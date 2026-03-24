/**
 * ESC/POS thermal receipt.
 * - Header/footer: normal Font A size (no double-width — that breaks centering and wraps lines). Bold on store name only.
 * - Centered lines use space-padding to exactly `width` chars under left align so they line up with body and fill the line.
 * - Body: left item lines (full width), rule, bold total.
 * - Cut: GS V 0x42 0x00.
 * - width: receiptWidthChars / RECEIPT_WIDTH_CHARS — set to 32 for 58mm, 48 for 80mm.
 */

import iconv from "iconv-lite";

const DEFAULT_WIDTH = 48;

const ESC = "\x1b";
const GS = "\x1d";
const LF = "\x0a";

const CMD = {
  RESET: ESC + "@",
  FONT_A: ESC + "M\x00",
  ALIGN_LEFT: ESC + "a\x00",
  BOLD_ON: ESC + "E\x01",
  BOLD_OFF: ESC + "E\x00",
  SIZE_NORMAL: GS + "!\x00",
  CUT_FEED_FULL: GS + "V\x42\x00",
};

function resolveReceiptWidth(settings) {
  const n = Number(settings?.receiptWidthChars);
  if (Number.isFinite(n) && n >= 24 && n <= 48) return Math.floor(n);
  const env = Number(process.env.RECEIPT_WIDTH_CHARS);
  if (Number.isFinite(env) && env >= 24 && env <= 48) return Math.floor(env);
  return DEFAULT_WIDTH;
}

function formatShortDateTime(iso) {
  if (iso == null || iso === "") return "-";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "-";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return `${day}/${month}/${year} ${h12}:${m} ${ampm}`;
}

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

/** Exactly `width` characters, text centered (use with ALIGN_LEFT so it matches body line length). */
function centerText(text, width) {
  const s = escapeText(text);
  const t = s.length > width ? s.slice(0, width) : s;
  if (t.length >= width) return t;
  const padLeft = Math.floor((width - t.length) / 2);
  const padRight = width - t.length - padLeft;
  return " ".repeat(padLeft) + t + " ".repeat(padRight);
}

function formatLine(left, right, width) {
  const safeRight = String(right);
  const maxLeft = width - safeRight.length - 1;
  const safeLeft = maxLeft <= 0 ? "" : (left.length > maxLeft ? left.slice(0, maxLeft) : left);
  const spaces = Math.max(1, width - safeLeft.length - safeRight.length);
  return safeLeft + " ".repeat(spaces) + safeRight;
}

/** One or two lines per item when name+qty does not fit one line. */
function formatItemLines(name, qty, priceStr, width) {
  const left = escapeText(name) + " x" + qty;
  const right = priceStr;
  const maxLeft = width - right.length - 1;
  if (left.length <= maxLeft) {
    return [formatLine(left, right, width)];
  }
  const safeName = escapeText(name);
  const nameLine = safeName.length > width ? safeName.slice(0, width) : safeName;
  const qtyLeft = "x" + qty;
  return [nameLine, formatLine(qtyLeft, right, width)];
}

function safeLine(s, width) {
  const t = escapeText(s);
  return t.length > width ? t.slice(0, width) : t;
}

export function buildReceiptEscPos(sale, settings, _locale = "en") {
  const { storeName, currencySymbol, receiptFooter } = settings;
  const width = resolveReceiptWidth(settings);
  const fmt = (n) => `${currencySymbol}${Number(n).toFixed(2)}`;

  const out = [];

  out.push(CMD.RESET);
  out.push(CMD.FONT_A);
  out.push(CMD.SIZE_NORMAL);
  out.push(CMD.ALIGN_LEFT);

  out.push(CMD.BOLD_ON);
  out.push(centerText(safeLine(storeName, width), width) + LF);
  out.push(CMD.BOLD_OFF);
  out.push(centerText(safeLine(formatShortDateTime(sale.date), width), width) + LF);
  out.push(LF);

  for (const i of sale.items || []) {
    const name = (i.product?.name ?? i.productName ?? "?").toString();
    const qty = i.quantity ?? 1;
    const unitPrice = i.product?.price ?? i.price ?? 0;
    const lineTotal = Number(unitPrice) * qty;
    const lines = formatItemLines(name, qty, fmt(lineTotal), width);
    for (const line of lines) {
      out.push(line + LF);
    }
  }

  out.push("-".repeat(width) + LF);

  out.push(CMD.BOLD_ON);
  out.push(formatLine("Total", fmt(sale.total), width) + LF);
  out.push(CMD.BOLD_OFF);

  out.push(LF);

  const paymentText =
    sale.paidAmount != null && sale.paidAmount < sale.total
      ? `Paid: ${fmt(sale.paidAmount)} | Bal: ${fmt(sale.total - sale.paidAmount)}`
      : `Paid by ${sale.paymentMethod}`;
  out.push(centerText(safeLine(paymentText, width), width) + LF);
  out.push(centerText(safeLine("Cashier: " + (sale.cashier || ""), width), width) + LF);
  out.push(LF);

  let footerRaw = (receiptFooter && receiptFooter.trim()) || "Thanks for your purchase!";
  if (footerRaw === "Thank you for your purchase!") footerRaw = "Thanks for your purchase!";
  out.push(centerText(safeLine(footerRaw, width), width) + LF);

  out.push(LF.repeat(4));
  out.push(CMD.CUT_FEED_FULL);

  return iconv.encode(out.join(""), "cp437");
}
