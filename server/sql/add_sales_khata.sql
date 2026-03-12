-- Customer Khata: add paid_amount and payment_status to sales.
-- Rules: paid_amount = total → paid; paid_amount = 0 → credit; 0 < paid_amount < total → partial

ALTER TABLE sales ADD COLUMN paid_amount DECIMAL(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN payment_status VARCHAR(20) NOT NULL DEFAULT 'paid';

-- Backfill existing sales as fully paid
UPDATE sales SET paid_amount = total, payment_status = 'paid';
