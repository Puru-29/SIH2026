-- Phone OTP and buyer verification levels.
-- Additive only, except: buyers already verified become Level 2 so they keep trading.

ALTER TABLE users ADD COLUMN phone_verified_at DATETIME;

CREATE TABLE phone_otps (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    code_hash TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One application per buyer. level: 0 unverified, 1 ID verified, 2 verified business.
CREATE TABLE buyer_verifications (
    buyer_id INTEGER PRIMARY KEY REFERENCES users(id),
    level INTEGER NOT NULL DEFAULT 0 CHECK (level IN (0, 1, 2)),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
    business_type TEXT CHECK (business_type IN ('individual', 'proprietorship', 'partnership', 'company')),
    business_name TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    district TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT '',
    pincode TEXT NOT NULL DEFAULT '',
    crops_bought TEXT NOT NULL DEFAULT '',
    monthly_capacity_quintals REAL,
    gstin TEXT,
    pan TEXT,
    bank_holder_name TEXT,
    bank_ifsc TEXT,
    -- AES-256-GCM (nonce || ciphertext); only the last 4 digits are kept in clear.
    bank_account_enc BLOB,
    bank_account_last4 TEXT,
    consent_at DATETIME,
    submitted_at DATETIME,
    admin_note TEXT,
    decided_by INTEGER REFERENCES users(id),
    decided_at DATETIME,
    is_sample INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- kind: id_proof, authorisation, business_proof, bank_proof, shop_photo.
CREATE TABLE buyer_verification_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL CHECK (kind IN ('id_proof', 'authorisation', 'business_proof', 'bank_proof', 'shop_photo')),
    doc_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    -- AES-256-GCM encrypted file (nonce || ciphertext). NULL once deleted.
    data_enc BLOB,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'deleted')),
    rejection_reason TEXT,
    masked_aadhaar_confirmed INTEGER NOT NULL DEFAULT 0,
    is_sample INTEGER NOT NULL DEFAULT 0,
    delete_after DATETIME,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at DATETIME
);
CREATE INDEX idx_bvd_buyer ON buyer_verification_documents(buyer_id, kind);

INSERT INTO buyer_verifications (buyer_id, level, status, business_name, decided_at)
SELECT b.id, 2, 'approved', u.name, CURRENT_TIMESTAMP
FROM buyers b JOIN users u ON u.id = b.id WHERE b.is_verified = 1;
