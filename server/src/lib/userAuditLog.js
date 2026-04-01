/**
 * Append-only audit rows for user account changes (profile, password, login status, delete).
 */
import { query } from "../config/database.js";
import { getNowPK } from "./dateUtils.js";

/**
 * @param {object} opts
 * @param {string} opts.userId - subject user id
 * @param {string} opts.action - profile | password | login_disabled | login_enabled | deleted
 * @param {string} opts.detail
 * @param {string|null} [opts.actorId]
 */
export async function logUserAudit(opts) {
  const { userId, action, detail, actorId } = opts;
  const id = `ua-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const createdAt = getNowPK();
  try {
    await query(
      "INSERT INTO user_audit_log (id, user_id, action, detail, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [id, userId, action, detail || "", actorId || null, createdAt]
    );
  } catch (err) {
    console.error("user_audit_log insert error:", err);
  }
}
