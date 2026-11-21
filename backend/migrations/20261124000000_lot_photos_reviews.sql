-- Crop quality trust: live camera photos on lots, the buyer's grade check on
-- arrival, and buyer reviews of farmers after delivery.
-- Additive only: no existing rows are changed or removed.

-- Photos taken with the in-app camera (never picked from a gallery).
-- The same image can never be attached twice (sha256 is unique), so a farmer
-- cannot reuse one good photo for every lot.
CREATE TABLE lot_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_id INTEGER NOT NULL REFERENCES lots(id),
    uploaded_by INTEGER NOT NULL REFERENCES users(id),
    mime_type TEXT NOT NULL,
    data BLOB NOT NULL,
    sha256 TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL DEFAULT 'camera' CHECK (source = 'camera'),
    latitude REAL,
    longitude REAL,
    captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_lot_photos_lot ON lot_photos(lot_id);

-- One grade check per order: what the buyer actually received vs what was listed.
-- A lower grade opens a dispute automatically.
CREATE TABLE grade_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id),
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    farmer_id INTEGER NOT NULL REFERENCES users(id),
    claimed_grade TEXT NOT NULL,
    received_grade TEXT NOT NULL,
    matched INTEGER NOT NULL CHECK (matched IN (0, 1)),
    note TEXT NOT NULL DEFAULT '',
    photo_mime TEXT,
    photo BLOB,
    dispute_id INTEGER REFERENCES disputes(id),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_grade_checks_farmer ON grade_checks(farmer_id);

-- One review per delivered order, by its buyer.
CREATE TABLE farmer_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id),
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    farmer_id INTEGER NOT NULL REFERENCES users(id),
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_farmer_reviews_farmer ON farmer_reviews(farmer_id);
