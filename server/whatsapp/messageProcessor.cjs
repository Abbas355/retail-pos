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

const API_BASE = process.env.POS_API_URL || `http://localhost:${process.env.PORT || 3000}`;

const processedIds = new Set();
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
    if (command.action === "add_product") {
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

      if (looksLikeId) {
        productId = nameOrId;
        const resGet = await fetch(`${API_BASE}/api/products/${encodeURIComponent(productId)}`);
        if (resGet.ok) {
          const p = await resGet.json().catch(() => ({}));
          productName = p.name;
        }
      } else {
        const resList = await fetch(`${API_BASE}/api/products`);
        const products = await resList.json().catch(() => []);
        if (!resList.ok) {
          reply = "Could not fetch products. Is the POS server running?";
          console.log("  → Error: could not fetch products");
        } else {
          let term = nameOrId.toLowerCase();
          let matches = products.filter((p) => (p.name || "").toLowerCase().includes(term));
          if (matches.length === 0 && /^.+\s+\d+$/.test(nameOrId.trim())) {
            const nameOnly = nameOrId.replace(/\s+\d+$/, "").trim();
            if (nameOnly) {
              term = nameOnly.toLowerCase();
              matches = products.filter((p) => (p.name || "").toLowerCase().includes(term));
            }
          }
          if (matches.length === 0) {
            reply = `Product not found: "${nameOrId}".`;
            console.log(`  → Delete product: not found "${nameOrId}"`);
          } else if (matches.length > 1) {
            reply = `Multiple products match. Use ID:\n${matches.slice(0, 5).map((p) => `• delete product ${p.id}`).join("\n")}`;
            console.log(`  → Delete product: ${matches.length} matches for "${nameOrId}"`);
          } else {
            productId = matches[0].id;
            productName = matches[0].name;
          }
        }
      }

      if (productId && !reply) {
        const res = await fetch(`${API_BASE}/api/products/${encodeURIComponent(productId)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
        });
        if (res.status === 204) {
          const displayName = productName || productId;
          reply = `Product deleted: ${displayName}`;
          console.log(`  → Product deleted: ${displayName}`);
        } else {
          const data = await res.json().catch(() => ({}));
          reply = data.error || `Error: ${res.status}`;
          console.log(`  → Error: ${reply}`);
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

      const resProducts = await fetch(`${API_BASE}/api/products`);
      const products = await resProducts.json().catch(() => []);
      if (!resProducts.ok || !Array.isArray(products)) {
        reply = "Could not fetch products. Is the POS server running?";
        console.log("  → Voice sale: products fetch failed");
      } else {
        const saleItems = [];
        const notFound = [];
        for (const it of items) {
          const qty = Math.max(1, it.quantity || 1);
          const term = (it.name || "").toLowerCase().trim();
          const matches = products.filter((p) => (p.name || "").toLowerCase().includes(term) || term.includes((p.name || "").toLowerCase()));
          const product = matches.length >= 1 ? (matches.find((p) => (p.name || "").toLowerCase() === term) || matches[0]) : null;
          if (product && product.stock >= qty) {
            saleItems.push({
              product: { id: product.id, name: product.name, price: Number(product.price) },
              quantity: qty,
            });
          } else if (product && product.stock < qty) {
            notFound.push(`${product.name} (only ${product.stock} in stock, asked ${qty})`);
          } else {
            notFound.push(term || "?");
          }
        }
        if (notFound.length > 0 && saleItems.length === 0) {
          reply = `Product(s) not found or out of stock: ${notFound.join(", ")}. Try *list products* to see available items.`;
          console.log("  → Voice sale: no matches", notFound);
        } else if (saleItems.length === 0) {
          reply = "No valid items for sale. Specify product names (e.g. add detergent to cart, payment cash).";
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
            const extra = notFound.length > 0 ? `\n(Skipped: ${notFound.join(", ")})` : "";
            reply = `✅ *Sale completed!*\nTotal: Rs ${total.toFixed(2)}\nPayment: ${paymentMethod}${extra}`;
            console.log(`  → Voice sale: ${saleItems.length} item(s), Rs ${total}, ${paymentMethod}`);
          } else {
            reply = saleData.error || `Sale failed (${resSale.status}).`;
            console.log("  → Voice sale error:", reply);
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
        "*Sales:*",
        "• *give me today's sales* – sales report (orders, revenue, top product, payment breakdown)",
        "• *show sales report today* – same as above",
        "",
        "*Voice/Text Sale (complete purchase):*",
        "• *add detergent to cart, payment is card* – add product, pay with card/cash",
        "• *add milk and bread, pay with cash, complete the sale*",
        "• *add 2 detergent and 1 milk, payment card* – specify quantity",
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
