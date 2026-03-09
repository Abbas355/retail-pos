/**
 * Understands user message and maps to a POS inventory action (tool).
 * Only returns actions related to the POS inventory system.
 * Uses Gemini when GEMINI_API_KEY is set; otherwise returns null (caller can fall back to parseCommand).
 */

const SYSTEM_PROMPT = `You are a strict intent classifier for a POS (point-of-sale) inventory and customer WhatsApp bot. Your ONLY job is to understand the user's message and return ONE JSON object that calls the correct tool.

Allowed tools (ONLY these – do not invent others):
1. add_product – Add a product to inventory. Needs: name (string), price (number). Optional: threshold (number, default 5).
2. list_products – Show all products. No extra params.
3. low_stock – Show items at or below stock threshold. No extra params.
4. search – Find products by name. Needs: term (string).
5. delete_product – Delete a product by name or id. Needs: nameOrId (string).
6. set_threshold – Set low-stock threshold for a product. Needs: nameOrId (string), threshold (number).
7. set_stock – Set stock quantity for a product. Needs: nameOrId (string), stock (number).
8. add_customer – Add a customer. Needs: name (string), phone (string, any digits).
9. add_customer_help – User asks how to add a customer. No extra params.
10. add_supplier – Add a supplier. Needs: name (string). Optional: phone (string), email (string).
11. add_supplier_help – User asks how to add a supplier, supplier insertion method, etc. No extra params.
12. sales_report_today – User asks for today's sales, revenue, sales report, top selling product today. No extra params.
13. voice_sale – User wants to make a sale: add product(s) to cart and complete with payment. Needs: items (array of {name: string, quantity: number}), paymentMethod (string: "cash" or "card"). Supports Urdu/English mix: "X sell kardo payment cash hai" = sell X, payment cash. Examples: "add detergent to cart, payment card", "a cooking oil sell kardo payment cash hai on sale ko complete".
14. help – Show command help. No extra params.

CRITICAL – Product name extraction (MUST follow strictly):
- The "name" field must be ONLY the product name – usually 1-2 words (e.g. talha, lazania, milk, bread, cooking oil).
- NEVER include: "it's", "its", "price", "should", "be", "threshold", "the", "and", "is", "cost", "to", "for".
- Example: "talha it's price should be 60000 and threshold is 50" → name MUST be "talha" only, price 60000, threshold 50.
- Extract the FIRST word or short phrase as the product name; everything after descriptive words like "price", "threshold", "it's" is NOT part of the name.

CRITICAL – Customer name extraction (for add_customer):
- The "name" field must be ONLY the customer name in English/Latin (e.g. talha, John, Ahmed Khan). If user writes in Hindi/Devanagari (e.g. अली), return the English romanized form (e.g. Ali).
- NEVER include: "and", "its", "it's", "phone", "number", "is", "the". Extract the name before these words.
- Example: "add customer usman and his phone number is 5678910" → name MUST be "usman", phone "5678910".

CRITICAL – Supplier (add_supplier) extraction:
- "name" = ONLY the actual supplier/person name (e.g. saboor, ABC Company, Ali Traders). NEVER include: "it's name", "its name", "name is", or any extra text. For "it's name is saboor" return name "saboor" only. If user writes in Hindi (e.g. अली), return English romanized form (e.g. Ali). Do NOT include "and its phone number" or any surrounding sentence.
- "phone" = ONLY digits. If no phone in the message, return null for phone.
- Identify name and phone separately. Never mix them.

Rules:
- Only perform POS inventory, customer, and supplier actions. If the user asks for anything else (weather, etc.), return {"action":"out_of_scope"}.
- Extract intent from natural language. Examples:
  - "talha it's price should be 60000 and threshold is 50" → {"action":"add_product","name":"talha","price":60000,"threshold":50}
  - "lazania it's price is 100 and the threshold is 50" → {"action":"add_product","name":"lazania","price":100,"threshold":50}
  - "add milk, price 50, threshold 10" → {"action":"add_product","name":"milk","price":50,"threshold":10}
  - "please add milk with price 50" → {"action":"add_product","name":"milk","price":50}
  - "add bread for 25" → {"action":"add_product","name":"bread","price":25}
  - "rice price 12 threshold 5" (add product) → {"action":"add_product","name":"rice","price":12,"threshold":5}
  - "show me all products" / "list products" → {"action":"list_products"}
  - "what's low on stock?" → {"action":"low_stock"}
  - "find milk" / "search for milk" → {"action":"search","term":"milk"}
  - "remove milk" → {"action":"delete_product","nameOrId":"milk"}
  - "set threshold for milk to 10" → {"action":"set_threshold","nameOrId":"milk","threshold":10}
  - "set stock for milk to 50" / "stock milk 50" → {"action":"set_stock","nameOrId":"milk","stock":50}
  - "how can I add customer" / "how to add customer" → {"action":"add_customer_help"}
  - "add customer usman and his phone number is 5678910" → {"action":"add_customer","name":"usman","phone":"5678910"}
  - "add customer talha and its phone number is 123" → {"action":"add_customer","name":"talha","phone":"123"}
  - "add customer John 03001234567" → {"action":"add_customer","name":"John","phone":"03001234567"}
  - "how to add supplier" / "supplier insertion method" / "how can I add supplier" → {"action":"add_supplier_help"}
  - "add supplier hamza his phone number is 1234567890 and the email address is a@gmail.com" → {"action":"add_supplier","name":"hamza","phone":"1234567890","email":"a@gmail.com"}
  - "add supplier it's name is saboor and phone number is 555555 and the email address is b@gmail.com" → {"action":"add_supplier","name":"saboor","phone":"555555","email":"b@gmail.com"}
  - "add supplier ABC Company and its phone number is 03001234567" → {"action":"add_supplier","name":"ABC Company","phone":"03001234567"}
  - "add supplier ABC Company" (no phone) → {"action":"add_supplier","name":"ABC Company","phone":null}
  - "give me today's sales" / "today's revenue" / "how much sales happened today" → {"action":"sales_report_today"}
  - "show sales report today" / "show today's top selling product" → {"action":"sales_report_today"}
  - "what product generated the most revenue today" → {"action":"sales_report_today"}
  - "give me the revenue generated by today's product sales" → {"action":"sales_report_today"}
  - "add detergent to cart, payment is card, complete the sale" → {"action":"voice_sale","items":[{"name":"detergent","quantity":1}],"paymentMethod":"card"}
  - "add milk and bread to cart, pay with cash" → {"action":"voice_sale","items":[{"name":"milk","quantity":1},{"name":"bread","quantity":1}],"paymentMethod":"cash"}
  - "add 2 detergent and 1 milk, payment card" → {"action":"voice_sale","items":[{"name":"detergent","quantity":2},{"name":"milk","quantity":1}],"paymentMethod":"card"}
  - "complete sale for detergent, payment is cash" → {"action":"voice_sale","items":[{"name":"detergent","quantity":1}],"paymentMethod":"cash"}
  - "a cooking oil sell kardo payment cash hai on sale ko complete" (Urdu/English) → {"action":"voice_sale","items":[{"name":"cooking oil","quantity":1}],"paymentMethod":"cash"}
  - "milk sell karo payment card hai" → {"action":"voice_sale","items":[{"name":"milk","quantity":1}],"paymentMethod":"card"}
  - "help" → {"action":"help"}
- If the message is unclear or missing required params, return {"action":"unknown"}.
- Reply with ONLY a single JSON object, no markdown, no explanation.`;

async function callGeminiForIntent(genAI, modelId, userMessage) {
  const model = genAI.getGenerativeModel({ model: modelId });
  const prompt = `${SYSTEM_PROMPT}\n\nUser message: "${userMessage}"\n\nReply with only the JSON object:`;
  const result = await model.generateContent(prompt);
  return result.response.text();
}

const JUNK_WORDS = /\b(it'?s|its|price|should|be|threshold|the|and|is|cost|to|for)\b/i;

/** Devanagari (Hindi) and common Indic scripts → Latin/English */
const DEVANAGARI_RANGE = /[\u0900-\u097F]/;
const BENGALI_RANGE = /[\u0980-\u09FF]/;
const GURMUKHI_RANGE = /[\u0A00-\u0A7F]/;
const GUJARATI_RANGE = /[\u0A80-\u0AFF]/;

/** Convert Hindi/Indic names to English (e.g. अली → Ali). Keeps Latin text unchanged. */
function transliterateToEnglish(str) {
  if (!str || typeof str !== "string") return str;
  const s = str.trim();
  if (!s) return s;
  let out = s;
  try {
    const Sanscript = require("@indic-transliteration/sanscript");
    if (DEVANAGARI_RANGE.test(s)) out = Sanscript.t(out, "devanagari", "hk");
    else if (BENGALI_RANGE.test(out)) out = Sanscript.t(out, "bengali", "hk");
    else if (GURMUKHI_RANGE.test(out)) out = Sanscript.t(out, "gurmukhi", "hk");
    else if (GUJARATI_RANGE.test(out)) out = Sanscript.t(out, "gujarati", "hk");
  } catch (_) { /* leave as-is on error */ }
  return out.replace(/\b\w/g, (c) => c.toUpperCase());
}

function sanitizeProductName(name) {
  if (!name || typeof name !== "string") return name;
  const s = transliterateToEnglish(name).trim();
  if (!s) return s;
  const match = s.match(new RegExp(`^(.+?)${JUNK_WORDS.source}`, "i"));
  if (match) return match[1].trim();
  return s;
}

const CUSTOMER_NAME_JUNK = /\b(and\s+(?:its?|his|her|their)\b|it'?s|phone\s*(number)?|number\s+is?|is\s+the?|add\s+customer)\b/i;

const SUPPLIER_NAME_JUNK = /\b(and\s+(?:its?|his|her|their)\b|(?:his|her|the)\s+|it'?s|phone\s*(number)?|email\s*(address)?|number\s+is?|is\s+the?|add\s+supplier)\b/i;
const SUPPLIER_NAME_IS = /((?:it'?s|its?|his|her|their|the)\s+)?name\s+(?:is\s+)?(.+)/i;

/** Name ONLY – no "it's name", "his phone number", etc. */
function sanitizeSupplierName(name) {
  if (!name || typeof name !== "string") return name;
  let s = transliterateToEnglish(name).trim();
  if (!s) return s;
  const nameIs = s.match(SUPPLIER_NAME_IS);
  if (nameIs) s = nameIs[2].replace(/\s+and\s*$/i, "").trim();
  const match = s.match(new RegExp(`^(.+?)${SUPPLIER_NAME_JUNK.source}`, "i"));
  if (match) s = match[1].trim();
  s = s.replace(/\d+/g, "").replace(/\s*@\s*/g, "").replace(/\b(and|its?|his|her|the|phone|number|email|address|is)\b/gi, "").trim().replace(/\s+/g, " ");
  const words = s.split(/\s+/).filter((w) => w.length > 0);
  return words.slice(0, 3).join(" ") || (name.match(/\b([A-Za-z\u00C0-\u024F]{2,})\b/)?.[1] || "Supplier");
}

function sanitizeCustomerName(name) {
  if (!name || typeof name !== "string") return name;
  let s = transliterateToEnglish(name).trim();
  if (!s) return s;
  const match = s.match(new RegExp(`^(.+?)${CUSTOMER_NAME_JUNK.source}`, "i"));
  if (match) s = match[1].trim();
  if (s.includes("add customer") || s.includes("phone number") || /\d/.test(s) || s.length > 35) {
    const first = s.match(/^([A-Za-z\u00C0-\u024F]+(?:\s+[A-Za-z\u00C0-\u024F]+)?)/);
    if (first) s = first[1].trim();
  }
  s = s.replace(/\d+/g, "").trim();
  if (!s) {
    const firstWord = name.split(/\s+/).find((w) => /^[A-Za-z\u00C0-\u024F]{2,}$/i.test(w));
    s = firstWord || "Customer";
  }
  return s;
}

function parseIntentResponse(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const obj = JSON.parse(jsonMatch[0]);
    if (!obj || typeof obj !== "object" || !obj.action) return null;
    const action = String(obj.action).toLowerCase();
    const allowed = ["add_product", "list_products", "low_stock", "search", "delete_product", "set_threshold", "set_stock", "add_customer", "add_customer_help", "add_supplier", "add_supplier_help", "sales_report_today", "voice_sale", "help", "out_of_scope", "unknown"];
    if (!allowed.includes(action)) return null;
    if (action === "add_product") {
      let name = obj.name != null ? String(obj.name).trim() : "";
      name = sanitizeProductName(name);
      const price = typeof obj.price === "number" ? obj.price : parseFloat(obj.price);
      if (!name || Number.isNaN(price) || price < 0) return { action: "unknown" };
      const threshold = obj.threshold != null ? (typeof obj.threshold === "number" ? obj.threshold : parseInt(obj.threshold, 10)) : undefined;
      const cmd = { action: "add_product", name, price };
      if (threshold != null && !Number.isNaN(threshold) && threshold >= 0) cmd.threshold = threshold;
      return cmd;
    }
    if (action === "search") {
      const term = obj.term != null ? String(obj.term).trim() : "";
      if (!term) return { action: "unknown" };
      return { action: "search", term };
    }
    if (action === "delete_product") {
      const nameOrId = obj.nameOrId != null ? String(obj.nameOrId).trim() : "";
      if (!nameOrId) return { action: "unknown" };
      return { action: "delete_product", nameOrId };
    }
    if (action === "set_threshold") {
      const nameOrId = obj.nameOrId != null ? String(obj.nameOrId).trim() : "";
      const threshold = typeof obj.threshold === "number" ? obj.threshold : parseInt(obj.threshold, 10);
      if (!nameOrId || Number.isNaN(threshold) || threshold < 0) return { action: "unknown" };
      return { action: "set_threshold", nameOrId, threshold };
    }
    if (action === "set_stock") {
      const nameOrId = obj.nameOrId != null ? String(obj.nameOrId).trim() : "";
      const stock = typeof obj.stock === "number" ? obj.stock : parseInt(obj.stock, 10);
      if (!nameOrId || Number.isNaN(stock) || stock < 0) return { action: "unknown" };
      return { action: "set_stock", nameOrId, stock };
    }
    if (action === "add_customer") {
      let name = obj.name != null ? String(obj.name).trim() : "";
      name = sanitizeCustomerName(name);
      const phone = obj.phone != null ? String(obj.phone).replace(/\D/g, "") : "";
      if (!name) return { action: "unknown" };
      if (!phone) return { action: "unknown" };
      return { action: "add_customer", name, phone };
    }
    if (action === "add_supplier") {
      let name = obj.name != null ? String(obj.name).trim() : "";
      name = sanitizeSupplierName(name);
      const phone = obj.phone != null && obj.phone !== "" ? String(obj.phone).replace(/\D/g, "") : null;
      const email = obj.email != null ? String(obj.email).trim() : "";
      if (!name) return { action: "unknown" };
      return { action: "add_supplier", name, phone: phone || null, email };
    }
    if (action === "voice_sale") {
      const rawItems = Array.isArray(obj.items) ? obj.items : [];
      const items = rawItems
        .filter((it) => it && (it.name || it.productName))
        .map((it) => ({
          name: String(it.name || it.productName || "").trim(),
          quantity: Math.max(1, parseInt(it.quantity, 10) || 1),
        }))
        .filter((it) => it.name.length > 0);
      const paymentMethod = /card/i.test(String(obj.paymentMethod || "")) ? "card" : "cash";
      if (items.length === 0) return { action: "unknown" };
      return { action: "voice_sale", items, paymentMethod };
    }
    if (["list_products", "low_stock", "add_customer_help", "add_supplier_help", "sales_report_today", "help", "out_of_scope", "unknown"].includes(action)) {
      return { action };
    }
    return null;
  } catch (_) {
    return null;
  }
}

async function getIntentFromMessage(userMessage) {
  const apiKey = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim();
  if (!apiKey) return null;

  const trimmed = (userMessage || "").trim();
  if (!trimmed) return null;

  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey);
  const models = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash"];

  for (const modelId of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const raw = await callGeminiForIntent(genAI, modelId, trimmed);
        const command = parseIntentResponse(raw);
        if (command) return command;
      } catch (err) {
        const is429 = err.message && err.message.includes("429");
        if (is429 && attempt === 1) {
          await new Promise((r) => setTimeout(r, 22000));
          continue;
        }
        console.error("Intent (Gemini) error:", err.message);
      }
    }
  }
  return null;
}

module.exports = { getIntentFromMessage, parseIntentResponse, sanitizeProductName, sanitizeCustomerName, sanitizeSupplierName };
