-- Add source column to all audit-relevant tables (for WhatsApp vs POS filter).
-- Run this if you have an existing MySQL database created before source was added.

ALTER TABLE customers ADD COLUMN source VARCHAR(20) NULL;
ALTER TABLE suppliers ADD COLUMN source VARCHAR(20) NULL;
ALTER TABLE products ADD COLUMN source VARCHAR(20) NULL;
ALTER TABLE purchases ADD COLUMN source VARCHAR(20) NULL;
ALTER TABLE sale_payments ADD COLUMN source VARCHAR(20) NULL;
