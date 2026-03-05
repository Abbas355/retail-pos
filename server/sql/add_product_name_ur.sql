-- Add Urdu name column for bilingual product display (Sales tab).
ALTER TABLE products ADD COLUMN name_ur VARCHAR(200) NULL;
