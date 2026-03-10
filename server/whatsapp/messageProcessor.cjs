/**
 * Message processor for WhatsApp bot.
 * Parses commands, calls POS API, and sends replies.
 * Ready for future AI command interpreter (same interface).
 */

const path = require("path");
require("dotenv").config({ path: path.join(process.cwd(), ".env") });
const { parseCommand } = require("./commandParser.cjs");
const { transcribeVoice } = require("./voiceToText.cjs");
const { getIntentFromMessage, sanitizeProductName, sanitizeCustomerName, sanitizeSupplierName } = require("./intentFromMessage.cjs");
const { normalizeProductNameForDb, findClosestProduct } = require("./productNameMap.cjs");
const { classifyExpenseCategory } = require("./expenseCategoryClassifier.cjs");

const API_BASE = process.env.POS_API_URL || `http://localhost:${process.env.PORT || 3000}`;

const processedIds = new Set();
/** Pending voice-sale confirmations: from (phone) -> { items, paymentMethod, customer, cashier } */
const pendingVoiceSales = new Map();
/** Pending delete confirmations: from -> { productId, productName, at } */
const pendingDeletes = new Map();
/** Action history for undo: from -> [{ action, label, payload }], max 3 per user */
const actionHistory = new Map();
const MAX_ACTION_HISTORY = 3;
const PENDING_EXPIRY_MS = 5 * 60 * 1000;

/** Normalize sender key so history is consistent (WhatsApp can use different formats for same user). */
function actionHistoryKey(from) {
  const s = String(from || "").trim();
  if (!s) return s;
  const num = s.replace(/\D/g, "");
  return num ? `${num}` : s;
}

function pushActionHistory(from, entry) {
  const key = actionHistoryKey(from);
  if (!key) return;
  let list = actionHistory.get(key) || [];
  list = [entry, ...list].slice(0, MAX_ACTION_HISTORY);
  actionHistory.set(key, list);
}

function getActionHistory(from) {
  return actionHistory.get(actionHistoryKey(from)) || [];
}

function removeActionAt(from, index) {
  const key = actionHistoryKey(from);
  const list = actionHistory.get(key) || [];
  if (index < 0 || index >= list.length) return null;
  const removed = list[index];
  const next = list.filter((_, i) => i !== index);
  if (next.length === 0) actionHistory.delete(key);
  else actionHistory.set(key, next);
  return removed;
}

function getPendingSale(from) {
  const entry = pendingVoiceSales.get(from);
  if (!entry) return null;
  if (Date.now() - (entry.at || 0) > PENDING_EXPIRY_MS) {
    pendingVoiceSales.delete(from);
    return null;
  }
  return entry;
}

function getPendingDelete(from) {
  const entry = pendingDeletes.get(from);
  if (!entry) return null;
  if (Date.now() - (entry.at || 0) > PENDING_EXPIRY_MS) {
    pendingDeletes.delete(from);
    return null;
  }
  return entry;
}
const MAX_PROCESSED = 200;

function normalizePhone(phone) {
  if (!phone) return "";
  return String(phone).replace(/\D/g, "").slice(-10) || String(phone);
}

function getAllowedPhones() {
  const raw = process.env.ALLOWED_WHATSAPP_NUMBERS || "";
  if (!raw.trim()) return null;
  return raw.split(",").map((n) => normalizePhone(n.trim())).filter(Boolean);
}

async function processIncomingMessage(msg, client) {
  const contact = await msg.getContact();
  const from = contact.pushname || msg.from;
  let body = (msg.body || "").trim();

  const msgId = (msg.id && (msg.id._serialized || msg.id)) || `${from}-${Date.now()}-${body || "voice"}`;
  if (processedIds.has(msgId)) {
    console.log(`[${new Date().toISOString()}] From: ${from} | ${body || "[voice]"}`);
    console.log("  → Skipped (already processed)");
    return;
  }
  processedIds.add(msgId);
  if (processedIds.size > MAX_PROCESSED) {
    const first = processedIds.values().next().value;
    processedIds.delete(first);
  }

  if (msg.type === "ptt" || (msg.hasMedia && !body)) {
    console.log(`[${new Date().toISOString()}] From: ${from} | [voice message]`);
    try {
      const media = await msg.downloadMedia();
      if (media && media.data) {
        const buffer = Buffer.from(media.data, "base64");
        const transcript = await transcribeVoice(buffer, media.mimetype || "");
        if (transcript) {
          body = transcript.trim();
          console.log("  → Voice:", body);
        } else {
          const reply = "Could not process voice. Add GEMINI_API_KEY (or OPENAI_API_KEY) to server/.env for voice, or type your command.";
          await client.sendMessage(msg.from, reply);
          console.log("  → Reply sent to WhatsApp: Could not process voice.");
          return;
        }
      } else {
        const reply = "Could not download voice message. Try again or type your command.";
        await client.sendMessage(msg.from, reply);
        console.log("  → Reply sent to WhatsApp: Could not download voice.");
        return;
      }
    } catch (err) {
      console.error("Voice download/transcribe error:", err);
      const reply = "Voice processing failed. Type your command instead.";
      await client.sendMessage(msg.from, reply);
      console.log("  → Reply sent to WhatsApp: Voice processing failed.");
      return;
    }
  } else {
    console.log(`[${new Date().toISOString()}] From: ${from} | ${body}`);
  }

  const allowed = getAllowedPhones();
  if (allowed && allowed.length > 0) {
    const senderPhone = normalizePhone(msg.from);
    const allowedSet = new Set(allowed.map((n) => n.slice(-10)));
    const senderSuffix = senderPhone.slice(-10);
    if (!allowedSet.has(senderSuffix)) {
      const reply = "Not authorized. Only whitelisted numbers can run commands.";
      await client.sendMessage(msg.from, reply);
      console.log("  → Reply sent to WhatsApp: Not authorized.");
      return;
    }
  }

  const bodyUpper = body.trim().toUpperCase();
  if (bodyUpper === "YES" || bodyUpper === "NO") {
    const pending = getPendingSale(msg.from);
    if (pending) {
      if (bodyUpper === "YES") {
        pendingVoiceSales.delete(msg.from);
        try {
          const resProducts = await fetch(`${API_BASE}/api/products`);
          const products = await resProducts.json().catch(() => []);
          if (!resProducts.ok || !Array.isArray(products)) {
            await client.sendMessage(msg.from, "Could not fetch products. Sale cancelled.");
            return;
          }
          const saleItems = [];
          const notFound = [];
          for (const it of pending.items) {
            const qty = Math.max(1, it.quantity || 1);
            const closest = findClosestProduct(it.name || "", products);
            const product = closest ? closest.product : null;
            if (product && product.stock >= qty) {
              saleItems.push({
                product: { id: product.id, name: product.name, price: Number(product.price) },
                quantity: qty,
              });
            } else if (product && product.stock < qty) {
              notFound.push(`${product.name} (only ${product.stock} in stock)`);
            } else {
              notFound.push(it.name || "?");
            }
          }
          if (saleItems.length === 0) {
            await client.sendMessage(msg.from, `Product(s) not found or out of stock: ${notFound.join(", ")}. Try *list products* to see available items.`);
            return;
          }
          const total = saleItems.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
          const resSale = await fetch(`${API_BASE}/api/sales`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: saleItems,
              total,
              paymentMethod: pending.paymentMethod || "cash",
              cashier: pending.cashier || "WhatsApp User",
              customerId: null,
            }),
          });
          const saleData = await resSale.json().catch(() => ({}));
          if (resSale.ok) {
            const saleLabel = saleItems.map((i) => `${i.quantity} ${i.product.name}`).join(", ");
            pushActionHistory(msg.from, { action: "voice_sale", label: `sell ${saleLabel}`, payload: { saleId: saleData.id } });
            const extra = notFound.length > 0 ? `\n(Skipped: ${notFound.join(", ")})` : "";
            await client.sendMessage(msg.from, `✅ *Sale completed!*\nTotal: Rs ${total.toFixed(2)}\nPayment: ${pending.paymentMethod || "cash"}${extra}`);
            console.log("  → Voice sale (confirmed):", saleItems.length, "item(s), Rs", total);
          } else {
            await client.sendMessage(msg.from, saleData.error || `Sale failed (${resSale.status}).`);
          }
        } catch (err) {
          console.error("Voice sale (YES) error:", err);
          await client.sendMessage(msg.from, "Error completing sale. Please try again.");
        }
      } else {
        pendingVoiceSales.delete(msg.from);
        await client.sendMessage(msg.from, "Request cancelled. Please send the correct instruction (e.g. *Sell 2 Milk, payment cash*).");
        console.log("  → Voice sale: user said NO, cancelled");
      }
      return;
    }
    const pendingDel = getPendingDelete(msg.from);
    if (pendingDel) {
      if (bodyUpper === "YES") {
        pendingDeletes.delete(msg.from);
        try {
          const res = await fetch(`${API_BASE}/api/products/${encodeURIComponent(pendingDel.productId)}?deletedBy=${encodeURIComponent(from || "WhatsApp User")}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
          });
          if (res.status === 204) {
            await client.sendMessage(msg.from, `The product *${pendingDel.productName}* has been deleted from the inventory.`);
            console.log("  → Delete (confirmed):", pendingDel.productName);
          } else if (res.status === 403) {
            await client.sendMessage(msg.from, "This product cannot be deleted because it has sales history in the system.");
            console.log("  → Delete blocked (has history):", pendingDel.productName);
          } else {
            const data = await res.json().catch(() => ({}));
            await client.sendMessage(msg.from, data.error || `Error: ${res.status}`);
          }
        } catch (err) {
          console.error("Delete (YES) error:", err);
          await client.sendMessage(msg.from, "Error deleting product. Please try again.");
        }
      } else {
        pendingDeletes.delete(msg.from);
        await client.sendMessage(msg.from, "Request cancelled. No product was deleted.");
        console.log("  → Delete: user said NO, cancelled");
      }
      return;
    }
  }

  let command = parseCommand(body);
  if (command.action === "unknown") {
    const intentCommand = await getIntentFromMessage(body);
    if (intentCommand) {
      if (intentCommand.action === "out_of_scope") {
        const reply = "I can only help with POS: products, customers, suppliers. Type *help* for all commands.";
        await client.sendMessage(msg.from, reply);
        console.log("  → Reply: out of scope (POS only)");
        return;
      }
      command = intentCommand;
      console.log("  → Intent:", command.action, command.name || command.term || command.nameOrId || "");
    }
  }

  let reply;

  try {
    if (command.action === "undo") {
      const history = getActionHistory(msg.from);
      const position = Math.min(Math.max(1, Number(command.undoPosition) || 1), 3);
      const index = position - 1;
      if (index >= history.length) {
        reply = "No command available to undo.";
        console.log("  → Undo: no action at position", position, "history:", history.length);
      } else {
        const entry = removeActionAt(msg.from, index);
        if (!entry) {
          reply = "No command available to undo.";
        } else {
          let ok = false;
          try {
            if (entry.action === "add_expense" && entry.payload?.expenseId) {
              const res = await fetch(`${API_BASE}/api/expenses/${encodeURIComponent(entry.payload.expenseId)}`, { method: "DELETE" });
              ok = res.status === 204;
            } else if (entry.action === "add_product" && entry.payload?.productId) {
              const res = await fetch(`${API_BASE}/api/products/${encodeURIComponent(entry.payload.productId)}`, { method: "DELETE" });
              ok = res.ok || res.status === 204;
            } else if (entry.action === "add_customer" && entry.payload?.customerId) {
              const res = await fetch(`${API_BASE}/api/customers/${encodeURIComponent(entry.payload.customerId)}?deletedBy=${encodeURIComponent(from || "WhatsApp")}`, { method: "DELETE" });
              ok = res.ok || res.status === 204;
            } else if (entry.action === "add_supplier" && entry.payload?.supplierId) {
              const res = await fetch(`${API_BASE}/api/suppliers/${encodeURIComponent(entry.payload.supplierId)}?deletedBy=${encodeURIComponent(from || "WhatsApp")}`, { method: "DELETE" });
              ok = res.ok || res.status === 204;
            } else if (entry.action === "voice_sale" && entry.payload?.saleId) {
              const res = await fetch(`${API_BASE}/api/sales/${encodeURIComponent(entry.payload.saleId)}`, { method: "DELETE" });
              ok = res.status === 204;
            }
          } catch (err) {
            console.error("Undo reverse error:", err);
          }
          if (ok) {
            reply = `The command "${entry.label}" has been successfully undone.`;
            console.log("  → Undo: reversed", entry.action, entry.label);
          } else {
            reply = `Could not undo the command "${entry.label}". It may no longer be reversible.`;
            console.log("  → Undo: failed to reverse", entry.action);
          }
        }
      }
    } else if (command.action === "add_product") {
      const productName = sanitizeProductName(command.name) || command.name;
      const res = await fetch(`${API_BASE}/api/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: productName,
          price: command.price,
          cost: command.price,
          stock: 0,
          category: "",
          lowStockThreshold: command.threshold ?? 5,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        pushActionHistory(msg.from, { action: "add_product", label: `add product ${data.name}`, payload: { productId: data.id } });
        reply = `Product added: ${data.name} — $${Number(data.price).toFixed(2)}`;
        console.log(`  → Product added: ${data.name} ($${Number(data.price).toFixed(2)})`);
      } else {
        reply = data.error || `Error: ${res.status}`;
        console.log(`  → Error: ${reply}`);
      }
    } else if (command.action === "list_products") {
      const res = await fetch(`${API_BASE}/api/products`);
      const products = await res.json().catch(() => []);
      if (!res.ok) {
        reply = "Could not fetch products. Is the POS server running?";
        console.log("  → Error: could not fetch products");
      } else if (!products.length) {
        reply = "No products in inventory.";
        console.log("  → List products: 0 items");
      } else {
        const list = products.map((p) => `• ${p.name} — $${Number(p.price).toFixed(2)}`).join("\n");
        reply = list;
        console.log(`  → List products: ${products.length} item(s)`);
      }
    } else if (command.action === "low_stock") {
      const res = await fetch(`${API_BASE}/api/products`);
      const products = await res.json().catch(() => []);
      if (!res.ok) {
        reply = "Could not fetch products. Is the POS server running?";
        console.log("  → Error: could not fetch products");
      } else {
        const low = products.filter((p) => Number(p.stock) <= Number(p.lowStockThreshold ?? 5));
        if (!low.length) {
          reply = "No low-stock items.";
          console.log("  → Low stock: 0 items");
        } else {
          const list = low.map((p) => `• ${p.name} — stock: ${p.stock} (min ${p.lowStockThreshold ?? 5})`).join("\n");
          reply = list;
          console.log(`  → Low stock: ${low.length} item(s)`);
        }
      }
    } else if (command.action === "search") {
      const res = await fetch(`${API_BASE}/api/products`);
      const products = await res.json().catch(() => []);
      if (!res.ok) {
        reply = "Could not fetch products. Is the POS server running?";
        console.log("  → Error: could not fetch products");
      } else {
        const term = (command.term || "").toLowerCase();
        const matches = products.filter((p) => (p.name || "").toLowerCase().includes(term));
        if (!matches.length) {
          reply = `No products matching "${command.term}".`;
          console.log(`  → Search "${command.term}": 0 results`);
        } else {
          const list = matches.map((p) => `• ${p.name} — $${Number(p.price).toFixed(2)} (stock: ${p.stock})`).join("\n");
          reply = list;
          console.log(`  → Search "${command.term}": ${matches.length} result(s)`);
        }
      }
    } else if (command.action === "delete_product") {
      const nameOrId = (command.nameOrId || "").trim();
      const looksLikeId = /^[a-z0-9]+-\d+$/i.test(nameOrId);
      let productId = null;
      let productName = null;
      let askConfirmation = false;

      if (looksLikeId) {
        productId = nameOrId;
        const resGet = await fetch(`${API_BASE}/api/products/${encodeURIComponent(productId)}`);
        if (resGet.ok) {
          const p = await resGet.json().catch(() => ({}));
          productName = p.name;
        } else {
          reply = `Product not found: "${nameOrId}".`;
          console.log(`  → Delete product: not found (ID) "${nameOrId}"`);
        }
      } else {
        const resList = await fetch(`${API_BASE}/api/products`);
        const products = await resList.json().catch(() => []);
        if (!resList.ok) {
          reply = "Could not fetch products. Is the POS server running?";
          console.log("  → Error: could not fetch products");
        } else {
          const closest = findClosestProduct(nameOrId, products);
          if (!closest) {
            reply = `Product not found: "${nameOrId}".`;
            console.log(`  → Delete product: not found "${nameOrId}"`);
          } else if (closest.confidence === "exact") {
            productId = closest.product.id;
            productName = closest.product.name;
          } else {
            productId = closest.product.id;
            productName = closest.product.name;
            askConfirmation = true;
          }
        }
      }

      if (askConfirmation && productId && productName) {
        pendingDeletes.set(msg.from, { productId, productName, at: Date.now() });
        reply = `I found a similar product in inventory: *${productName}*.\nDid you mean to delete *${productName}*?\nReply YES to confirm or NO to cancel.`;
        console.log(`  → Delete: asking confirmation for "${productName}"`);
      } else if (productId && !reply) {
        const res = await fetch(`${API_BASE}/api/products/${encodeURIComponent(productId)}?deletedBy=${encodeURIComponent(from || "WhatsApp User")}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
        });
        if (res.status === 204) {
          const displayName = productName || productId;
          reply = `The product *${displayName}* has been deleted from the inventory.`;
          console.log(`  → Product deleted: ${displayName}`);
        } else if (res.status === 403) {
          reply = "This product cannot be deleted because it has sales history in the system.";
          console.log(`  → Delete product (has history): ${productName || productId}`);
        } else {
          const data = await res.json().catch(() => ({}));
          reply = data.error || `Error: ${res.status}`;
          console.log(`  → Delete product error: ${reply}`);
        }
      }
    } else if (command.action === "set_threshold") {
      const nameOrId = (command.nameOrId || "").trim();
      const threshold = Number(command.threshold);
      if (Number.isNaN(threshold) || threshold < 0) {
        reply = "Invalid threshold. Use a number ≥ 0 (e.g. set threshold for Milk to 10).";
      } else {
        let productId = null;
        let productName = null;
        const looksLikeId = /^[a-z0-9]+-\d+$/i.test(nameOrId);
        if (looksLikeId) {
          const resGet = await fetch(`${API_BASE}/api/products/${encodeURIComponent(nameOrId)}`);
          if (resGet.ok) {
            const p = await resGet.json().catch(() => ({}));
            productId = p.id;
            productName = p.name;
          }
        } else {
          const resList = await fetch(`${API_BASE}/api/products`);
          const products = await resList.json().catch(() => []);
          if (!resList.ok) {
            reply = "Could not fetch products. Is the POS server running?";
          } else {
            const term = nameOrId.toLowerCase();
            let matches = products.filter((p) => (p.name || "").toLowerCase().includes(term));
            if (matches.length === 0 && /^.+\s+\d+$/.test(nameOrId.trim())) {
              const nameOnly = nameOrId.replace(/\s+\d+$/, "").trim().toLowerCase();
              if (nameOnly) matches = products.filter((p) => (p.name || "").toLowerCase().includes(nameOnly));
            }
            if (matches.length === 0) reply = `Product not found: "${nameOrId}".`;
            else if (matches.length > 1) {
              reply = `Multiple products match. Use ID:\n${matches.slice(0, 5).map((p) => `• set threshold for ${p.id} to ${threshold}`).join("\n")}`;
            } else {
              productId = matches[0].id;
              productName = matches[0].name;
            }
          }
        }
        if (productId && !reply) {
          const resGet = await fetch(`${API_BASE}/api/products/${encodeURIComponent(productId)}`);
          if (!resGet.ok) {
            reply = "Product not found.";
          } else {
            const product = await resGet.json().catch(() => ({}));
            const body = {
              name: product.name ?? "",
              nameUr: product.nameUr ?? null,
              price: Number(product.price) ?? 0,
              cost: Number(product.cost) ?? 0,
              stock: Number(product.stock) ?? 0,
              category: product.category ?? "",
              lowStockThreshold: threshold,
            };
            const resPut = await fetch(`${API_BASE}/api/products/${encodeURIComponent(productId)}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            if (resPut.ok) {
              const displayName = productName || productId;
              reply = `Low-stock threshold for ${displayName} set to ${threshold}.`;
              console.log(`  → Set threshold: ${displayName} = ${threshold}`);
            } else {
              const data = await resPut.json().catch(() => ({}));
              reply = data.error || `Error: ${resPut.status}`;
            }
          }
        }
      }
    } else if (command.action === "set_stock") {
      const nameOrId = (command.nameOrId || "").trim();
      const stock = Number(command.stock);
      if (Number.isNaN(stock) || stock < 0) {
        reply = "Invalid stock. Use a number ≥ 0 (e.g. set stock for Milk to 50).";
      } else {
        let productId = null;
        let productName = null;
        const looksLikeId = /^[a-z0-9]+-\d+$/i.test(nameOrId);
        if (looksLikeId) {
          const resGet = await fetch(`${API_BASE}/api/products/${encodeURIComponent(nameOrId)}`);
          if (resGet.ok) {
            const p = await resGet.json().catch(() => ({}));
            productId = p.id;
            productName = p.name;
          }
        } else {
          const resList = await fetch(`${API_BASE}/api/products`);
          const products = await resList.json().catch(() => []);
          if (!resList.ok) {
            reply = "Could not fetch products. Is the POS server running?";
          } else {
            const term = nameOrId.toLowerCase();
            let matches = products.filter((p) => (p.name || "").toLowerCase().includes(term));
            if (matches.length === 0 && /^.+\s+\d+$/.test(nameOrId.trim())) {
              const nameOnly = nameOrId.replace(/\s+\d+$/, "").trim().toLowerCase();
              if (nameOnly) matches = products.filter((p) => (p.name || "").toLowerCase().includes(nameOnly));
            }
            if (matches.length === 0) reply = `Product not found: "${nameOrId}".`;
            else if (matches.length > 1) {
              reply = `Multiple products match. Use ID:\n${matches.slice(0, 5).map((p) => `• set stock for ${p.id} to ${stock}`).join("\n")}`;
            } else {
              productId = matches[0].id;
              productName = matches[0].name;
            }
          }
        }
        if (productId && !reply) {
          const resGet = await fetch(`${API_BASE}/api/products/${encodeURIComponent(productId)}`);
          if (!resGet.ok) {
            reply = "Product not found.";
          } else {
            const product = await resGet.json().catch(() => ({}));
            const body = {
              name: product.name ?? "",
              nameUr: product.nameUr ?? null,
              price: Number(product.price) ?? 0,
              cost: Number(product.cost) ?? 0,
              stock,
              category: product.category ?? "",
              lowStockThreshold: Number(product.lowStockThreshold) ?? 5,
            };
            const resPut = await fetch(`${API_BASE}/api/products/${encodeURIComponent(productId)}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            if (resPut.ok) {
              const displayName = productName || productId;
              reply = `Stock for ${displayName} set to ${stock}.`;
              console.log(`  → Set stock: ${displayName} = ${stock}`);
            } else {
              const data = await resPut.json().catch(() => ({}));
              reply = data.error || `Error: ${resPut.status}`;
            }
          }
        }
      }
    } else if (command.action === "add_customer_help") {
      reply = [
        "*How to add a customer*",
        "",
        "You need the customer's *name* and *phone number*.",
        "",
        "Send: *add customer <name> <phone>*",
        "",
        "Example: add customer John 03001234567",
        "Example: add customer Ahmed Khan 03001234567",
        "",
        "The customer will appear in the Customers tab in your POS.",
      ].join("\n");
      console.log("  → Add customer help");
    } else if (command.action === "add_supplier_help") {
      reply = [
        "*How to add a supplier*",
        "",
        "You need the supplier's *name* (required). You can also add *phone* and *email* (optional).",
        "",
        "Formats:",
        "• *add supplier <name>*",
        "  Example: add supplier ABC Traders",
        "",
        "• *add supplier <name> <phone>*",
        "  Example: add supplier ABC Traders 03001234567",
        "",
        "• *add supplier <name> <phone> <email>*",
        "  Example: add supplier ABC Traders 03001234567 abc@company.com",
        "",
        "• Natural: *add supplier ABC and its phone is 03001234567*",
        "",
        "The supplier will appear in the Suppliers tab in your POS.",
      ].join("\n");
      console.log("  → Add supplier help");
    } else if (command.action === "add_expense") {
      const amount = Number(command.amount);
      const rawDescription = (command.description || "").trim();
      if (Number.isNaN(amount) || amount < 0) {
        reply = "Please send a valid amount. Example: bijli ka bill add kr do 7000";
      } else if (!rawDescription) {
        reply = "Please mention the expense (e.g. rent, bijli ka bill). Example: add expense 7000 bijli ka bill";
      } else {
        const { category, description } = classifyExpenseCategory(rawDescription);
        try {
          const res = await fetch(`${API_BASE}/api/expenses`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              amount,
              category,
              description: description.slice(0, 500),
            }),
          });
          const expData = await res.json().catch(() => ({}));
          if (res.ok) {
            pushActionHistory(msg.from, { action: "add_expense", label: `add expense ${description}`, payload: { expenseId: expData.id } });
            reply = `Expense recorded: *${description}* (${category}) – ${amount.toLocaleString()} added.`;
            console.log("  → Expense added:", { amount, category, description });
          } else {
            reply = expData.error || `Error: ${res.status}`;
          }
        } catch (err) {
          console.error("Add expense error:", err);
          reply = "Could not add expense. Is the POS server running?";
        }
      }
    } else if (command.action === "add_customer") {
      let name = sanitizeCustomerName((command.name || "").trim());
      if (!name || /phone|number|add\s+customer|\d{4,}/i.test(name) || name.length > 40) {
        const first = name.match(/^([A-Za-z\u00C0-\u024F]+)/) || (command.name || "").match(/\b([A-Za-z\u00C0-\u024F]{2,})\b/);
        name = first ? first[1] : "Customer";
      }
      const phone = (command.phone || "").replace(/\D/g, "").trim();
      if (!name) {
        reply = "Customer name is required. Send: add customer <name> <phone>";
      } else if (!phone) {
        reply = "Phone number is required. Example: add customer John 03001234567";
      } else {
        const res = await fetch(`${API_BASE}/api/customers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, phone }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          pushActionHistory(msg.from, { action: "add_customer", label: `add customer ${data.name}`, payload: { customerId: data.id } });
          reply = `Customer added: ${data.name} — ${data.phone || phone}`;
          console.log(`  → Customer added: ${data.name} (${data.phone || phone})`);
        } else {
          reply = data.error || `Error: ${res.status}`;
          console.log("  → Error:", reply);
        }
      }
    } else if (command.action === "add_supplier") {
      let name = sanitizeSupplierName((command.name || "").trim());
      if (!name || /phone|number|add\s+supplier|\d{4,}|@/i.test(name) || name.length > 50) {
        const first = (command.name || "").match(/\b([A-Za-z\u00C0-\u024F]{2,}(?:\s+[A-Za-z\u00C0-\u024F]{2,})?)\b/);
        name = first ? first[1].trim() : "Supplier";
      }
      const phone = command.phone != null ? String(command.phone).replace(/\D/g, "").trim() || null : null;
      const email = (command.email || "").trim();
      if (!name) {
        reply = "Supplier name is required. Type *how to add supplier* for instructions.";
      } else {
        const res = await fetch(`${API_BASE}/api/suppliers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, phone: phone || undefined, email: email || undefined }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          pushActionHistory(msg.from, { action: "add_supplier", label: `add supplier ${data.name}`, payload: { supplierId: data.id } });
          const parts = [data.name];
          if (data.phone) parts.push(data.phone);
          if (data.email) parts.push(data.email);
          reply = `Supplier added: ${parts.join(" — ")}`;
          console.log(`  → Supplier added: ${data.name}`);
        } else {
          reply = data.error || `Error: ${res.status}`;
          console.log("  → Error:", reply);
        }
      }
    } else if (command.action === "sales_report_today") {
      const statsUrl = `${API_BASE}/api/sales/stats?period=today`;
      let res;
      try {
        res = await fetch(statsUrl);
      } catch (err) {
        reply = `Could not reach POS API at ${API_BASE}. Ensure the POS server is running (npm start in server/).`;
        console.log("  → Sales report: fetch failed", err?.message || err);
        res = null;
      }
      if (res) {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          reply = data.error || `Could not fetch sales (${res.status}). Is the POS server running?`;
          console.log("  → Sales report: error", res.status, data.error || "");
      } else {
        const fmt = (n) => Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const orders = data.salesCount ?? 0;
        const revenue = data.totalRevenue ?? 0;
        const cash = (data.paymentBreakdown && data.paymentBreakdown.cash) ?? 0;
        const card = (data.paymentBreakdown && data.paymentBreakdown.card) ?? 0;
        const top = data.topProduct;

        const parts = [
          "📊 *Today's Sales Report*",
          "",
          `Total Orders: ${orders}`,
          `Total Revenue: Rs ${fmt(revenue)}`,
          "",
        ];
        if (top && top.productName) {
          parts.push("Top Product:", top.productName, `Units Sold: ${top.quantitySold || 0}`, `Revenue: Rs ${fmt(top.revenue)}`, "");
        }
        parts.push("Payment Breakdown:", `Cash: Rs ${fmt(cash)}`, `Card: Rs ${fmt(card)}`);
        reply = parts.join("\n");
        console.log(`  → Sales report: ${orders} orders, Rs ${revenue} revenue`);
      }
    }
    } else if (command.action === "voice_sale") {
      const items = command.items || [];
      const paymentMethod = command.paymentMethod === "card" ? "card" : "cash";
      const cashier = from || "WhatsApp User";
      const needsConfirmation = command.saleAction === "ask_confirmation" || command.saleConfidence === "low";

      if (needsConfirmation && items.length > 0) {
        const first = items[0];
        const productLabel = (first.name || "unknown").toLowerCase() === "unknown" ? "?" : first.name;
        const qtyLabel = (first.quantity == null || first.quantity === 0) ? "?" : first.quantity;
        pendingVoiceSales.set(msg.from, {
          items: [...items],
          paymentMethod,
          customer: command.customer || null,
          cashier,
          at: Date.now(),
        });
        reply = "I may have misunderstood your request.\n\nThis is what I understood:\n*Sell " + qtyLabel + " " + productLabel + "*\n\nIs this correct? Reply *YES* to confirm or *NO* to cancel.";
        console.log("  → Voice sale: ask_confirmation", { product: productLabel, quantity: qtyLabel });
      } else if (items.length === 0 || items.some((it) => !it.name || (it.name || "").toLowerCase() === "unknown")) {
        reply = "I couldn't understand the product or quantity. Please say clearly, e.g. *Sell 2 Milk, payment cash*.";
        console.log("  → Voice sale: missing product/quantity");
      } else {
        const resProducts = await fetch(`${API_BASE}/api/products`);
        const products = await resProducts.json().catch(() => []);
        if (!resProducts.ok || !Array.isArray(products)) {
          reply = "Could not fetch products. Is the POS server running?";
          console.log("  → Voice sale: products fetch failed");
        } else {
          const saleItems = [];
          const notFound = [];
          const similarForConfirmation = [];
          for (const it of items) {
            const qty = Math.max(1, it.quantity || 1);
            const closest = findClosestProduct(it.name || "", products);
            if (!closest) {
              notFound.push(it.name || "?");
              continue;
            }
            const { product, confidence } = closest;
            if (product.stock < qty) {
              notFound.push(`${product.name} (only ${product.stock} in stock, asked ${qty})`);
              continue;
            }
            if (confidence === "exact") {
              saleItems.push({
                product: { id: product.id, name: product.name, price: Number(product.price) },
                quantity: qty,
              });
            } else {
              similarForConfirmation.push({
                product: { id: product.id, name: product.name, price: Number(product.price) },
                quantity: qty,
                spoken: it.name,
              });
            }
          }
          if (similarForConfirmation.length > 0 && saleItems.length === 0) {
            const first = similarForConfirmation[0];
            const parts = similarForConfirmation.map((s) => `${s.quantity} ${s.product.name}`).join(", ");
            pendingVoiceSales.set(msg.from, {
              items: similarForConfirmation.map((s) => ({ name: s.product.name, quantity: s.quantity })),
              paymentMethod,
              customer: null,
              cashier,
              at: Date.now(),
            });
            reply = `I found a similar product in inventory: *${first.product.name}*.\n\nDid you mean to sell ${parts}?\n\nReply *YES* to confirm or *NO* to cancel.`;
            console.log("  → Voice sale: similar product, ask confirmation", first.product.name);
          } else if (notFound.length > 0 && saleItems.length === 0) {
            reply = `Product(s) not found or out of stock: ${notFound.join(", ")}. Try *list products* to see available items.`;
            console.log("  → Voice sale: no matches", notFound);
          } else if (saleItems.length === 0) {
            reply = "No valid items for sale. Specify product names (e.g. Sell 2 detergent, payment cash).";
          } else if (similarForConfirmation.length > 0) {
            const pendingItems = [...saleItems, ...similarForConfirmation.map((s) => ({ product: s.product, quantity: s.quantity }))];
            const parts = similarForConfirmation.map((s) => `${s.quantity} ${s.product.name}`).join(", ");
            pendingVoiceSales.set(msg.from, {
              items: pendingItems.map((i) => ({ name: i.product.name, quantity: i.quantity })),
              paymentMethod,
              customer: null,
              cashier,
              at: Date.now(),
            });
            reply = `I found a similar product in inventory: *${similarForConfirmation[0].product.name}*.\n\nDid you mean to sell ${parts}${saleItems.length > 0 ? " (and " + saleItems.map((i) => `${i.quantity} ${i.product.name}`).join(", ") + ")" : ""}?\n\nReply *YES* to confirm or *NO* to cancel.`;
            console.log("  → Voice sale: partial similar, ask confirmation");
          } else {
            const total = saleItems.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
            const resSale = await fetch(`${API_BASE}/api/sales`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                items: saleItems,
                total,
                paymentMethod,
                cashier,
                customerId: null,
              }),
            });
            const saleData = await resSale.json().catch(() => ({}));
            if (resSale.ok) {
              const saleLabel = saleItems.map((i) => `${i.quantity} ${i.product.name}`).join(", ");
              pushActionHistory(msg.from, { action: "voice_sale", label: `sell ${saleLabel}`, payload: { saleId: saleData.id } });
              const extra = notFound.length > 0 ? `\n(Skipped: ${notFound.join(", ")})` : "";
              reply = `✅ *Sale completed!*\nTotal: Rs ${total.toFixed(2)}\nPayment: ${paymentMethod}${extra}`;
              console.log(`  → Voice sale: ${saleItems.length} item(s), Rs ${total}, ${paymentMethod}`);
            } else {
              reply = saleData.error || `Sale failed (${resSale.status}).`;
              console.log("  → Voice sale error:", reply);
            }
          }
        }
      }
    } else if (command.action === "help") {
      reply = [
        "*POS WhatsApp Bot – Commands*",
        "",
        "*Products:*",
        "• add product <name> <price>",
        "• list products – show all products",
        "• low stock – items at or below threshold",
        "• search <term> – find products",
        "• set threshold for <name> to <number>",
        "• set stock for <name> to <number>",
        "• delete product <name or id>",
        "",
        "*Customers:*",
        "• add customer <name> <phone>",
        "• Type *how to add customer* for details",
        "",
        "*Suppliers:*",
        "• add supplier <name> [phone] [email]",
        "• Type *how to add supplier* for details",
        "",
        "*Expenses:*",
        "• *<category> add kr do <amount>* – e.g. bijli ka bill add kr do 7000",
        "• *<amount> add kr do <category>* – e.g. 7000 add kr do rent",
        "• *add expense <amount> <category>* – e.g. add expense 5000 utilities",
        "• Voice: *acha yar mera bijli ka bill add kr do 7000*",
        "",
        "*Sales:*",
        "• *give me today's sales* – sales report (orders, revenue, top product, payment breakdown)",
        "• *show sales report today* – same as above",
        "",
        "*Voice/Text Sale:*",
        "• *Sell 2 Milk, payment cash* – clear instruction runs immediately",
        "• *Sell 1 detergent, payment card* – or say product name and quantity",
        "• If unclear, bot will ask: Reply *YES* to confirm or *NO* to cancel",
        "",
        "*Undo:*",
        "• *undo* or *undo 1* – undo most recent command",
        "• *undo 2* – undo 2nd last, *undo 3* – undo 3rd last",
        "• *pehla undo karo*, *dusra undo karo*, *undo kar do*",
        "",
        "• help – show this message",
        "",
        "Voice messages work for any command. Needs GEMINI_API_KEY or OPENAI_API_KEY.",
      ].join("\n");
    } else {
      reply = "Unknown command. Send *help* for commands.";
      console.log("  → Unknown command");
    }
  } catch (err) {
    console.error("Message processing error:", err);
    reply = "Error reaching POS. Is the server running on " + API_BASE + "?";
  }

  if (reply) {
    await client.sendMessage(msg.from, reply);
    const preview = reply.length > 60 ? reply.slice(0, 57) + "..." : reply;
    console.log("  → Reply sent to WhatsApp:", preview.replace(/\n/g, " "));
  }
}

module.exports = {
  processIncomingMessage,
};
