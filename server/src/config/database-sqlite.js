/**
 * SQLite database module — API compatible with MySQL (query + pool.getConnection for transactions).
 * Use when DB_TYPE=sqlite. Depends on server/sql/schema-sqlite.sql.
 */
import Database from "better-sqlite3";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDir = path.join(__dirname, "../../data");
const dbPath = process.env.SQLITE_DB_PATH || path.join(defaultDir, "retail_pos.db");
if (!process.env.SQLITE_DB_PATH) {
  try { fs.mkdirSync(defaultDir, { recursive: true }); } catch (_) {}
}
const db = new Database(dbPath);

/** Run schema-sqlite.sql if the database has no tables (e.g. first run). */
function initSchemaIfNeeded() {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (row) return;
  // Use __dirname: this file is server/src/config/, so ../../sql = server/sql/
  const schemaPath = path.resolve(__dirname, "../../sql/schema-sqlite.sql");
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`SQLite schema not found at ${schemaPath}`);
  }
  const sql = fs.readFileSync(schemaPath, "utf8");
  db.exec(sql);
}
initSchemaIfNeeded();

/** Add soft-delete columns if missing (for DBs created before they existed). */
function ensureSoftDeleteColumns() {
  const alters = [
    "ALTER TABLE suppliers ADD COLUMN deleted_at TEXT",
    "ALTER TABLE suppliers ADD COLUMN deleted_by TEXT",
    "ALTER TABLE customers ADD COLUMN deleted_at TEXT",
    "ALTER TABLE customers ADD COLUMN deleted_by TEXT",
    "ALTER TABLE products ADD COLUMN deleted_at TEXT",
    "ALTER TABLE products ADD COLUMN deleted_by TEXT",
    "ALTER TABLE products ADD COLUMN deleted_by_role TEXT",
  ];
  for (const sql of alters) {
    try { db.exec(sql); } catch (e) { if (!/duplicate column name/i.test(e.message)) throw e; }
  }
}
ensureSoftDeleteColumns();

// Optional: make SQL slightly MySQL-friendly (e.g. NOW() in routes)
function normalizeSql(sql) {
  return sql.replace(/\bNOW\s*\(\s*\)/gi, "CURRENT_TIMESTAMP");
}

/**
 * Run a statement. Returns rows array for SELECT; { affectedRows } for INSERT/UPDATE/DELETE.
 */
export async function query(sql, params = []) {
  const normalized = normalizeSql(sql);
  const stmt = db.prepare(normalized);
  const upper = normalized.trim().toUpperCase();
  if (upper.startsWith("SELECT")) {
    const rows = stmt.all(...params);
    return rows;
  }
  const result = stmt.run(...params);
  return { affectedRows: result.changes };
}

/**
 * Pool-like object: getConnection() returns a connection that supports
 * beginTransaction(), execute(), commit(), rollback(), release().
 * Only one transaction is active at a time (mutex).
 */
let transactionDone = Promise.resolve();

function runWithConn(sql, params = []) {
  const normalized = normalizeSql(sql);
  const stmt = db.prepare(normalized);
  const upper = normalized.trim().toUpperCase();
  if (upper.startsWith("SELECT")) {
    const rows = stmt.all(...params);
    return Promise.resolve([rows]);
  }
  stmt.run(...params);
  return Promise.resolve([{ affectedRows: 1 }]);
}

const pool = {
  async getConnection() {
    let releaseTx = null;
    return {
      async beginTransaction() {
        await transactionDone;
        db.exec("BEGIN");
        transactionDone = new Promise((r) => { releaseTx = r; });
      },
      async execute(sql, params = []) {
        return runWithConn(sql, params);
      },
      async commit() {
        db.exec("COMMIT");
        if (releaseTx) releaseTx();
      },
      async rollback() {
        db.exec("ROLLBACK");
        if (releaseTx) releaseTx();
      },
      release() {
        try { db.exec("ROLLBACK"); } catch (_) {}
        if (releaseTx) releaseTx();
      },
    };
  },
};

export { pool };
export default pool;
