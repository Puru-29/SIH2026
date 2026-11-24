//! Phone OTP, buyer verification levels, encrypted documents and contacts.
//!
//! Levels: 0 Unverified (browse, post requirements) · 1 ID Verified (orders up to
//! `BASIC_BUYER_ORDER_LIMIT`) · 2 Verified Business (no limit). "Trusted Buyer" is
//! computed live from the rules in [`buyer_badge`], so it disappears by itself
//! as soon as a rule stops being met.
//!
//! Documents and the bank account number are encrypted with AES-256-GCM using
//! `DOC_ENCRYPTION_KEY`. Only the owner and admins can open documents; every admin
//! view is written to the audit log.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use axum::{
    extract::{Path, Query, State},
    http::header,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rand::{Rng, RngCore};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

use crate::{
    admin::{log, notify_typed},
    auth::AuthUser,
    errors::AppError,
};

type ApiResult<T> = Result<Json<T>, AppError>;

const MAX_DOC_BYTES: usize = 2 * 1024 * 1024;
const OTP_TTL_SECS: i64 = 300;
const OTP_RESEND_SECS: i64 = 30;
const OTP_MAX_ATTEMPTS: i64 = 5;
const REJECTED_RETENTION_DAYS: i64 = 30;

pub fn routes() -> Router<SqlitePool> {
    Router::new()
        .route("/api/me/phone/otp/send", post(otp_send))
        .route("/api/me/phone/otp/verify", post(otp_verify))
        .route(
            "/api/me/verification",
            get(my_verification).put(save_details),
        )
        .route("/api/me/verification/submit", post(submit))
        .route(
            "/api/me/verification/documents",
            post(upload_document).delete(delete_my_documents),
        )
        .route("/api/me/verification/documents/:id", get(my_document))
        .route("/api/buyers/:id/badge", get(badge_endpoint))
        .route("/api/transactions/:id/contact", get(order_contact))
        .route("/api/fpo-market/offers/:id/contact", get(fpo_offer_contact))
        .route("/api/admin/buyer-verifications", get(admin_queue))
        .route("/api/admin/buyer-verifications/:id", get(admin_detail))
        .route(
            "/api/admin/buyer-verifications/:id/grant",
            post(admin_grant),
        )
        .route(
            "/api/admin/buyer-verifications/:id/reject",
            post(admin_reject),
        )
        .route("/api/admin/buyer-documents/:id", get(admin_document))
        .route(
            "/api/admin/buyer-documents/:id/:action",
            post(admin_review_document),
        )
}

fn bad(msg: impl Into<String>) -> AppError {
    AppError::BadRequest(msg.into())
}
fn forbidden(msg: impl Into<String>) -> AppError {
    AppError::Forbidden(msg.into())
}
fn not_found(msg: impl Into<String>) -> AppError {
    AppError::NotFound(msg.into())
}
fn require_admin(user: &AuthUser) -> Result<(), AppError> {
    if user.role == "admin" {
        Ok(())
    } else {
        Err(forbidden("This is for AgriSense administrators only"))
    }
}
fn require_buyer(user: &AuthUser) -> Result<(), AppError> {
    if user.role == "buyer" {
        Ok(())
    } else {
        Err(forbidden("Buyer verification is for buyer accounts"))
    }
}

/* -------------------------------------------------------------------------- */
/*                               format checks                                */
/* -------------------------------------------------------------------------- */

fn all(s: &str, f: impl Fn(char) -> bool) -> bool {
    s.chars().all(f)
}
fn upper(c: char) -> bool {
    c.is_ascii_uppercase()
}
fn digit(c: char) -> bool {
    c.is_ascii_digit()
}

pub fn valid_pan(p: &str) -> bool {
    p.len() == 10 && all(&p[..5], upper) && all(&p[5..9], digit) && all(&p[9..], upper)
}

pub fn valid_ifsc(s: &str) -> bool {
    s.len() == 11
        && all(&s[..4], upper)
        && &s[4..5] == "0"
        && all(&s[5..], |c| upper(c) || digit(c))
}

pub fn valid_pincode(s: &str) -> bool {
    s.len() == 6 && all(s, digit) && !s.starts_with('0')
}

/// GSTIN: 2-digit state + PAN + entity + 'Z' + checksum (mod-36 Luhn variant).
pub fn valid_gstin(g: &str) -> bool {
    const CS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if g.len() != 15
        || !all(&g[..2], digit)
        || !valid_pan(&g[2..12])
        || &g[13..14] != "Z"
        || !all(g, |c| upper(c) || digit(c))
    {
        return false;
    }
    let mut sum = 0;
    for (i, b) in g.bytes().take(14).enumerate() {
        let v = CS.iter().position(|&c| c == b).unwrap_or(0);
        let p = v * if i % 2 == 0 { 1 } else { 2 };
        sum += p / 36 + p % 36;
    }
    CS[(36 - sum % 36) % 36] == g.as_bytes()[14]
}

/* -------------------------------------------------------------------------- */
/*                                 encryption                                 */
/* -------------------------------------------------------------------------- */

fn cipher() -> Result<Aes256Gcm, AppError> {
    let raw = std::env::var("DOC_ENCRYPTION_KEY").unwrap_or_default();
    let raw = raw.trim();
    let key: Vec<u8> = if raw.len() == 64 && raw.chars().all(|c| c.is_ascii_hexdigit()) {
        (0..32)
            .map(|i| u8::from_str_radix(&raw[i * 2..i * 2 + 2], 16).unwrap_or(0))
            .collect()
    } else {
        crate::fpo::decode_base64(raw).unwrap_or_default()
    };
    if key.len() != 32 {
        return Err(bad(
            "Document upload is switched off: the server has no DOC_ENCRYPTION_KEY (32 bytes, hex or base64). Contact the AgriSense admin.",
        ));
    }
    Aes256Gcm::new_from_slice(&key).map_err(|_| bad("Invalid DOC_ENCRYPTION_KEY"))
}

/// Returns nonce (12 bytes) || ciphertext.
pub fn encrypt(plain: &[u8]) -> Result<Vec<u8>, AppError> {
    let c = cipher()?;
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let mut out = nonce.to_vec();
    out.extend(
        c.encrypt(Nonce::from_slice(&nonce), plain)
            .map_err(|_| AppError::InternalServerError(anyhow::anyhow!("encryption failed")))?,
    );
    Ok(out)
}

pub fn decrypt(blob: &[u8]) -> Result<Vec<u8>, AppError> {
    if blob.len() < 12 {
        return Err(not_found("Document not found"));
    }
    cipher()?
        .decrypt(Nonce::from_slice(&blob[..12]), &blob[12..])
        .map_err(|_| AppError::InternalServerError(anyhow::anyhow!("decryption failed")))
}

/// Real file type from the bytes: PDF, JPEG, PNG or WEBP.
pub fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"%PDF-") {
        Some("application/pdf")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/* -------------------------------------------------------------------------- */
/*                                  phone OTP                                 */
/* -------------------------------------------------------------------------- */

/// Where OTP codes go. `OTP_MODE=fixed` (default) sends nothing; add a real SMS provider here.
pub trait SmsSender {
    fn send(&self, phone: &str, code: &str) -> Result<(), AppError>;
}

struct NoSms;
impl SmsSender for NoSms {
    fn send(&self, _phone: &str, _code: &str) -> Result<(), AppError> {
        Ok(())
    }
}

fn otp_fixed() -> Option<String> {
    let mode = std::env::var("OTP_MODE").unwrap_or_else(|_| "fixed".into());
    (mode == "fixed").then(|| std::env::var("OTP_FIXED_CODE").unwrap_or_else(|_| "123456".into()))
}

fn sender() -> Box<dyn SmsSender + Send + Sync> {
    Box::new(NoSms)
}

fn otp_hash(user_id: i64, code: &str) -> String {
    format!("{:x}", Sha256::digest(format!("{user_id}:{code}")))
}

async fn otp_send(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Value> {
    let phone: String = sqlx::query_scalar("SELECT phone_number FROM users WHERE id = ?")
        .bind(user.user_id)
        .fetch_one(&pool)
        .await?;
    let recent: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM phone_otps WHERE user_id = ? AND sent_at > datetime('now', ?)",
    )
    .bind(user.user_id)
    .bind(format!("-{OTP_RESEND_SECS} seconds"))
    .fetch_one(&pool)
    .await?;
    if recent > 0 {
        return Err(bad(format!(
            "Please wait {OTP_RESEND_SECS} seconds before asking for a new code"
        )));
    }
    let fixed = otp_fixed();
    let code = fixed
        .clone()
        .unwrap_or_else(|| format!("{:06}", rand::thread_rng().gen_range(0..1_000_000)));
    sqlx::query(
        "INSERT INTO phone_otps (user_id, code_hash, expires_at, attempts, sent_at)
         VALUES (?, ?, datetime('now', ?), 0, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash,
            expires_at = excluded.expires_at, attempts = 0, sent_at = CURRENT_TIMESTAMP",
    )
    .bind(user.user_id)
    .bind(otp_hash(user.user_id, &code))
    .bind(format!("+{OTP_TTL_SECS} seconds"))
    .execute(&pool)
    .await?;
    sender().send(&phone, &code)?;
    Ok(Json(json!({
        "sent_to": format!("XXXXXX{}", &phone[phone.len().saturating_sub(4)..]),
        "test_mode": fixed.is_some(),
        "test_code": fixed,
        "expires_in_seconds": OTP_TTL_SECS,
    })))
}

#[derive(Deserialize)]
struct OtpBody {
    code: String,
}

async fn otp_verify(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<OtpBody>,
) -> ApiResult<Value> {
    let row: Option<(String, i64, i64)> = sqlx::query_as(
        "SELECT code_hash, attempts, expires_at > datetime('now') FROM phone_otps WHERE user_id = ?",
    )
    .bind(user.user_id)
    .fetch_optional(&pool)
    .await?;
    let (hash, attempts, live) = row.ok_or_else(|| bad("Ask for a code first"))?;
    if live == 0 {
        return Err(bad("This code has expired. Ask for a new one."));
    }
    if attempts >= OTP_MAX_ATTEMPTS {
        return Err(bad("Too many wrong tries. Ask for a new code."));
    }
    if otp_hash(user.user_id, b.code.trim()) != hash {
        sqlx::query("UPDATE phone_otps SET attempts = attempts + 1 WHERE user_id = ?")
            .bind(user.user_id)
            .execute(&pool)
            .await?;
        let left = OTP_MAX_ATTEMPTS - attempts - 1;
        return Err(bad(format!("Wrong code. {left} tries left.")));
    }
    sqlx::query("DELETE FROM phone_otps WHERE user_id = ?")
        .bind(user.user_id)
        .execute(&pool)
        .await?;
    sqlx::query("UPDATE users SET phone_verified_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(user.user_id)
        .execute(&pool)
        .await?;
    Ok(Json(json!({ "phone_verified": true })))
}

/* -------------------------------------------------------------------------- */
/*                               levels & badges                              */
/* -------------------------------------------------------------------------- */

fn order_limit() -> f64 {
    std::env::var("BASIC_BUYER_ORDER_LIMIT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(200_000.0)
}

/// 0, 1 or 2. Buyers approved before levels existed (no application) count as Level 1.
pub async fn buyer_level(pool: &SqlitePool, buyer_id: i64) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT COALESCE(
            (SELECT level FROM buyer_verifications WHERE buyer_id = ?),
            (SELECT CASE WHEN is_verified = 1 THEN 1 ELSE 0 END FROM buyers WHERE id = ?), 0)",
    )
    .bind(buyer_id)
    .bind(buyer_id)
    .fetch_one(pool)
    .await?)
}

/// Enforced on every offer, counter and accept (farmer lots and FPO lots).
pub async fn require_buyer_can_trade(
    pool: &SqlitePool,
    buyer_id: i64,
    order_amount: f64,
) -> Result<(), AppError> {
    let level = buyer_level(pool, buyer_id).await?;
    if level == 0 {
        return Err(forbidden(
            "Your account is being verified — you can make offers once approved.",
        ));
    }
    let limit = order_limit();
    if level == 1 && order_amount > limit + 0.5 {
        return Err(forbidden(format!(
            "ID Verified buyers can place orders up to {} each. This order is {}. Complete business verification (Level 2) to remove the limit.",
            crate::market::rupees(limit),
            crate::market::rupees(order_amount)
        )));
    }
    Ok(())
}

/// Facts behind "Trusted Buyer".
pub struct TrustFacts {
    pub completed_deals: i64,
    pub late_payments: i64,
    pub rating: f64,
    pub lost_disputes_90d: i64,
}

/// Level 2 + ≥ 5 completed deals + no late/missed payments + rating ≥ 4 + no lost dispute in 90 days.
pub fn is_trusted(level: i64, f: &TrustFacts) -> bool {
    level >= 2
        && f.completed_deals >= 5
        && f.late_payments == 0
        && f.rating >= 4.0
        && f.lost_disputes_90d == 0
}

pub async fn trust_facts(pool: &SqlitePool, buyer_id: i64) -> Result<TrustFacts, AppError> {
    let completed_deals: i64 = sqlx::query_scalar(
        "SELECT
            (SELECT COUNT(*) FROM transactions t JOIN offers o ON o.id = t.offer_id
              WHERE o.buyer_id = ?1 AND (EXISTS (SELECT 1 FROM order_events e WHERE e.transaction_id = t.id AND e.status = 'delivered')
                   OR (t.status = 'completed' AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.transaction_id = t.id))))
          + (SELECT COUNT(*) FROM fpo_sales s WHERE s.buyer_id = ?1 AND s.delivery_status = 'delivered')",
    )
    .bind(buyer_id)
    .fetch_one(pool)
    .await?;
    // A farmer reporting a payment as not received counts as a late/missed payment.
    let late_payments: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM transaction_payments p JOIN transactions t ON t.id = p.transaction_id
         JOIN offers o ON o.id = t.offer_id WHERE o.buyer_id = ? AND p.status = 'not_received'
           AND p.created_at > datetime('now', '-90 days')",
    )
    .bind(buyer_id)
    .fetch_one(pool)
    .await?;
    let rating: f64 = sqlx::query_scalar(
        "SELECT CAST(COALESCE((SELECT trust_score FROM buyers WHERE id = ?), 0) AS REAL)",
    )
    .bind(buyer_id)
    .fetch_one(pool)
    .await?;
    // Lost = a dispute raised by the seller on this buyer's order that the admin resolved.
    let lost_disputes_90d: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM disputes d JOIN transactions t ON t.id = d.transaction_id
         JOIN offers o ON o.id = t.offer_id
         WHERE o.buyer_id = ? AND d.raised_by <> o.buyer_id AND d.status = 'resolved'
           AND COALESCE(d.resolved_at, d.created_at) > datetime('now', '-90 days')",
    )
    .bind(buyer_id)
    .fetch_one(pool)
    .await?;
    Ok(TrustFacts {
        completed_deals,
        late_payments,
        rating,
        lost_disputes_90d,
    })
}

/// `{ level, trusted, label, rank }` — rank sorts Trusted (3) > Verified Business (2) > ID Verified (1) > Unverified (0).
pub async fn buyer_badge(pool: &SqlitePool, buyer_id: i64) -> Result<Value, AppError> {
    let level = buyer_level(pool, buyer_id).await?;
    let trusted = level >= 2 && is_trusted(level, &trust_facts(pool, buyer_id).await?);
    let label = match (trusted, level) {
        (true, _) => "Trusted Buyer",
        (_, 2) => "Verified Business",
        (_, 1) => "ID Verified",
        _ => "Unverified",
    };
    Ok(
        json!({ "level": level, "trusted": trusted, "label": label, "rank": if trusted { 3 } else { level } }),
    )
}

async fn badge_endpoint(
    State(pool): State<SqlitePool>,
    _user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Value> {
    Ok(Json(buyer_badge(&pool, id).await?))
}

/* -------------------------------------------------------------------------- */
/*                                  contacts                                  */
/* -------------------------------------------------------------------------- */

/// Name, phone, verification and badges of one account. Only call this for the
/// two parties of a deal (or an admin).
pub async fn contact(pool: &SqlitePool, user_id: i64) -> Result<Value, AppError> {
    let (name, role, phone, verified): (String, String, String, Option<String>) = sqlx::query_as(
        "SELECT name, role, phone_number, phone_verified_at FROM users WHERE id = ?",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    let business: Option<String> = match role.as_str() {
        "buyer" => sqlx::query_scalar(
            "SELECT NULLIF(business_name, '') FROM buyer_verifications WHERE buyer_id = ?",
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await?
        .flatten(),
        "fpo" => {
            sqlx::query_scalar("SELECT name FROM fpo_organizations WHERE manager_user_id = ?")
                .bind(user_id)
                .fetch_optional(pool)
                .await?
        }
        _ => None,
    };
    let badge = if role == "buyer" {
        Some(buyer_badge(pool, user_id).await?)
    } else {
        None
    };
    Ok(json!({
        "id": user_id, "name": name, "role": role, "phone": phone,
        "phone_verified": verified.is_some(), "business_name": business, "badge": badge,
    }))
}

/// GET /api/transactions/:id/contact — the other party, for the two parties of the order.
async fn order_contact(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Value> {
    let (buyer, farmer): (i64, i64) = sqlx::query_as(
        "SELECT o.buyer_id, l.farmer_id FROM transactions t JOIN offers o ON o.id = t.offer_id
         JOIN lots l ON l.id = o.lot_id WHERE t.id = ?",
    )
    .bind(id)
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| not_found("Order not found"))?;
    let other = if user.user_id == buyer {
        farmer
    } else if user.user_id == farmer || user.role == "admin" {
        buyer
    } else {
        return Err(forbidden(
            "Contact details are only shared between the two parties of a deal",
        ));
    };
    Ok(Json(contact(&pool, other).await?))
}

/// GET /api/fpo-market/offers/:id/contact — buyer sees the FPO manager once the offer is accepted.
async fn fpo_offer_contact(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Value> {
    let (buyer, status, manager): (i64, String, i64) = sqlx::query_as(
        "SELECT f.buyer_id, f.status, o.manager_user_id FROM fpo_offers f
         JOIN fpo_organizations o ON o.id = f.fpo_id WHERE f.id = ?",
    )
    .bind(id)
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| not_found("Offer not found"))?;
    if user.user_id != buyer && user.role != "admin" {
        return Err(forbidden(
            "Contact details are only shared between the two parties of a deal",
        ));
    }
    if status != "accepted" {
        return Err(forbidden(
            "Contact details are shared once the offer is accepted",
        ));
    }
    Ok(Json(contact(&pool, manager).await?))
}

/* -------------------------------------------------------------------------- */
/*                            the buyer's application                         */
/* -------------------------------------------------------------------------- */

/// Documents expected for each business type (shown to buyer and admin).
pub fn expected_documents(business_type: &str) -> Value {
    let id_any = "PAN, Voter ID, Driving licence, Passport or masked Aadhaar";
    match business_type {
        "proprietorship" => json!({
            "id_proof": format!("Owner's ID: {id_any}"),
            "business_proof": "One of: GST certificate, Udyam, Shop & Establishment, APMC or FSSAI licence",
        }),
        "partnership" => json!({
            "id_proof": format!("A partner's ID: {id_any}"),
            "business_proof": "Partnership deed or LLP certificate, plus firm PAN",
        }),
        "company" => json!({
            "id_proof": format!("Authorised signatory's ID: {id_any}"),
            "authorisation": "Authorisation letter / board resolution for the signatory",
            "business_proof": "Certificate of incorporation, plus company PAN",
        }),
        _ => json!({
            "id_proof": id_any,
            "business_proof": "APMC trader licence, Udyam, or a 3-month bank statement",
        }),
    }
}

#[derive(sqlx::FromRow)]
struct App {
    level: i64,
    status: String,
    business_type: Option<String>,
    business_name: String,
    address: String,
    district: String,
    state: String,
    pincode: String,
    crops_bought: String,
    monthly_capacity_quintals: Option<f64>,
    gstin: Option<String>,
    pan: Option<String>,
    bank_holder_name: Option<String>,
    bank_ifsc: Option<String>,
    bank_account_last4: Option<String>,
    consent_at: Option<String>,
    submitted_at: Option<String>,
    admin_note: Option<String>,
    is_sample: i64,
}

const APP_COLS: &str =
    "level, status, business_type, business_name, address, district, state, pincode,
    crops_bought, monthly_capacity_quintals, gstin, pan, bank_holder_name, bank_ifsc,
    bank_account_last4, consent_at, submitted_at, admin_note, is_sample";

async fn load_app(pool: &SqlitePool, buyer_id: i64) -> Result<Option<App>, AppError> {
    Ok(sqlx::query_as::<_, App>(&format!(
        "SELECT {APP_COLS} FROM buyer_verifications WHERE buyer_id = ?"
    ))
    .bind(buyer_id)
    .fetch_optional(pool)
    .await?)
}

async fn documents(pool: &SqlitePool, buyer_id: i64) -> Result<Vec<Value>, AppError> {
    type Row = (
        i64,
        String,
        String,
        String,
        String,
        String,
        Option<String>,
        i64,
        i64,
    );
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT id, kind, doc_type, file_name, mime_type, status, rejection_reason, is_sample,
            masked_aadhaar_confirmed
         FROM buyer_verification_documents WHERE buyer_id = ? AND status <> 'deleted' ORDER BY id",
    )
    .bind(buyer_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.0, "kind": r.1, "doc_type": r.2, "file_name": r.3, "mime_type": r.4,
                "status": r.5, "rejection_reason": r.6, "is_sample": r.7 == 1,
                "masked_aadhaar_confirmed": r.8 == 1,
            })
        })
        .collect())
}

fn has_doc(docs: &[Value], kind: &str, approved_only: bool) -> bool {
    docs.iter().any(|d| {
        d["kind"] == kind
            && if approved_only {
                d["status"] == "approved"
            } else {
                d["status"] != "rejected"
            }
    })
}

/// What is still missing for Level 1 and Level 2. `approved_only` = admin view.
fn missing(
    app: Option<&App>,
    docs: &[Value],
    phone_ok: bool,
    approved_only: bool,
) -> (Vec<&'static str>, Vec<&'static str>) {
    let mut l1 = vec![];
    if !phone_ok {
        l1.push("Verify your phone number with OTP");
    }
    let filled = |s: &str| !s.trim().is_empty();
    match app {
        Some(a)
            if a.business_type.is_some()
                && filled(&a.business_name)
                && filled(&a.address)
                && filled(&a.crops_bought)
                && a.monthly_capacity_quintals.is_some() => {}
        _ => {
            l1.push("Business type, business/shop name, address, crops bought and monthly capacity")
        }
    }
    if !has_doc(docs, "id_proof", approved_only) {
        l1.push("One ID proof");
    }
    if app.and_then(|a| a.business_type.as_deref()) == Some("company")
        && !has_doc(docs, "authorisation", approved_only)
    {
        l1.push("Authorisation letter for the signatory");
    }
    let mut l2 = vec![];
    if !has_doc(docs, "business_proof", approved_only) {
        l2.push("Business proof for your business type");
    }
    match app {
        Some(a)
            if a.bank_holder_name.is_some()
                && a.bank_ifsc.is_some()
                && a.bank_account_last4.is_some() => {}
        _ => l2.push("Bank account holder name, account number and IFSC"),
    }
    if !has_doc(docs, "bank_proof", approved_only) {
        l2.push("Cancelled cheque or passbook page");
    }
    if !has_doc(docs, "shop_photo", approved_only) {
        l2.push("A live photo of your shop or warehouse");
    }
    (l1, l2)
}

fn norm(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

/// Flag when the bank account holder matches neither the buyer nor the business name.
fn holder_mismatch(holder: Option<&str>, person: &str, business: &str) -> bool {
    match holder {
        Some(h) if !h.trim().is_empty() => {
            let h = norm(h);
            let p = norm(person);
            let b = norm(business);
            !(h == p
                || (!b.is_empty() && h == b)
                || (!p.is_empty() && (h.contains(&p) || p.contains(&h))))
        }
        _ => false,
    }
}

async fn application_json(pool: &SqlitePool, buyer_id: i64) -> Result<Value, AppError> {
    let app = load_app(pool, buyer_id).await?;
    let docs = documents(pool, buyer_id).await?;
    let (name, phone_verified): (String, Option<String>) =
        sqlx::query_as("SELECT name, phone_verified_at FROM users WHERE id = ?")
            .bind(buyer_id)
            .fetch_one(pool)
            .await?;
    let (m1, m2) = missing(app.as_ref(), &docs, phone_verified.is_some(), false);
    let bt = app
        .as_ref()
        .and_then(|a| a.business_type.clone())
        .unwrap_or_else(|| "individual".into());
    Ok(json!({
        "buyer_id": buyer_id,
        "name": name,
        "phone_verified": phone_verified.is_some(),
        "badge": buyer_badge(pool, buyer_id).await?,
        "order_limit": order_limit(),
        "status": app.as_ref().map(|a| a.status.clone()).unwrap_or_else(|| "draft".into()),
        "details": app.as_ref().map(|a| json!({
            "business_type": a.business_type, "business_name": a.business_name, "address": a.address,
            "district": a.district, "state": a.state, "pincode": a.pincode, "crops_bought": a.crops_bought,
            "monthly_capacity_quintals": a.monthly_capacity_quintals, "gstin": a.gstin, "pan": a.pan,
            "gst_registered": a.gstin.is_some(),
            "bank_holder_name": a.bank_holder_name, "bank_ifsc": a.bank_ifsc,
            "bank_account_masked": a.bank_account_last4.as_ref().map(|l| format!("XXXXXX{l}")),
            "bank_holder_mismatch": holder_mismatch(a.bank_holder_name.as_deref(), &name, &a.business_name),
            "consent_at": a.consent_at, "submitted_at": a.submitted_at, "admin_note": a.admin_note,
            "is_sample": a.is_sample == 1, "level": a.level,
        })),
        "documents": docs,
        "missing_level1": m1,
        "missing_level2": m2,
        "expected_documents": expected_documents(&bt),
        "otp_test_code": otp_fixed(),
    }))
}

async fn my_verification(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Value> {
    require_buyer(&user)?;
    Ok(Json(application_json(&pool, user.user_id).await?))
}

#[derive(Deserialize)]
struct DetailsBody {
    business_type: String,
    business_name: String,
    address: String,
    district: Option<String>,
    state: Option<String>,
    pincode: String,
    crops_bought: String,
    monthly_capacity_quintals: f64,
    gstin: Option<String>,
    pan: Option<String>,
    bank_holder_name: Option<String>,
    bank_account: Option<String>,
    bank_account_confirm: Option<String>,
    bank_ifsc: Option<String>,
}

fn opt_upper(v: &Option<String>) -> Option<String> {
    v.as_deref()
        .map(|s| s.trim().to_uppercase().replace(' ', ""))
        .filter(|s| !s.is_empty())
}

fn text(v: &str, field: &str, min: usize, max: usize) -> Result<String, AppError> {
    let t = v.trim();
    let n = t.chars().count();
    if n < min {
        return Err(bad(format!("{field} is required")));
    }
    if n > max {
        return Err(bad(format!("{field} must be at most {max} characters")));
    }
    Ok(t.to_string())
}

/// PUT /api/me/verification — save business, ID and bank details (draft).
async fn save_details(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<DetailsBody>,
) -> ApiResult<Value> {
    require_buyer(&user)?;
    if !matches!(
        b.business_type.as_str(),
        "individual" | "proprietorship" | "partnership" | "company"
    ) {
        return Err(bad("Choose your business type"));
    }
    let name = text(&b.business_name, "Business or shop name", 2, 120)?;
    let address = text(&b.address, "Address", 5, 300)?;
    let crops = text(&b.crops_bought, "Crops you buy", 2, 300)?;
    let pincode = b.pincode.trim().to_string();
    if !valid_pincode(&pincode) {
        return Err(bad("Enter a valid 6-digit PIN code"));
    }
    if !(b.monthly_capacity_quintals.is_finite() && b.monthly_capacity_quintals > 0.0) {
        return Err(bad("Enter your monthly buying capacity in quintals"));
    }
    let gstin = opt_upper(&b.gstin);
    if gstin.as_deref().is_some_and(|g| !valid_gstin(g)) {
        return Err(bad(
            "This GSTIN is not valid. Check it, or leave it empty (GST is optional).",
        ));
    }
    let pan = opt_upper(&b.pan);
    if pan.as_deref().is_some_and(|p| !valid_pan(p)) {
        return Err(bad("PAN must look like ABCDE1234F"));
    }
    let ifsc = opt_upper(&b.bank_ifsc);
    if ifsc.as_deref().is_some_and(|i| !valid_ifsc(i)) {
        return Err(bad("IFSC must look like SBIN0001234"));
    }
    let account = b
        .bank_account
        .as_deref()
        .map(|a| a.replace(' ', ""))
        .filter(|a| !a.is_empty());
    let (account_enc, last4) = match &account {
        Some(a) => {
            if !(9..=18).contains(&a.len()) || !a.chars().all(|c| c.is_ascii_digit()) {
                return Err(bad("Bank account number must be 9 to 18 digits"));
            }
            if b.bank_account_confirm
                .as_deref()
                .map(|c| c.replace(' ', ""))
                != Some(a.clone())
            {
                return Err(bad("The two bank account numbers do not match"));
            }
            if ifsc.is_none() {
                return Err(bad("Enter the IFSC for this bank account"));
            }
            (
                Some(encrypt(a.as_bytes())?),
                Some(a[a.len() - 4..].to_string()),
            )
        }
        None => (None, None),
    };
    let holder = b
        .bank_holder_name
        .as_deref()
        .map(str::trim)
        .filter(|h| !h.is_empty())
        .map(str::to_string);
    sqlx::query(
        "INSERT INTO buyer_verifications (buyer_id, business_type, business_name, address, district, state,
            pincode, crops_bought, monthly_capacity_quintals, gstin, pan, bank_holder_name, bank_ifsc,
            bank_account_enc, bank_account_last4, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(buyer_id) DO UPDATE SET business_type = excluded.business_type,
            business_name = excluded.business_name, address = excluded.address,
            district = excluded.district, state = excluded.state, pincode = excluded.pincode,
            crops_bought = excluded.crops_bought,
            monthly_capacity_quintals = excluded.monthly_capacity_quintals,
            gstin = excluded.gstin, pan = excluded.pan,
            bank_holder_name = COALESCE(excluded.bank_holder_name, bank_holder_name),
            bank_ifsc = COALESCE(excluded.bank_ifsc, bank_ifsc),
            bank_account_enc = COALESCE(excluded.bank_account_enc, bank_account_enc),
            bank_account_last4 = COALESCE(excluded.bank_account_last4, bank_account_last4),
            updated_at = CURRENT_TIMESTAMP",
    )
    .bind(user.user_id)
    .bind(&b.business_type)
    .bind(&name)
    .bind(&address)
    .bind(b.district.as_deref().unwrap_or("").trim())
    .bind(b.state.as_deref().unwrap_or("").trim())
    .bind(&pincode)
    .bind(&crops)
    .bind(b.monthly_capacity_quintals)
    .bind(&gstin)
    .bind(&pan)
    .bind(&holder)
    .bind(&ifsc)
    .bind(&account_enc)
    .bind(&last4)
    .execute(&pool)
    .await?;
    Ok(Json(application_json(&pool, user.user_id).await?))
}

#[derive(Deserialize)]
struct UploadBody {
    kind: String,
    doc_type: String,
    file_name: Option<String>,
    data_base64: String,
    masked_aadhaar_confirmed: Option<bool>,
}

/// POST /api/me/verification/documents — one file; replaces an earlier upload of the same kind.
async fn upload_document(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<UploadBody>,
) -> ApiResult<Value> {
    require_buyer(&user)?;
    if !matches!(
        b.kind.as_str(),
        "id_proof" | "authorisation" | "business_proof" | "bank_proof" | "shop_photo"
    ) {
        return Err(bad("Unknown document kind"));
    }
    let doc_type = text(&b.doc_type, "Document type", 2, 60)?;
    let lower = doc_type.to_lowercase();
    if lower.contains("aadhaar") && !b.masked_aadhaar_confirmed.unwrap_or(false) {
        return Err(bad(
            "Upload only a masked Aadhaar (just the last 4 digits visible) and tick the box to confirm.",
        ));
    }
    let bytes = crate::fpo::decode_base64(&b.data_base64)
        .ok_or_else(|| bad("The file could not be read"))?;
    if bytes.len() > MAX_DOC_BYTES {
        return Err(bad("Files must be 2 MB or smaller"));
    }
    let mime = sniff(&bytes).ok_or_else(|| bad("Upload a PDF, JPG, PNG or WEBP file"))?;
    if b.kind == "shop_photo" {
        // Must come from the live camera, like crop photos.
        crate::quality::check_photo(&crate::quality::PhotoIn {
            data_base64: b.data_base64.clone(),
            latitude: None,
            longitude: None,
        })?;
    }
    let enc = encrypt(&bytes)?;
    let file_name = b
        .file_name
        .as_deref()
        .map(|f| {
            f.chars()
                .filter(|c| !c.is_control())
                .take(120)
                .collect::<String>()
        })
        .filter(|f| !f.trim().is_empty())
        .unwrap_or_else(|| format!("{}.{}", b.kind, mime.rsplit('/').next().unwrap_or("bin")));
    let mut tx = pool.begin().await?;
    // Earlier pending/rejected copies of this kind are wiped.
    sqlx::query(
        "UPDATE buyer_verification_documents SET status = 'deleted', data_enc = NULL
         WHERE buyer_id = ? AND kind = ? AND status IN ('pending', 'rejected')",
    )
    .bind(user.user_id)
    .bind(&b.kind)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO buyer_verifications (buyer_id) VALUES (?) ON CONFLICT(buyer_id) DO NOTHING",
    )
    .bind(user.user_id)
    .execute(&mut *tx)
    .await?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO buyer_verification_documents (buyer_id, kind, doc_type, file_name, mime_type, data_enc,
            masked_aadhaar_confirmed) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(user.user_id)
    .bind(&b.kind)
    .bind(&doc_type)
    .bind(&file_name)
    .bind(mime)
    .bind(&enc)
    .bind(b.masked_aadhaar_confirmed.unwrap_or(false) as i64)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": id, "mime_type": mime })))
}

fn file_response(mime: String, name: String, bytes: Vec<u8>) -> Response {
    (
        [
            (header::CONTENT_TYPE, mime),
            (header::CACHE_CONTROL, "no-store".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("inline; filename=\"{}\"", name.replace('"', "")),
            ),
        ],
        bytes,
    )
        .into_response()
}

async fn load_document(
    pool: &SqlitePool,
    id: i64,
) -> Result<(i64, String, String, Vec<u8>), AppError> {
    let row: Option<(i64, String, String, Option<Vec<u8>>)> = sqlx::query_as(
        "SELECT buyer_id, mime_type, file_name, data_enc FROM buyer_verification_documents WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    let (owner, mime, name, data) = row.ok_or_else(|| not_found("Document not found"))?;
    let data = data.ok_or_else(|| not_found("This document was deleted"))?;
    Ok((owner, mime, name, decrypt(&data)?))
}

/// GET /api/me/verification/documents/:id — owner only.
async fn my_document(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> Result<Response, AppError> {
    let owner: i64 =
        sqlx::query_scalar("SELECT buyer_id FROM buyer_verification_documents WHERE id = ?")
            .bind(id)
            .fetch_optional(&pool)
            .await?
            .ok_or_else(|| not_found("Document not found"))?;
    if owner != user.user_id {
        return Err(forbidden("You can only open your own documents"));
    }
    let (_, mime, name, bytes) = load_document(&pool, id).await?;
    Ok(file_response(mime, name, bytes))
}

/// DELETE /api/me/verification/documents — wipe all my uploaded files.
async fn delete_my_documents(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Value> {
    require_buyer(&user)?;
    let done = sqlx::query(
        "UPDATE buyer_verification_documents SET status = 'deleted', data_enc = NULL
         WHERE buyer_id = ? AND status <> 'deleted'",
    )
    .bind(user.user_id)
    .execute(&pool)
    .await?;
    sqlx::query("UPDATE buyer_verifications SET bank_account_enc = NULL WHERE buyer_id = ?")
        .bind(user.user_id)
        .execute(&pool)
        .await?;
    Ok(Json(json!({ "deleted": done.rows_affected() })))
}

#[derive(Deserialize)]
struct SubmitBody {
    consent: bool,
}

/// POST /api/me/verification/submit — send for admin review (consent required).
async fn submit(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<SubmitBody>,
) -> ApiResult<Value> {
    require_buyer(&user)?;
    if !b.consent {
        return Err(bad(
            "Tick the consent box to let AgriSense store and check your documents",
        ));
    }
    let app = load_app(&pool, user.user_id).await?;
    let docs = documents(&pool, user.user_id).await?;
    let phone: Option<String> =
        sqlx::query_scalar("SELECT phone_verified_at FROM users WHERE id = ?")
            .bind(user.user_id)
            .fetch_one(&pool)
            .await?;
    let (m1, _) = missing(app.as_ref(), &docs, phone.is_some(), false);
    if !m1.is_empty() {
        return Err(bad(format!("Still needed: {}", m1.join("; "))));
    }
    sqlx::query(
        "UPDATE buyer_verifications SET status = 'submitted', consent_at = CURRENT_TIMESTAMP,
            submitted_at = CURRENT_TIMESTAMP WHERE buyer_id = ?",
    )
    .bind(user.user_id)
    .execute(&pool)
    .await?;
    let admins: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM users WHERE role = 'admin' AND status = 'active'")
            .fetch_all(&pool)
            .await?;
    for a in admins {
        notify_typed(
            &pool,
            a,
            "admin",
            &format!("Buyer verification: {}", user.name),
            "A buyer sent documents for review.",
            Some("/admin/verification"),
        )
        .await?;
    }
    Ok(Json(application_json(&pool, user.user_id).await?))
}

/* -------------------------------------------------------------------------- */
/*                                    admin                                   */
/* -------------------------------------------------------------------------- */

/// Rejected documents are wiped once their 30 days are up.
pub async fn purge_expired(pool: &SqlitePool) -> Result<u64, AppError> {
    Ok(sqlx::query(
        "UPDATE buyer_verification_documents SET status = 'deleted', data_enc = NULL
         WHERE status = 'rejected' AND delete_after IS NOT NULL AND delete_after <= datetime('now')",
    )
    .execute(pool)
    .await?
    .rows_affected())
}

#[derive(Deserialize)]
struct QueueQuery {
    status: Option<String>,
}

async fn admin_queue(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Query(q): Query<QueueQuery>,
) -> ApiResult<Vec<Value>> {
    require_admin(&user)?;
    purge_expired(&pool).await?;
    let status = q.status.unwrap_or_default();
    type Row = (
        i64,
        String,
        String,
        Option<String>,
        String,
        i64,
        String,
        Option<String>,
        i64,
        i64,
    );
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT u.id, u.name, u.phone_number, u.phone_verified_at, COALESCE(v.status, 'draft'),
            COALESCE(v.level, 0), COALESCE(v.business_name, ''), v.submitted_at,
            (SELECT COUNT(*) FROM buyer_verification_documents d WHERE d.buyer_id = u.id AND d.status = 'pending'),
            COALESCE(v.is_sample, 0)
         FROM users u LEFT JOIN buyer_verifications v ON v.buyer_id = u.id
         WHERE u.role = 'buyer' AND (? = '' OR COALESCE(v.status, 'draft') = ?)
         ORDER BY COALESCE(v.status, 'draft') = 'submitted' DESC, v.submitted_at DESC, u.id DESC LIMIT 300",
    )
    .bind(&status)
    .bind(&status)
    .fetch_all(&pool)
    .await?;
    let mut out = vec![];
    for r in rows {
        out.push(json!({
            "buyer_id": r.0, "name": r.1, "phone": r.2, "phone_verified": r.3.is_some(),
            "status": r.4, "level": r.5, "business_name": r.6, "submitted_at": r.7,
            "pending_documents": r.8, "is_sample": r.9 == 1,
            "badge": buyer_badge(&pool, r.0).await?,
        }));
    }
    Ok(Json(out))
}

async fn admin_detail(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let is_buyer: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE id = ? AND role = 'buyer'")
            .bind(id)
            .fetch_one(&pool)
            .await?;
    if is_buyer == 0 {
        return Err(not_found("Buyer not found"));
    }
    let mut v = application_json(&pool, id).await?;
    let app = load_app(&pool, id).await?;
    let docs = documents(&pool, id).await?;
    let phone_ok = v["phone_verified"].as_bool().unwrap_or(false);
    let (m1, m2) = missing(app.as_ref(), &docs, phone_ok, true);
    v["missing_level1_approved"] = json!(m1);
    v["missing_level2_approved"] = json!(m2);
    let f = trust_facts(&pool, id).await?;
    v["trust_facts"] = json!({
        "completed_deals": f.completed_deals, "late_payments": f.late_payments,
        "rating": f.rating, "lost_disputes_90d": f.lost_disputes_90d,
    });
    v["phone"] = json!(
        sqlx::query_scalar::<_, String>("SELECT phone_number FROM users WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await?
    );
    Ok(Json(v))
}

/// GET /api/admin/buyer-documents/:id — every view is audited.
async fn admin_document(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> Result<Response, AppError> {
    require_admin(&user)?;
    let (owner, mime, name, bytes) = load_document(&pool, id).await?;
    log(
        &pool,
        user.user_id,
        "buyer_document.view",
        "buyer_document",
        Some(id),
        json!({ "buyer_id": owner }),
    )
    .await?;
    Ok(file_response(mime, name, bytes))
}

#[derive(Deserialize, Default)]
struct ReasonBody {
    reason: Option<String>,
    note: Option<String>,
    level: Option<i64>,
}

/// POST /api/admin/buyer-documents/:id/approve|reject
async fn admin_review_document(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path((id, action)): Path<(i64, String)>,
    body: Option<Json<ReasonBody>>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let b = body.map(|Json(b)| b).unwrap_or_default();
    let (owner, doc_type, kind): (i64, String, String) = sqlx::query_as(
        "SELECT buyer_id, doc_type, kind FROM buyer_verification_documents WHERE id = ? AND status <> 'deleted'",
    )
    .bind(id)
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| not_found("Document not found"))?;
    let mut tx = pool.begin().await?;
    match action.as_str() {
        "approve" => {
            sqlx::query(
                "UPDATE buyer_verification_documents SET status = 'approved', rejection_reason = NULL,
                    delete_after = NULL, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?",
            )
            .bind(user.user_id)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        }
        "reject" => {
            let reason = text(b.reason.as_deref().unwrap_or(""), "Reason", 5, 300)?;
            // Aadhaar copies are deleted at once; other rejected files after 30 days.
            let aadhaar = doc_type.to_lowercase().contains("aadhaar");
            sqlx::query(
                "UPDATE buyer_verification_documents SET status = 'rejected', rejection_reason = ?,
                    reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP,
                    data_enc = CASE WHEN ? THEN NULL ELSE data_enc END,
                    delete_after = datetime('now', ?) WHERE id = ?",
            )
            .bind(&reason)
            .bind(user.user_id)
            .bind(aadhaar)
            .bind(format!("+{REJECTED_RETENTION_DAYS} days"))
            .bind(id)
            .execute(&mut *tx)
            .await?;
            notify_typed(
                &mut *tx,
                owner,
                "admin",
                &format!("{doc_type} needs a new upload"),
                &reason,
                Some("/verification"),
            )
            .await?;
        }
        _ => return Err(bad("Action must be approve or reject")),
    }
    log(
        &mut *tx,
        user.user_id,
        &format!("buyer_document.{action}"),
        "buyer_document",
        Some(id),
        json!({ "buyer_id": owner, "kind": kind, "doc_type": doc_type, "reason": b.reason }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": id, "status": action })))
}

/// POST /api/admin/buyer-verifications/:id/grant `{ level: 1 | 2, note? }`
async fn admin_grant(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<ReasonBody>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let level = b.level.unwrap_or(1);
    if !(1..=2).contains(&level) {
        return Err(bad("Level must be 1 or 2"));
    }
    let app = load_app(&pool, id).await?;
    let docs = documents(&pool, id).await?;
    let phone: Option<String> =
        sqlx::query_scalar("SELECT phone_verified_at FROM users WHERE id = ? AND role = 'buyer'")
            .bind(id)
            .fetch_optional(&pool)
            .await?
            .ok_or_else(|| not_found("Buyer not found"))?;
    let (m1, m2) = missing(app.as_ref(), &docs, phone.is_some(), true);
    let blocking: Vec<&str> = if level == 1 {
        m1
    } else {
        m1.into_iter().chain(m2).collect()
    };
    if !blocking.is_empty() {
        return Err(bad(format!("Approve these first: {}", blocking.join("; "))));
    }
    let note = b.note.as_deref().unwrap_or("").trim().to_string();
    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE buyer_verifications SET level = ?, status = 'approved', admin_note = NULLIF(?, ''),
            decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE buyer_id = ?",
    )
    .bind(level)
    .bind(&note)
    .bind(user.user_id)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO buyers (id, trust_score, is_verified) VALUES (?, 5.0, 1)
         ON CONFLICT(id) DO UPDATE SET is_verified = 1, verification_note = NULL",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    let (title, msg) = if level == 2 {
        (
            "You are a Verified Business",
            "Your business is verified. There is no order limit any more.".to_string(),
        )
    } else {
        (
            "Your ID is verified",
            format!(
                "You can now make offers up to {} per order. Add business and bank proof to remove the limit.",
                crate::market::rupees(order_limit())
            ),
        )
    };
    notify_typed(&mut *tx, id, "admin", title, &msg, Some("/verification")).await?;
    log(
        &mut *tx,
        user.user_id,
        &format!("buyer.grant_level{level}"),
        "user",
        Some(id),
        json!({ "note": note }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "buyer_id": id, "level": level })))
}

/// POST /api/admin/buyer-verifications/:id/reject `{ reason }` — send the application back.
async fn admin_reject(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<ReasonBody>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let reason = text(b.reason.as_deref().unwrap_or(""), "Reason", 5, 500)?;
    let mut tx = pool.begin().await?;
    let done = sqlx::query(
        "UPDATE buyer_verifications SET status = 'rejected', admin_note = ?, decided_by = ?,
            decided_at = CURRENT_TIMESTAMP WHERE buyer_id = ?",
    )
    .bind(&reason)
    .bind(user.user_id)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    if done.rows_affected() == 0 {
        return Err(not_found("No application from this buyer"));
    }
    notify_typed(
        &mut *tx,
        id,
        "admin",
        "Verification needs changes",
        &reason,
        Some("/verification"),
    )
    .await?;
    log(
        &mut *tx,
        user.user_id,
        "buyer.verification_reject",
        "user",
        Some(id),
        json!({ "reason": reason }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "buyer_id": id, "status": "rejected" })))
}

/* -------------------------------------------------------------------------- */
/*                                sample data                                 */
/* -------------------------------------------------------------------------- */

/// Sample buyers at each level and one pending application (SAMPLE documents,
/// fake IDs). Also gives buyers approved before levels existed Level 2. Idempotent.
pub async fn ensure_samples(pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::query(
        "INSERT OR IGNORE INTO buyer_verifications (buyer_id, level, status, business_name, decided_at)
         SELECT b.id, 2, 'approved', u.name, CURRENT_TIMESTAMP FROM buyers b JOIN users u ON u.id = b.id
         WHERE b.is_verified = 1",
    )
    .execute(pool)
    .await?;
    let samples: [(&str, &str, i64, &str); 3] = [
        ("Shree Ganesh Traders", "9123450001", 1, "approved"),
        ("Annadata Fresh Foods Pvt Ltd", "9123450002", 2, "approved"),
        ("Kisan Wholesale Mart", "9123450003", 0, "submitted"),
    ];
    for (phone, name) in [
        ("9123450001", "Shree Ganesh Traders"),
        ("9123450002", "Annadata Fresh Foods Pvt Ltd"),
        ("9123450003", "Kisan Wholesale Mart"),
    ] {
        sqlx::query("UPDATE users SET name = ? WHERE phone_number = ? AND name LIKE 'Sample %'")
            .bind(name)
            .bind(phone)
            .execute(pool)
            .await?;
        sqlx::query(
            "UPDATE buyer_verifications SET business_name = ?
             WHERE business_name LIKE 'Sample %' AND buyer_id = (SELECT id FROM users WHERE phone_number = ?)",
        )
        .bind(name)
        .bind(phone)
        .execute(pool)
        .await?;
    }
    sqlx::query(
        "UPDATE buyer_verification_documents SET doc_type = REPLACE(doc_type, ' (SAMPLE)', ''),
            file_name = REPLACE(file_name, 'SAMPLE-', '') WHERE is_sample = 1",
    )
    .execute(pool)
    .await?;
    let can_encrypt = cipher().is_ok();
    for (name, phone, level, status) in samples {
        let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE phone_number = ?")
            .bind(phone)
            .fetch_one(pool)
            .await?;
        if exists > 0 {
            continue;
        }
        let mut tx = pool.begin().await?;
        let uid: i64 = sqlx::query_scalar(
            "INSERT INTO users (name, role, phone_number, pin_hash, status, phone_verified_at)
             VALUES (?, 'buyer', ?, ?, 'active', CURRENT_TIMESTAMP) RETURNING id",
        )
        .bind(name)
        .bind(phone)
        .bind(crate::auth::hash_pin("1234"))
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query("INSERT INTO buyers (id, trust_score, is_verified, location) VALUES (?, 4.5, ?, 'Delhi')")
            .bind(uid)
            .bind((level >= 1) as i64)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "INSERT INTO buyer_verifications (buyer_id, level, status, business_type, business_name, address,
                district, state, pincode, crops_bought, monthly_capacity_quintals, pan, bank_holder_name,
                bank_ifsc, bank_account_last4, consent_at, submitted_at, is_sample)
             VALUES (?, ?, ?, ?, ?, 'Shop 12, Azadpur Mandi', 'North West Delhi', 'Delhi', '110033',
                'Onion, Potato, Tomato', 500, 'ABCDE1234F', ?, 'SBIN0001234', '1234',
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)",
        )
        .bind(uid)
        .bind(level)
        .bind(status)
        .bind(if level == 2 { "company" } else { "proprietorship" })
        .bind(name)
        .bind(name)
        .execute(&mut *tx)
        .await?;
        if can_encrypt {
            let kinds: &[(&str, &str)] = match level {
                2 => &[
                    ("id_proof", "PAN card"),
                    ("authorisation", "Board resolution"),
                    ("business_proof", "Certificate of incorporation"),
                    ("bank_proof", "Cancelled cheque"),
                ],
                _ => &[("id_proof", "PAN card")],
            };
            for (kind, doc_type) in kinds {
                let pdf = format!("%PDF-1.4\n% {doc_type} - {name}\n%%EOF\n");
                sqlx::query(
                    "INSERT INTO buyer_verification_documents (buyer_id, kind, doc_type, file_name, mime_type,
                        data_enc, status, is_sample) VALUES (?, ?, ?, ?, 'application/pdf', ?, ?, 1)",
                )
                .bind(uid)
                .bind(kind)
                .bind(doc_type.to_string())
                .bind(format!("{kind}.pdf"))
                .bind(encrypt(pdf.as_bytes())?)
                .bind(if level >= 1 { "approved" } else { "pending" })
                .execute(&mut *tx)
                .await?;
            }
        }
        tx.commit().await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;

    fn status<T>(r: Result<T, AppError>) -> u16 {
        match r {
            Ok(_) => 200,
            Err(e) => e.into_response().status().as_u16(),
        }
    }

    fn who(id: i64, role: &str) -> AuthUser {
        AuthUser {
            user_id: id,
            role: role.into(),
            status: "active".into(),
            name: format!("{role}{id}"),
        }
    }

    fn code(c: &str) -> Json<OtpBody> {
        Json(OtpBody { code: c.into() })
    }

    fn pdf_upload(doc_type: &str, confirmed: Option<bool>) -> Json<UploadBody> {
        Json(UploadBody {
            kind: "id_proof".into(),
            doc_type: doc_type.into(),
            file_name: Some("pan.pdf".into()),
            data_base64: crate::quality::tests_b64(b"%PDF-1.4 PAN ABCDE1234F secret"),
            masked_aadhaar_confirmed: confirmed,
        })
    }

    #[tokio::test]
    async fn otp_limits_documents_and_contacts() {
        std::env::set_var("DOC_ENCRYPTION_KEY", "11".repeat(32));
        std::env::remove_var("OTP_MODE");
        std::env::remove_var("BASIC_BUYER_ORDER_LIMIT");
        let opts = SqliteConnectOptions::from_str("sqlite::memory:")
            .unwrap()
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let mut ids = vec![];
        for (role, phone) in [
            ("buyer", "9000000501"),
            ("buyer", "9000000502"),
            ("farmer", "9000000503"),
        ] {
            ids.push(
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO users (name, role, phone_number, status) VALUES ('U', ?, ?, 'active') RETURNING id",
                )
                .bind(role)
                .bind(phone)
                .fetch_one(&pool)
                .await
                .unwrap(),
            );
        }
        let (a, b, f) = (ids[0], ids[1], ids[2]);
        for id in [a, b] {
            sqlx::query("INSERT INTO buyers (id, trust_score, is_verified) VALUES (?, 5, 0)")
                .bind(id)
                .execute(&pool)
                .await
                .unwrap();
        }
        let st = || State(pool.clone());

        // OTP: 5 wrong codes block it, resend is rate-limited, the right code verifies, expiry works.
        let _ = otp_send(st(), who(a, "buyer")).await.unwrap();
        assert_eq!(status(otp_send(st(), who(a, "buyer")).await), 400);
        for _ in 0..5 {
            assert_eq!(
                status(otp_verify(st(), who(a, "buyer"), code("000000")).await),
                400
            );
        }
        assert_eq!(
            status(otp_verify(st(), who(a, "buyer"), code("123456")).await),
            400
        );
        sqlx::query(
            "UPDATE phone_otps SET sent_at = datetime('now', '-1 minute') WHERE user_id = ?",
        )
        .bind(a)
        .execute(&pool)
        .await
        .unwrap();
        let _ = otp_send(st(), who(a, "buyer")).await.unwrap();
        let _ = otp_verify(st(), who(a, "buyer"), code("123456"))
            .await
            .unwrap();
        let _ = otp_send(st(), who(b, "buyer")).await.unwrap();
        sqlx::query(
            "UPDATE phone_otps SET expires_at = datetime('now', '-1 second') WHERE user_id = ?",
        )
        .bind(b)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            status(otp_verify(st(), who(b, "buyer"), code("123456")).await),
            400
        );

        // Offer limits per level.
        assert_eq!(status(require_buyer_can_trade(&pool, a, 1000.0).await), 403);
        sqlx::query("INSERT INTO buyer_verifications (buyer_id, level) VALUES (?, 1)")
            .bind(a)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            status(require_buyer_can_trade(&pool, a, 150_000.0).await),
            200
        );
        assert_eq!(
            status(require_buyer_can_trade(&pool, a, 300_000.0).await),
            403
        );
        sqlx::query("UPDATE buyer_verifications SET level = 2 WHERE buyer_id = ?")
            .bind(a)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            status(require_buyer_can_trade(&pool, a, 300_000.0).await),
            200
        );

        // Documents are stored encrypted and only the owner (or an admin) can open them.
        let doc = upload_document(st(), who(a, "buyer"), pdf_upload("PAN card", None))
            .await
            .unwrap()
            .0["id"]
            .as_i64()
            .unwrap();
        let stored: Vec<u8> =
            sqlx::query_scalar("SELECT data_enc FROM buyer_verification_documents WHERE id = ?")
                .bind(doc)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(!stored.windows(10).any(|w| w == b"ABCDE1234F"));
        assert_eq!(
            status(my_document(st(), who(b, "buyer"), Path(doc)).await),
            403
        );
        assert_eq!(
            status(my_document(st(), who(a, "buyer"), Path(doc)).await),
            200
        );
        assert_eq!(
            status(admin_document(st(), who(f, "farmer"), Path(doc)).await),
            403
        );
        // Aadhaar without the masked confirmation is refused.
        let aadhaar =
            upload_document(st(), who(a, "buyer"), pdf_upload("Aadhaar", Some(false))).await;
        assert_eq!(status(aadhaar), 400);

        // Phone numbers: visible only to the two parties of the deal.
        sqlx::query("INSERT INTO farmers (id, location, urgency_level) VALUES (?, 'Ludhiana, Punjab', 'medium')")
            .bind(f)
            .execute(&pool)
            .await
            .unwrap();
        let lot: i64 = sqlx::query_scalar(
            "INSERT INTO lots (farmer_id, crop_id, quantity_quintals, expected_quality, status)
             VALUES (?, 1, 10, 'Grade A', 'sold') RETURNING id",
        )
        .bind(f)
        .fetch_one(&pool)
        .await
        .unwrap();
        let offer: i64 = sqlx::query_scalar(
            "INSERT INTO offers (lot_id, buyer_id, price_offered, status) VALUES (?, ?, 2000, 'accepted') RETURNING id",
        )
        .bind(lot)
        .bind(a)
        .fetch_one(&pool)
        .await
        .unwrap();
        let tx: i64 = sqlx::query_scalar(
            "INSERT INTO transactions (offer_id, final_price, status) VALUES (?, 2000, 'accepted') RETURNING id",
        )
        .bind(offer)
        .fetch_one(&pool)
        .await
        .unwrap();
        let seen = order_contact(st(), who(a, "buyer"), Path(tx))
            .await
            .unwrap()
            .0;
        assert_eq!(seen["phone"], "9000000503");
        let seen = order_contact(st(), who(f, "farmer"), Path(tx))
            .await
            .unwrap()
            .0;
        assert_eq!(seen["phone"], "9000000501");
        assert_eq!(seen["phone_verified"], true);
        assert_eq!(
            status(order_contact(st(), who(b, "buyer"), Path(tx)).await),
            403
        );
    }

    #[test]
    fn formats() {
        assert!(valid_pan("ABCDE1234F"));
        assert!(!valid_pan("ABCD1234F"));
        assert!(valid_ifsc("SBIN0001234"));
        assert!(!valid_ifsc("SBIN1001234"));
        assert!(valid_pincode("110033"));
        assert!(!valid_pincode("010033"));
        // Real-format GSTIN with a correct checksum, and the same with a wrong one.
        assert!(valid_gstin("27AAPFU0939F1ZV"));
        assert!(!valid_gstin("27AAPFU0939F1ZX"));
    }

    #[test]
    fn trusted_needs_every_rule() {
        let good = TrustFacts {
            completed_deals: 5,
            late_payments: 0,
            rating: 4.2,
            lost_disputes_90d: 0,
        };
        assert!(is_trusted(2, &good));
        assert!(!is_trusted(1, &good));
        assert!(!is_trusted(
            2,
            &TrustFacts {
                completed_deals: 4,
                ..good
            }
        ));
        assert!(!is_trusted(
            2,
            &TrustFacts {
                late_payments: 1,
                ..good
            }
        ));
        assert!(!is_trusted(
            2,
            &TrustFacts {
                rating: 3.9,
                ..good
            }
        ));
        assert!(!is_trusted(
            2,
            &TrustFacts {
                lost_disputes_90d: 1,
                ..good
            }
        ));
    }

    #[test]
    fn files_are_encrypted_and_typed_from_bytes() {
        std::env::set_var("DOC_ENCRYPTION_KEY", "11".repeat(32));
        let plain = b"%PDF-1.4 secret PAN ABCDE1234F";
        let enc = encrypt(plain).unwrap();
        assert!(!enc.windows(10).any(|w| w == b"ABCDE1234F"));
        assert_eq!(decrypt(&enc).unwrap(), plain);
        assert_eq!(sniff(plain), Some("application/pdf"));
        assert_eq!(sniff(b"MZ\x90\x00 exe"), None);
    }

    #[test]
    fn holder_name_mismatch() {
        assert!(!holder_mismatch(
            Some("Ravi Kumar"),
            "Ravi Kumar",
            "RK Traders"
        ));
        assert!(!holder_mismatch(
            Some("RK TRADERS"),
            "Ravi Kumar",
            "RK Traders"
        ));
        assert!(holder_mismatch(
            Some("Someone Else"),
            "Ravi Kumar",
            "RK Traders"
        ));
    }
}
