/**
 * Classifies expense descriptions into POS categories.
 * POS supports: Rent, Utilities, Salaries, Supplies, Maintenance, Other.
 */

const CATEGORIES = ["Rent", "Utilities", "Salaries", "Supplies", "Maintenance", "Other"];

/** Strip leading filler/possessive words so description is neutral (e.g. "mera bijli ka bill" → "bijli ka bill"). */
function cleanDescription(raw) {
  if (!raw || typeof raw !== "string") return "";
  let s = raw.trim().replace(/\s+/g, " ").trim();
  // Strip common prefixes: fillers (acha yar, oy, yar) and possessives (mera, meri, mere, hamara, etc.)
  const leadingFiller =
    /^(?:acha\s+yar\s+|oy\s+|yar\s+|mera\s+|meri\s+|mere\s+|hamara\s+|hamari\s+|hamare\s+|tumhara\s+|tumhari\s+|the\s+)/i;
  while (leadingFiller.test(s)) {
    s = s.replace(leadingFiller, "").trim();
  }
  return s;
}

/**
 * Classify raw expense phrase into category and clean description.
 * @param {string} rawDescription - What the user said (e.g. "bijli ka bill", "shop ka kiraya")
 * @returns {{ category: string, description: string, confidence: "high"|"medium"|"low" }}
 */
function classifyExpenseCategory(rawDescription) {
  const cleaned = cleanDescription(rawDescription);
  const lower = cleaned.toLowerCase();

  // Utilities: electricity, gas, water, internet, phone, bills (bijli bill, pani ka bill, gas bill, etc.)
  if (
    /\bbijli\b|\belectricity\b|\bgas\b|\bpani\b|\bwater\b|\binternet\b|\bphone\b|\bbill\b|\bbills\b/i.test(lower)
  ) {
    const desc = cleaned || "Utilities bill";
    return { category: "Utilities", description: desc, confidence: "high" };
  }

  // Rent: shop rent, building rent, kiraya
  if (
    /\bkiraya\b|\brent\b|\bkiraye\b|\bshop\s+rent\b|\bdukan\s+ka\s+kiraya\b|\bbuilding\s+rent\b/i.test(lower)
  ) {
    const desc = cleaned || "Rent";
    return { category: "Rent", description: desc, confidence: "high" };
  }

  // Salaries: staff, employee, salary, tankhwa, mazdoor – category and description are same ("Salaries")
  if (
    /\bsalary\b|\bsalaries\b|\btankhwa\b|\bmazdoor\b|\bstaff\b|\bemployee\b|\bemployees\b|\bworker\b|\bworkers\b/i.test(lower)
  ) {
    return { category: "Salaries", description: "Salaries", confidence: "high" };
  }

  // Supplies: packing, bags, boxes, stationery
  if (
    /\bpacking\b|\bbags\b|\bboxes\b|\bstationery\b|\bmaterial\b|\bsupplies\b|\bitems\b|\bthaile\b/i.test(lower)
  ) {
    const desc = cleaned || "Supplies";
    return { category: "Supplies", description: desc, confidence: "high" };
  }

  // Maintenance: repair, fixing, AC, machine
  if (
    /\brepair\b|\bmaintenance\b|\bfix\b|\bfixing\b|\bmachine\b|\bac\s+repair\b|\brepairing\b/i.test(lower)
  ) {
    const desc = cleaned || "Maintenance";
    return { category: "Maintenance", description: desc, confidence: "high" };
  }

  // Fallback: Other
  const desc = cleaned || "Expense";
  return { category: "Other", description: desc, confidence: cleaned ? "medium" : "low" };
}

module.exports = { classifyExpenseCategory, CATEGORIES, cleanDescription };
