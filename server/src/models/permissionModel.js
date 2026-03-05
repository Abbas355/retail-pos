/**
 * Permission Model – role-permission lookup from database.
 */

import { query } from "../config/database.js";

/**
 * Get list of permission keys for a role.
 * @param {string} role – 'admin' | 'manager' | 'cashier'
 * @returns {Promise<string[]>}
 */
export async function getPermissionsForRole(role) {
  if (!role) return [];
  const rows = await query(
    "SELECT permission_key FROM role_permissions WHERE role = ? ORDER BY permission_key",
    [role]
  );
  return rows.map((r) => r.permission_key);
}
