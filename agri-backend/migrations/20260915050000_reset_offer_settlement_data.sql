DELETE FROM transactions;
DELETE FROM offers;
UPDATE lots SET status = 'open' WHERE status = 'sold';
