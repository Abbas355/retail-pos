/**
 * Activity log for delete/undo events.
 * Inserts into activity_log table so Activity feed can show deletions.
 */
import { query } from "../config/database.js";

/**
 * Infer source from request: pos or whatsapp.
 * Uses X-Source header or deletedBy containing "WhatsApp".
 */
export function inferDeleteSource(req) {
  const headerSource = (req.headers["x-source"] || req.headers["X-Source"] || "").toLowerCase().trim();
  if (headerSource === "whatsapp") return "whatsapp";
  const fromBody = req.body?.deletedBy != null ? String(req.body.deletedBy) : "";
  const fromQuery = req.query?.deletedBy != null ? String(req.query.deletedBy) : "";
  const deletedBy = (fromBody || fromQuery || "").toLowerCase();
  if (deletedBy.includes("whatsapp")) return "whatsapp";
  return "pos";
}

/**
 * Log a delete/void event to activity_log.
 * @param {object} opts
 * @param {string} opts.type - delete_product | delete_customer | delete_supplier | delete_expense | void_sale
 * @param {string} opts.entityId - id of deleted entity
 * @param {string} opts.summary - human-readable summary
 * @param {number} [opts.amount=0] - amount (for expense/sale)
 * @param {string} opts.source - pos | whatsapp
 * @param {string|null} opts.deletedBy - who performed the delete
 */
export async function logActivityDelete(opts) {
  const { type, entityId, summary, amount = 0, source, deletedBy } = opts;
  const id = `al-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const createdAt = new Date().toISOString().slice(0, 19).replace("T", " ");
  try {
    await query(
      "INSERT INTO activity_log (id, type, entity_id, summary, amount, source, deleted_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, type, entityId || "", summary || "", Number(amount) || 0, source || "pos", deletedBy || null, createdAt]
    );
  } catch (err) {
    console.error("activity_log insert error:", err);
  }
}
