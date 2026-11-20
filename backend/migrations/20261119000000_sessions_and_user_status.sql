-- Real login sessions (replaces the trusted X-User-Id header) and account status.

CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    -- SHA-256 of the random bearer token; the token itself is never stored.
    token_hash TEXT NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- active: normal; pending: waiting for admin verification (FPOs); suspended: cannot sign in.
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending', 'suspended'));

-- FPO profile fields asked for in the FPO/admin brief.
ALTER TABLE fpo_organizations ADD COLUMN verified_by INTEGER REFERENCES users(id);
ALTER TABLE fpo_organizations ADD COLUMN primary_crops TEXT NOT NULL DEFAULT '';

-- FPO accounts whose organisation is not verified yet wait for an admin.
-- The seeded demo FPO (user 3) stays active.
UPDATE users SET status = 'pending'
WHERE role = 'fpo' AND id <> 3
  AND id IN (SELECT manager_user_id FROM fpo_organizations WHERE verified = 0);
