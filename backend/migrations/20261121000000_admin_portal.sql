-- Admin portal: audit log, disputes on transactions, per-user notifications,
-- and reasons for rejections and cancellations.

CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

CREATE TABLE disputes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id),
    raised_by INTEGER NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'investigating', 'resolved', 'rejected')),
    resolution_note TEXT,
    resolved_by INTEGER REFERENCES users(id),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME
);
CREATE INDEX idx_disputes_status ON disputes(status);
-- One open dispute per transaction per person.
CREATE UNIQUE INDEX idx_disputes_open ON disputes(transaction_id, raised_by)
    WHERE status IN ('open', 'investigating');

CREATE TABLE user_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    link TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at DATETIME
);
CREATE INDEX idx_user_notifications_user ON user_notifications(user_id, created_at);

ALTER TABLE fpo_organizations ADD COLUMN rejection_reason TEXT;
ALTER TABLE buyers ADD COLUMN verification_note TEXT;
ALTER TABLE lots ADD COLUMN cancel_reason TEXT;
ALTER TABLE offers ADD COLUMN cancel_reason TEXT;
