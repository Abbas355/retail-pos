/**
 * Localization: auto-translate product names from English to Urdu.
 * Used when admin adds/edits products (auto-fill Name Urdu) and when displaying
 * products in Urdu locale when name_ur is missing.
 */

const URDU_NUMERALS = "۰۱۲۳۴۵۶۷۸۹";

/** Approximate Latin → Urdu script (Arabic/Persian) for unknown words - write English as it sounds in Urdu */
const LATIN_TO_URDU_SCRIPT: Record<string, string> = {
  a: "ا", b: "ب", c: "ک", d: "ڈ", e: "ے", f: "ف", g: "گ", h: "ہ", i: "ی", j: "ج", k: "ک", l: "ل",
  m: "م", n: "ن", o: "و", p: "پ", q: "ق", r: "ر", s: "س", t: "ٹ", u: "ؤ", v: "و", w: "و", x: "کس", y: "ی", z: "ز",
  A: "ا", B: "ب", C: "ک", D: "ڈ", E: "ے", F: "ف", G: "گ", H: "ہ", I: "ی", J: "ج", K: "ک", L: "ل",
  M: "م", N: "ن", O: "و", P: "پ", Q: "ق", R: "ر", S: "س", T: "ٹ", U: "ؤ", V: "و", W: "و", X: "کس", Y: "ی", Z: "ز",
};

function toUrduNumerals(str: string): string {
  return str.replace(/\d/g, (d) => URDU_NUMERALS[parseInt(d, 10)] ?? d);
}

/** Transliterate an English word into Urdu script (for words not in dictionary) */
function transliterateToUrduScript(word: string): string {
  if (!word) return word;
  const out: string[] = [];
  for (let i = 0; i < word.length; i++) {
    const c = word[i];
    if (LATIN_TO_URDU_SCRIPT[c] !== undefined) {
      out.push(LATIN_TO_URDU_SCRIPT[c]);
    } else if (/[0-9]/.test(c)) {
      out.push(URDU_NUMERALS[parseInt(c, 10)] ?? c);
    } else {
      out.push(c);
    }
  }
  return out.join("");
}

/** English word/phrase -> Urdu. Lowercase keys for case-insensitive match. */
const EN_TO_UR: Record<string, string> = {
  rice: "چاول",
  milk: "دودھ",
  bread: "روٹی",
  sugar: "چینی",
  eggs: "انڈے",
  soap: "صابن",
  detergent: "ڈٹرجنٹ",
  oil: "تیل",
  cooking: "پکانے",
  "cooking oil": "پکانے کا تیل",
  apple: "سیب",
  fruits: "پھل",
  bakery: "بیکری",
  dairy: "ڈیری",
  groceries: "راشن",
  household: "گھریلو",
  bar: "سلاخ",
  pc: "عدد",
  kg: "کلو",
  g: "گرام",
  gram: "گرام",
  grams: "گرام",
  litre: "لیٹر",
  liter: "لیٹر",
  l: "لیٹر",
  "low stock threshold": "کم اسٹاک حد",
  yogurt: "دہی",
  "yoghurt": "دہی",
  cheese: "پنیر",
  butter: "مکھن",
  tea: "چائے",
  flour: "آٹا",
  salt: "نمک",
  lentils: "دال",
  beans: "پھلیاں",
  potato: "آلو",
  tomato: "ٹماٹر",
  onion: "پیاز",
  chicken: "مرغ",
  beef: "گائے کا گوشت",
  juice: "جوس",
  water: "پانی",
  bottle: "بوتل",
  pack: "پیک",
  box: "ڈبہ",
  tin: "ٹن",
  can: "ڈبہ",
  bag: "تھیلا",
  shampoo: "شیمپو",
  toothpaste: "ٹوتھ پیسٹ",
  tissue: "ٹشو",
  alcohol: "الکحل",
  sanitizer: "سینیٹائزر",
  "hand sanitizer": "ہینڈ سینیٹائزر",
  fresh: "تازہ",
  organic: "نامیاتی",
  premium: "پریمیم",
  cold: "ٹھنڈا",
  hot: "گرم",
  soft: "نرم",
  drink: "مشروب",
  "soft drink": "سافٹ ڈرنک",
  biscuit: "بسکٹ",
  cookies: "کوکیز",
  chocolate: "چاکلیٹ",
  honey: "شہد",
  jam: "مربہ",
  sauce: "چٹنی",
  ketchup: "کیچپ",
  pasta: "پاستا",
  noodles: "نوڈلز",
  cereal: "اناج",
  oats: "جئی",
  corn: "مکئی",
  vinegar: "سرکہ",
  spices: "مصالحے",
  pepper: "کالی مرچ",
  garlic: "لہسن",
  ginger: "ادرک",
  green: "سبز",
  red: "سرخ",
  white: "سفید",
  black: "سیاہ",
  powder: "پاؤڈر",
  liquid: "مائع",
  spray: "سپرے",
  gel: "جیل",
  cream: "کریم",
  lotion: "لوشن",
  wipe: "وائپ",
  wipes: "وائپس",
  paper: "کاغذ",
  towel: "تولیہ",
  napkin: "رومال",
  hand: "ہاتھ",
  face: "چہرہ",
  body: "جسم",
  hair: "بال",
  clean: "صاف",
  cleaning: "صفائی",
  wash: "دھلائی",
  free: "مفت",
  large: "بڑا",
  small: "چھوٹا",
  medium: "درمیانہ",
  extra: "اضافی",
  original: "اصل",
  natural: "قدرتی",
  pure: "خالص",
  low: "کم",
  high: "زیادہ",
  fat: "چربی",
  "low fat": "کم چربی",
  vitamin: "وٹامن",
  energy: "توانائی",
};

/** Unit patterns: (5kg) -> (۵ کلو), (1L) -> (۱ لیٹر), (12pc) -> (۱۲ عدد) */
function translateUnit(match: string): string {
  const inner = match.replace(/[()]/g, "").trim();
  const numMatch = inner.match(/^(\d+)\s*(kg|g|gram|grams|L|litre|liter|pc)?$/i);
  if (numMatch) {
    const num = toUrduNumerals(numMatch[1]);
    const unit = (numMatch[2] || "").toLowerCase();
    const urUnit =
      unit === "kg" ? "کلو" : unit === "g" || unit === "gram" || unit === "grams" ? "گرام" : unit === "l" || unit === "litre" || unit === "liter" ? "لیٹر" : unit === "pc" ? "عدد" : "";
    return urUnit ? `(${num} ${urUnit})` : `(${num})`;
  }
  return toUrduNumerals(match);
}

/**
 * Translates an English product name to Urdu using a built-in dictionary.
 * Converts numbers to Urdu numerals and known words to Urdu; unknown words stay in English.
 */
export function translateProductNameToUrdu(englishName: string): string {
  if (!englishName?.trim()) return "";

  let out = englishName.trim();

  // Replace unit patterns like (5kg), (1L), (12pc), (500g)
  out = out.replace(/\(\s*\d+\s*(kg|g|gram|grams|L|litre|liter|pc)\s*\)/gi, (m) =>
    translateUnit(m)
  );
  // Standalone numbers in parentheses to Urdu numerals
  out = out.replace(/\(\s*(\d+)\s*\)/g, (_, n) => `(${toUrduNumerals(n)})`);

  // Replace known phrases (longer first to avoid partial matches)
  const phrases = Object.entries(EN_TO_UR).filter(([k]) => k.includes(" ")).sort((a, b) => b[0].length - a[0].length);
  for (const [en, ur] of phrases) {
    const re = new RegExp(en.replace(/\s+/g, "\\s+"), "gi");
    out = out.replace(re, ur);
  }

  // Replace known single words (case-insensitive, whole word); unknown words → Urdu script transliteration
  const words = out.split(/\s+/);
  const result = words
    .map((word) => {
      const key = word.toLowerCase().replace(/[()]/g, "");
      if (EN_TO_UR[key]) return EN_TO_UR[key];
      // Words not in dictionary: write in Urdu script as in English (transliterate)
      return transliterateToUrduScript(word);
    })
    .join(" ");

  return result.trim() || englishName;
}

export type ProductLike = { name: string; nameUr?: string | null };

/**
 * Returns the product display name for the current locale.
 * - "en": primary = English name, secondary = Urdu (nameUr or auto-translated) shown below.
 * - "ur": primary = Urdu (nameUr or auto-translated), secondary = English.
 */
export function getProductDisplayName(
  product: ProductLike,
  locale: string
): { primary: string; secondary?: string } {
  const urdu = product.nameUr?.trim() || translateProductNameToUrdu(product.name);
  const isUrduLocale = locale === "ur" || locale.startsWith("ur-");
  if (isUrduLocale) {
    return { primary: urdu || product.name, secondary: product.name };
  }
  return {
    primary: product.name,
    secondary: urdu || undefined,
  };
}
