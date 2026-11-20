-- Only admins add crops now. Everyone else picks from this list and can ask
-- for a missing crop with a crop request, which the admin adds or dismisses.
-- Additive only: no existing rows are changed or removed.

CREATE TABLE crop_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requested_by INTEGER NOT NULL REFERENCES users(id),
    crop_name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'added', 'dismissed')),
    crop_id INTEGER REFERENCES crops(id),
    decided_by INTEGER REFERENCES users(id),
    decided_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_crop_requests_status ON crop_requests(status, id);

-- Common crops (Agmarknet names) so the pick list is useful on a fresh install.
-- Shelf life in days: 5–15 fresh vegetables/fruit, 30–60 bulbs/tubers, 180 dry produce.
INSERT OR IGNORE INTO crops (name, perishability_days) VALUES
    ('Wheat', 180), ('Paddy', 180), ('Rice', 180), ('Maize', 180), ('Bajra', 180),
    ('Jowar', 180), ('Barley', 180), ('Bengal Gram (Chana)', 180), ('Arhar (Tur)', 180),
    ('Moong', 180), ('Urad', 180), ('Masoor', 180), ('Soybean', 180), ('Mustard', 180),
    ('Groundnut', 180), ('Cotton', 180), ('Turmeric', 180), ('Coriander Seed', 180),
    ('Cumin', 180), ('Dry Chillies', 180), ('Onion', 45), ('Potato', 45), ('Garlic', 60),
    ('Ginger', 30), ('Tomato', 5), ('Cauliflower', 7), ('Cabbage', 10), ('Brinjal', 7),
    ('Okra (Bhindi)', 5), ('Green Chilli', 7), ('Carrot', 15), ('Peas', 7), ('Bottle Gourd', 7),
    ('Banana', 7), ('Mango', 7), ('Apple', 30), ('Grapes', 10), ('Orange', 15),
    ('Pomegranate', 30), ('Papaya', 7), ('Sugarcane', 7);
