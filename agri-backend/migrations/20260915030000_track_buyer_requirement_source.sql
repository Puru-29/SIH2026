ALTER TABLE buyer_demand ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;

UPDATE buyer_demand
SET is_demo = 1
WHERE buyer_id IN (2, 4, 5, 6, 7, 8);
