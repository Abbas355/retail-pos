/**
 * Auth Model – user lookup and password verification.
 */

import { query } from "../config/database.js";
import bcrypt from "bcryptjs";

export async function findByUsername(username) {
  const rows = await query(
    "SELECT id, username, password_hash, role, name, COALESCE(is_disabled, 0) AS is_disabled FROM users WHERE username = ?",
    [username]
  );
  return rows[0] || null;
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}
