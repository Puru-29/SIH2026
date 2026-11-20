-- FPO portal: organisations, members, crop contributions, bulk lots, quality,
-- offers & negotiation, sales, payments, member payouts, logistics,
-- grievances, documents and an audit log.

CREATE TABLE fpo_organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manager_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    name TEXT NOT NULL,
    registration_no TEXT,
    district TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'Maharashtra',
    contact_phone TEXT,
    commission_pct REAL NOT NULL DEFAULT 2.0 CHECK (commission_pct >= 0 AND commission_pct <= 20),
    verified INTEGER NOT NULL DEFAULT 0,
    verified_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fpo_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fpo_id INTEGER NOT NULL REFERENCES fpo_organizations(id),
    user_id INTEGER REFERENCES users(id),
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    village TEXT NOT NULL DEFAULT '',
    land_acres REAL NOT NULL DEFAULT 0 CHECK (land_acres >= 0),
    crops TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (fpo_id, phone)
);

CREATE TABLE fpo_warehouses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fpo_id INTEGER NOT NULL REFERENCES fpo_organizations(id),
    name TEXT NOT NULL,
    location TEXT NOT NULL,
    capacity_quintals REAL NOT NULL CHECK (capacity_quintals > 0),
    rate_per_quintal_month REAL NOT NULL DEFAULT 0 CHECK (rate_per_quintal_month >= 0),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fpo_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fpo_id INTEGER NOT NULL REFERENCES fpo_organizations(id),
    lot_code TEXT UNIQUE,
    crop_id INTEGER NOT NULL REFERENCES crops(id),
    variety TEXT NOT NULL DEFAULT '',
    total_quintals REAL NOT NULL CHECK (total_quintals > 0),
    reserved_quintals REAL NOT NULL DEFAULT 0 CHECK (reserved_quintals >= 0),
    sold_quintals REAL NOT NULL DEFAULT 0 CHECK (sold_quintals >= 0),
    grade TEXT CHECK (grade IN ('A', 'B', 'C')),
    warehouse_id INTEGER REFERENCES fpo_warehouses(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- Stock can never be allocated twice.
    CHECK (reserved_quintals + sold_quintals <= total_quintals + 0.0001)
);

CREATE TABLE fpo_contributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fpo_id INTEGER NOT NULL REFERENCES fpo_organizations(id),
    member_id INTEGER NOT NULL REFERENCES fpo_members(id),
    crop_id INTEGER NOT NULL REFERENCES crops(id),
    variety TEXT NOT NULL DEFAULT '',
    quantity_quintals REAL NOT NULL CHECK (quantity_quintals > 0),
    harvest_date TEXT NOT NULL,
    quality_note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'pooled')),
    lot_id INTEGER REFERENCES fpo_lots(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fpo_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fpo_id INTEGER NOT NULL REFERENCES fpo_organizations(id),
    owner_type TEXT NOT NULL CHECK (owner_type IN ('quality', 'grievance', 'payment')),
    owner_id INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    data BLOB NOT NULL,
    uploaded_by INTEGER NOT NULL REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fpo_quality_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_id INTEGER NOT NULL REFERENCES fpo_lots(id),
    inspector_name TEXT NOT NULL,
    inspected_on TEXT NOT NULL,
    moisture_pct REAL NOT NULL CHECK (moisture_pct >= 0 AND moisture_pct <= 100),
    foreign_matter_pct REAL NOT NULL CHECK (foreign_matter_pct >= 0 AND foreign_matter_pct <= 100),
    damaged_pct REAL NOT NULL DEFAULT 0 CHECK (damaged_pct >= 0 AND damaged_pct <= 100),
    grain_quality TEXT NOT NULL DEFAULT '',
    grade TEXT NOT NULL CHECK (grade IN ('A', 'B', 'C')),
    certificate_doc_id INTEGER REFERENCES fpo_documents(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fpo_offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fpo_id INTEGER NOT NULL REFERENCES fpo_organizations(id),
    lot_id INTEGER NOT NULL REFERENCES fpo_lots(id),
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    quantity_quintals REAL NOT NULL CHECK (quantity_quintals > 0),
    price_per_quintal REAL NOT NULL CHECK (price_per_quintal > 0),
    payment_terms TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected')),
    awaiting TEXT NOT NULL CHECK (awaiting IN ('fpo', 'buyer')),
    round INTEGER NOT NULL DEFAULT 1,
    created_by_role TEXT NOT NULL CHECK (created_by_role IN ('fpo', 'buyer')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fpo_offer_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    offer_id INTEGER NOT NULL REFERENCES fpo_offers(id),
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('offered', 'countered', 'accepted', 'rejected')),
    quantity_quintals REAL NOT NULL,
    price_per_quintal REAL NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fpo_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fpo_id INTEGER NOT NULL REFERENCES fpo_organizations(id),
    lot_id INTEGER NOT NULL REFERENCES fpo_lots(id),
    offer_id INTEGER NOT NULL UNIQUE REFERENCES fpo_offers(id),
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    quantity_quintals REAL NOT NULL CHECK (quantity_quintals > 0),
    price_per_quintal REAL NOT NULL,
    amount REAL NOT NULL,
    payment_terms TEXT NOT NULL DEFAULT '',
    transport_cost REAL NOT NULL DEFAULT 0 CHECK (transport_cost >= 0),
    storage_cost REAL NOT NULL DEFAULT 0 CHECK (storage_cost >= 0),
    handling_cost REAL NOT NULL DEFAULT 0 CHECK (handling_cost >= 0),
    commission_pct REAL NOT NULL DEFAULT 0,
    delivery_status TEXT NOT NULL DEFAULT 'awaiting_dispatch'
        CHECK (delivery_status IN ('awaiting_dispatch', 'in_transit', 'delivered')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fpo_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES fpo_sales(id),
    amount REAL NOT NULL CHECK (amount > 0),
    kind TEXT NOT NULL CHECK (kind IN ('advance', 'part', 'final')),
    method TEXT NOT NULL CHECK (method IN ('upi', 'neft', 'rtgs', 'cheque', 'cash')),
    reference TEXT NOT NULL DEFAULT '',
    paid_on TEXT NOT NULL,
    receipt_doc_id INTEGER REFERENCES fpo_documents(id),
    recorded_by INTEGER NOT NULL REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fpo_payouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES fpo_sales(id),
    member_id INTEGER NOT NULL REFERENCES fpo_members(id),
    contribution_id INTEGER NOT NULL REFERENCES fpo_contributions(id),
    quantity_quintals REAL NOT NULL,
    gross REAL NOT NULL,
    deductions REAL NOT NULL,
    net REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'paid')),
    reference TEXT,
    paid_on TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (sale_id, contribution_id)
);

CREATE TABLE fpo_transporters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fpo_id INTEGER NOT NULL REFERENCES fpo_organizations(id),
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    vehicle_number TEXT NOT NULL,
    capacity_quintals REAL NOT NULL CHECK (capacity_quintals > 0),
    rate_per_km REAL NOT NULL CHECK (rate_per_km >= 0),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fpo_shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fpo_id INTEGER NOT NULL REFERENCES fpo_organizations(id),
    sale_id INTEGER NOT NULL REFERENCES fpo_sales(id),
    transporter_id INTEGER REFERENCES fpo_transporters(id),
    pickup_location TEXT NOT NULL,
    delivery_address TEXT NOT NULL,
    distance_km REAL NOT NULL DEFAULT 0 CHECK (distance_km >= 0),
    estimated_cost REAL NOT NULL DEFAULT 0,
    expected_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'dispatched', 'in_transit', 'delivered', 'cancelled')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fpo_grievances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fpo_id INTEGER NOT NULL REFERENCES fpo_organizations(id),
    raised_by INTEGER NOT NULL REFERENCES users(id),
    raised_by_role TEXT NOT NULL,
    member_id INTEGER REFERENCES fpo_members(id),
    sale_id INTEGER REFERENCES fpo_sales(id),
    category TEXT NOT NULL CHECK (category IN ('payment_delay', 'quality_dispute', 'buyer_issue', 'other')),
    subject TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted', 'under_review', 'resolved', 'rejected')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fpo_grievance_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grievance_id INTEGER NOT NULL REFERENCES fpo_grievances(id),
    actor_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fpo_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fpo_id INTEGER NOT NULL,
    actor_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id INTEGER,
    detail TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_fpo_members_fpo ON fpo_members(fpo_id);
CREATE INDEX idx_fpo_members_phone ON fpo_members(phone);
CREATE INDEX idx_fpo_contrib_fpo ON fpo_contributions(fpo_id, status);
CREATE INDEX idx_fpo_contrib_lot ON fpo_contributions(lot_id);
CREATE INDEX idx_fpo_lots_fpo ON fpo_lots(fpo_id);
CREATE INDEX idx_fpo_offers_lot ON fpo_offers(lot_id, status);
CREATE INDEX idx_fpo_offers_buyer ON fpo_offers(buyer_id);
CREATE INDEX idx_fpo_sales_fpo ON fpo_sales(fpo_id);
CREATE INDEX idx_fpo_payments_sale ON fpo_payments(sale_id);
CREATE INDEX idx_fpo_payouts_member ON fpo_payouts(member_id);
CREATE INDEX idx_fpo_shipments_sale ON fpo_shipments(sale_id);
CREATE INDEX idx_fpo_grievances_fpo ON fpo_grievances(fpo_id, status);
CREATE INDEX idx_fpo_audit_fpo ON fpo_audit_log(fpo_id, created_at);
