/**
 * Sync MySQL ↔ SQLite. Pull (MySQL→SQLite) and Push (SQLite→MySQL).
 * Use when desktop app is online and MySQL is configured.
 */
import mysql from "mysql2/promise";
import { query as sqliteQuery } from "../config/database.js";

const dbType = (process.env.DB_TYPE || "mysql").toLowerCase();
const TABLES = [
  "permissions",
  "role_permissions",
  "users",
  "user_audit_log",
  "products",
  "customers",
  "suppliers",
  "sales",
  "sale_items",
  "purchases",
  "purchase_items",
];

function mysqlPool() {
  return mysql.createPool({
    host: process.env.MYSQL_SYNC_HOST || process.env.DB_HOST || "localhost",
    port: Number(process.env.MYSQL_SYNC_PORT || process.env.DB_PORT || 3306),
    user: process.env.MYSQL_SYNC_USER || process.env.DB_USER || "root",
    password: process.env.MYSQL_SYNC_PASSWORD || process.env.DB_PASSWORD || "",
    database: process.env.MYSQL_SYNC_DB || process.env.DB_NAME || "retail_pos",
    waitForConnections: true,
    connectionLimit: 5,
    connectTimeout: 8000,
  });
}

/** Pull all data from MySQL into SQLite. */
export async function pullFromMysql() {
  if (dbType !== "sqlite") return { ok: false, error: "Pull only runs when using SQLite" };
  const pool = mysqlPool();
  try {
    await pool.query("SELECT 1");
  } catch (e) {
    return { ok: false, error: `MySQL not reachable: ${e.message}` };
  }
  try {
    for (const table of TABLES) {
      const [rows] = await pool.execute(`SELECT * FROM \`${table}\``);
      if (rows.length === 0) continue;
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => "?").join(", ");
      const colList = columns.map((c) => `"${c}"`).join(", ");
      const sql = `INSERT OR REPLACE INTO ${table} (${colList}) VALUES (${placeholders})`;
      for (const row of rows) {
        const vals = columns.map((col) => {
          let v = row[col];
          if (v === null || v === undefined) return null;
          if (v instanceof Date) return v.toISOString().slice(0, 19).replace("T", " ");
          return v;
        });
        await sqliteQuery(sql, vals);
      }
    }
    await pool.end();
    return { ok: true, message: "Synced from MySQL" };
  } catch (e) {
    try { await pool.end(); } catch (_) {}
    return { ok: false, error: e.message };
  }
}

/** Push all data from SQLite to MySQL. */
export async function pushToMysql() {
  if (dbType !== "sqlite") return { ok: false, error: "Push only runs when using SQLite" };
  const pool = mysqlPool();
  try {
    await pool.query("SELECT 1");
  } catch (e) {
    return { ok: false, error: `MySQL not reachable: ${e.message}` };
  }
  try {
    for (const table of TABLES) {
      const rows = await sqliteQuery(`SELECT * FROM ${table}`);
      if (rows.length === 0) continue;
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => "?").join(", ");
      const colList = columns.map((c) => "`" + c + "`").join(", ");
      const pkCols = table === "role_permissions" ? ["role", "permission_key"] : ["id"];
      const updateCols = columns.filter((c) => !pkCols.includes(c));
      const onDup =
        updateCols.length > 0
          ? ` ON DUPLICATE KEY UPDATE ${updateCols.map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(", ")}`
          : " ON DUPLICATE KEY UPDATE role = VALUES(role)";
      const sql = `INSERT INTO \`${table}\` (${colList}) VALUES (${placeholders})${onDup}`;
      for (const row of rows) {
        const vals = columns.map((c) => (row[c] ?? null));
        await pool.execute(sql, vals);
      }
    }
    await pool.end();
    return { ok: true, message: "Synced to MySQL" };
  } catch (e) {
    try { await pool.end(); } catch (_) {}
    return { ok: false, error: e.message };
  }
}
