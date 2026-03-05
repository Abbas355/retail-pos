/**
 * Seed roles and permissions only.
 * Run: npm run seed:roles
 */
import "dotenv/config";
import { query } from "../src/config/database.js";

const permissionKeys = [
  ["view_dashboard", "View dashboard"],
  ["view_sales", "View sales"],
  ["manage_sales", "Create and manage sales"],
  ["view_inventory", "View inventory"],
  ["manage_inventory", "Add, edit products"],
  ["delete_products", "Delete products (inventory)"],
  ["view_customers", "View customers"],
  ["manage_customers", "Add, edit customers"],
  ["delete_customers", "Delete customers"],
  ["view_purchases", "View purchases"],
  ["manage_purchases", "Create purchases"],
  ["view_suppliers", "View suppliers"],
  ["manage_suppliers", "Add, edit suppliers"],
  ["delete_suppliers", "Delete suppliers"],
  ["view_reports", "View reports"],
  ["manage_users", "User management (add, edit, delete users)"],
];

async function seed() {
  for (const [key, desc] of permissionKeys) {
    await query(
      "INSERT INTO permissions (permission_key, description) VALUES (?, ?) ON DUPLICATE KEY UPDATE description = VALUES(description)",
      [key, desc]
    );
  }
  const adminPerms = permissionKeys.map(([k]) => k);
  const managerPerms = adminPerms.filter(
    (k) => k !== "manage_users" && k !== "delete_customers" && k !== "delete_suppliers" && k !== "delete_products"
  );
  for (const key of adminPerms) {
    await query("INSERT IGNORE INTO role_permissions (role, permission_key) VALUES ('admin', ?)", [key]);
  }
  for (const key of managerPerms) {
    await query("INSERT IGNORE INTO role_permissions (role, permission_key) VALUES ('manager', ?)", [key]);
  }
  const cashierPerms = ["view_dashboard", "view_sales", "manage_sales", "view_inventory", "view_customers"];
  for (const key of cashierPerms) {
    await query("INSERT IGNORE INTO role_permissions (role, permission_key) VALUES ('cashier', ?)", [key]);
  }
  console.log("Roles and permissions seeded.");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
