/**
 * ESC/POS thermal receipt. WIDTH=48. All text centered. Date and footer use short lines so they don't wrap.
 */

import iconv from "iconv-lite";

const WIDTH = 48;
/** Max chars for date and footer so they stay on one line (printer wraps long lines). */
const SHORT_LINE_WIDTH = 34;
/** Footer line length so "Thanks for your purchase" fits on one printer line (no "ase!" wrap). */
const FOOTER_LINE_WIDTH =40;

const ESC = "\x1b";
const GS = "\x1d";
const LF = "\x0a";

function formatDateTimePK(iso) {
  if (iso == null || iso === "") return "-";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-PK", { timeZone: "Asia/Karachi" });
}

/** Short date/time so it fits in one printer line (no "pm" wrap). e.g. "15/03/26 10:07 pm" */
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

/** Returns exactly `width` chars with text centered (for printers that ignore ESC a 1). */
function centerText(text, width) {
  const s = String(text).trim();
  const len = Math.min(s.length, width);
  const trimmed = len < s.length ? s.slice(0, width) : s;
  const padLeft = Math.max(0, Math.floor((width - len) / 2));
  const padRight = width - len - padLeft;
  return " ".repeat(padLeft) + trimmed + " ".repeat(padRight);
}

/** Centers a short line (shortWidth chars) in the full receipt width (totalWidth) so it prints in the middle. */
function centerShortLine(shortContent, shortWidth, totalWidth) {
  const content = shortContent.length > shortWidth ? shortContent.slice(0, shortWidth) : shortContent;
  const padded = centerText(content, shortWidth);
  const left = Math.floor((totalWidth - shortWidth) / 2);
  const right = totalWidth - shortWidth - left;
  return " ".repeat(left) + padded + " ".repeat(right);
}

/** Left and right on one line; exactly `width` chars; price right-aligned; at least one space between. */
function formatLine(left, right, width) {
  const safeRight = String(right);
  const maxLeft = width - safeRight.length - 1;
  const safeLeft = maxLeft <= 0 ? "" : (left.length > maxLeft ? left.slice(0, maxLeft) : left);
  const spaces = Math.max(1, width - safeLeft.length - safeRight.length);
  return safeLeft + " ".repeat(spaces) + safeRight;
}

/** One or two lines per item; each line exactly `width` chars; price never wraps. */
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

function safeLine(s, width = WIDTH) {
  const t = escapeText(s);
  return t.length > width ? t.slice(0, width) : t;
}

export function buildReceiptEscPos(sale, settings, locale = "en") {
  const { storeName, currencySymbol, receiptFooter } = settings;
  const fmt = (n) => `${currencySymbol}${Number(n).toFixed(2)}`;

  const out = [];

  out.push(ESC + "@");
  out.push(ESC + "M\x00");
  out.push(GS + "!\x00");
  out.push(ESC + "a\x00");

  out.push(centerText(safeLine(storeName), WIDTH) + LF);
  out.push(centerShortLine(formatShortDateTime(sale.date), SHORT_LINE_WIDTH, WIDTH) + LF);

  out.push(LF);

  for (const i of sale.items || []) {
    const name = (i.product?.name ?? i.productName ?? "?").toString();
    const qty = i.quantity ?? 1;
    const unitPrice = i.product?.price ?? i.price ?? 0;
    const lineTotal = Number(unitPrice) * qty;
    const lines = formatItemLines(name, qty, fmt(lineTotal), WIDTH);
    for (const line of lines) {
      out.push(centerText(line, WIDTH) + LF);
    }
  }

  out.push(centerText("-".repeat(WIDTH), WIDTH) + LF);
  out.push(centerText(formatLine("Total", fmt(sale.total), WIDTH), WIDTH) + LF);

  out.push(LF);
  out.push(LF);

  const paymentText =
    sale.paidAmount != null && sale.paidAmount < sale.total
      ? `Paid: ${fmt(sale.paidAmount)} | Bal: ${fmt(sale.total - sale.paidAmount)}`
      : `Paid by ${sale.paymentMethod}`;
  out.push(centerText(safeLine(paymentText), WIDTH) + LF);
  out.push(centerText(safeLine("Cashier: " + (sale.cashier || "")), WIDTH) + LF);

  out.push(LF);

  let footerRaw = (receiptFooter && receiptFooter.trim()) || "Thanks for your purchase!";
  if (footerRaw === "Thank you for your purchase!") footerRaw = "Thanks for your purchase!";
  const footerContent = safeLine(footerRaw).slice(0, FOOTER_LINE_WIDTH);
  out.push(ESC + "a\x00");
  out.push(centerText(footerContent, FOOTER_LINE_WIDTH) + LF);

  out.push(LF.repeat(6));
  out.push(ESC + "d\x05");
  out.push(GS + "V\x00");

  return iconv.encode(out.join(""), "cp437");
}
