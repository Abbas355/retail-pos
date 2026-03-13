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
/** Pending voice-sale: from -> { items, paymentMethod, customer, cashier, at, state?: 'confirm'|'add_more'|'waiting_products' } (used when no multi-bill flow) */
const pendingVoiceSales = new Map();
/** Multi-customer open bills: from -> { [customerKey]: { customerName, items: [{ name, quantity }], paymentMethod, state?: 'open'|'add_more'|'waiting_products', at } } */
const pendingBills = new Map();
/** When asking "Which customer?" we wait for next message to pick customer: from -> { at } */
const pendingWhichCustomer = new Map();
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

function normalizeCustomerKey(name) {
  if (!name || typeof name !== "string") return "";
  return String(name).trim().toLowerCase().replace(/\s+/g, "_") || "";
}

function getBills(from) {
  const obj = pendingBills.get(from);
  if (!obj) return {};
  const now = Date.now();
  const out = {};
  for (const [k, bill] of Object.entries(obj)) {
    if (bill && (now - (bill.at || 0)) <= PENDING_EXPIRY_MS) out[k] = bill;
  }
  if (Object.keys(out).length === 0) pendingBills.delete(from);
  else pendingBills.set(from, out);
  return out;
}

function getBill(from, customerKey) {
  const bills = getBills(from);
  return bills[customerKey] || null;
}

function setBill(from, customerKey, bill) {
  let obj = pendingBills.get(from) || {};
  obj = { ...obj, [customerKey]: { ...bill, at: Date.now() } };
  pendingBills.set(from, obj);
}

function removeBill(from, customerKey) {
  const obj = pendingBills.get(from) || {};
  const next = { ...obj };
  delete next[customerKey];
  if (Object.keys(next).length === 0) pendingBills.delete(from);
  else pendingBills.set(from, next);
}

function getOpenBillCustomerNames(from) {
  const bills = getBills(from);
  return Object.values(bills).map((b) => (b.customerName || "Customer")).filter(Boolean);
}

function getSingleOpenBill(from) {
  const bills = getBills(from);
  const keys = Object.keys(bills);
  if (keys.length !== 1) return null;
  return { customerKey: keys[0], bill: bills[keys[0]] };
}

function getBillInWaitingProducts(from) {
  const bills = getBills(from);
  for (const [customerKey, bill] of Object.entries(bills)) {
    if (bill.state === "waiting_products") return { customerKey, bill };
  }
  return null;
}

function getBillInAddMoreOrPayment(from) {
  const bills = getBills(from);
  for (const [customerKey, bill] of Object.entries(bills)) {
    if (bill.state === "add_more_or_payment") return { customerKey, bill };
  }
  return null;
}

function getBillInChoosePayment(from) {
  const bills = getBills(from);
  for (const [customerKey, bill] of Object.entries(bills)) {
    if (bill.state === "choose_payment") return { customerKey, bill };
  }
  return null;
}

/** Voice transcript fillers and timestamp pattern – strip so we get only the real name. */
const VOICE_FILLERS = /\b(achha|acha|achar|yar|oy|oh|um|uh)\b/gi;
const VOICE_TIMESTAMP = /\d{1,2}:\d{2}\s*/g;

function cleanExtractedCustomerName(raw) {
  if (!raw || typeof raw !== "string") return "";
  let s = raw
    .replace(VOICE_TIMESTAMP, " ")
    .replace(/\s+/g, " ")
    .trim();
  while (true) {
    const next = s.replace(VOICE_FILLERS, " ").replace(/\s+/g, " ").trim();
    if (next === s) break;
    s = next;
  }
  s = s.replace(/\s+na\s*$/i, "").trim();
  const words = s.split(/\s+/).filter((w) => /^[A-Za-z\u00C0-\u024F]{2,}$/.test(w));
  if (words.length === 0) return s.trim();
  if (words.length >= 2 && words[words.length - 2].length >= 2) {
    return (words[words.length - 2] + " " + words[words.length - 1]).trim();
  }
  return words[words.length - 1];
}

/** Clean voice transcript body before intent/parsing so timestamps and fillers don't affect name or products. */
function cleanVoiceTranscript(body) {
  if (!body || typeof body !== "string") return body;
  let s = body.replace(VOICE_TIMESTAMP, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/\b(achha|acha)\s+yar\s+/gi, " ").replace(/\b(achha|acha)\s+/gi, " ").trim();
  return s.trim() || body;
}

/** True if the message means "no more items, complete the bill" (English or Roman Urdu). */
function looksLikeNoCompleteBill(body) {
  if (!body || typeof body !== "string") return false;
  const lower = body.trim().toLowerCase();
  if (lower === "no" || lower === "nahi" || lower === "nahi bas" || lower === "bas") return true;
  if (/^nahi\s*(yar\s+)?(bas\s+)?(bill\s+)?(complete|nikal)/i.test(lower)) return true;
  if (/^nahi\s*(bas\s+)?(bill\s+)?(nikal\s+do|complete\s+(kr\s+)?do)/i.test(lower)) return true;
  if (/(bas\s+)?bill\s+(complete|nikal)\s*(kr\s+do|karo|kar\s+do)?\s*$/i.test(lower)) return true;
  if (/\bbill\s+nikal\s+do\s*$/i.test(lower) || /\bbill\s+complete\s+(kr\s+)?do\s*$/i.test(lower)) return true;
  if (/^(bas\s+)?(bill\s+)?(nikal\s+do|complete\s+(kr\s+)?do)\s*$/i.test(lower)) return true;
  return false;
}

/**
 * Extract the exact customer name from the message.
 * Supports: "<name> ko 2 detergent dy do", "2 detergent dy do <name> ko", "<name> ka bill nikal do", "<name> ki payment".
 */
function getExactCustomerNameFromMessage(body) {
  if (!body || typeof body !== "string") return null;
  const s = body.trim();
  if (!s) return null;
  let raw = null;
  const koMid = s.match(/([A-Za-z\u00C0-\u024F]+(?:\s+[A-Za-z\u00C0-\u024F]+)?)\s+ko\s+/i);
  if (koMid && koMid[1]) raw = koMid[1].trim();
  if (!raw) {
    const koEnd = s.match(/\s+([A-Za-z\u00C0-\u024F]+)\s+ko\s*$/i);
    if (koEnd && koEnd[1]) raw = koEnd[1].trim();
  }
  if (!raw) {
    const kaBill = s.match(/([A-Za-z\u00C0-\u024F]+)\s+ka\s+bill/i) || s.match(/([A-Za-z\u00C0-\u024F]+)\s+ke\s+bill/i);
    if (kaBill && kaBill[1]) raw = kaBill[1].trim();
  }
  if (!raw) {
    const kiMatch = s.match(/([A-Za-z\u00C0-\u024F]+)\s+ki\s+payment/i);
    if (kiMatch && kiMatch[1]) raw = kiMatch[1].trim();
  }
  if (!raw) return null;
  const cleaned = cleanExtractedCustomerName(raw);
  return cleaned || null;
}

/**
 * Ensure a customer exists in the database with the exact name as given (voice/text).
 * If not found, creates the customer with that exact name. Returns { id, name } or null on error.
 */
async function ensureCustomerExists(apiBase, exactName) {
  if (!exactName || typeof exactName !== "string") return null;
  const nameToStore = exactName.trim();
  if (!nameToStore) return null;
  try {
    const res = await fetch(`${apiBase}/api/customers`);
    const list = await res.json().catch(() => []);
    if (!res.ok || !Array.isArray(list)) return null;
    const found = list.find((c) => String(c.name || "").trim().toLowerCase() === nameToStore.toLowerCase());
    if (found) return { id: found.id, name: found.name };
    const createRes = await fetch(`${apiBase}/api/customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nameToStore, phone: "", source: "whatsapp" }),
    });
    const data = await createRes.json().catch(() => ({}));
    if (createRes.ok && data.id) {
      console.log("  → Customer auto-added from voice:", nameToStore);
      return { id: data.id, name: data.name || nameToStore };
    }
    return null;
  } catch (err) {
    console.error("ensureCustomerExists error:", err);
    return null;
  }
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

  if (body && /\d{1,2}:\d{2}/.test(body)) {
    body = cleanVoiceTranscript(body);
    if (body) console.log("  → Voice transcript cleaned:", body);
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
  const pending = getPendingSale(msg.from);
  const isNoOrComplete = bodyUpper === "NO" || looksLikeNoCompleteBill(body);
  if ((bodyUpper === "YES" || bodyUpper === "NO") || (pending && isNoOrComplete)) {
    if (pending) {
      const state = pending.state || "confirm";
      if (state === "waiting_products") {
        if (bodyUpper === "NO" || looksLikeNoCompleteBill(body)) {
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
                source: "whatsapp",
              }),
            });
            const saleData = await resSale.json().catch(() => ({}));
            if (resSale.ok) {
              const saleLabel = saleItems.map((i) => `${i.quantity} ${i.product.name}`).join(", ");
              pushActionHistory(msg.from, { action: "voice_sale", label: `sell ${saleLabel}`, payload: { saleId: saleData.id } });
              const extra = notFound.length > 0 ? `\n(Skipped: ${notFound.join(", ")})` : "";
              await client.sendMessage(msg.from, `✅ *Sale completed!*\nTotal: Rs ${total.toFixed(2)}\nPayment: ${pending.paymentMethod || "cash"}${extra}`);
              console.log("  → Voice sale (completed from waiting_products NO):", saleItems.length, "item(s), Rs", total);
            } else {
              await client.sendMessage(msg.from, saleData.error || `Sale failed (${resSale.status}).`);
            }
          } catch (err) {
            console.error("Voice sale (waiting_products NO) error:", err);
            await client.sendMessage(msg.from, "Error completing sale. Please try again.");
          }
        } else {
          await client.sendMessage(msg.from, "Please add the product now (type or send a voice message, e.g. *2 milk 1 coke*).");
        }
        return;
      }
      if (state === "add_more") {
        if (bodyUpper === "YES" && !looksLikeNoCompleteBill(body)) {
          pending.state = "waiting_products";
          pending.at = Date.now();
          pendingVoiceSales.set(msg.from, pending);
          await client.sendMessage(msg.from, "Please add the product now (type or send a voice message, e.g. *2 milk 1 coke*).");
          console.log("  → Voice sale: waiting for more products");
        } else if (bodyUpper === "NO" || looksLikeNoCompleteBill(body)) {
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
                source: "whatsapp",
              }),
            });
            const saleData = await resSale.json().catch(() => ({}));
            if (resSale.ok) {
              const saleLabel = saleItems.map((i) => `${i.quantity} ${i.product.name}`).join(", ");
              pushActionHistory(msg.from, { action: "voice_sale", label: `sell ${saleLabel}`, payload: { saleId: saleData.id } });
              const extra = notFound.length > 0 ? `\n(Skipped: ${notFound.join(", ")})` : "";
              await client.sendMessage(msg.from, `✅ *Sale completed!*\nTotal: Rs ${total.toFixed(2)}\nPayment: ${pending.paymentMethod || "cash"}${extra}`);
              console.log("  → Voice sale (completed, no more):", saleItems.length, "item(s), Rs", total);
            } else {
              await client.sendMessage(msg.from, saleData.error || `Sale failed (${resSale.status}).`);
            }
          } catch (err) {
            console.error("Voice sale (NO add more) error:", err);
            await client.sendMessage(msg.from, "Error completing sale. Please try again.");
          }
        }
        return;
      }
      if (state === "confirm") {
        if (bodyUpper === "YES") {
          pending.state = "add_more";
          pending.at = Date.now();
          pendingVoiceSales.set(msg.from, pending);
          const parts = pending.items.map((i) => `${i.quantity || 1} ${i.name || "?"}`).join(", ");
          await client.sendMessage(msg.from, `I've added those items to the bill: ${parts}.`);
          console.log("  → Voice sale: confirmed, asking add more");
        } else {
          pendingVoiceSales.delete(msg.from);
          await client.sendMessage(msg.from, "Request cancelled. Please send the correct instruction (e.g. *Sell 2 Milk, payment cash*).");
          console.log("  → Voice sale: user said NO, cancelled");
        }
        return;
      }
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

  const whichCustomerPending = pendingWhichCustomer.get(msg.from);
  if (whichCustomerPending && (Date.now() - (whichCustomerPending.at || 0)) <= PENDING_EXPIRY_MS) {
    const bills = getBills(msg.from);
    const bodyTrim = (body || "").trim().toLowerCase();
    let matchedKey = null;
    for (const key of Object.keys(bills)) {
      const bill = bills[key];
      const displayName = (bill && bill.customerName) ? bill.customerName.toLowerCase() : key.replace(/_/g, " ");
      if (displayName === bodyTrim || displayName.startsWith(bodyTrim) || bodyTrim.startsWith(displayName) || key === bodyTrim.replace(/\s+/g, "_")) {
        matchedKey = key;
        break;
      }
    }
    if (matchedKey) {
      pendingWhichCustomer.delete(msg.from);
      if (whichCustomerPending.action === "complete_payment") {
        const bill = getBill(msg.from, matchedKey);
        if (!bill || !bill.items || bill.items.length === 0) {
          await client.sendMessage(msg.from, `No open bill for that customer, or bill is empty.`);
          return;
        }
        try {
          const resProducts = await fetch(`${API_BASE}/api/products`);
          const products = await resProducts.json().catch(() => []);
          if (!resProducts.ok || !Array.isArray(products)) {
            await client.sendMessage(msg.from, "Could not fetch products. Sale cancelled.");
            return;
          }
          const saleItems = [];
          const notFound = [];
          for (const it of bill.items) {
            const qty = Math.max(1, it.quantity || 1);
            const closest = findClosestProduct(it.name || "", products);
            const product = closest ? closest.product : null;
            if (product && product.stock >= qty) {
              saleItems.push({ product: { id: product.id, name: product.name, price: Number(product.price) }, quantity: qty });
            } else if (product && product.stock < qty) {
              notFound.push(`${product.name} (only ${product.stock} in stock)`);
            } else {
              notFound.push(it.name || "?");
            }
          }
          if (saleItems.length === 0) {
            await client.sendMessage(msg.from, `Product(s) not found or out of stock: ${notFound.join(", ")}.`);
            return;
          }
          let customerId = bill.customerId || null;
          const billCustomerName = bill.customerName || matchedKey.replace(/_/g, " ");
          if (!customerId && billCustomerName && billCustomerName !== "Walk-in") {
            const customerRecord = await ensureCustomerExists(API_BASE, billCustomerName);
            if (customerRecord) customerId = customerRecord.id;
          }
          const total = saleItems.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
          const resSale = await fetch(`${API_BASE}/api/sales`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: saleItems,
              total,
              paymentMethod: bill.paymentMethod || "cash",
              cashier: from || "WhatsApp User",
              customerId: customerId || undefined,
              source: "whatsapp",
            }),
          });
          const saleData = await resSale.json().catch(() => ({}));
          if (resSale.ok) {
            removeBill(msg.from, matchedKey);
            const saleLabel = saleItems.map((i) => `${i.quantity} ${i.product.name}`).join(", ");
            pushActionHistory(msg.from, { action: "voice_sale", label: `sell ${saleLabel}`, payload: { saleId: saleData.id } });
            await client.sendMessage(msg.from, `✅ *Bill closed!*\n${bill.customerName || matchedKey}'s sale completed.\nTotal: Rs ${total.toFixed(2)}\nPayment: ${bill.paymentMethod || "cash"}`);
          } else {
            await client.sendMessage(msg.from, saleData.error || `Sale failed (${resSale.status}).`);
          }
        } catch (err) {
          console.error("Complete payment (which customer) error:", err);
          await client.sendMessage(msg.from, "Error completing sale. Please try again.");
        }
      } else if (whichCustomerPending.action === "add_to_bill" && whichCustomerPending.items && whichCustomerPending.items.length > 0) {
        let existing = getBill(msg.from, matchedKey);
        const replyName = (body || "").trim();
        const displayName = replyName && replyName.length <= 50 ? replyName : ((existing && existing.customerName) || matchedKey.replace(/_/g, " "));
        if (!existing) {
          existing = { customerName: displayName, items: [], paymentMethod: whichCustomerPending.paymentMethod || "cash", state: "open" };
        } else {
          existing = { ...existing, items: [...(existing.items || [])] };
        }
        if (matchedKey !== "walk_in" && displayName !== "Walk-in") {
          const customerRecord = await ensureCustomerExists(API_BASE, displayName);
          if (customerRecord) existing.customerId = customerRecord.id;
        }
        existing.items = [...existing.items, ...whichCustomerPending.items];
        existing.state = "open";
        setBill(msg.from, matchedKey, existing);
        const added = whichCustomerPending.items.map((i) => `${i.quantity || 1} ${i.name || "?"}`).join(", ");
        await client.sendMessage(msg.from, `Added to *${existing.customerName || matchedKey}'s* bill: ${added}.`);
      }
    } else {
      const names = Object.entries(bills).map(([k, b]) => (b && b.customerName) || k.replace(/_/g, " "));
      await client.sendMessage(msg.from, `Which customer's bill? Please reply with one of: *${names.join("* or *")}*`);
    }
    return;
  } else if (whichCustomerPending) {
    pendingWhichCustomer.delete(msg.from);
  }

  const billChoosePayment = getBillInChoosePayment(msg.from);
  if (billChoosePayment) {
    const bodyLower = (body || "").trim().toLowerCase();
    const isCash = /^cash$/i.test(bodyLower) || bodyLower === "cash";
    const isCard = /^card$/i.test(bodyLower) || bodyLower === "card";
    if (isCash || isCard) {
      const { customerKey, bill } = billChoosePayment;
      const paymentMethod = isCard ? "card" : "cash";
      try {
        const resProducts = await fetch(`${API_BASE}/api/products`);
        const products = await resProducts.json().catch(() => []);
        if (!resProducts.ok || !Array.isArray(products)) {
          await client.sendMessage(msg.from, "Could not fetch products. Sale cancelled.");
          return;
        }
        const saleItems = [];
        const notFound = [];
        for (const it of bill.items || []) {
          const qty = Math.max(1, it.quantity || 1);
          const closest = findClosestProduct(it.name || "", products);
          const product = closest ? closest.product : null;
          if (product && product.stock >= qty) {
            saleItems.push({ product: { id: product.id, name: product.name, price: Number(product.price) }, quantity: qty });
          } else if (product && product.stock < qty) {
            notFound.push(`${product.name} (only ${product.stock} in stock)`);
          } else {
            notFound.push(it.name || "?");
          }
        }
        if (saleItems.length === 0) {
          await client.sendMessage(msg.from, `Product(s) not found or out of stock: ${notFound.join(", ")}.`);
          return;
        }
        let customerId = bill.customerId || null;
        if (!customerId && bill.customerName && bill.customerName !== "Walk-in") {
          const customerRecord = await ensureCustomerExists(API_BASE, bill.customerName);
          if (customerRecord) customerId = customerRecord.id;
        }
        const total = saleItems.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
        const resSale = await fetch(`${API_BASE}/api/sales`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: saleItems,
            total,
            paymentMethod,
            cashier: from || "WhatsApp User",
            customerId: customerId || undefined,
            source: "whatsapp",
          }),
        });
        const saleData = await resSale.json().catch(() => ({}));
        if (resSale.ok) {
          removeBill(msg.from, customerKey);
          const saleLabel = saleItems.map((i) => `${i.quantity} ${i.product.name}`).join(", ");
          pushActionHistory(msg.from, { action: "voice_sale", label: `sell ${saleLabel}`, payload: { saleId: saleData.id } });
          await client.sendMessage(msg.from, `✅ *Bill closed!*\n${bill.customerName || customerKey.replace(/_/g, " ")}'s sale completed.\nTotal: Rs ${total.toFixed(2)}\nPayment: ${paymentMethod}`);
        } else {
          await client.sendMessage(msg.from, saleData.error || `Sale failed (${resSale.status}).`);
        }
      } catch (err) {
        console.error("Choose payment close error:", err);
        await client.sendMessage(msg.from, "Error completing sale. Please try again.");
      }
    } else {
      await client.sendMessage(msg.from, "Please reply *cash* or *card* for the payment method.");
    }
    return;
  }

  const billAddMoreOrPayment = getBillInAddMoreOrPayment(msg.from);
  if (billAddMoreOrPayment) {
    const bodyLower = (body || "").trim().toLowerCase();
    const looksLikeNewAdd = /\b\w+\s+ko\s+/.test(bodyLower) && /\d+/.test(bodyLower);
    const looksLikeBillClose = /\bbill\s+nikal\b|\bka\s+bill\b|\bbill\s+complete\b|payment\s+(cash|card)\s*(ha|hai|rakhni)?/i.test(bodyLower);
    const noCustomerInMessage = !getExactCustomerNameFromMessage(body);
    const completeCurrentBill = looksLikeNoCompleteBill(body) || (looksLikeBillClose && noCustomerInMessage);
    const bodyUpper = bodyLower.toUpperCase();
    const yesAddMore = bodyUpper === "YES" || bodyLower === "add more" || bodyLower === "add more products";
    const noPayNow = bodyUpper === "NO" || bodyLower === "payment" || bodyLower === "pay" || bodyLower === "pay now" || completeCurrentBill;
    if (!looksLikeNewAdd) {
      if (noPayNow) {
        const { customerKey, bill } = billAddMoreOrPayment;
        const updated = { ...bill, state: "choose_payment", at: Date.now() };
        setBill(msg.from, customerKey, updated);
        await client.sendMessage(msg.from, `What payment method? Reply *cash* or *card*.`);
        return;
      }
      if (!looksLikeBillClose) {
      if (yesAddMore) {
        const { customerKey, bill } = billAddMoreOrPayment;
        const updated = { ...bill, state: "waiting_products", at: Date.now() };
        setBill(msg.from, customerKey, updated);
        await client.sendMessage(msg.from, `Please add the products now (e.g. *2 milk 1 bread* or send a voice message).`);
        return;
      }
      // Try parsing as products (voice or text) - add directly without YES
      const intentCommand = await getIntentFromMessage(body);
      const newItems = (intentCommand && intentCommand.action === "voice_sale" && intentCommand.items && intentCommand.items.length > 0) ? intentCommand.items : [];
      if (newItems.length > 0) {
        const { customerKey, bill } = billAddMoreOrPayment;
        const updated = { ...bill, items: [...(bill.items || []), ...newItems], state: "add_more_or_payment", at: Date.now() };
        setBill(msg.from, customerKey, updated);
        const added = newItems.map((i) => `${i.quantity || 1} ${i.name || "?"}`).join(", ");
        await client.sendMessage(msg.from, `Added to *${bill.customerName || customerKey.replace(/_/g, " ")}'s* bill: ${added}.\n\nIf you want to add more products to this bill, send voice or text. Otherwise say *NO* to complete the sale.`);
        return;
      }
      await client.sendMessage(msg.from, "If you want to add more products to this bill, send voice or text. Otherwise say *NO* to complete the sale.");
      return;
      }
    }
  }

  const billWaiting = getBillInWaitingProducts(msg.from);
  if (billWaiting) {
    const intentCommand = await getIntentFromMessage(body);
    const newItems = (intentCommand && intentCommand.action === "voice_sale" && intentCommand.items && intentCommand.items.length > 0) ? intentCommand.items : [];
    if (newItems.length > 0) {
      const { customerKey, bill } = billWaiting;
      const updated = { ...bill, items: [...(bill.items || []), ...newItems], state: "add_more_or_payment", at: Date.now() };
      setBill(msg.from, customerKey, updated);
      const added = newItems.map((i) => `${i.quantity || 1} ${i.name || "?"}`).join(", ");
      await client.sendMessage(msg.from, `Added to *${bill.customerName || customerKey.replace(/_/g, " ")}'s* bill: ${added}.\n\nIf you want to add more products to this bill, send voice or text. Otherwise say *NO* to complete the sale.`);
      return;
    }
    await client.sendMessage(msg.from, "I couldn't understand the products. Send e.g. *2 milk 1 coke*, or reply *NO* to complete the sale without adding more.");
    return;
  }

  const pendingWaiting = getPendingSale(msg.from);
  if (pendingWaiting && (pendingWaiting.state === "waiting_products" || pendingWaiting.state === "add_more")) {
    const intentCommand = await getIntentFromMessage(body);
    const newItems = (intentCommand && intentCommand.action === "voice_sale" && intentCommand.items && intentCommand.items.length > 0)
      ? intentCommand.items
      : [];
    if (newItems.length > 0) {
      pendingWaiting.items = [...(pendingWaiting.items || []), ...newItems];
      pendingWaiting.state = "add_more";
      pendingWaiting.at = Date.now();
      pendingVoiceSales.set(msg.from, pendingWaiting);
      const added = newItems.map((i) => `${i.quantity || 1} ${i.name || "?"}`).join(", ");
      await client.sendMessage(msg.from, `Added to bill: ${added}.\n\nIf you want to add more products to this bill, send voice or text. Otherwise say *NO* to complete the sale.`);
      console.log("  → Voice sale: added more items", newItems.length, "total items:", pendingWaiting.items.length);
      return;
    }
    await client.sendMessage(msg.from, "I couldn't understand the products. Please send e.g. *2 milk 1 coke*, or reply *NO* to complete the sale without adding more.");
    return;
  }

  let command = parseCommand(body);
  const quantityNumberCount = (body.match(/\d+/g) || []).filter((n) => {
    const v = parseInt(n, 10);
    return v >= 1 && v <= 999;
  }).length;
  if (command.action === "voice_sale" && command.items && command.items.length < quantityNumberCount && quantityNumberCount >= 2) {
    command = { action: "unknown" };
  }
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
      const position = Number(command.undoPosition);
      let index = position === 0
        ? 0
        : Math.max(0, history.length - Math.min(Math.max(1, position), 3));
      if (index >= history.length) {
        reply = "No command available to undo.";
        console.log("  → Undo: no action at position", position, "history:", history.length);
      } else {
        const reversible = ["add_expense", "add_product", "add_customer", "add_supplier", "voice_sale"];
        let entry = removeActionAt(msg.from, index);
        while (entry && (entry.action === "khata_list_pending" || entry.action === "khata_customer")) {
          entry = removeActionAt(msg.from, 0);
        }
        if (!entry) {
          reply = "No command available to undo.";
        } else if (!reversible.includes(entry.action)) {
          reply = "No command available to undo.";
          if (entry.action) pushActionHistory(msg.from, entry);
        } else {
          const undoHeaders = { "X-Source": "whatsapp" };
          const deletedByParam = `deletedBy=${encodeURIComponent(from || "WhatsApp User")}`;
          let ok = false;
          try {
            if (entry.action === "add_expense" && entry.payload?.expenseId) {
              const res = await fetch(`${API_BASE}/api/expenses/${encodeURIComponent(entry.payload.expenseId)}?${deletedByParam}`, { method: "DELETE", headers: undoHeaders });
              ok = res.status === 204;
            } else if (entry.action === "add_product" && entry.payload?.productId) {
              const res = await fetch(`${API_BASE}/api/products/${encodeURIComponent(entry.payload.productId)}?${deletedByParam}`, { method: "DELETE", headers: undoHeaders });
              ok = res.ok || res.status === 204;
            } else if (entry.action === "add_customer" && entry.payload?.customerId) {
              const res = await fetch(`${API_BASE}/api/customers/${encodeURIComponent(entry.payload.customerId)}?${deletedByParam}`, { method: "DELETE", headers: undoHeaders });
              ok = res.ok || res.status === 204;
            } else if (entry.action === "add_supplier" && entry.payload?.supplierId) {
              const res = await fetch(`${API_BASE}/api/suppliers/${encodeURIComponent(entry.payload.supplierId)}?${deletedByParam}`, { method: "DELETE", headers: undoHeaders });
              ok = res.ok || res.status === 204;
            } else if (entry.action === "voice_sale" && entry.payload?.saleId) {
              const res = await fetch(`${API_BASE}/api/sales/${encodeURIComponent(entry.payload.saleId)}?${deletedByParam}`, { method: "DELETE", headers: undoHeaders });
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
            pushActionHistory(msg.from, entry);
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
          source: "whatsapp",
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
    } else if (command.action === "list_open_bills") {
      const bills = getBills(msg.from);
      const entries = Object.entries(bills);
      if (entries.length === 0) {
        reply = "No open bills. Add items for a customer (e.g. *Talha ko 2 bread laga do*).";
        console.log("  → List open bills: 0");
      } else {
        const parts = entries.map(([key, bill]) => {
          const name = (bill && bill.customerName) || key.replace(/_/g, " ");
          const items = (bill && bill.items) || [];
          const itemsStr = items.map((i) => `${i.quantity || 1} ${i.name || "?"}`).join(", ");
          return `• *${name}* – ${itemsStr || "(no items)"}`;
        });
        reply = `📋 *Open bills (${entries.length}):*\n\n${parts.join("\n")}`;
        console.log(`  → List open bills: ${entries.length}`);
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
              source: "whatsapp",
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
          body: JSON.stringify({ name, phone, source: "whatsapp" }),
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
          headers: { "Content-Type": "application/json", "X-Source": "whatsapp" },
          body: JSON.stringify({ name, phone: phone || undefined, email: email || undefined, source: "whatsapp" }),
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
    } else if (command.action === "sales_report_today" || command.action === "sales_report_yesterday" || command.action === "sales_report_day_before_yesterday") {
      const periodMap = { sales_report_today: "today", sales_report_yesterday: "yesterday", sales_report_day_before_yesterday: "day_before_yesterday" };
      const period = periodMap[command.action];
      const statsUrl = `${API_BASE}/api/sales/stats?period=${period}`;
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
          const profit = data.totalProfit ?? 0;
          const cash = (data.paymentBreakdown && data.paymentBreakdown.cash) ?? 0;
          const card = (data.paymentBreakdown && data.paymentBreakdown.card) ?? 0;
          const top = data.topProduct;
          const dateLabel = data.reportDateLabel || data.reportDate || (period === "today" ? "Today" : period === "yesterday" ? "Yesterday" : "Day before yesterday");

          const titleMap = { today: "Today's", yesterday: "Yesterday's (Kal)", day_before_yesterday: "Day Before Yesterday's (Parso)" };
          const title = titleMap[period] || "Sales";
          const parts = [
            `📊 *${title} Sales Report*`,
            `*Date: ${dateLabel}*`,
            "",
            `*Total Revenue:* Rs ${fmt(revenue)}`,
            `*Total Profit:* Rs ${fmt(profit)}`,
            `Total Orders: ${orders}`,
            "",
          ];
          if (top && top.productName) {
            parts.push("*Most Sold:*", `${top.productName} — ${top.quantitySold || 0} units (Rs ${fmt(top.revenue)})`, "");
          }
          parts.push("Payment:", `Cash Rs ${fmt(cash)} | Card Rs ${fmt(card)}`);
          reply = parts.join("\n");
          console.log(`  → Sales report (${period}): ${orders} orders, Rs ${revenue} revenue, Rs ${profit} profit`);
        }
      }
    } else if (command.action === "khata_list_pending") {
      try {
        const res = await fetch(`${API_BASE}/api/khata/ledger`);
        const rows = await res.json().catch(() => []);
        if (!res.ok) {
          reply = "Could not fetch khata data. Is the POS server running?";
        } else if (!rows || rows.length === 0) {
          reply = "📒 *Khata (Pending Payments)*\n\nNo customers with outstanding balance.";
        } else {
          const byCustomer = {};
          for (const r of rows) {
            const key = (r.customerName || "?").trim();
            if (!byCustomer[key]) byCustomer[key] = { totalDue: 0, sales: [] };
            byCustomer[key].totalDue += Number(r.amountDue) || 0;
            byCustomer[key].sales.push(r);
          }
          const fmt = (n) => Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
          const parts = ["📒 *Customers with Pending Payments*", ""];
          let grandTotal = 0;
          for (const [name, data] of Object.entries(byCustomer)) {
            const due = data.totalDue;
            grandTotal += due;
            parts.push(`• *${name}* — Rs ${fmt(due)}`);
          }
          parts.push("", `*Total outstanding: Rs ${fmt(grandTotal)}*`);
          reply = parts.join("\n");
          console.log(`  → Khata list: ${Object.keys(byCustomer).length} customers, Rs ${grandTotal} total`);
        }
      } catch (err) {
        reply = "Could not fetch khata. Is the POS server running?";
        console.error("Khata list error:", err);
      }
    } else if (command.action === "khata_customer") {
      const customerName = (command.customerName || "").trim();
      if (!customerName) {
        reply = "Please specify a customer name (e.g. *Talha ka khata bata do*).";
      } else {
        try {
          const res = await fetch(`${API_BASE}/api/khata/ledger`);
          const rows = await res.json().catch(() => []);
          if (!res.ok) {
            reply = "Could not fetch khata data. Is the POS server running?";
          } else {
            const query = customerName.toLowerCase();
            const matches = (rows || []).filter((r) =>
              (r.customerName || "").toLowerCase().includes(query) ||
              query.includes((r.customerName || "").toLowerCase())
            );
            if (matches.length === 0) {
              reply = `📒 *${customerName} ka Khata*\n\nNo khata found for *${customerName}*.`;
            } else {
              const totalDue = matches.reduce((sum, r) => sum + (Number(r.amountDue) || 0), 0);
              const fmt = (n) => Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
              const parts = [`📒 *${matches[0].customerName} ka Khata*`, "", `*Balance: Rs ${fmt(totalDue)}*`, ""];
              for (const r of matches) {
                parts.push(`• ${r.items || "—"} | Paid: Rs ${fmt(r.paidAmount)} | Due: Rs ${fmt(r.amountDue)}`);
              }
              reply = parts.join("\n");
              console.log(`  → Khata customer: ${customerName}, Rs ${totalDue}`);
            }
          }
        } catch (err) {
          reply = "Could not fetch khata. Is the POS server running?";
          console.error("Khata customer error:", err);
        }
      }
    } else if (command.action === "voice_sale") {
      const items = command.items || [];
      const paymentMethod = command.paymentMethod === "card" ? "card" : "cash";
      const cashier = from || "WhatsApp User";
      const needsConfirmation = command.saleAction === "ask_confirmation" || command.saleConfidence === "low";

      if (command.billAction === "complete_payment") {
        const exactNameFromMessage = getExactCustomerNameFromMessage(body);
        const openNames = getOpenBillCustomerNames(msg.from);
        let customerKey = (exactNameFromMessage || (command.customerName && String(command.customerName).trim())) ? normalizeCustomerKey(exactNameFromMessage || command.customerName) : null;
        if (!customerKey && openNames.length === 1) {
          const single = getSingleOpenBill(msg.from);
          if (single) customerKey = single.customerKey;
        }
        if (!customerKey && openNames.length > 1) {
          pendingWhichCustomer.set(msg.from, { action: "complete_payment", at: Date.now() });
          reply = "Which customer's bill should I close? Reply with: *" + openNames.join("* or *") + "*";
        } else if (customerKey) {
          const bill = getBill(msg.from, customerKey);
          if (!bill || !bill.items || bill.items.length === 0) {
            reply = `No open bill for ${command.customerName || customerKey.replace(/_/g, " ")}. Add items first (e.g. *${command.customerName || customerKey} ko 2 bread laga do*).`;
          } else {
            try {
              const resProducts = await fetch(`${API_BASE}/api/products`);
              const products = await resProducts.json().catch(() => []);
              if (!resProducts.ok || !Array.isArray(products)) {
                reply = "Could not fetch products. Sale cancelled.";
              } else {
                const saleItems = [];
                const notFound = [];
                for (const it of bill.items) {
                  const qty = Math.max(1, it.quantity || 1);
                  const closest = findClosestProduct(it.name || "", products);
                  const product = closest ? closest.product : null;
                  if (product && product.stock >= qty) {
                    saleItems.push({ product: { id: product.id, name: product.name, price: Number(product.price) }, quantity: qty });
                  } else if (product && product.stock < qty) {
                    notFound.push(`${product.name} (only ${product.stock} in stock)`);
                  } else {
                    notFound.push(it.name || "?");
                  }
                }
                if (saleItems.length === 0) {
                  reply = `Product(s) not found or out of stock: ${notFound.join(", ")}.`;
                } else {
                  let customerId = bill.customerId || null;
                  if (!customerId && bill.customerName && bill.customerName !== "Walk-in") {
                    const customerRecord = await ensureCustomerExists(API_BASE, bill.customerName);
                    if (customerRecord) customerId = customerRecord.id;
                  }
                  const total = saleItems.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
                  const resSale = await fetch(`${API_BASE}/api/sales`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      items: saleItems,
                      total,
                      paymentMethod: bill.paymentMethod || "cash",
                      cashier: from || "WhatsApp User",
                      customerId: customerId || undefined,
                      source: "whatsapp",
                    }),
                  });
                  const saleData = await resSale.json().catch(() => ({}));
                  if (resSale.ok) {
                    removeBill(msg.from, customerKey);
                    const saleLabel = saleItems.map((i) => `${i.quantity} ${i.product.name}`).join(", ");
                    pushActionHistory(msg.from, { action: "voice_sale", label: `sell ${saleLabel}`, payload: { saleId: saleData.id } });
                    reply = `✅ *Bill closed!*\n${bill.customerName || customerKey.replace(/_/g, " ")}'s sale completed.\nTotal: Rs ${total.toFixed(2)}\nPayment: ${bill.paymentMethod || "cash"}`;
                  } else {
                    reply = saleData.error || `Sale failed (${resSale.status}).`;
                  }
                }
              }
            } catch (err) {
              console.error("Complete payment error:", err);
              reply = "Error completing sale. Please try again.";
            }
          }
        } else {
          reply = "No open bill to close. Add items to a customer's bill first (e.g. *Talha ko 2 bread laga do*).";
        }
      } else if (command.items && command.items.length > 0 && (command.billAction === "add_to_bill" || !command.billAction)) {
        const exactNameFromMessage = getExactCustomerNameFromMessage(body);
        const hasCustomerName = !!(exactNameFromMessage || (command.customerName && String(command.customerName).trim()));
        // Only add to bill when customer name is in the message. No-name = direct sale (multiple products).
        if (hasCustomerName) {
          const openNames = getOpenBillCustomerNames(msg.from);
          const nameForKey = exactNameFromMessage || (command.customerName && String(command.customerName).trim());
          let customerKey = nameForKey ? normalizeCustomerKey(nameForKey) : null;
          if (!customerKey && openNames.length === 1) {
            const single = getSingleOpenBill(msg.from);
            if (single) customerKey = single.customerKey;
          }
          if (!customerKey && openNames.length > 1) {
            pendingWhichCustomer.set(msg.from, { action: "add_to_bill", items: command.items, paymentMethod: command.paymentMethod || "cash", at: Date.now() });
            reply = "Which customer's bill should I add this to? Reply with: *" + openNames.join("* or *") + "*";
          } else if (customerKey) {
            let bill = getBill(msg.from, customerKey);
            const displayName = exactNameFromMessage || (command.customerName && String(command.customerName).trim()) || (bill && bill.customerName) || customerKey.replace(/_/g, " ");
            if (!bill) bill = { customerName: displayName, items: [], paymentMethod: command.paymentMethod || "cash", state: "open" };
            else bill = { ...bill, items: [...(bill.items || [])] };
            if (displayName && displayName !== "Walk-in") {
              const customerRecord = await ensureCustomerExists(API_BASE, displayName);
              if (customerRecord) bill.customerId = customerRecord.id;
            }
            bill.items = [...bill.items, ...command.items];
            bill.paymentMethod = bill.paymentMethod || command.paymentMethod || "cash";
            bill.state = "add_more_or_payment";
            setBill(msg.from, customerKey, bill);
            const added = command.items.map((i) => `${i.quantity || 1} ${i.name || "?"}`).join(", ");
            reply = `Added to *${displayName}'s* bill: ${added}.\n\nIf you want to add more products to this bill, send voice or text. Otherwise say *NO* to complete the sale.`;
          }
        }
      }
      if (!reply && needsConfirmation && items.length > 0) {
        const parts = items.map((it) => {
          const q = (it.quantity == null || it.quantity === 0) ? "?" : it.quantity;
          const p = (it.name || "unknown").toLowerCase() === "unknown" ? "?" : it.name;
          return q + " " + p;
        }).join(", ");
        pendingVoiceSales.set(msg.from, {
          items: [...items],
          paymentMethod,
          customer: command.customer || null,
          cashier,
          at: Date.now(),
          state: "confirm",
        });
        reply = "I may have misunderstood your request.\n\nThis is what I understood:\n*Sell " + parts + "*\n\nIs this correct? Reply *YES* to confirm or *NO* to cancel.";
        console.log("  → Voice sale: ask_confirmation", { items: items.length, parts });
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
          const notFoundItems = [];
          const similarForConfirmation = [];
          for (const it of items) {
            const qty = Math.max(1, it.quantity || 1);
            const spokenName = it.name || "?";
            const closest = findClosestProduct(spokenName, products);
            if (!closest) {
              notFound.push(spokenName);
              notFoundItems.push({ name: spokenName, quantity: qty });
              continue;
            }
            const { product, confidence } = closest;
            if (product.stock < qty) {
              notFound.push(`${product.name} (only ${product.stock} in stock, asked ${qty})`);
              continue;
            }
            if (confidence === "exact" || confidence === "similar") {
              saleItems.push({
                product: { id: product.id, name: product.name, price: Number(product.price) },
                quantity: qty,
              });
            } else {
              similarForConfirmation.push({
                product: { id: product.id, name: product.name, price: Number(product.price) },
                quantity: qty,
                spoken: spokenName,
              });
            }
          }
          // Add similar matches directly to sale (no confirmation). User can say "no not this product" to cancel before completing.
          for (const s of similarForConfirmation) {
            saleItems.push({
              product: { id: s.product.id, name: s.product.name, price: Number(s.product.price) },
              quantity: s.quantity,
            });
          }
          if (saleItems.length === 0 && notFound.length > 0) {
            reply = `Product(s) not found or out of stock: ${notFound.join(", ")}. Try *list products* to see available items.`;
            console.log("  → Voice sale: no matches", notFound);
          } else if (saleItems.length === 0) {
            reply = "No valid items for sale. Specify product names (e.g. Sell 2 detergent, payment cash).";
          } else {
            const parts = saleItems.map((i) => `${i.quantity} ${i.product.name}`).join(", ");
            pendingVoiceSales.set(msg.from, {
              items: saleItems.map((i) => ({ name: i.product.name, quantity: i.quantity })),
              paymentMethod,
              customer: null,
              cashier,
              at: Date.now(),
              state: "add_more",
            });
            const extra = notFound.length > 0 ? `\n(Skipped: ${notFound.join(", ")})` : "";
            reply = `Added to bill: ${parts}.${extra}\n\nIf you want to add more products to this bill, send voice or text. Otherwise say *NO* to complete the sale.`;
            console.log("  → Voice sale: added to cart (add_more), items:", saleItems.length);
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
        "• *give me today's sales* – today's report (date, revenue, profit, top product)",
        "• *mujhy kal ki sale batao* – yesterday's (kal) report",
        "• *parso ki sale batao* – day before yesterday's (parso) report",
        "• *show sales report today* – same as above",
        "",
        "*Khata (In-Out / Pending Payments):*",
        "• *give me customers whose payments are pending* – list all with outstanding balance",
        "• *Talha ka khata bata do* – show Talha's balance and items",
        "• *mujhe Ali ka khata bata do kitna rehta hai* – customer's khata",
        "",
        "*Voice/Text Sale:*",
        "• *Sell 2 Milk, payment cash* – single product",
        "• *Sell 3 eggs and 2 bread and 1 aquafina, payment cash* – multiple products in one message",
        "• Roman Urdu: *teen anday do bread ek aquafina bech do cash par* (3 eggs, 2 bread, 1 aquafina)",
        "",
        "*Multiple customer bills (at the same time):*",
        "• *kitne bills khule hain* / *open bills* – list all open bills and their items",
        "• *Talha ko 3 bread aur 2 aquafina laga do* – add to Talha's bill",
        "• *Ali ko aur 2 milk laga do* – add more to Ali's bill",
        "• *Talha ki payment cash kar do* – close Talha's bill and take cash payment",
        "• *payment cash kar do* / *bill close karo* – close the bill (if only one open, else bot asks which customer)",
        "• *aur 2 bread laga do* – add to the only open bill; if multiple bills open, bot asks which customer",
        "• If unclear, bot will ask: Reply *YES* to confirm or *NO* to cancel",
        "• After adding items, bot says: *If you want to add more products, send voice or text. Otherwise say NO to complete the sale.* Reply with more items (voice/text) or *NO* to complete.",
        "",
        "*Undo:*",
        "• *undo* or *undo kar do* – undo the last (most recent) command",
        "• *undo 1* – undo the first command you did, *undo 2* – second, *undo 3* – third",
        "• *pehla undo karo* = undo 1st, *dusra undo karo* = undo 2nd",
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
