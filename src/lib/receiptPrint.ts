/**
 * Builds 67mm / 190pt thermal receipt HTML for printing.
 * Optimized for BIXOLON and similar thermal printers.
 */

import type { Sale } from "@/types/pos";
import type { AppSettings } from "@/lib/settings";
import { formatDateTimePK } from "@/lib/utils";
import { getProductDisplayName } from "@/lib/productTranslation";

export function buildReceiptHtml(sale: Sale, settings: AppSettings, locale = "en"): string {
  const { storeName, currencySymbol, receiptHeader, receiptFooter } = settings;
  const fmt = (n: number) => `${currencySymbol}${n.toFixed(2)}`;

  const itemsHtml = sale.items
    .map((i) => {
      const name = getProductDisplayName(i.product, locale).primary;
      const lineTotal = i.product.price * i.quantity;
      return `<tr><td><b>${escapeHtml(name)} x${i.quantity}</b></td><td style="text-align:right"><b>${fmt(lineTotal)}</b></td></tr>`;
    })
    .join("");

  const dateStr = formatDateTimePK(sale.date);

  let extrasHtml = "";
  if (sale.subtotal != null && sale.subtotal !== sale.total) {
    extrasHtml += `<tr><td><b>Subtotal</b></td><td style="text-align:right"><b>${fmt(sale.subtotal)}</b></td></tr>`;
  }
  if (sale.discountAmount != null && sale.discountAmount > 0) {
    extrasHtml += `<tr><td><b>Discount</b></td><td style="text-align:right"><b>-${fmt(sale.discountAmount)}</b></td></tr>`;
  }

  const paymentText =
    sale.paidAmount != null && sale.paidAmount < sale.total
      ? `Paid: ${fmt(sale.paidAmount)} · Balance: ${fmt(sale.total - sale.paidAmount)} in khata`
      : `Paid by ${sale.paymentMethod}`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page { size: 67mm auto; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; font-weight: bold; }
    body {
      width: 67mm;
      max-width: 190pt;
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px;
      font-weight: bold;
      line-height: 1.3;
      padding: 4mm;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .center { text-align: center; }
    .store { font-size: 14px; margin-bottom: 4px; }
    .date-block { margin-bottom: 8px; color: #000; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; font-weight: bold; }
    td { padding: 2px 0; }
    .total { font-size: 13px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #000; }
    .footer-block { margin-top: 12px; font-size: 10px; color: #000; }
    .header { margin-bottom: 4px; font-size: 10px; }
    b, strong { font-weight: bold; }
  </style>
</head>
<body>
  <div class="center">
    <div class="store" style="font-weight:bold"><b>${escapeHtml(storeName)}</b></div>
    ${receiptHeader ? `<div class="header" style="font-weight:bold"><b>${escapeHtml(receiptHeader)}</b></div>` : ""}
    <div class="date-block" style="font-weight:bold"><b>${escapeHtml(dateStr)}</b></div>
  </div>
  <table style="font-weight:bold">
    ${itemsHtml}
    ${extrasHtml}
  </table>
  <div class="total" style="font-weight:bold">
    <b><span>Total</span><span style="float:right">${fmt(sale.total)}</span></b>
  </div>
  <div class="center footer-block" style="font-weight:bold">
    <b>${escapeHtml(paymentText)}</b><br>
    <b>Cashier: ${escapeHtml(sale.cashier)}</b>
  </div>
  ${receiptFooter ? `<div class="center footer-block" style="margin-top:8px;font-weight:bold"><b>${escapeHtml(receiptFooter)}</b></div>` : ""}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
