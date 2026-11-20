-- Farmer and buyer portals on real data: negotiation, payments, order tracking,
-- messages, typed notifications, profile fields and stored mandi price history.
-- Additive only: no existing rows are changed or removed.

-- Counter-offers: a counter is a new offer linked to the one it answers.
-- Offer statuses now: pending, accepted, rejected, countered, cancelled.
ALTER TABLE offers ADD COLUMN parent_offer_id INTEGER REFERENCES offers(id);
ALTER TABLE offers ADD COLUMN responded_at DATETIME;
CREATE INDEX idx_offers_lot ON offers(lot_id);
CREATE INDEX idx_offers_parent ON offers(parent_offer_id);

-- Lots: when they were last edited (status values now: open, sold, withdrawn, cancelled).
ALTER TABLE lots ADD COLUMN updated_at DATETIME;

-- Deals: where the crop is picked up and delivered. New deals start as
-- 'accepted' and move to picked_up, in_transit, delivered. Older rows stay 'completed'.
ALTER TABLE transactions ADD COLUMN pickup_location TEXT;
ALTER TABLE transactions ADD COLUMN delivery_location TEXT;

-- Profile
ALTER TABLE users ADD COLUMN preferred_language TEXT;
ALTER TABLE buyers ADD COLUMN location TEXT;

-- Daily mandi prices per crop and state, saved whenever prices are fetched,
-- so the forecast has history even when the Mandi API history call fails.
CREATE TABLE mandi_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    commodity TEXT NOT NULL,
    state TEXT NOT NULL,
    arrival_date TEXT NOT NULL,
    modal_price REAL NOT NULL CHECK (modal_price > 0),
    min_price REAL,
    max_price REAL,
    markets INTEGER NOT NULL DEFAULT 1,
    fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (commodity, state, arrival_date)
);

-- Payments on a farmer-buyer deal. The buyer records a payment, the farmer
-- confirms it was received (or says it was not).
CREATE TABLE transaction_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id),
    amount REAL NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL DEFAULT 'bank_transfer',
    reference TEXT,
    status TEXT NOT NULL DEFAULT 'marked_paid'
        CHECK (status IN ('marked_paid', 'confirmed', 'not_received')),
    paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    recorded_by INTEGER NOT NULL REFERENCES users(id),
    confirmed_at DATETIME,
    note TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_tx_payments_tx ON transaction_payments(transaction_id);

-- Order tracking events, visible to both sides.
CREATE TABLE order_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id),
    status TEXT NOT NULL CHECK (status IN ('accepted', 'picked_up', 'in_transit', 'delivered')),
    note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (transaction_id, status)
);

-- Direct messages between farmers, buyers and FPOs.
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL REFERENCES users(id),
    receiver_id INTEGER NOT NULL REFERENCES users(id),
    lot_id INTEGER REFERENCES lots(id),
    transaction_id INTEGER REFERENCES transactions(id),
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at DATETIME
);
CREATE INDEX idx_messages_pair ON messages(sender_id, receiver_id, created_at);
CREATE INDEX idx_messages_receiver ON messages(receiver_id, read_at);

-- Typed notifications (offer, counter, accepted, rejected, matching_lot,
-- payment, order, message, dispute, admin, general).
ALTER TABLE user_notifications ADD COLUMN type TEXT NOT NULL DEFAULT 'general';
CREATE INDEX idx_user_notifications_unread ON user_notifications(user_id, read_at);

-- Existing deals get their 'accepted' event so the timeline starts somewhere.
INSERT OR IGNORE INTO order_events (transaction_id, status, note, created_at)
SELECT id, 'accepted', 'Offer accepted', completed_at FROM transactions;
