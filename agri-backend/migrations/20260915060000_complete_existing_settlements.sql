UPDATE transactions
SET status = 'completed'
WHERE status = 'settlement_pending';
