import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Returns local date as YYYY-MM-DD (for filtering/display by calendar date, not UTC). */
export function getLocalDateString(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Extracts YYYY-MM-DD from API date (ISO string) to avoid timezone shifting. Use for grouping sales by stored date. */
export function getDatePartFromApi(d: Date | string | null | undefined): string {
  if (d == null) return "";
  if (typeof d === "string" && d.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  return getLocalDateString(d);
}
