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

/** Ensure users.is_disabled exists (block login when set). */
function ensureUsersIsDisabledColumn() {
  try {
    const info = db.prepare("PRAGMA table_info(users)").all();
    if (!info.some((col) => col.name === "is_disabled")) {
      db.exec("ALTER TABLE users ADD COLUMN is_disabled INTEGER NOT NULL DEFAULT 0");
    }
  } catch (e) {
    if (!/duplicate column name/i.test(e.message)) throw e;
  }
}
ensureUsersIsDisabledColumn();

/** Ensure users.created_at exists (account timeline). */
function ensureUsersCreatedAtColumn() {
  try {
    const info = db.prepare("PRAGMA table_info(users)").all();
    if (!info.some((col) => col.name === "created_at")) {
      db.exec("ALTER TABLE users ADD COLUMN created_at TEXT");
    }
  } catch (e) {
    if (!/duplicate column name/i.test(e.message)) throw e;
  }
}
ensureUsersCreatedAtColumn();

/** Audit log for user profile / password / login status changes. */
function ensureUserAuditLogTable() {
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS user_audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      actor_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    db.exec("CREATE INDEX IF NOT EXISTS idx_user_audit_log_user_id ON user_audit_log(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_user_audit_log_created_at ON user_audit_log(created_at)");
  } catch (e) {
    if (!/already exists/i.test(e.message)) throw e;
  }
}
ensureUserAuditLogTable();

/** Ensure expenses table exists (for DBs created before expenses feature). */
function ensureExpensesTable() {
  const sql = `CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    date TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT
  )`;
  try { db.exec(sql); } catch (e) { if (!/already exists/i.test(e.message)) throw e; }
}
ensureExpensesTable();

/** Expenses with category Urgent/Other can be marked returned when cash in is recorded. */
function ensureExpensesReturnedAt() {
  try {
    const info = db.prepare("PRAGMA table_info(expenses)").all();
    const names = info.map((c) => c.name);
    if (!names.includes("returned_at")) {
      db.exec("ALTER TABLE expenses ADD COLUMN returned_at TEXT NULL");
    }
    if (!names.includes("returned_amount")) {
      db.exec("ALTER TABLE expenses ADD COLUMN returned_amount REAL NOT NULL DEFAULT 0");
    }
  } catch (e) {
    if (!/duplicate column|no such column/i.test(e.message)) throw e;
  }
}
ensureExpensesReturnedAt();

/** Ensure products.barcode column exists (for DBs created before barcode feature). */
function ensureProductsBarcodeColumn() {
  try {
    const info = db.prepare("PRAGMA table_info(products)").all();
    const hasBarcode = info.some((col) => col.name === "barcode");
    if (!hasBarcode) {
      db.exec("ALTER TABLE products ADD COLUMN barcode TEXT");
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)");
  } catch (e) { if (!/duplicate column name|already exists/i.test(e.message)) throw e; }
}
ensureProductsBarcodeColumn();

/** Ensure sales khata columns (paid_amount, payment_status) exist. */
function ensureSalesKhataColumns() {
  try {
    const info = db.prepare("PRAGMA table_info(sales)").all();
    const names = info.map((c) => c.name);
    if (!names.includes("paid_amount")) {
      db.exec("ALTER TABLE sales ADD COLUMN paid_amount REAL NOT NULL DEFAULT 0");
      db.exec("UPDATE sales SET paid_amount = total");
    }
    if (!names.includes("payment_status")) {
      db.exec("ALTER TABLE sales ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'paid'");
    }
  } catch (e) {
    if (!/duplicate column|no such column/i.test(e.message)) throw e;
  }
}
ensureSalesKhataColumns();

/** Ensure sale_payments table exists for khata payment history. */
function ensureSalePaymentsTable() {
  const sql = `CREATE TABLE IF NOT EXISTS sale_payments (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    date TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
  )`;
  try {
    db.exec(sql);
  } catch (e) {
    if (!/already exists/i.test(e.message)) throw e;
  }
}
ensureSalePaymentsTable();

/** Ensure source column on all audit-relevant tables (whatsapp vs pos). */
function ensureSourceColumns() {
  const alters = [
    "ALTER TABLE sales ADD COLUMN source TEXT",
    "ALTER TABLE expenses ADD COLUMN source TEXT",
    "ALTER TABLE customers ADD COLUMN source TEXT",
    "ALTER TABLE suppliers ADD COLUMN source TEXT",
    "ALTER TABLE products ADD COLUMN source TEXT",
    "ALTER TABLE purchases ADD COLUMN source TEXT",
    "ALTER TABLE sale_payments ADD COLUMN source TEXT",
  ];
  for (const sql of alters) {
    try {
      db.exec(sql);
    } catch (e) {
      if (!/duplicate column name/i.test(e.message)) throw e;
    }
  }
}
ensureSourceColumns();

/** Ensure purchases has paid_amount and payment_status for supplier khata. */
function ensurePurchasesKhataColumns() {
  try {
    const info = db.prepare("PRAGMA table_info(purchases)").all();
    const names = info.map((c) => c.name);
    if (!names.includes("paid_amount")) {
      db.exec("ALTER TABLE purchases ADD COLUMN paid_amount REAL NOT NULL DEFAULT 0");
    }
    if (!names.includes("payment_status")) {
      db.exec("ALTER TABLE purchases ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'");
    }
  } catch (e) {
    if (!/duplicate column|no such column/i.test(e.message)) throw e;
  }
}
ensurePurchasesKhataColumns();

/** Ensure supplier_payments table exists for supplier khata payment history. */
function ensureSupplierPaymentsTable() {
  const sql = `CREATE TABLE IF NOT EXISTS supplier_payments (
    id TEXT PRIMARY KEY,
    purchase_id TEXT NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    date TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    source TEXT,
    FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE
  )`;
  try {
    db.exec(sql);
  } catch (e) {
    if (!/already exists/i.test(e.message)) throw e;
  }
}
ensureSupplierPaymentsTable();

/** Ensure cash_in table exists (advances returned – money received back, out is in Expenses). */
function ensureCashInTable() {
  const sql = `CREATE TABLE IF NOT EXISTS cash_in (
    id TEXT PRIMARY KEY,
    amount REAL NOT NULL,
    note TEXT,
    date TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  )`;
  try {
    db.exec(sql);
    db.exec("CREATE INDEX IF NOT EXISTS idx_cash_in_date ON cash_in(date)");
  } catch (e) {
    if (!/already exists/i.test(e.message)) throw e;
  }
}
ensureCashInTable();

/** Manual khata entries per customer (Digi Khata style: udhaar added / payment received). */
function ensureCustomerKhataEntriesTable() {
  const sql = `CREATE TABLE IF NOT EXISTS customer_khata_entries (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('udhaar_added', 'payment_received')),
    amount REAL NOT NULL,
    note TEXT,
    date TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
  )`;
  try {
    db.exec(sql);
    db.exec("CREATE INDEX IF NOT EXISTS idx_customer_khata_entries_customer_id ON customer_khata_entries(customer_id)");
  } catch (e) {
    if (!/already exists/i.test(e.message)) throw e;
  }
}
ensureCustomerKhataEntriesTable();

/** General in/out khata entries (random or linked to customer/supplier/cashin). */
function ensureKhataEntriesTable() {
  const sql = `CREATE TABLE IF NOT EXISTS khata_entries (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('in', 'out')),
    amount REAL NOT NULL,
    note TEXT,
    date TEXT NOT NULL DEFAULT (datetime('now')),
    link_type TEXT NOT NULL DEFAULT 'random' CHECK (link_type IN ('random', 'customer', 'supplier', 'cashin')),
    link_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT
  )`;
  try {
    db.exec(sql);
    db.exec("CREATE INDEX IF NOT EXISTS idx_khata_entries_date ON khata_entries(date)");
  } catch (e) {
    if (!/already exists/i.test(e.message)) throw e;
  }
}
ensureKhataEntriesTable();

function ensureKhataEntriesCreatedByColumn() {
  try {
    db.exec("ALTER TABLE khata_entries ADD COLUMN created_by TEXT");
  } catch (e) {
    if (!/duplicate column name/i.test(String(e.message))) {
      console.warn("ensureKhataEntriesCreatedByColumn:", e.message);
    }
  }
}
ensureKhataEntriesCreatedByColumn();

/** Manual khata entries per supplier (same as customer: udhaar added / payment received). */
function ensureSupplierKhataEntriesTable() {
  const sql = `CREATE TABLE IF NOT EXISTS supplier_khata_entries (
    id TEXT PRIMARY KEY,
    supplier_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('udhaar_added', 'payment_received')),
    amount REAL NOT NULL,
    note TEXT,
    date TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
  )`;
  try {
    db.exec(sql);
    db.exec("CREATE INDEX IF NOT EXISTS idx_supplier_khata_entries_supplier_id ON supplier_khata_entries(supplier_id)");
  } catch (e) {
    if (!/already exists/i.test(e.message)) throw e;
  }
}
ensureSupplierKhataEntriesTable();

/** Manual in/out entries for Cash in Khata (statement timeline). */
function ensureCashinKhataEntriesTable() {
  const sql = `CREATE TABLE IF NOT EXISTS cashin_khata_entries (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('in', 'out')),
    amount REAL NOT NULL,
    note TEXT,
    date TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  )`;
  try {
    db.exec(sql);
    db.exec("CREATE INDEX IF NOT EXISTS idx_cashin_khata_entries_date ON cashin_khata_entries(date)");
  } catch (e) {
    if (!/already exists/i.test(e.message)) throw e;
  }
}
ensureCashinKhataEntriesTable();

/** Ensure activity_log table exists for delete/undo audit events. */
function ensureActivityLogTable() {
  const sql = `CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    entity_id TEXT,
    summary TEXT,
    amount REAL DEFAULT 0,
    source TEXT DEFAULT 'pos',
    deleted_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`;
  try {
    db.exec(sql);
    db.exec("CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at)");
  } catch (e) {
    if (!/already exists/i.test(e.message)) throw e;
  }
}
ensureActivityLogTable();

/** Bills (Bill Book in Khata app). */
function ensureBillsTables() {
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS bills (
      id TEXT PRIMARY KEY,
      customer_id TEXT NULL,
      customer_name TEXT NOT NULL DEFAULT '',
      total REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      notes TEXT NULL,
      bill_date TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS bill_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id TEXT NOT NULL,
      description TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL,
      FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
    )`);
    db.exec("CREATE INDEX IF NOT EXISTS idx_bills_created_at ON bills(created_at)");
  } catch (e) {
    if (!/already exists/i.test(e.message)) throw e;
  }
}
ensureBillsTables();

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
