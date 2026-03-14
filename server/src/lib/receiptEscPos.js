/**
 * Builds ESC/POS receipt bytes for BIXOLON thermal printers (67mm).
 * Compatible with SNP-352plus and similar models.
 * Uses CP437 encoding - BIXOLON does NOT support UTF-8.
 */

import iconv from "iconv-lite";

// ESC/POS commands
const ESC = "\x1b";
const GS = "\x1d";
const LF = "\n";

/** Format date/time in Pakistan time for receipt display (ASCII-safe) */
function formatDateTimePK(iso) {
  if (iso == null || iso === "") return "-";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-PK", { timeZone: "Asia/Karachi" });
}

/** Build ESC/POS buffer from sale + settings */
export function buildReceiptEscPos(sale, settings, locale = "en") {
  const { storeName, currencySymbol, receiptHeader, receiptFooter } = settings;
  const fmt = (n) => `${currencySymbol}${n.toFixed(2)}`;

  const lines = [];
  const push = (t) => lines.push(t + LF);
  const center = (t) => {
    lines.push(ESC + "a" + "\x01"); // center align
    lines.push(t + LF);
    lines.push(ESC + "a" + "\x00"); // left align
  };

  // Initialize
  lines.push(ESC + "@"); // init
  lines.push(ESC + "t" + "\x00"); // select character table 0 (USA / CP437)

  // Store name (bold, center)
  lines.push(GS + "!" + "\x08"); // double height
  center(escapeText(storeName));
  lines.push(GS + "!" + "\x00"); // normal size

  if (receiptHeader && receiptHeader.trim()) {
    push(escapeText(receiptHeader.trim()));
  }

  center(escapeText(formatDateTimePK(sale.date)));
  push("");

  // Items - use English name only (CP437 doesn't support Urdu)
  for (const i of sale.items || []) {
    const name = (i.product?.name ?? i.productName ?? "?").toString().slice(0, 24);
    const qty = i.quantity ?? 1;
    const unitPrice = i.product?.price ?? i.price ?? 0;
    const lineTotal = Number(unitPrice) * qty;
    const left = `${escapeText(name)} x${qty}`;
    const right = fmt(lineTotal);
    const pad = Math.max(0, 32 - left.length - right.length);
    push(left + " ".repeat(pad) + right);
  }

  if (sale.subtotal != null && sale.subtotal !== sale.total) {
    const left = "Subtotal";
    const right = fmt(sale.subtotal);
    push(left + " ".repeat(Math.max(0, 32 - left.length - right.length)) + right);
  }
  if (sale.discountAmount != null && sale.discountAmount > 0) {
    const left = "Discount";
    const right = "-" + fmt(sale.discountAmount);
    push(left + " ".repeat(Math.max(0, 32 - left.length - right.length)) + right);
  }

  push("------------------------");
  const totalLeft = "Total";
  const totalRight = fmt(sale.total);
  lines.push(GS + "!" + "\x10"); // double width
  push(totalLeft + " ".repeat(Math.max(0, 16 - totalLeft.length - totalRight.length)) + totalRight);
  lines.push(GS + "!" + "\x00");
  push("");

  const paymentText =
    sale.paidAmount != null && sale.paidAmount < sale.total
      ? `Paid: ${fmt(sale.paidAmount)} | Balance: ${fmt(sale.total - sale.paidAmount)} in khata`
      : `Paid by ${sale.paymentMethod}`;

  center(escapeText(paymentText));
  center(escapeText(`Cashier: ${sale.cashier || ""}`));

  if (receiptFooter && receiptFooter.trim()) {
    push("");
    center(escapeText(receiptFooter.trim()));
  }

  push("");
  push("");
  lines.push(GS + "V" + "\x00"); // full cut

  const text = lines.join("");
  return iconv.encode(text, "cp437");
}

/** Strip to ASCII-only for BIXOLON CP437 - prevents garbled output */
function escapeText(s) {
  if (s == null) return "";
  return String(s)
    .replace(/[^\x20-\x7e]/g, (c) => {
      if (c === "\u2014" || c === "\u2013") return "-";
      if (c === "\u2018" || c === "\u2019") return "'";
      if (c === "\u201c" || c === "\u201d") return '"';
      if (c === "\u00a0") return " ";
      return "?";
    })
    .trim();
}
