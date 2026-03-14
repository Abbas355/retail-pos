/**
 * Pakistan timezone (Asia/Karachi) – all server date/time should use this.
 * Fixes wrong-date bugs when server runs in UTC (e.g. expense recorded as 14 March when it's 15 March in Pakistan).
 */

export const TIMEZONE_PK = "Asia/Karachi";

/** Returns current datetime as "YYYY-MM-DD HH:mm:ss" in Pakistan time (for DB storage). */
export function getNowPK() {
  const s = new Date().toLocaleString("sv-SE", { timeZone: TIMEZONE_PK });
  return s; // sv-SE format: "YYYY-MM-DD HH:mm:ss"
}

/** Returns current date as "YYYY-MM-DD" in Pakistan time. */
export function getTodayPK() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE_PK });
}

/** Convert a provided date string/Date to "YYYY-MM-DD HH:mm:ss" in Pakistan time. */
export function toDbDateTimePK(value) {
  if (!value) return getNowPK();
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("sv-SE", { timeZone: TIMEZONE_PK });
}

/** Convert DB datetime (Pakistan time) to ISO string for API response. Handles Date objects and various string formats. */
export function toIsoPK(dbDateTime) {
  if (dbDateTime == null) return null;
  // Date object (e.g. from MySQL driver): format in Pakistan time
  if (dbDateTime instanceof Date) {
    const s = dbDateTime.toLocaleString("sv-SE", { timeZone: TIMEZONE_PK });
    return s ? s.replace(" ", "T") + "+05:00" : dbDateTime.toISOString();
  }
  const s = String(dbDateTime).trim();
  if (!s) return null;
  // Already valid ISO (has T and ends with Z or +offset): return as-is so frontend can parse
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    return s;
  }
  // "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DD" (SQLite/our format)
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?)?/);
  if (match) {
    const time = match[4] != null ? `${match[4]}:${match[5]}:${match[6]}` : "12:00:00";
    return `${match[1]}-${match[2]}-${match[3]}T${time}+05:00`;
  }
  // Fallback: try parsing and return ISO
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
