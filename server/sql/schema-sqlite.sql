-- SQLite schema for Retail POS (same structure as MySQL schema).
-- Run this when using DB_TYPE=sqlite. ENUM → TEXT, AUTO_INCREMENT → AUTOINCREMENT.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cashier' CHECK (role IN ('admin', 'manager', 'cashier')),
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permissions (
  permission_key TEXT PRIMARY KEY,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  PRIMARY KEY (role, permission_key),
  FOREIGN KEY (permission_key) REFERENCES permissions(permission_key)
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ur TEXT,
  barcode TEXT UNIQUE,
  price REAL NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL,
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  created_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT,
  deleted_by TEXT,
  deleted_by_role TEXT
);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT,
  deleted_by TEXT
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT,
  deleted_by TEXT
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  total REAL NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card')),
  customer_id TEXT,
  cashier TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  total REAL NOT NULL,
  date TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  cost REAL NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  amount REAL NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  date TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  created_by TEXT
);
