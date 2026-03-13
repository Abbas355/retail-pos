/**
 * Parses incoming WhatsApp text or voice transcript into POS commands.
 * Supports both exact text commands and voice-style variations (e.g. "list all products", "show low stock").
 */

const ADD_NAME_JUNK = /\b(it'?s|its|price|should|be|threshold|and|is|cost)\b/i;

/** Roman Urdu / Hindi number words → digit (for quantity in "teen eggs", "do bread") */
const ROMAN_URDU_NUMBERS = {
  ek: 1, aik: 1, one: 1,
  do: 2, doh: 2, two: 2,
  teen: 3, tin: 3, three: 3,
  char: 4, chaar: 4, four: 4,
  paanch: 5, panch: 5, five: 5,
  chhe: 6, che: 6, chhay: 6, six: 6,
  saat: 7, sat: 7, seven: 7,
  aath: 8, ath: 8, eight: 8,
  nau: 9, no: 9, nine: 9,
  das: 10, dus: 10, ten: 10,
  gyarah: 11, barah: 12, terah: 13, chaudah: 14, pandrah: 15,
};
function parseQuantityFromSegment(segment) {
  if (!segment || typeof segment !== "string") return { quantity: 1, name: segment || "" };
  const s = segment.trim();
  const digitMatch = s.match(/^(\d+)\s+(.+)$/);
  if (digitMatch) {
    const qty = Math.max(1, parseInt(digitMatch[1], 10) || 1);
    return { quantity: qty, name: digitMatch[2].trim() };
  }
  const word = s.split(/\s+/)[0] || "";
  const lower = word.toLowerCase();
  const num = ROMAN_URDU_NUMBERS[lower];
  if (num != null) {
    const rest = s.slice(word.length).trim();
    return { quantity: Math.max(1, num), name: rest || word };
  }
  return { quantity: 1, name: s };
}

function extractCustomerNameOnly(raw) {
  if (!raw || typeof raw !== "string") return raw;
  const s = raw.trim();
  const junk = /\s+(?:and\s+(?:its?|his|her|their)|it'?s|,)\s*(?:phone|number)/i;
  const m = s.match(new RegExp("^(.+?)" + junk.source));
  if (m) return m[1].trim();
  if (/phone|number|\d/.test(s) || s.length > 30) {
    const first = s.match(/^([A-Za-z\u00C0-\u024F]+)/);
    return first ? first[1].trim() : s.split(/\s+/)[0] || s;
  }
  return s;
}

const SUPPLIER_JUNK_WORDS = /^(and|its?|his|her|the|phone|number|email|is|address|name)$/i;

/** Match "it's name is X", "it's name X", "name is X" etc. – extract X only */
const NAME_IS_PATTERN = /((?:it'?s|its?|his|her|their|the)\s+)?name\s+(?:is\s+)?(.+)/i;

/** Extract ONLY the supplier name – no "it's name", "his phone number", etc. */
function extractSupplierNameOnly(raw) {
  if (!raw || typeof raw !== "string") return "";
  let s = raw.trim();
  const nameIs = s.match(NAME_IS_PATTERN);
  if (nameIs) s = nameIs[2].replace(/\s+and\s*$/i, "").trim();
  const junk = /\s+(?:(?:and\s+)?(?:its?|his|her|their|the)\s+)?(?:phone\s*(?:number\s+)?(?:is\s+)?|email\s*(?:address\s+)?(?:is\s+)?|number)/i;
  const m = s.match(new RegExp("^(.+?)" + junk.source));
  if (m) s = m[1].trim();
  s = s.replace(/\d+/g, "").replace(/\s*@\s*/g, "").trim();
  const words = s.split(/\s+/).filter((w) => w.length > 0 && !SUPPLIER_JUNK_WORDS.test(w));
  return words.slice(0, 3).join(" ") || "";
}

/** Extract phone – only digits. Returns empty string if none found. */
function extractPhoneOnly(text) {
  if (!text || typeof text !== "string") return "";
  const digits = text.replace(/\D/g, "");
  return digits;
}

function parseCommand(text) {
  if (!text || typeof text !== "string") return { action: "unknown" };
  const trimmed = text.trim().replace(/\s+/g, " ");
  const lower = trimmed.toLowerCase();

  // --- List products (voice: "list products", "list all products", "show products", etc.)
  if (/^(list|show)\s*(all\s*)?(the\s*)?products?$/.test(lower) || lower === "list products" || lower === "list product") {
    return { action: "list_products" };
  }
  if (lower.includes("list") && lower.includes("product") && !lower.includes("add") && !/delete|remove/.test(lower)) {
    return { action: "list_products" };
  }

  // --- Low stock (voice: "low stock", "show low stock", "what's low on stock", etc.)
  if (/^(show\s*)?(what'?s\s*)?low\s*(on\s*)?stock(\s*items?)?\.?$/i.test(lower) || lower === "low stock" || lower === "lowstock") {
    return { action: "low_stock" };
  }
  if (lower.includes("low") && lower.includes("stock") && !lower.includes("add") && !/delete|remove|search/.test(lower)) {
    return { action: "low_stock" };
  }

  // --- Help (voice: "help", "help me", "show help", "commands")
  if (/^(show\s*)?help(\s+me)?\.?$/i.test(lower) || lower === "help" || lower === "?" || lower === "commands") {
    return { action: "help" };
  }

  // --- Undo: "undo" / "undo kar do" / "is ko undo kar do" / "usy undo krta hun" = undo LAST. "undo 1" = first, etc.
  const undoNum = lower.match(/^undo\s+(\d+)\s*$/) || lower.match(/^undo\s+kar\s+do\s+(\d+)\s*$/);
  if (undoNum) {
    const pos = parseInt(undoNum[1], 10);
    if (pos >= 1 && pos <= 3) return { action: "undo", undoPosition: pos };
  }
  if (/^undo\s*$/i.test(lower) || /^undo\s+kar\s+do\s*$/i.test(lower) || /^last\s+(?:command\s+)?undo\s*$/i.test(lower) || /^last\s+wala\s+undo\s+(?:karo|kar\s+do)\s*$/i.test(lower)) {
    return { action: "undo", undoPosition: 0 };
  }
  if (/(?:is\s+ko|usy|isy|is\s+wale\s+ko|us\s+ko)\s+undo\s+(?:kar\s+do|karo|krta?\s+hun)/i.test(lower) || /^(?:is|us)\s+undo\s+(?:kar\s+do|karo)/i.test(lower)) {
    return { action: "undo", undoPosition: 0 };
  }
  if (/^(?:pehla|pehla\s+wala)\s+undo\s+(?:karo|kar\s+do)\s*$/i.test(lower) || /^first\s+undo\s*$/i.test(lower)) {
    return { action: "undo", undoPosition: 1 };
  }
  if (/^(?:dusra|doosra|second)\s+undo\s+(?:karo|kar\s+do)\s*$/i.test(lower)) {
    return { action: "undo", undoPosition: 2 };
  }
  if (/^(?:teesra|teesra\s+wala|third)\s+undo\s+(?:karo|kar\s+do)\s*$/i.test(lower)) {
    return { action: "undo", undoPosition: 3 };
  }

  // --- Voice sale: English + Roman Urdu (sale kr do, bech do, de do, nikal do, dedena = sell)
  const voiceSaleAdd = lower.match(/add\s+(.+?)\s+(?:to\s+cart|,|and\s+payment|pay\s+with|payment\s+is)/i) ||
    lower.match(/(?:complete\s+sale|make\s+sale)\s+(?:for\s+)?(.+?)(?:\s*,\s*|\s+payment|\s+pay\s+with|$)/i) ||
    lower.match(/(?:a\s+)?(.+?)\s+sell\s+(?:kardo|karo)/i) ||
    lower.match(/sell\s+(?:kardo\s+)?(?:a\s+)?(.+?)(?:\s+payment|\s+pay\s+with|\s+card|\s+cash|$)/i) ||
    lower.match(/(.+?)\s+(?:sale\s+kr\s+do|bech\s+do|de\s+do|nikal\s+do|dedena)(?:\s+cash|\s+card|\s+payment|\s+par|$)/i) ||
    lower.match(/(?:sale\s+kr\s+do|bech\s+do|de\s+do|nikal\s+do|dedena)\s+(.+?)(?:\s+cash|\s+card|\s+payment|\s+par|$)/i) ||
    lower.match(/(.+?)\s+(?:cash\s+par|card\s+se|cash\s+rakh\s+lo|card\s+par)(?:\s+payment)?\s*$/i);
  const saleKeywords = /cart|sale|sell|payment|pay\s+with|complete|kardo|karo|bech\s+do|de\s+do|nikal\s+do|dedena|cash\s+par|card\s+se/i;
  if (voiceSaleAdd && (saleKeywords.test(lower) || /add\s+\w+/.test(lower))) {
    const payMatch = lower.match(/payment\s+method\s+to\s+(\w+)|set\s+payment\s+method\s+to\s+(\w+)|payment\s+is\s+(\w+)|pay\s+with\s+(\w+)|payment\s+(\w+)\s+hai|(\w+)\s+hai\s+.*(?:payment|pay)/i)
      || lower.match(/card\s+se|card\s+par|card\s+payment/i)
      || lower.match(/cash\s+rakh\s+lo|cash\s+par|cash\s+payment|cash(?:\s|$)/i)
      || lower.match(/online\s+payment|bank\s+transfer/i)
      || lower.match(/payment\s+is\s+(\w+)|pay\s+with\s+(\w+)|payment\s+(\w+)/i);
    let payVal = "";
    if (payMatch) {
      if (/card\s+se|card\s+par|card\s+payment/i.test(lower)) payVal = "card";
      else if (/cash\s+rakh\s+lo|cash\s+par|cash\s+payment|cash(?:\s|$)/i.test(lower)) payVal = "cash";
      else if (/online\s+payment|bank\s+transfer/i.test(lower)) payVal = "card";
      else payVal = (payMatch[1] || payMatch[2] || payMatch[3] || payMatch[4] || payMatch[5] || payMatch[6] || "").toLowerCase();
    }
    const paymentMethod = /card/i.test(payVal) ? "card" : "cash";
    let productPart = (voiceSaleAdd[1] || "").replace(/\s*(?:and\s+)?(?:set\s+)?payment\s+(?:method\s+to\s+)?(?:is\s+)?\w+(\s+hai)?.*$/i, "").replace(/\s*(?:on\s+)?sale\s+ko\s+complete.*$/i, "").replace(/\s*,\s*complete.*$/i, "").replace(/\s+payment\s+.*$/i, "").replace(/\s+(?:cash\s+rakh\s+lo|cash\s+par|card\s+se|card\s+par|card\s+rakhni\s+hai|online\s+payment|bank\s+transfer).*$/i, "").trim();
    productPart = productPart.replace(/^(a|the|acha\s+yar|yar\s+acha|acha|oy\s+yar)\s+/i, "").trim();
    productPart = productPart.replace(/\banday\b/gi, "eggs").replace(/\banda\b/gi, "eggs");
    const segments = productPart.split(/\s+and\s+|\s+aur\s+|\s+or\s+|\s*,\s*/).map((s) => s.trim()).filter(Boolean);
    const items = [];
    for (const n of segments) {
      const { quantity, name } = parseQuantityFromSegment(n);
      if (name && !/^(set|payment|method|to|card|cash|rakh|lo|par|se)$/i.test(name)) items.push({ name, quantity });
    }
    if (items.length > 0) return { action: "voice_sale", items, paymentMethod };
  }

  // --- List open bills (voice: "kitne bills khule hain", "open bills", "list bills", etc.)
  if (/^(kitne\s+)?bills?\s+khul(e|ay)\s+hain/i.test(lower) || /khul(e|ay)\s+hue?\s+bills?\s+bata\s+do/i.test(lower) ||
      /^(list|show)\s+(open\s+)?bills?$/i.test(lower) || lower === "open bills" || lower === "open bill" ||
      /batao\s+kitne\s+bills?\s+khul(e|ay)\s+hain/i.test(lower)) {
    return { action: "list_open_bills" };
  }

  // --- Khata: specific customer FIRST (X ka khata bata do - must have actual name like Talha, Ali)
  const khataCustomerMatch = lower.match(/mujhe\s+([A-Za-z\u00C0-\u024F]+(?:\s+[A-Za-z\u00C0-\u024F]+)?)\s+ka\s+khata\s+(bata\s+do|batao|kitna\s+rehta)/i) ||
    lower.match(/([A-Za-z\u00C0-\u024F]{2,}(?:\s+[A-Za-z\u00C0-\u024F]+)?)\s+ka\s+khata\s+(bata\s+do|batao|kitna\s+rehta\s+hai|show)/i) ||
    lower.match(/([A-Za-z\u00C0-\u024F]{2,}(?:\s+[A-Za-z\u00C0-\u024F]+)?)\s+ka\s+balance/i) ||
    lower.match(/([A-Za-z\u00C0-\u024F]{2,}(?:\s+[A-Za-z\u00C0-\u024F]+)?)\s+ka\s+udhaar\s+(kitna\s+hai|bata\s+do|batao)/i);
  if (khataCustomerMatch) {
    const name = (khataCustomerMatch[1] || "").trim();
    if (name && !/^(acha|achha|yar|oy|mujhe|give|me|the|data|of|kis|kiska|kisi|na|woh|wo|batao|bata|list|show)$/i.test(name)) {
      return { action: "khata_customer", customerName: name };
    }
  }

  // --- Khata: pending payments list (general - no specific customer name)
  const khataLower = lower.replace(/\bkhat\b/gi, "khata");
  if (/customers?\s+whose\s+payments?\s+(are\s+)?pending/i.test(khataLower) ||
      /pending\s+payments?\s+list/i.test(khataLower) ||
      /jinke?\s+payments?\s+pending\s+hain/i.test(khataLower) ||
      /kitne\s+customers?\s+ka\s+payment\s+pending\s+hai/i.test(khataLower) ||
      /(give\s+me\s+)?(the\s+)?data\s+of\s+customers?\s+whose\s+payments?\s+are\s+pending/i.test(khataLower) ||
      /(udhaar|in\s+out|khata)\s+(list|bata\s+do|batao|bata|show)/i.test(khataLower) ||
      /mujh(e|y)\s+(\w+\s+)*khata\s+(batao|bata\s+do|bata)/i.test(khataLower) ||
      /khata\s+(batao|bata\s+do|bata|show)\s+(kis\s+ka|kiska)\s+kitna\s+rehta\s+(hai|ha)/i.test(khataLower) ||
      /(kis\s+ka|kiska)\s+kitna\s+rehta\s+(hai|ha)/i.test(khataLower) && /khata|khat|udhaar|bata/i.test(khataLower) ||
      /mujh(e|y)\s+(khat|khata)\s+bata\s*(kis|kiska|kiskaa)/i.test(khataLower)) {
    return { action: "khata_list_pending" };
  }

  // --- Sales report today (English + Roman Urdu)
  if (/today'?s?\s+(sales|revenue|report)/i.test(lower) || /(sales|revenue|report)\s+(of\s+)?today/i.test(lower) ||
      /give\s+me\s+(today'?s?\s+)?(sales|revenue)/i.test(lower) || /how\s+much\s+sales\s+happened\s+today/i.test(lower) ||
      /show\s+(today'?s?\s+)?(sales|revenue|report|top)/i.test(lower) ||
      /(what\s+product\s+generated|top\s+product|best\s+selling)\s+.*today/i.test(lower) ||
      /today.*(sales|revenue|top\s+product|best\s+selling)/i.test(lower) ||
      /revenue\s+generated\s+by\s+today/i.test(lower) || /revenue\s+generated\s+.*today/i.test(lower) ||
      /mujhy\s+aj\s+ki\s+sale\s+batao/i.test(lower) || /mujh[ehy]\s+aj\s+ki\s+sale\s+bata\s*do/i.test(lower) ||
      /aj\s+ki\s+sale\s+(batao|bata\s*do|bata\s*d[eo])/i.test(lower) || /aj\s+ka\s+sale\s+(report|batao|bata)/i.test(lower) ||
      /aj\s+ki\s+revenue\s+batao/i.test(lower) || /aj\s+kitna\s+sale\s+hua/i.test(lower) ||
      /today\s+ka\s+sale/i.test(lower) || /acha\s+(yar\s+)?(mujhy\s+)?aj\s+ki\s+sale/i.test(lower)) {
    return { action: "sales_report_today" };
  }
  // --- Sales report yesterday (kal)
  if (/yesterday'?s?\s+(sales|revenue|report)/i.test(lower) || /(sales|revenue|report)\s+(of\s+)?yesterday/i.test(lower) ||
      /give\s+me\s+(yesterday'?s?\s+)?(sales|revenue)/i.test(lower) || /mujhy\s+kal\s+ki\s+sale/i.test(lower) ||
      /kal\s+ki\s+sale\s+(batao|bata\s*do)/i.test(lower) || /kal\s+ka\s+sale\s+report/i.test(lower) ||
      /acha\s+(yar\s+)?(mujhy\s+)?kal\s+ki\s+sale/i.test(lower) || /kal\s+kitna\s+sale\s+hua/i.test(lower)) {
    return { action: "sales_report_yesterday" };
  }
  // --- Sales report day before yesterday (parso/parson)
  if (/\bparso\b.*(sale|report)/i.test(lower) || /\bparson\b.*(sale|report)/i.test(lower) ||
      /(sale|report).*\bparso\b/i.test(lower) || /day\s+before\s+yesterday/i.test(lower) ||
      /mujhy\s+parso\s+ki\s+sale/i.test(lower) || /parso\s+ki\s+sale\s+(batao|bata)/i.test(lower) ||
      /acha\s+(yar\s+)?parso\s+ki\s+sale/i.test(lower)) {
    return { action: "sales_report_day_before_yesterday" };
  }

  // --- Add customer help (how to add customer)
  if (/^(how\s+)?(can\s+i|do\s+i|to)\s+add\s+(a\s+)?customer\.?$/i.test(lower) ||
      /^add\s+customer\s+help$/i.test(lower) ||
      lower === "how to add customer" || lower === "how can i add customer") {
    return { action: "add_customer_help" };
  }

  // --- Add supplier help (how to add supplier, supplier insertion method, etc.)
  if (/^(how\s+)?(can\s+i|do\s+i|to)\s+add\s+(a\s+)?supplier\.?$/i.test(lower) ||
      /^add\s+supplier\s+help$/i.test(lower) ||
      /supplier\s+(insertion|add|registration|method|process)/i.test(lower) ||
      /how\s+(do\s+i\s+)?(add|register|insert)\s+supplier/i.test(lower) ||
      lower === "how to add supplier" || lower === "how can i add supplier" ||
      lower === "supplier insertion method" || lower === "add supplier help") {
    return { action: "add_supplier_help" };
  }

  // --- Add customer (add customer <name> <phone> — extract name and phone)
  const addCustomerHisPhone = trimmed.match(/^add\s+customer\s+(.+?)\s+(?:his|her)\s+phone\s+(?:number\s+)?(?:is\s+)?(\d[\d\s\-]*)\s*$/i);
  if (addCustomerHisPhone) {
    const name = extractCustomerNameOnly(addCustomerHisPhone[1].trim());
    const phone = addCustomerHisPhone[2].replace(/\D/g, "");
    if (name && phone) return { action: "add_customer", name, phone };
  }
  const addCustomerNatural = trimmed.match(/^add\s+customer\s+(.+?)\s+(?:and\s+(?:its?|his|her)|it'?s|,)\s*(?:phone\s*(?:number\s+)?(?:is\s+)?)?(\d[\d\s\-]*)\s*$/i);
  if (addCustomerNatural) {
    const name = addCustomerNatural[1].trim();
    const phone = addCustomerNatural[2].replace(/\D/g, "");
    if (name && phone) return { action: "add_customer", name: extractCustomerNameOnly(name), phone };
  }
  const addCustomerMatch = trimmed.match(/^add\s+customer\s+(.+?)\s+(\+?[\d][\d\s\-]*)$/i);
  if (addCustomerMatch) {
    const rawName = addCustomerMatch[1].trim();
    const phone = addCustomerMatch[2].replace(/\D/g, "");
    if (!phone) return { action: "unknown" };
    return { action: "add_customer", name: extractCustomerNameOnly(rawName), phone };
  }

  // --- Add supplier (full sentence: "hamza his phone number is 1234567890 and the email address is a@gmail.com")
  const phoneMatch = trimmed.match(/phone\s*(?:number\s+)?is\s+(\d[\d\s\-]*)/i);
  const emailMatch = trimmed.match(/email\s*(?:address\s+)?(?:is\s+)?([^\s]+@[^\s]+)/i);
  const afterAdd = trimmed.replace(/^add\s+supplier\s+/i, "").trim();
  if (afterAdd && afterAdd !== trimmed && !/^(help|how)/i.test(afterAdd)) {
    let namePart = afterAdd;
    if (phoneMatch) namePart = namePart.replace(/\s*phone\s*(?:number\s+)?is\s+[\d\s\-]+/i, "");
    if (emailMatch) namePart = namePart.replace(/\s*(?:and\s+)?(?:the\s+)?email\s*(?:address\s+)?(?:is\s+)?[^\s]+@[^\s]+/i, "");
    namePart = namePart.replace(/\s*(?:and\s+)?(?:his|her|its?|the)\s*$/i, "").trim();
    const name = extractSupplierNameOnly(namePart);
    if (name) {
      const phone = phoneMatch ? extractPhoneOnly(phoneMatch[1]) || null : null;
      const email = emailMatch ? emailMatch[1].trim() : "";
      return { action: "add_supplier", name, phone, email };
    }
  }
  // --- Add supplier (regex patterns for structured input)
  const addSupplierNatural = trimmed.match(/^add\s+supplier\s+(.+?)\s+(?:(?:and\s+)?(?:its?|his|her)|it'?s|,)\s*(?:phone\s*(?:number\s+)?(?:is\s+)?)?(\d[\d\s\-]*)(?:\s+(?:and\s+)?(?:the\s+)?(?:email\s*(?:address\s+)?(?:is\s+)?)?([^\s]+@[^\s]+))?\s*$/i);
  if (addSupplierNatural) {
    const name = extractSupplierNameOnly(addSupplierNatural[1].trim());
    const phone = extractPhoneOnly(addSupplierNatural[2]) || null;
    const email = addSupplierNatural[3] ? addSupplierNatural[3].trim() : "";
    if (name) return { action: "add_supplier", name, phone, email };
  }
  const addSupplierWithPhone = trimmed.match(/^add\s+supplier\s+(.+?)\s+(\+?[\d][\d\s\-]*)(?:\s+(?:and\s+)?(?:the\s+)?(?:email\s*(?:address\s+)?(?:is\s+)?)?([^\s]+@[^\s]+))?\s*$/i);
  if (addSupplierWithPhone) {
    const rawName = addSupplierWithPhone[1].trim();
    const name = extractSupplierNameOnly(rawName);
    const phone = extractPhoneOnly(addSupplierWithPhone[2]) || null;
    const email = addSupplierWithPhone[3] ? addSupplierWithPhone[3].trim() : "";
    if (name) return { action: "add_supplier", name, phone, email };
  }
  const addSupplierNameOnly = trimmed.match(/^add\s+supplier\s+(.+)$/i);
  if (addSupplierNameOnly) {
    const raw = addSupplierNameOnly[1].trim();
    if (raw && !/^(help|how)/i.test(raw)) {
      const name = extractSupplierNameOnly(raw);
      if (name) return { action: "add_supplier", name, phone: null, email: "" };
    }
  }

  // --- Search (voice: "search milk", "search for milk")
  const searchMatch = trimmed.match(/^search\s+(?:for\s+)?(.+)$/i);
  if (searchMatch) {
    const term = searchMatch[1].trim();
    if (term) return { action: "search", term };
  }

  // --- Delete/remove product (text/voice: "delete product milk", "paratha delete kr do", "inventory se coca cola hata do")
  const deleteMatch = trimmed.match(/^(delete|remove)\s+(?:the\s+)?product\s+(.+)$/i);
  if (deleteMatch) {
    const nameOrId = deleteMatch[2].trim();
    if (nameOrId) return { action: "delete_product", nameOrId };
  }
  const productRemoveKrDo = trimmed.match(/product\s+(.+?)\s+(?:remove|delete)\s+(?:kr\s+do|krdo)/i);
  if (productRemoveKrDo) {
    const nameOrId = productRemoveKrDo[1].trim();
    if (nameOrId) return { action: "delete_product", nameOrId };
  }
  const deleteProductFirst = trimmed.match(/^(.+?)\s+(?:delete|remove)\s+(?:product|kardo|karo|kr\s+do|krdo)/i);
  if (deleteProductFirst) {
    const nameOrId = deleteProductFirst[1].trim();
    if (nameOrId) return { action: "delete_product", nameOrId };
  }
  const inventorySeHata = trimmed.match(/inventory\s+se\s+(.+?)\s+(?:hata\s+do|delete\s+kr\s+do|delete\s+krdo)/i);
  if (inventorySeHata) {
    const nameOrId = inventorySeHata[1].trim();
    if (nameOrId) return { action: "delete_product", nameOrId };
  }
  const productHataDo = trimmed.match(/product\s+(.+?)\s+hata\s+do/i);
  if (productHataDo) {
    const nameOrId = productHataDo[1].trim();
    if (nameOrId) return { action: "delete_product", nameOrId };
  }
  const productInventorySeHata = trimmed.match(/^(.+?)\s+inventory\s+se\s+hata\s+do/i);
  if (productInventorySeHata) {
    const nameOrId = productInventorySeHata[1].trim();
    if (nameOrId) return { action: "delete_product", nameOrId };
  }

  // --- Set threshold (text + voice: "set threshold for milk to 10", "manage threshold milk 10", "threshold for Bread to 5")
  const setThresholdTo = trimmed.match(/^(?:set|manage)\s+threshold\s+(?:for\s+)?(.+?)\s+to\s+(\d+)\s*$/i);
  if (setThresholdTo) {
    const nameOrId = setThresholdTo[1].trim();
    const threshold = parseInt(setThresholdTo[2], 10);
    if (nameOrId && !Number.isNaN(threshold) && threshold >= 0) return { action: "set_threshold", nameOrId, threshold };
  }
  const thresholdFor = trimmed.match(/^(?:low\s+stock\s+)?threshold\s+(?:for\s+)?(.+?)\s+(?:to\s+)?(\d+)\s*$/i);
  if (thresholdFor) {
    const nameOrId = thresholdFor[1].trim();
    const threshold = parseInt(thresholdFor[2], 10);
    if (nameOrId && !Number.isNaN(threshold) && threshold >= 0) return { action: "set_threshold", nameOrId, threshold };
  }
  const thresholdProductFirst = trimmed.match(/^(?:set|manage)\s+(?:low\s+stock\s+)?threshold\s+(\d+)\s+(?:for\s+)?(.+)$/i);
  if (thresholdProductFirst) {
    const threshold = parseInt(thresholdProductFirst[1], 10);
    const nameOrId = thresholdProductFirst[2].trim();
    if (nameOrId && !Number.isNaN(threshold) && threshold >= 0) return { action: "set_threshold", nameOrId, threshold };
  }
  const manageThreshold = trimmed.match(/^manage\s+threshold\s+(?:for\s+)?(.+?)\s+(\d+)\s*$/i);
  if (manageThreshold) {
    const nameOrId = manageThreshold[1].trim();
    const threshold = parseInt(manageThreshold[2], 10);
    if (nameOrId && !Number.isNaN(threshold) && threshold >= 0) return { action: "set_threshold", nameOrId, threshold };
  }

  // --- Set stock (text + voice: "set stock for milk to 50", "stock milk 50", "update stock Bread 100")
  const setStockTo = trimmed.match(/^(?:set|update|manage)\s+stock\s+(?:for\s+)?(.+?)\s+to\s+(\d+)\s*$/i);
  if (setStockTo) {
    const nameOrId = setStockTo[1].trim();
    const stock = parseInt(setStockTo[2], 10);
    if (nameOrId && !Number.isNaN(stock) && stock >= 0) return { action: "set_stock", nameOrId, stock };
  }
  const stockFor = trimmed.match(/^stock\s+(?:for\s+)?(.+?)\s+(?:to\s+)?(\d+)\s*$/i);
  if (stockFor) {
    const nameOrId = stockFor[1].trim();
    const stock = parseInt(stockFor[2], 10);
    if (nameOrId && !Number.isNaN(stock) && stock >= 0) return { action: "set_stock", nameOrId, stock };
  }
  const stockProductFirst = trimmed.match(/^(?:set|update|manage)\s+stock\s+(\d+)\s+(?:for\s+)?(.+)$/i);
  if (stockProductFirst) {
    const stock = parseInt(stockProductFirst[1], 10);
    const nameOrId = stockProductFirst[2].trim();
    if (nameOrId && !Number.isNaN(stock) && stock >= 0) return { action: "set_stock", nameOrId, stock };
  }
  const manageStock = trimmed.match(/^manage\s+stock\s+(?:for\s+)?(.+?)\s+(\d+)\s*$/i);
  if (manageStock) {
    const nameOrId = manageStock[1].trim();
    const stock = parseInt(manageStock[2], 10);
    if (nameOrId && !Number.isNaN(stock) && stock >= 0) return { action: "set_stock", nameOrId, stock };
  }

  // --- Add expense (text/voice: "add expense 7000 bijli ka bill", "mera bijli ka bill add kr do 7000", "7000 add kr do rent")
  // Returns: action, amount, description (raw phrase – classifier maps to category)
  const addExpenseAmountFirst = trimmed.match(/^(?:add\s+expense|expense\s+add)\s+(\d+(?:[.,]\d+)?)\s+(.+)$/i);
  if (addExpenseAmountFirst) {
    const amount = parseFloat(addExpenseAmountFirst[1].replace(",", "."));
    const description = addExpenseAmountFirst[2].trim();
    if (!Number.isNaN(amount) && amount >= 0 && description) return { action: "add_expense", amount, description };
  }
  const addExpenseCategoryFirst = trimmed.match(/^(?:add\s+expense|expense\s+add)\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*$/i);
  if (addExpenseCategoryFirst) {
    const description = addExpenseCategoryFirst[1].trim();
    const amount = parseFloat(addExpenseCategoryFirst[2].replace(",", "."));
    if (description && !Number.isNaN(amount) && amount >= 0) return { action: "add_expense", amount, description };
  }
  const categoryAddKrDoAmount = trimmed.match(/^(.+?)\s+add\s+(?:kr\s+|kro\s+)?do\s+(\d+(?:[.,]\d+)?)\s*$/i) || trimmed.match(/^(.+?)\s+add\s+kardo\s+(\d+(?:[.,]\d+)?)\s*$/i);
  if (categoryAddKrDoAmount) {
    const part1 = categoryAddKrDoAmount[1].trim();
    const amount = parseFloat(categoryAddKrDoAmount[2].replace(",", "."));
    if (part1 && !Number.isNaN(amount) && amount >= 0 && /expense|bill|rent|salary|utilities|bijli|gas|maintenance|supplies|kharcha|lagan|ka\s+bill/i.test(part1)) {
      const description = part1.replace(/^(?:acha\s+yar\s+|oy\s+|yar\s+|mera\s+|meri\s+|mere\s+)/i, "").trim();
      if (description) return { action: "add_expense", amount, description };
    }
  }
  const amountAddKrDoCategory = trimmed.match(/^(\d+(?:[.,]\d+)?)\s+add\s+(?:kr\s+)?do\s+(.+)$/i) || trimmed.match(/^(\d+(?:[.,]\d+)?)\s+add\s+kardo\s+(.+)$/i);
  if (amountAddKrDoCategory) {
    const amount = parseFloat(amountAddKrDoCategory[1].replace(",", "."));
    const description = amountAddKrDoCategory[2].trim();
    if (!Number.isNaN(amount) && amount >= 0 && description) return { action: "add_expense", amount, description };
  }
  const categoryAmountAdd = trimmed.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s+add\s+(?:(?:kr\s+|kro\s+)?do|kardo)\s*$/i);
  if (categoryAmountAdd) {
    const part1 = categoryAmountAdd[1].trim();
    const amount = parseFloat(categoryAmountAdd[2].replace(",", "."));
    if (part1 && !Number.isNaN(amount) && amount >= 0 && /expense|bill|rent|salary|utilities|bijli|gas|maintenance|supplies|kharcha|lagan|ka\s+bill/i.test(part1)) {
      const description = part1.replace(/^(?:acha\s+yar\s+|oy\s+|yar\s+|mera\s+|meri\s+|mere\s+)/i, "").trim();
      if (description) return { action: "add_expense", amount, description };
    }
  }
  // Amount first, description: "7000 mere bijli ka bill", "7000 bijli bill add kr do"
  const amountThenDescription = trimmed.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/i);
  if (amountThenDescription) {
    const amount = parseFloat(amountThenDescription[1].replace(",", "."));
    let part2 = amountThenDescription[2].trim().replace(/\s+add\s+(?:kr\s+|kro\s+)?do\s*$/i, "").replace(/\s+add\s+kardo\s*$/i, "").trim();
    if (!Number.isNaN(amount) && amount >= 0 && part2 && /expense|bill|rent|salary|utilities|bijli|gas|kiraya|maintenance|supplies|kharcha|lagan|ka\s+bill|tankhwa|mazdoor|salaries|di\s+hein|di\s+hai/i.test(part2)) {
      const description = part2.replace(/^(?:acha\s+yar\s+|oy\s+|yar\s+|mera\s+|meri\s+|mere\s+)/i, "").trim();
      if (description) return { action: "add_expense", amount, description };
    }
  }

  // "acha yar aj ma ny salaries di hein 35000" / "aj maine salaries di 35000" – description/category first, amount at end
  const descThenAmountDi = trimmed.match(/^(.+?)\s+(?:di\s+hein|di\s+hai|de\s+di|de\s+die)\s+(\d+(?:[.,]\d+)?)\s*$/i);
  if (descThenAmountDi) {
    let part1 = descThenAmountDi[1].trim()
      .replace(/^(?:acha\s+yar\s+|oy\s+|yar\s+)/gi, "")
      .replace(/^aj\s+(?:main?\s*ny|maine|mene|ma\s*ny)\s+/i, "")
      .trim();
    const amount = parseFloat(descThenAmountDi[2].replace(",", "."));
    if (part1 && !Number.isNaN(amount) && amount >= 0 && /salary|salaries|tankhwa|mazdoor|bijli|rent|utilities|bill|kiraya|maintenance|supplies|kharcha|lagan|gas|pani|expense/i.test(part1)) {
      return { action: "add_expense", amount, description: part1 };
    }
  }

  // --- Add product (text: "add product milk 50", "add product lazania 100 50" with optional threshold)
  // Reject if name contains descriptive words – let intent handle natural language (e.g. "talha it's price should be 60000")
  const addWithThreshold = trimmed.match(/^add\s+(?:the\s+)?product\s+(.+?)\s+(\d+(?:\.\d+)?)\s+(\d+)\s*$/i);
  if (addWithThreshold) {
    const name = addWithThreshold[1].trim();
    if (!ADD_NAME_JUNK.test(name)) {
      const price = parseFloat(addWithThreshold[2]);
      const threshold = parseInt(addWithThreshold[3], 10);
      if (name && !Number.isNaN(price) && price >= 0 && !Number.isNaN(threshold) && threshold >= 0) {
        return { action: "add_product", name, price, threshold };
      }
    }
  }
  const addMatch = trimmed.match(/^add\s+(?:the\s+)?product\s+(.+)\s+(\d+(?:\.\d+)?)\s*$/i);
  if (addMatch) {
    const name = addMatch[1].trim();
    if (!ADD_NAME_JUNK.test(name)) {
      const price = parseFloat(addMatch[2]);
      if (name && !Number.isNaN(price) && price >= 0) {
        return { action: "add_product", name, price };
      }
    }
  }

  return { action: "unknown" };
}

module.exports = { parseCommand };
