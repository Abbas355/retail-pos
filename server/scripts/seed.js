/**
 * Seed script: users, products, customers, suppliers.
 * Run from server directory: npm run seed
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { query } from "../src/config/database.js";

async function seed() {
  console.log("Seeding...");
  const adminHash = await bcrypt.hash("admin123", 10);
  const managerHash = await bcrypt.hash("manager123", 10);
  const cashierHash = await bcrypt.hash("cash123", 10);
  await query(
    "INSERT INTO users (id, username, password_hash, role, name) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), name = VALUES(name)",
    ["u-admin", "admin", adminHash, "admin", "Admin"]
  );
  await query(
    "INSERT INTO users (id, username, password_hash, role, name) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), name = VALUES(name)",
    ["u-manager", "manager", managerHash, "manager", "Manager"]
  );
  await query(
    "INSERT INTO users (id, username, password_hash, role, name) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), name = VALUES(name)",
    ["u-cashier", "cashier", cashierHash, "cashier", "Cashier"]
  );
  console.log("Users seeded.");
  const products = [
    ["p-1", "Apple", "سیب", 1.5, 0.5, 50, "Fruits", 5],
    ["p-2", "Bread", "روٹی", 2.0, 0.8, 30, "Bakery", 5],
    ["p-3", "Milk", "دودھ", 2.5, 1.0, 40, "Dairy", 5],
  ];
  for (const row of products) {
    await query(
      "INSERT INTO products (id, name, name_ur, price, cost, stock, category, low_stock_threshold) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), name_ur=VALUES(name_ur), price=VALUES(price), cost=VALUES(cost), stock=VALUES(stock), category=VALUES(category), low_stock_threshold=VALUES(low_stock_threshold)",
      row
    );
  }
  console.log("Products seeded.");
  await query("INSERT INTO customers (id, name, phone) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), phone=VALUES(phone)", ["c-1", "Walk-in", ""]);
  await query("INSERT INTO suppliers (id, name, phone, email) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), phone=VALUES(phone), email=VALUES(email)", ["s-1", "Main Supplier", "555-0000", "supplier@example.com"]);
  console.log("Done.");
}

seed().catch((e) => { console.error(e); process.exit(1); });
