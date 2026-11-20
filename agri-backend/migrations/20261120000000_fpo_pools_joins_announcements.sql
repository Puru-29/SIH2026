-- FPO pools (collection drives), farmer pledges, join requests and announcements.

CREATE TABLE fpo_pools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fpo_id INTEGER NOT NULL REFERENCES fpo_organizations(id),
    crop_id INTEGER NOT NULL REFERENCES crops(id),
    target_grade TEXT CHECK (target_grade IN ('A', 'B', 'C')),
    target_quantity_quintals REAL NOT NULL CHECK (target_quantity_quintals > 0),
    collection_center TEXT NOT NULL,
    collection_deadline TEXT NOT NULL,
    -- 'sold' and 'settled' are derived from the listed lot's stock and payouts.
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'collecting', 'locked', 'listed', 'cancelled')),
    lot_id INTEGER REFERENCES fpo_lots(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_fpo_pools_fpo ON fpo_pools(fpo_id, status);

-- Contributions can belong to a pool and be pledged from a farmer's own lot.
-- status: pending = pledged, approved = received at the collection centre,
-- rejected, pooled = in a listed bulk lot.
ALTER TABLE fpo_contributions ADD COLUMN pool_id INTEGER REFERENCES fpo_pools(id);
ALTER TABLE fpo_contributions ADD COLUMN pledged_quintals REAL;
ALTER TABLE fpo_contributions ADD COLUMN received_quintals REAL;
ALTER TABLE fpo_contributions ADD COLUMN assessed_grade TEXT CHECK (assessed_grade IN ('A', 'B', 'C'));
ALTER TABLE fpo_contributions ADD COLUMN source_lot_id INTEGER REFERENCES lots(id);
ALTER TABLE fpo_contributions ADD COLUMN received_at DATETIME;
ALTER TABLE fpo_contributions ADD COLUMN pledged_by TEXT NOT NULL DEFAULT 'fpo'
    CHECK (pledged_by IN ('fpo', 'farmer'));
ALTER TABLE fpo_contributions ADD COLUMN rejection_note TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_fpo_contrib_pool ON fpo_contributions(pool_id);
-- A farmer lot can be pledged to only one live pool contribution.
CREATE UNIQUE INDEX idx_fpo_contrib_source_lot ON fpo_contributions(source_lot_id)
    WHERE source_lot_id IS NOT NULL AND status IN ('pending', 'approved', 'pooled');

CREATE TABLE fpo_join_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fpo_id INTEGER NOT NULL REFERENCES fpo_organizations(id),
    farmer_user_id INTEGER NOT NULL REFERENCES users(id),
    message TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    decided_at DATETIME,
    decided_by INTEGER REFERENCES users(id)
);
CREATE UNIQUE INDEX idx_fpo_join_pending ON fpo_join_requests(fpo_id, farmer_user_id)
    WHERE status = 'pending';

-- Notices from FPOs to their members, and from admins to groups of users.
CREATE TABLE announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id INTEGER NOT NULL REFERENCES users(id),
    audience TEXT NOT NULL
        CHECK (audience IN ('fpo_members', 'all_farmers', 'all_buyers', 'all_fpos', 'all')),
    fpo_id INTEGER REFERENCES fpo_organizations(id),
    district TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_announcements_fpo ON announcements(fpo_id, created_at);
CREATE INDEX idx_announcements_audience ON announcements(audience, created_at);
