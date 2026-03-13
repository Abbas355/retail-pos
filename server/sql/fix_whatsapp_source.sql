-- Fix: Mark records as WhatsApp-created (for those added via WhatsApp but showing in POS view).
-- MySQL: mysql -u root -p retail_pose < server/sql/fix_whatsapp_source.sql
-- Or run in MySQL Workbench / your DB client.

-- Mark suppliers Arshad and Mahram as WhatsApp (add more names as needed)
UPDATE suppliers SET source = 'whatsapp' WHERE name IN ('Arshad', 'Mahram') AND (source IS NULL OR source = '' OR source = 'pos');
