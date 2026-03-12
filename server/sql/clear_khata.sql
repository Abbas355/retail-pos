-- Clear all Khata data: mark all sales as fully paid and remove payment history.
-- Run this once to discard existing credit/partial data. New sales will be saved normally.
-- MySQL: run via mysql client or your DB tool
-- SQLite: run via sqlite3 retail_pos.db < clear_khata.sql (or use DB browser)

-- 1. Mark all sales as fully paid (removes them from khata view)
UPDATE sales SET paid_amount = total, payment_status = 'paid' WHERE COALESCE(paid_amount, 0) < total;

-- 2. Delete payment history (sale_payments)
DELETE FROM sale_payments;
