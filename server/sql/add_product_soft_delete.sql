-- Run on an existing database to add soft-delete columns to products.
ALTER TABLE products ADD COLUMN deleted_at DATETIME NULL;
ALTER TABLE products ADD COLUMN deleted_by VARCHAR(100) NULL;
ALTER TABLE products ADD COLUMN deleted_by_role VARCHAR(20) NULL;
