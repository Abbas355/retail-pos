/**
 * ESC/POS receipt for BIXOLON SRP-352plusIII, raw TCP IP:9100.
 * Uses actual printable width (32 chars) for raw mode to prevent price wrap.
 */

import iconv from "iconv-lite";

const WIDTH = 32;

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

  out.push(ESC + "a\x01");
  out.push(escapeText(storeName) + LF);
  out.push(escapeText(formatDateTimePK(sale.date)) + LF);
  out.push(ESC + "a\x00");

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

  out.push(ESC + "a\x01");
  const paymentText =
    sale.paidAmount != null && sale.paidAmount < sale.total
      ? `Paid: ${fmt(sale.paidAmount)} | Bal: ${fmt(sale.total - sale.paidAmount)}`
      : `Paid by ${sale.paymentMethod}`;
  out.push(escapeText(paymentText) + LF);
  out.push(escapeText("Cashier: " + (sale.cashier || "")) + LF);
  out.push(ESC + "a\x00");

  out.push(LF);

  const footer = (receiptFooter && receiptFooter.trim()) || "Thank you for your purchase!";
  out.push(ESC + "a\x01");
  out.push(escapeText(footer) + LF);
  out.push(ESC + "a\x00");

  out.push(LF.repeat(6));
  out.push(ESC + "d\x05");
  out.push(GS + "V\x00");

  return iconv.encode(out.join(""), "cp437");
}
