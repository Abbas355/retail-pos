-- Add barcode column to products (for existing MySQL databases)
-- Run: mysql -u user -p database_name < add_products_barcode.sql

ALTER TABLE products ADD COLUMN barcode VARCHAR(64) NULL UNIQUE;
CREATE INDEX idx_products_barcode ON products(barcode);
