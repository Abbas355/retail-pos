/**
 * Converts spoken or informal product names into the exact product name used in the inventory database.
 * Handles: plural forms (parathe→paratha, eggs→egg), Urdu/Roman Urdu/English, spelling variations.
 * Add more entries to PRODUCT_NAME_MAP and PLURAL_TO_SINGULAR as needed.
 */

const PRODUCT_NAME_MAP = {
  coke: "cocacola",
  "coca cola": "cocacola",
  "coca-cola": "cocacola",
  "coca cola drink": "cocacola",
};

/** Plural (or Urdu variant) → singular form as in inventory. Keys lowercase. */
const PLURAL_TO_SINGULAR = {
  parathe: "paratha",
  parathay: "paratha",
  parathas: "paratha",
  eggs: "egg",
  burgers: "burger",
  anday: "egg",
  ande: "egg",
  anda: "egg",
  breads: "bread",
  fries: "fries",
  pizzas: "pizza",
};

/**
 * Normalize key for lookup: lowercase, trim, collapse spaces, replace hyphens with space.
 */
function normalizeKey(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/-/g, " ");
}

/**
 * Convert plural or Urdu form to singular (for matching inventory).
 */
function toSingular(word) {
  if (!word || typeof word !== "string") return "";
  const key = normalizeKey(word);
  if (PLURAL_TO_SINGULAR[key]) return PLURAL_TO_SINGULAR[key];
  const keyNoSpaces = key.replace(/\s/g, "");
  for (const [k, v] of Object.entries(PLURAL_TO_SINGULAR)) {
    if (k.replace(/\s/g, "") === keyNoSpaces) return v;
  }
  if (key.length > 2 && (key.endsWith("es") || key.endsWith("s"))) {
    const without = key.endsWith("es") ? key.slice(0, -2) : key.slice(0, -1);
    if (without.length >= 2) return without;
  }
  return key;
}

/**
 * Convert spoken/informal product name to the database product name.
 * Order: trim → plural to singular → PRODUCT_NAME_MAP.
 */
function normalizeProductNameForDb(spokenName) {
  if (!spokenName || typeof spokenName !== "string") return "";
  const trimmed = spokenName.trim();
  if (!trimmed) return "";
  const singular = toSingular(trimmed);
  const key = normalizeKey(singular);
  if (PRODUCT_NAME_MAP[key]) return PRODUCT_NAME_MAP[key];
  const keyNoSpaces = key.replace(/\s/g, "");
  for (const [k, v] of Object.entries(PRODUCT_NAME_MAP)) {
    if (k.replace(/\s/g, "") === keyNoSpaces) return v;
  }
  return singular || trimmed;
}

/**
 * Simple edit distance (Levenshtein) for similarity.
 */
function editDistance(a, b) {
  const an = (a || "").toLowerCase();
  const bn = (b || "").toLowerCase();
  const rows = an.length + 1;
  const cols = bn.length + 1;
  const d = Array(rows).fill(null).map(() => Array(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = an[i - 1] === bn[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[rows - 1][cols - 1];
}

/**
 * Find closest product in inventory. Returns { product, confidence: 'exact'|'similar' } or null.
 * Exact = normalized name matches a product name. Similar = one product within edit distance 2 or contains.
 */
function findClosestProduct(spokenName, products) {
  if (!spokenName || !Array.isArray(products) || products.length === 0) return null;
  const normalized = normalizeProductNameForDb(spokenName);
  const term = normalized.toLowerCase();
  const productList = products.map((p) => ({ ...p, nameLower: (p.name || "").toLowerCase() }));

  const exact = productList.find((p) => p.nameLower === term);
  if (exact) return { product: exact, confidence: "exact" };

  const contains = productList.filter(
    (p) => p.nameLower.includes(term) || term.includes(p.nameLower)
  );
  if (contains.length === 1) return { product: contains[0], confidence: "similar" };

  let best = null;
  let bestDist = 3;
  for (const p of productList) {
    const d = editDistance(term, p.nameLower);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  if (best && bestDist <= 2) return { product: best, confidence: "similar" };
  if (contains.length >= 1) return { product: contains[0], confidence: "similar" };
  return null;
}

module.exports = { normalizeProductNameForDb, findClosestProduct, PRODUCT_NAME_MAP, PLURAL_TO_SINGULAR };
