import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import productsRoutes from "./routes/products.js";
import customersRoutes from "./routes/customers.js";
import suppliersRoutes from "./routes/suppliers.js";
import salesRoutes from "./routes/sales.js";
import purchasesRoutes from "./routes/purchases.js";
import expensesRoutes from "./routes/expenses.js";
import usersRoutes from "./routes/users.js";
import permissionsRoutes from "./routes/permissions.js";
import syncRoutes from "./routes/sync.js";
import { query } from "./config/database.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/customers", customersRoutes);
app.use("/api/suppliers", suppliersRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/purchases", purchasesRoutes);
app.use("/api/expenses", expensesRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/permissions", permissionsRoutes);
app.use("/api/sync", syncRoutes);

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  await ensureDefaultUserIfSqlite();
  await syncFromMysqlIfConfigured();
});
