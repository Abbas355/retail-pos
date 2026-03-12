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
13. list_open_bills – User asks for open bills, list of customers with open bills (e.g. "kitne bills khule hain", "open bills", "list bills", "khule hue bills bata do"). No extra params.
14. voice_sale (use intent "create_sale") – Your responsibility: understand the context, listen to the WHOLE message, and extract EACH product mentioned. Do not take one or two products – take EVERY product from the message. A single message may contain MULTIPLE products; all belong to the SAME sale. Never return only one or two items when the user said three or more (e.g. "3 breads 2 eggs 1 Coca-Cola" must yield three items).

   Before responding, read the ENTIRE message. Words like "aur", "and", commas, or separate numbers indicate different items. Never stop after the first product; continue until all items are extracted.

   Extract: (1) Product name only (eggs, bread, aquafina – never the whole sentence), (2) Quantity (number; if missing use 1), (3) Payment: "cash"/"card"/"online" if mentioned, else "unknown".

   Return ONLY this JSON: {"intent":"create_sale","items":[{"product":"<name1>","quantity":<n1>},{"product":"<name2>","quantity":<n2>},...],"payment_method":"cash|card|online|unknown"}

   Rules: Never treat the whole sentence as a product name. Numbers usually before product ("3 bread", "2 milk"). "aur"/"and"/"," = multiple items – include every item. Roman Urdu numbers: ek=1, do=2, teen=3, char=4, paanch=5, chhe=6, saat=7, aath=8, nau=9, das=10. anday/anda=eggs. bech do/sale kr do = sell. payment cash/cash rakhni hai = cash; payment card/card se = card.

   Example: "3 bread 2 aquafina bech do payment card rakhni hai" → {"intent":"create_sale","items":[{"product":"bread","quantity":3},{"product":"aquafina","quantity":2}],"payment_method":"card"}
   Example: "3 anday 2 bread aur 1 aquafina bech do payment cash" → {"intent":"create_sale","items":[{"product":"eggs","quantity":3},{"product":"bread","quantity":2},{"product":"aquafina","quantity":1}],"payment_method":"cash"}

   If you cannot extract any product, return: {"intent":"create_sale","items":[],"payment_method":"unknown"}
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
  - "kitne bills khule hain" / "open bills" / "list bills" / "khule hue bills bata do" / "show open bills" → {"action":"list_open_bills"}
  - "7 eggs sale kr do" / "7 anday bech do" → {"intent":"create_sale","items":[{"product":"eggs","quantity":7}],"payment_method":"cash"}
  - "3 anday 2 bread aur 1 aquafina bech do payment cash rakhni hai" → {"intent":"create_sale","items":[{"product":"eggs","quantity":3},{"product":"bread","quantity":2},{"product":"aquafina","quantity":1}],"payment_method":"cash"}
  - "2 coke bech do" / "3 bread cash par" → {"intent":"create_sale","items":[{"product":"coke","quantity":2}],"payment_method":"cash"} or items with bread, quantity 3
  - "2 bread card se payment" → {"intent":"create_sale","items":[{"product":"bread","quantity":2}],"payment_method":"card"}
  - "sell 3 eggs and 2 bread and 1 aquafina payment cash" → {"intent":"create_sale","items":[{"product":"eggs","quantity":3},{"product":"bread","quantity":2},{"product":"aquafina","quantity":1}],"payment_method":"cash"}
  - "teen anday do bread ek bottle aquafina bech do cash par" → {"intent":"create_sale","items":[{"product":"eggs","quantity":3},{"product":"bread","quantity":2},{"product":"aquafina","quantity":1}],"payment_method":"cash"}
  - If payment not mentioned → "payment_method":"unknown". If quantity missing for an item → quantity 1.
  - "help" → {"action":"help"}
- If the message is unclear or missing required params, return {"action":"unknown"}.
- Reply with ONLY a single JSON object, no markdown, no explanation.`;

async function callGeminiForIntent(genAI, modelId, userMessage) {
  const model = genAI.getGenerativeModel({ model: modelId });
  const prompt = `${SYSTEM_PROMPT}\n\nUser message: "${userMessage}"\n\nReply with only the JSON object:`;
  const result = await model.generateContent(prompt);
  return result.response.text();
}

/** Focused sales extraction – Roman Urdu / Urdu / English / mixed. Use when message looks like a sale. */
const SALES_EXTRACTION_PROMPT = `Your responsibility is to understand the context of the user's voice: listen to the WHOLE message, then extract EVERY product mentioned and make the sale for each. Do not take one or two products – take EACH product from the message.

Users may speak in Roman Urdu, Urdu, English, or a mixture. A single message may contain multiple products. All products belong to the same sale. Never process only one or two items when the user said three or more.

Before responding, read the entire message and identify every product and its quantity. Words like "aur", "and", "or", commas, or separate numbers indicate different items in the same sale. In Roman Urdu, "or" often means another item (like "and"), e.g. "2 anday or 2 bread bech do" = 2 eggs AND 2 bread (two items).

For example, if the user says:
"3 bread 2 aquafina bech do payment card rakhni hai"
You must return items: 3 bread, 2 aquafina (both in the same sale).

Another example: "3 breads 2 pizza and 1 fries payment is card" → return all three: bread, pizza, fries.

Example with drinks: "sell 3 breads 2 eggs and 1 Coca-Cola payment card" (or "payment carda")
You must return items: 3 bread, 2 eggs, 1 Coca-Cola (or cocacola) – all three in the same sale. Never skip the third product (Coca-Cola).

Never stop processing after the first recognized product. Continue scanning the full message until all items are extracted.

Quantities are usually spoken before the product name (e.g., "3 bread", "2 milk", "5 anday"). If quantity is not mentioned, assume the quantity is 1.

Common language patterns:
- "bech do", "sale kr do", "sale kar do" = create a sale
- "aur" and "or" = another item (both mean add this item too). "2 anday or 2 bread" = two items: 2 eggs, 2 bread
- Quantity then product: "3 bread" = 3 bread, "2 anday" = 2 eggs. Roman Urdu: do=2, teen=3, char=4, paanch=5
- "payment cash" = cash, "payment card" = card

If multiple valid products are detected in the message, always include all of them in the same sale transaction.

Only ask for confirmation (return empty items) if a product name is unclear or you cannot extract any item. If several products are clearly recognized, return all of them in the items array.

Never treat the entire sentence as a product name and never ignore earlier items when a later item is recognized.

Product name hints: anday / anda = eggs. Coca-Cola / coca-cola / coke = cocacola. paratha/parathas = paratha. Use short inventory names: eggs, bread, milk, aquafina, fries, pizza, cocacola, paratha. "set payment method to card/cash" is only payment – do not treat "set" or "method" as product names. Never skip a product that appears between two numbers or after "and"/"aur"/"or". Example: "2 anday or 2 bread bech do" must return items: [{"product":"eggs","quantity":2},{"product":"bread","quantity":2}].
Number words: ek=1, do=2, teen=3, char=4, paanch=5, chhe=6, saat=7, aath=8, nau=9, das=10. Output quantity as a number.

Return the result ONLY in JSON format. No other text.

Example with two items:
{"intent":"create_sale","items":[{"product":"bread","quantity":3},{"product":"aquafina","quantity":2}],"payment_method":"card"}

Example with three items (e.g. "3 breads 2 pizza and 1 fries payment is card"):
{"intent":"create_sale","items":[{"product":"bread","quantity":3},{"product":"pizza","quantity":2},{"product":"fries","quantity":1}],"payment_method":"card"}

Example "sell 3 breads 2 eggs and 1 Coca-Cola payment card":
{"intent":"create_sale","items":[{"product":"bread","quantity":3},{"product":"eggs","quantity":2},{"product":"cocacola","quantity":1}],"payment_method":"card"}

Example "2 anday or 2 bread bech do" (Roman Urdu – "or" = another item, two products):
{"intent":"create_sale","items":[{"product":"eggs","quantity":2},{"product":"bread","quantity":2}],"payment_method":"unknown"}

Example "3 eggs 2 bread and 1 paratha set payment method to card":
{"intent":"create_sale","items":[{"product":"eggs","quantity":3},{"product":"bread","quantity":2},{"product":"paratha","quantity":1}],"payment_method":"card"}

Rules:
- items must contain EVERY product in the message. Never return only one or two items when the user said three or more (e.g. bread, pizza, fries = all three required).
- Never treat the whole sentence as a product name. Always separate quantity and product.
- If payment is not mentioned set payment_method = "unknown".
- If quantity is missing for an item assume quantity = 1.`;

async function callGeminiForSalesOnly(genAI, modelId, userMessage) {
  const model = genAI.getGenerativeModel({ model: modelId });
  const prompt = `${SALES_EXTRACTION_PROMPT}\n\nUser message: "${userMessage}"\n\nReturn ONLY the JSON object, no other text:`;
  const result = await model.generateContent(prompt);
  return result.response.text();
}

function looksLikeSaleMessage(text) {
  if (!text || typeof text !== "string") return false;
  const lower = text.trim().toLowerCase();
  const saleVerbs = /bech\s+do|sale\s+kr|sell|nikal\s+do|de\s+do|dy\s+do|dedena|rakhni\s+hai|laga\s+do|daal\s+do/;
  const paymentWords = /payment|cash|card|rakhni/;
  const multiItem = /aur\s+\d|\d+\s+aur|and\s+\d|\d+\s+and|or\s+\d|\d+\s+or|,\s*\d+|\d+\s+,/;
  const quantityProduct = /\d+\s+(bread|milk|eggs|anday|anda|aquafina|fries|coke|water|\w+)/i;
  if (saleVerbs.test(lower) || (paymentWords.test(lower) && quantityProduct.test(lower))) return true;
  if (multiItem.test(lower)) return true;
  if (/\d+\s+\w+(\s+(aur|and)\s+\d+\s+\w+)+/i.test(lower)) return true;
  return false;
}

function looksLikeBillOrPaymentMessage(text) {
  if (!text || typeof text !== "string") return false;
  const lower = text.trim().toLowerCase();
  if (/\b(laga\s+do|daal\s+do|dy\s+do|de\s+do|bill\s+close|bill\s+nikal|bill\s+complete|ka\s+bill|ke\s+bill|payment\s+(cash|card)\s*(kar|karo|kr)?\s*do|payment\s+(cash|card)\s*(ha|hai)|(cash|card)\s+payment\s*(kar|karo|kr)\s*do)\b/.test(lower)) return true;
  if (/\b(ko|ki\s+payment)\s+\w+/.test(lower)) return true;
  return false;
}

/** Multi-customer billing: extract customer_name and bill_action. */
const BILL_AWARE_SALES_PROMPT = `Extract sale/bill intent. Return JSON: intent "create_sale", customer_name (the EXACT name as written or spoken – same spelling/casing. Name can appear: "<name> ko 2 detergent dy do" OR "2 detergent dy do <name> ko" OR "<name> ka bill nikal do". Extract that name only, else null), bill_action "add_to_bill" (laga do, bech do, daal do, dy do, de do, sale kr do) or "complete_payment" (bill nikal do, X ka bill nikal do, bill complete kr do, payment cash kar do, payment cash ha), items [{product, quantity}], payment_method (cash|card|unknown). "or"/"aur" = another item. Product hints: anday/anda=eggs. Include EVERY product. Examples: "Safeer ko 2 eggs or 1 paratha dy do" → customer_name:"Safeer", bill_action:"add_to_bill", items:[{product:"eggs",quantity:2},{product:"paratha",quantity:1}]. "Azam ka bill nikal do payment cash ha" → customer_name:"Azam", bill_action:"complete_payment", items:[], payment_method:"cash". "bill nikal do" (no name) → customer_name:null, bill_action:"complete_payment".`;

async function callGeminiForBillAwareSales(genAI, modelId, userMessage) {
  const model = genAI.getGenerativeModel({ modelId });
  const prompt = `${BILL_AWARE_SALES_PROMPT}\n\nUser message: "${userMessage}"\n\nReturn ONLY the JSON object, no other text:`;
  const result = await model.generateContent(prompt);
  return result.response.text();
}

/** Roman Urdu number words → digit for fallback parsing */
const ROMAN_URDU_NUM = { ek: 1, aik: 1, do: 2, teen: 3, tin: 3, char: 4, paanch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10 };
const PRODUCT_JUNK = /^(payment|is|cash|card|carda|carde|cashh|sell|bech|do|aur|and|or|rakhni|hai|par|se|the|a|an|set|method|to|acha|yar|oy|dy)$/i;

/**
 * Fallback: extract quantity-product pairs from raw message so we never drop items.
 * Handles "3 breads 2 eggs and 1 Coca-Cola payment card" → bread, eggs, coca-cola (all three).
 */
function extractSaleItemsFromText(message) {
  if (!message || typeof message !== "string") return [];
  const text = message.trim().toLowerCase()
    .replace(/\bset\s+payment\s+method\s+to\s+(cash|card[a-z]*)\b/gi, "")
    .replace(/\bpayment\s+method\s+to\s+(cash|card[a-z]*)\b/gi, "")
    .replace(/\bpayment\s+is\s+(cash|card[a-z]*)\b/gi, "")
    .replace(/\bpayment\s+(cash|card[a-z]*)\b/gi, "")
    .replace(/\b(cash|card[a-z]*)\s+rakhni\s+hai\b/gi, "")
    .replace(/\b(sell|bech\s+do|sale\s+kr\s+do)\b/gi, "")
    .replace(/\b(and|aur|or)\b/gi, " ");
  const items = [];
  const parts = text.split(/\s+/).filter((p) => p.length > 0);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (PRODUCT_JUNK.test(p)) continue;
    const num = parseInt(p, 10);
    if (!Number.isNaN(num) && num >= 1 && num <= 999) {
      const rest = parts.slice(i + 1);
      const productWords = [];
      for (const w of rest) {
        if (PRODUCT_JUNK.test(w)) break;
        if (/^\d+$/.test(w) || ROMAN_URDU_NUM[w]) break;
        productWords.push(w);
        if (productWords.length >= 3) break;
      }
      const product = productWords.join(" ").trim();
      if (product) {
        items.push({ product, quantity: num });
        i += productWords.length;
      }
    } else if (ROMAN_URDU_NUM[p] != null) {
      const qty = ROMAN_URDU_NUM[p];
      const rest = parts.slice(i + 1);
      const productWords = [];
      for (const w of rest) {
        if (PRODUCT_JUNK.test(w)) break;
        if (/^\d+$/.test(w) || ROMAN_URDU_NUM[w]) break;
        productWords.push(w);
        if (productWords.length >= 3) break;
      }
      const product = productWords.join(" ").trim();
      if (product) {
        items.push({ product, quantity: qty });
        i += productWords.length;
      }
    }
  }
  const normalized = items.map((it) => {
    const name = it.product.toLowerCase().replace(/-/g, " ");
    const single = name.replace(/\s+/g, " ");
    let product = single === "breads" ? "bread" : single === "anday" || single === "ande" || single === "anda" ? "eggs" : single;
    if (product === "coca cola" || product === "coca-cola" || product === "cocacola") product = "cocacola";
    else if (product.endsWith("s") && product !== "fries" && product.length > 2) product = product.slice(0, -1);
    return { product, quantity: it.quantity };
  });
  return normalized;
}

/** Count how many quantity-like numbers appear in the message (e.g. "3 breads 2 eggs 1 cola" → 3). */
function countQuantityNumbersInMessage(text) {
  if (!text || typeof text !== "string") return 0;
  const tokens = text.trim().split(/\s+/);
  let count = 0;
  for (let i = 0; i < tokens.length; i++) {
    const n = parseInt(tokens[i], 10);
    if (!Number.isNaN(n) && n >= 1 && n <= 999) count++;
  }
  return count;
}

/** Use regex fallback when it finds more items than Gemini, or when message has N quantity numbers and fallback correctly extracts N items (so we get accurate products and quantities). */
function applySaleFallback(command, userMessage) {
  if (!command || command.action !== "voice_sale" || !Array.isArray(command.items) || !userMessage) return command;
  const fallbackItems = extractSaleItemsFromText(userMessage);
  const expectedCount = countQuantityNumbersInMessage(userMessage);
  const useFallback = fallbackItems.length > command.items.length ||
    (expectedCount >= 2 && fallbackItems.length >= expectedCount && command.items.length < expectedCount) ||
    (expectedCount >= 2 && fallbackItems.length === expectedCount);
  if (!useFallback || fallbackItems.length === 0) return command;
  command = { ...command, items: fallbackItems.map((it) => ({ name: it.product, quantity: it.quantity })) };
  return command;
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
    if (obj.intent && (String(obj.intent).toLowerCase() === "sale" || String(obj.intent).toLowerCase() === "create_sale")) action = "voice_sale";
    if (!action) return null;
    const allowed = ["add_product", "list_products", "low_stock", "search", "delete_product", "set_threshold", "set_stock", "add_customer", "add_customer_help", "add_supplier", "add_supplier_help", "sales_report_today", "list_open_bills", "voice_sale", "help", "out_of_scope", "unknown"];
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
    if (action === "voice_sale" || (obj.intent && (String(obj.intent).toLowerCase() === "sale" || String(obj.intent).toLowerCase() === "create_sale"))) {
      const isCreateSale = obj.intent && String(obj.intent).toLowerCase() === "create_sale";
      const rawItemsArray = Array.isArray(obj.items) ? obj.items : [];
      const customerNameRaw = obj.customer_name != null ? obj.customer_name : (obj.customerName != null ? obj.customerName : obj.customer);
      const customerName = customerNameRaw != null && String(customerNameRaw).trim() !== "" ? String(customerNameRaw).trim() : null;
      const billAction = (obj.bill_action || obj.billAction) === "complete_payment" ? "complete_payment" : "add_to_bill";

      if (isCreateSale || rawItemsArray.length > 0) {
        const payRaw = String(obj.payment_method || obj.paymentMethod || "").toLowerCase().trim();
        const paymentMethod = payRaw === "unknown" || !payRaw
          ? "cash"
          : /card|online/i.test(payRaw)
            ? "card"
            : "cash";
        const multiProductItems = rawItemsArray
          .filter((it) => it && (it.product != null || it.name != null))
          .map((it) => {
            const name = String(it.product != null ? it.product : it.name || "").trim();
            const qRaw = it.quantity;
            const qty = qRaw === "unknown" || qRaw === null || qRaw === undefined
              ? 1
              : Math.max(1, parseInt(qRaw, 10) || Number(qRaw) || 1);
            return { name, quantity: qty };
          })
          .filter((it) => it.name.length > 0 && it.name.toLowerCase() !== "unknown");

        if (multiProductItems.length > 0) {
          return {
            action: "voice_sale",
            items: multiProductItems,
            paymentMethod,
            customer: customerName || (obj.customer != null && String(obj.customer).trim() !== "" ? String(obj.customer).trim() : null),
            customerName: customerName || null,
            billAction,
            saleAction: "process_sale",
            saleConfidence: "high",
          };
        }
        if (isCreateSale) {
          return { action: "voice_sale", items: [], paymentMethod: "cash", customerName: customerName || null, billAction, saleAction: "ask_confirmation", saleConfidence: "low" };
        }
      }

      const isNewFormat = obj.intent && obj.hasOwnProperty("action") && /process_sale|ask_confirmation/.test(String(obj.action));
      if (isNewFormat) {
        const customer = obj.customer != null && String(obj.customer).trim() !== "" ? String(obj.customer).trim() : null;
        const paymentMethod = /card/i.test(String(obj.payment_method || obj.paymentMethod || "")) ? "card" : "cash";
        const saleAction = String(obj.action || "").toLowerCase() === "process_sale" ? "process_sale" : "ask_confirmation";
        const saleConfidence = String(obj.confidence || "").toLowerCase() === "high" ? "high" : "low";

        const rawItemsArrayLegacy = Array.isArray(obj.items) ? obj.items : [];
        const multiProductItems = rawItemsArrayLegacy
          .filter((it) => it && (it.product != null || it.name != null))
          .map((it) => {
            const name = String(it.product != null ? it.product : it.name || "").trim();
            const qRaw = it.quantity;
            const qty = qRaw === "unknown" || qRaw === null || qRaw === undefined ? 1 : Math.max(1, parseInt(qRaw, 10) || Number(qRaw) || 1);
            return { name, quantity: qty };
          })
          .filter((it) => it.name.length > 0 && it.name.toLowerCase() !== "unknown");

        if (multiProductItems.length > 0) {
          const effectiveAction = saleAction === "process_sale" && multiProductItems.every((it) => it.name && it.quantity >= 1) ? "process_sale" : "ask_confirmation";
          return { action: "voice_sale", items: multiProductItems, paymentMethod, customer, customerName: customerName || null, billAction, saleAction: effectiveAction, saleConfidence };
        }

        const product = obj.product != null ? String(obj.product).trim() : "";
        const qRaw = obj.quantity;
        const quantity = qRaw === "unknown" || qRaw === null || qRaw === undefined ? null : Math.max(1, parseInt(qRaw, 10) || Number(qRaw) || 1);
        const productUnknown = !product || product.toLowerCase() === "unknown";
        const qtyUnknown = quantity === null || quantity === undefined;
        const effectiveAction = (saleAction === "process_sale" && !productUnknown && !qtyUnknown) ? "process_sale" : "ask_confirmation";
        const items = !productUnknown && !qtyUnknown ? [{ name: product, quantity: quantity || 1 }] : [{ name: product || "unknown", quantity: 1 }];
        return { action: "voice_sale", items, paymentMethod, customer, customerName: customerName || null, billAction, saleAction: effectiveAction, saleConfidence };
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
      if (items.length === 0) {
        if (billAction === "complete_payment") {
          return { action: "voice_sale", items: [], paymentMethod, customerName: customerName || null, billAction: "complete_payment", saleAction: "process_sale", saleConfidence: "high" };
        }
        return { action: "unknown" };
      }
      return { action: "voice_sale", items, paymentMethod, customerName: customerName || null, billAction, saleAction: "process_sale", saleConfidence: "high" };
    }
    if (["list_products", "low_stock", "add_customer_help", "add_supplier_help", "sales_report_today", "list_open_bills", "help", "out_of_scope", "unknown"].includes(action)) {
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

  if (looksLikeBillOrPaymentMessage(trimmed) || looksLikeSaleMessage(trimmed)) {
    const useBillAware = looksLikeBillOrPaymentMessage(trimmed);
    const hasMultipleQuantityProduct = (/\d+\s+\w+/.test(trimmed) && (/\d+\s+\w+.*\d+\s+\w+/.test(trimmed) || /aur|and\s+\d|\d+\s+aur|\d+\s+and/.test(trimmed)));
    for (const modelId of models) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const raw = useBillAware
            ? await callGeminiForBillAwareSales(genAI, modelId, trimmed)
            : await callGeminiForSalesOnly(genAI, modelId, trimmed);
          let command = parseIntentResponse(raw);
          if (command && command.action === "voice_sale") {
            if (command.items && command.items.length > 0) {
              command = applySaleFallback(command, trimmed);
              if (!hasMultipleQuantityProduct || command.items.length >= 2) return command;
            } else if (command.billAction === "complete_payment") {
              return command;
            }
          }
        } catch (err) {
          const is429 = err.message && err.message.includes("429");
          if (is429 && attempt === 1) {
            await new Promise((r) => setTimeout(r, 22000));
            continue;
          }
        }
      }
    }
  }

  for (const modelId of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const raw = await callGeminiForIntent(genAI, modelId, trimmed);
        let command = parseIntentResponse(raw);
        if (command) {
          command = applySaleFallback(command, trimmed);
          return command;
        }
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
