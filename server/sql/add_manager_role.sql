-- Add manager role to users table if using ENUM.
-- Run on existing database. Adjust if your column is already VARCHAR.

-- If users.role is ENUM('admin','cashier'), add 'manager':
-- ALTER TABLE users MODIFY COLUMN role ENUM('admin', 'manager', 'cashier') NOT NULL DEFAULT 'cashier';
