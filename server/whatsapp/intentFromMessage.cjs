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
13. voice_sale – User wants to make a sale. You MUST return ONE of two JSON shapes:

   A) When intent is clearly a SALE and information is COMPLETE and UNAMBIGUOUS (product name and quantity are clear):
   Return ONLY this JSON (no other text):
   {"intent":"sale","product":"<exact product name only>","quantity":<number>,"customer":"<name or null>","payment_method":"cash|card","confidence":"high","action":"process_sale"}
   - product: ONLY the product name (e.g. eggs, milk, cooking oil). Do NOT include the number in the product name.
   - quantity: The NUMBER of units to sell. When the user says "7 eggs sale kro do" or "7 eggs sell kardo", the number 7 is the quantity and "eggs" is the product. Total payment = quantity × price per unit. Always extract the number before or with the product (e.g. "2 milk", "7 eggs", "3 bread") as the quantity. If no number is stated, use 1.
   - Default payment_method to "cash" if not specified. Never guess other missing fields; use B) instead.

   B) When the message is ambiguous, incomplete, or you are not confident:
   Return ONLY this JSON:
   {"intent":"sale","product":"<understood name or unknown>","quantity":<number or "unknown">,"confidence":"low","action":"ask_confirmation"}
   - Use "unknown" only for truly missing fields. Extract exact values from the sentence when present.

   Rules for voice_sale: Only extract EXACT values from the sentence. Do NOT include whole sentence as a value. Never guess missing product or quantity; ask for confirmation instead.

   Roman Urdu / mixed language – SALE phrases (all mean SELL): sale kr do, bech do, de do, nikal do, dedena. Treat these as "sell".
   Payment phrases: cash rakh lo, cash par, cash payment, cash → payment_method "cash". card se, card par, card payment → payment_method "card". online payment, bank transfer → payment_method "card".
   Quantity: If a number appears before the product name, that number is the quantity. "anday" = eggs (product name "eggs").
   Plurals: User may say parathe, parathay, eggs, burgers – return the word as spoken; the system will match to inventory (e.g. paratha, egg, burger).
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
  - "7 eggs sale kr do" / "7 anday bech do" → {"intent":"sale","product":"eggs","quantity":7,"customer":null,"payment_method":"cash","confidence":"high","action":"process_sale"} (anday = eggs)
  - "2 coke sale kr do" / "2 coke bech do" → {"intent":"sale","product":"coke","quantity":2,"customer":null,"payment_method":"cash","confidence":"high","action":"process_sale"}
  - "3 bread cash par" / "3 bread cash rakh lo" → {"intent":"sale","product":"bread","quantity":3,"customer":null,"payment_method":"cash","confidence":"high","action":"process_sale"}
  - "3 coke bech do cash par" → {"intent":"sale","product":"coke","quantity":3,"customer":null,"payment_method":"cash","confidence":"high","action":"process_sale"}
  - "2 bread card se payment" → {"intent":"sale","product":"bread","quantity":2,"customer":null,"payment_method":"card","confidence":"high","action":"process_sale"}
  - "sell 2 milk payment cash" → {"intent":"sale","product":"milk","quantity":2,"customer":null,"payment_method":"cash","confidence":"high","action":"process_sale"}
  - "3 bread sale kardo payment cash rakhni hai" → {"intent":"sale","product":"bread","quantity":3,"customer":null,"payment_method":"cash","confidence":"high","action":"process_sale"}
  - "add detergent to cart, payment is card" → {"intent":"sale","product":"detergent","quantity":1,"customer":null,"payment_method":"card","confidence":"high","action":"process_sale"}
  - "a cooking oil sell kardo payment cash hai" → {"intent":"sale","product":"cooking oil","quantity":1,"customer":null,"payment_method":"cash","confidence":"high","action":"process_sale"}
  - "milk sell karo payment card hai" → {"intent":"sale","product":"milk","quantity":1,"customer":null,"payment_method":"card","confidence":"high","action":"process_sale"}
  - If message is unclear (e.g. "sell something") → {"intent":"sale","product":"unknown","quantity":"unknown","confidence":"low","action":"ask_confirmation"}
  - If multiple products in one message, use the first clear product and quantity, or ask_confirmation if ambiguous.
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
    if (!obj || typeof obj !== "object") return null;
    let action = (obj.action != null ? String(obj.action) : "").toLowerCase();
    if (obj.intent && String(obj.intent).toLowerCase() === "sale") action = "voice_sale";
    if (!action) return null;
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
    if (action === "voice_sale" || (obj.intent && String(obj.intent).toLowerCase() === "sale")) {
      const isNewFormat = obj.intent && obj.hasOwnProperty("action") && /process_sale|ask_confirmation/.test(String(obj.action));
      if (isNewFormat) {
        const product = obj.product != null ? String(obj.product).trim() : "";
        const qRaw = obj.quantity;
        const quantity = qRaw === "unknown" || qRaw === null || qRaw === undefined
          ? null
          : Math.max(1, parseInt(qRaw, 10) || Number(qRaw) || 1);
        const customer = obj.customer != null && String(obj.customer).trim() !== "" ? String(obj.customer).trim() : null;
        const paymentMethod = /card/i.test(String(obj.payment_method || obj.paymentMethod || "")) ? "card" : "cash";
        const saleAction = String(obj.action || "").toLowerCase() === "process_sale" ? "process_sale" : "ask_confirmation";
        const saleConfidence = String(obj.confidence || "").toLowerCase() === "high" ? "high" : "low";
        const productUnknown = !product || product.toLowerCase() === "unknown";
        const qtyUnknown = quantity === null || quantity === undefined;
        const effectiveAction = (saleAction === "process_sale" && !productUnknown && !qtyUnknown) ? "process_sale" : "ask_confirmation";
        const items = !productUnknown && !qtyUnknown
          ? [{ name: product, quantity: quantity || 1 }]
          : [{ name: product || "unknown", quantity: 1 }];
        return {
          action: "voice_sale",
          items,
          paymentMethod,
          customer,
          saleAction: effectiveAction,
          saleConfidence,
        };
      }
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
      return { action: "voice_sale", items, paymentMethod, saleAction: "process_sale", saleConfidence: "high" };
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
