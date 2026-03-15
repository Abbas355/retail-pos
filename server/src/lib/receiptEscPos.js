/**
 * ESC/POS receipt for BIXOLON SRP-352plusIII, raw TCP IP:9100.
 * Uses 48-char line width (matches working sample) for full-width centered layout.
 */

import iconv from "iconv-lite";

const WIDTH = 48;

const ESC = "\x1b";
const GS = "\x1d";
const LF = "\x0a";

function formatDateTimePK(iso) {
  if (iso == null || iso === "") return "-";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-PK", { timeZone: "Asia/Karachi" });
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

function centerText(text, width) {
  const pad = Math.max(0, Math.floor((width - text.length) / 2));
  return " ".repeat(pad) + text;
}

function formatLine(left, right, width) {
  const maxLeft = width - right.length - 1;
  const safeLeft = left.length > maxLeft ? left.slice(0, maxLeft) : left;
  const spaces = width - safeLeft.length - right.length;
  return safeLeft + " ".repeat(Math.max(1, spaces)) + right;
}

export function buildReceiptEscPos(sale, settings, locale = "en") {
  const { storeName, currencySymbol, receiptFooter } = settings;
  const fmt = (n) => `${currencySymbol}${Number(n).toFixed(2)}`;

  const out = [];

  out.push(ESC + "@");
  out.push(ESC + "t\x00");
  out.push(GS + "!\x00");
  out.push(ESC + "a\x00");

  out.push(centerText(escapeText(storeName), WIDTH) + LF);
  out.push(centerText(escapeText(formatDateTimePK(sale.date)), WIDTH) + LF);

  out.push(LF);

  for (const i of sale.items || []) {
    const name = (i.product?.name ?? i.productName ?? "?").toString();
    const qty = i.quantity ?? 1;
    const unitPrice = i.product?.price ?? i.price ?? 0;
    const lineTotal = Number(unitPrice) * qty;
    const left = escapeText(name) + " x" + qty;
    const right = fmt(lineTotal);
    out.push(formatLine(left, right, WIDTH) + LF);
  }

  out.push("-".repeat(WIDTH) + LF);
  out.push(formatLine("Total", fmt(sale.total), WIDTH) + LF);
  out.push(LF);

  const paymentText =
    sale.paidAmount != null && sale.paidAmount < sale.total
      ? `Paid: ${fmt(sale.paidAmount)} | Bal: ${fmt(sale.total - sale.paidAmount)}`
      : `Paid by ${sale.paymentMethod}`;
  out.push(centerText(escapeText(paymentText), WIDTH) + LF);
  out.push(centerText(escapeText("Cashier: " + (sale.cashier || "")), WIDTH) + LF);

  out.push(LF);

  const footer = (receiptFooter && receiptFooter.trim()) || "Thank you for your purchase!";
  out.push(centerText(escapeText(footer), WIDTH) + LF);

  out.push(LF.repeat(6));
  out.push(ESC + "d\x05");
  out.push(GS + "V\x00");

  return iconv.encode(out.join(""), "cp437");
}
