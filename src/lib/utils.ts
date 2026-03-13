import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Pakistan timezone (Asia/Karachi, UTC+5) – used for all date/time display and "today" logic. */
export const TIMEZONE_PK = "Asia/Karachi";

/** Returns date as YYYY-MM-DD in Pakistan time (for filtering, "today" logic). */
export function getLocalDateString(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-CA", { timeZone: TIMEZONE_PK }); // en-CA → YYYY-MM-DD
}

/** Extracts YYYY-MM-DD from API date (ISO string) in Pakistan time. Use for grouping sales by stored date. */
export function getDatePartFromApi(d: Date | string | null | undefined): string {
  if (d == null) return "";
  return getLocalDateString(d);
}

/** Format date/time for display in Pakistan time. */
export function formatDateTimePK(iso: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (iso == null) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString("en-PK", { timeZone: TIMEZONE_PK, ...opts });
}

/** Format date only (no time) in Pakistan time. */
export function formatDatePK(iso: string | Date | null | undefined): string {
  if (iso == null) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("en-PK", { timeZone: TIMEZONE_PK });
}
