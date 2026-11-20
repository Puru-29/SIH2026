-- Base Users table
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL, -- "farmer", "fpo", "buyer"
    phone_number TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Farmers / FPOs
CREATE TABLE farmers (
    id INTEGER PRIMARY KEY,
    location TEXT NOT NULL,
    urgency_level TEXT NOT NULL, -- "high", "medium", "low"
    FOREIGN KEY(id) REFERENCES users(id)
);

-- Buyers
CREATE TABLE buyers (
    id INTEGER PRIMARY KEY,
    trust_score REAL NOT NULL DEFAULT 5.0,
    is_verified BOOLEAN NOT NULL DEFAULT 0,
    FOREIGN KEY(id) REFERENCES users(id)
);

-- Crops
CREATE TABLE crops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    perishability_days INTEGER NOT NULL
);

-- Markets
CREATE TABLE markets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    location TEXT NOT NULL
);

-- Market Prices
CREATE TABLE market_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id INTEGER NOT NULL,
    crop_id INTEGER NOT NULL,
    price_per_quintal REAL NOT NULL,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(market_id) REFERENCES markets(id),
    FOREIGN KEY(crop_id) REFERENCES crops(id)
);

-- Transport Costs (Source -> Destination string lookup)
CREATE TABLE transport_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_location TEXT NOT NULL,
    to_location TEXT NOT NULL,
    cost_per_quintal REAL NOT NULL,
    UNIQUE(from_location, to_location)
);

-- Storage Facilities
CREATE TABLE storage_facilities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id INTEGER NOT NULL,
    cost_per_quintal_per_day REAL NOT NULL,
    FOREIGN KEY(market_id) REFERENCES markets(id)
);

-- Buyer Demand
CREATE TABLE buyer_demand (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_id INTEGER NOT NULL,
    crop_id INTEGER NOT NULL,
    min_quantity REAL NOT NULL,
    max_price REAL NOT NULL,
    required_quality TEXT NOT NULL, -- e.g., "Grade A"
    delivery_location TEXT NOT NULL,
    required_by DATETIME NOT NULL,
    FOREIGN KEY(buyer_id) REFERENCES buyers(id),
    FOREIGN KEY(crop_id) REFERENCES crops(id)
);

-- Lots (Produce listings by Farmers)
CREATE TABLE lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    farmer_id INTEGER NOT NULL,
    crop_id INTEGER NOT NULL,
    quantity_quintals REAL NOT NULL,
    expected_quality TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', -- 'open', 'sold'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(farmer_id) REFERENCES farmers(id),
    FOREIGN KEY(crop_id) REFERENCES crops(id)
);

-- Offers (Bids by buyers on lots)
CREATE TABLE offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_id INTEGER NOT NULL,
    buyer_id INTEGER NOT NULL,
    price_offered REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'rejected'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(lot_id) REFERENCES lots(id),
    FOREIGN KEY(buyer_id) REFERENCES buyers(id)
);

-- Transactions (Completed sales)
CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    offer_id INTEGER NOT NULL,
    final_price REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(offer_id) REFERENCES offers(id)
);
