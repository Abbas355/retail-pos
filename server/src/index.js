import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import productsRoutes from "./routes/products.js";
import customersRoutes from "./routes/customers.js";
import suppliersRoutes from "./routes/suppliers.js";
import salesRoutes from "./routes/sales.js";
import khataRoutes from "./routes/khata.js";
import purchasesRoutes from "./routes/purchases.js";
import expensesRoutes from "./routes/expenses.js";
import usersRoutes from "./routes/users.js";
import permissionsRoutes from "./routes/permissions.js";
import syncRoutes from "./routes/sync.js";
import activityRoutes from "./routes/activity.js";
import printRoutes from "./routes/print.js";
import { query } from "./config/database.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/customers", customersRoutes);
app.use("/api/suppliers", suppliersRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/khata", khataRoutes);
app.use("/api/purchases", purchasesRoutes);
app.use("/api/expenses", expensesRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/permissions", permissionsRoutes);
app.use("/api/sync", syncRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/print", printRoutes);

/** When using SQLite and MySQL env is set, pull MySQL → SQLite on startup so desktop shows MySQL data. */
async function syncFromMysqlIfConfigured() {
  if ((process.env.DB_TYPE || "").toLowerCase() !== "sqlite") return;
  if (!process.env.DB_HOST && !process.env.MYSQL_SYNC_HOST) return;
  try {
    const { pullFromMysql } = await import("./sync/index.js");
    const result = await pullFromMysql();
    if (result.ok) console.log("Sync: " + result.message);
    else console.warn("Sync (pull): " + result.error);
  } catch (e) {
    console.warn("Sync (pull) skipped:", e.message);
  }
}

/** When using SQLite and no users exist, create default admin (admin / admin123) for offline use. */
async function ensureDefaultUserIfSqlite() {
  if ((process.env.DB_TYPE || "").toLowerCase() !== "sqlite") return;
  try {
    const rows = await query("SELECT 1 FROM users LIMIT 1");
    if (Array.isArray(rows) && rows.length > 0) return;
    const bcrypt = (await import("bcryptjs")).default;
    const hash = await bcrypt.hash("admin123", 10);
    await query(
      "INSERT INTO users (id, username, password_hash, role, name) VALUES (?, ?, ?, ?, ?)",
      ["u-admin", "admin", hash, "admin", "Admin"]
    );
    console.log("Default user created: admin / admin123");
  } catch (e) {
    console.warn("Could not ensure default user:", e.message);
  }
}

/** Ensure activity_log table exists (for delete/undo audit). */
async function ensureActivityLogTableMysql() {
  if ((process.env.DB_TYPE || "mysql").toLowerCase() !== "mysql") return;
  try {
    await query(`CREATE TABLE IF NOT EXISTS activity_log (
      id VARCHAR(64) PRIMARY KEY,
      type VARCHAR(32) NOT NULL,
      entity_id VARCHAR(64),
      summary VARCHAR(512),
      amount DECIMAL(12,2) DEFAULT 0,
      source VARCHAR(20) DEFAULT 'pos',
      deleted_by VARCHAR(128),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  } catch (e) {
    if (!/already exists|Table.*already exists/i.test(e.message)) console.warn("ensureActivityLogTableMysql:", e.message);
  }
}

/** Ensure source column exists on MySQL tables (for Activity WhatsApp filter). */
async function ensureSourceColumnsMysql() {
  if ((process.env.DB_TYPE || "mysql").toLowerCase() !== "mysql") return;
  try {
    const tables = [
      { table: "suppliers", col: "source" },
      { table: "customers", col: "source" },
      { table: "products", col: "source" },
      { table: "purchases", col: "source" },
      { table: "sale_payments", col: "source" },
    ];
    for (const { table, col } of tables) {
      try {
        await query(`ALTER TABLE ${table} ADD COLUMN ${col} VARCHAR(20) NULL`);
        console.log(`Added ${col} to ${table}`);
      } catch (e) {
        if (!/Duplicate column name/i.test(e.message)) console.warn(`${table}.${col}:`, e.message);
      }
    }
  } catch (e) {
    console.warn("ensureSourceColumnsMysql:", e.message);
  }
}

/** Ensure purchases has paid_amount and payment_status for supplier khata (MySQL). */
async function ensurePurchasesKhataColumnsMysql() {
  if ((process.env.DB_TYPE || "mysql").toLowerCase() !== "mysql") return;
  try {
    await query("ALTER TABLE purchases ADD COLUMN paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0");
  } catch (e) {
    if (!/Duplicate column name/i.test(e.message)) console.warn("purchases.paid_amount:", e.message);
  }
  try {
    await query("ALTER TABLE purchases ADD COLUMN payment_status VARCHAR(20) NOT NULL DEFAULT 'unpaid'");
  } catch (e) {
    if (!/Duplicate column name/i.test(e.message)) console.warn("purchases.payment_status:", e.message);
  }
}

/** Ensure supplier_payments table exists (MySQL). */
async function ensureSupplierPaymentsTableMysql() {
  if ((process.env.DB_TYPE || "mysql").toLowerCase() !== "mysql") return;
  try {
    await query(`CREATE TABLE IF NOT EXISTS supplier_payments (
      id VARCHAR(64) PRIMARY KEY,
      purchase_id VARCHAR(36) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
      date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      source VARCHAR(20) NULL,
      FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE
    )`);
  } catch (e) {
    if (!/already exists|Table.*already exists/i.test(e.message)) console.warn("ensureSupplierPaymentsTableMysql:", e.message);
  }
}

/** Ensure cash_in table exists (advances returned – Khata). */
async function ensureCashInTableMysql() {
  if ((process.env.DB_TYPE || "mysql").toLowerCase() !== "mysql") return;
  try {
    await query(`CREATE TABLE IF NOT EXISTS cash_in (
      id VARCHAR(64) PRIMARY KEY,
      amount DECIMAL(10,2) NOT NULL,
      note VARCHAR(512) NULL,
      date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  } catch (e) {
    if (!/already exists|Table.*already exists/i.test(e.message)) console.warn("ensureCashInTableMysql:", e.message);
  }
}

/** Expenses with category Urgent/Other can be marked returned (partial via returned_amount). */
async function ensureExpensesReturnedAtMysql() {
  if ((process.env.DB_TYPE || "mysql").toLowerCase() !== "mysql") return;
  try {
    await query("ALTER TABLE expenses ADD COLUMN returned_at DATETIME NULL");
  } catch (e) {
    if (!/Duplicate column name/i.test(e.message)) console.warn("expenses.returned_at:", e.message);
  }
  try {
    await query("ALTER TABLE expenses ADD COLUMN returned_amount DECIMAL(10,2) NOT NULL DEFAULT 0");
  } catch (e) {
    if (!/Duplicate column name/i.test(e.message)) console.warn("expenses.returned_amount:", e.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  await ensureDefaultUserIfSqlite();
  await ensureActivityLogTableMysql();
  await ensureSourceColumnsMysql();
  await ensurePurchasesKhataColumnsMysql();
  await ensureSupplierPaymentsTableMysql();
  await ensureCashInTableMysql();
  await ensureExpensesReturnedAtMysql();
  await syncFromMysqlIfConfigured();
});
