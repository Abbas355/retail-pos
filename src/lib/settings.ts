/**
 * System settings stored in localStorage (key: pos_settings).
 * Used by Settings page and optionally by receipt/currency formatting.
 */
export const SETTINGS_STORAGE_KEY = "pos_settings";
export const SETTINGS_CHANGE_EVENT = "pos-settings-change";

export interface AppSettings {
  storeName: string;
  currencySymbol: string;
  defaultLowStockThreshold: number;
  receiptHeader: string;
  receiptFooter: string;
  /** Chars per line for thermal print (32 ≈ 58mm, 48 ≈ 80mm). */
  receiptWidthChars: number;
  autoSync: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  storeName: "Retail Store",
  currencySymbol: "$",
  defaultLowStockThreshold: 5,
  receiptHeader: "",
  receiptFooter: "Thanks for your purchase!",
  receiptWidthChars: 48,
  autoSync: true,
};

export function formatCurrency(amount: number, symbol?: string): string {
  const s = symbol ?? DEFAULT_SETTINGS.currencySymbol;
  return `${s}${amount.toFixed(2)}`;
}
