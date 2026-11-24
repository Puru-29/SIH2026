//! FPO (Farmer Producer Organisation) portal API.
//!
//! Roles:
//!   * `fpo`    — FPO manager: runs members, contributions, bulk lots, quality,
//!     offers, sales, payments, payouts, logistics and grievances.
//!   * `buyer`  — sees FPO bulk lots, makes and negotiates offers.
//!   * `farmer` — sees own FPO membership, contributions, payouts; raises grievances.
//!   * `admin`  — verifies FPO organisations and buyers.
//!
//! Every manager query is scoped by the manager's own `fpo_id`.

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    http::header,
    response::{IntoResponse, Response},
    routing::{get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, Sqlite, SqlitePool};

use crate::{
    auth::AuthUser,
    db,
    errors::AppError,
    models::{SmartSaleRequest, UrgencyLevel},
    services::advisor::evaluate_smart_sale,
};

#[path = "fpo_pools.rs"]
pub(crate) mod pools;

type ApiResult<T> = Result<Json<T>, AppError>;
const EPS: f64 = 0.0001;
const MAX_UPLOAD_BYTES: usize = 1024 * 1024;

pub fn routes() -> Router<SqlitePool> {
    Router::new()
        .merge(pools::routes())
        .route("/api/fpo/org", get(get_org).put(update_org))
        .route("/api/fpo/dashboard", get(dashboard))
        .route("/api/fpo/notifications", get(notifications))
        .route("/api/fpo/members", get(list_members).post(create_member))
        .route(
            "/api/fpo/members/:id",
            get(member_detail).put(update_member),
        )
        .route(
            "/api/fpo/contributions",
            get(list_contributions).post(create_contribution),
        )
        .route(
            "/api/fpo/contributions/:id/:action",
            post(review_contribution),
        )
        .route("/api/fpo/lots", get(list_lots).post(create_lot))
        .route("/api/fpo/lots/:id", get(lot_detail))
        .route("/api/fpo/lots/:id/warehouse", put(assign_warehouse))
        .route("/api/fpo/lots/:id/quality", post(add_quality))
        .route("/api/fpo/lots/:id/matches", get(lot_matches))
        .route("/api/fpo/lots/:id/advice", get(lot_advice))
        .route("/api/fpo/quality", get(list_quality))
        .route("/api/fpo/buyers", get(list_buyers))
        .route(
            "/api/fpo/offers",
            get(list_fpo_offers).post(fpo_create_offer),
        )
        .route("/api/fpo/offers/:id/respond", post(fpo_respond_offer))
        .route("/api/fpo/sales", get(list_sales))
        .route("/api/fpo/sales/:id", get(sale_detail))
        .route("/api/fpo/sales/:id/payments", post(record_payment))
        .route("/api/fpo/sales/:id/expenses", put(update_expenses))
        .route(
            "/api/fpo/sales/:id/distribution",
            get(preview_distribution).post(create_distribution),
        )
        .route("/api/fpo/payouts/:id/pay", post(pay_payout))
        .route(
            "/api/fpo/warehouses",
            get(list_warehouses).post(create_warehouse),
        )
        .route(
            "/api/fpo/transporters",
            get(list_transporters).post(create_transporter),
        )
        .route(
            "/api/fpo/shipments",
            get(list_shipments).post(create_shipment),
        )
        .route(
            "/api/fpo/shipments/:id/status",
            post(update_shipment_status),
        )
        .route(
            "/api/fpo/grievances",
            get(list_grievances).post(create_grievance),
        )
        .route(
            "/api/fpo/grievances/:id/status",
            post(update_grievance_status),
        )
        .route(
            "/api/fpo/grievances/:id/documents",
            post(add_grievance_document),
        )
        .route("/api/fpo/documents/:id", get(download_document))
        .route("/api/fpo/reports/:kind", get(report))
        .route("/api/fpo/demand", get(demand_forecast))
        .route("/api/fpo/audit", get(audit_log))
        .route("/api/fpo/my", get(my_fpo))
        .route("/api/fpo/my/grievances", post(farmer_grievance))
        .route("/api/fpo-market/lots", get(market_lots))
        .route(
            "/api/fpo-market/offers",
            get(buyer_offers).post(buyer_create_offer),
        )
        .route(
            "/api/fpo-market/offers/:id/respond",
            post(buyer_respond_offer),
        )
        .route(
            "/api/fpo-market/sales/:id/disputes",
            post(buyer_raise_dispute),
        )
        .route("/api/admin/fpos", get(admin_fpos))
        .route("/api/admin/buyers", get(admin_buyers))
}

/* -------------------------------------------------------------------------- */
/*                                   helpers                                  */
/* -------------------------------------------------------------------------- */

fn bad(msg: impl Into<String>) -> AppError {
    AppError::BadRequest(msg.into())
}
fn forbidden(msg: impl Into<String>) -> AppError {
    AppError::Forbidden(msg.into())
}
fn not_found(msg: impl Into<String>) -> AppError {
    AppError::NotFound(msg.into())
}

fn r2(x: f64) -> f64 {
    // Adding 0.0 turns -0.0 (Rust's empty f64 sum) into 0.0.
    (x * 100.0).round() / 100.0 + 0.0
}

fn text(value: &str, field: &str, min: usize, max: usize) -> Result<String, AppError> {
    let t = value.trim();
    let n = t.chars().count();
    if n < min {
        return Err(bad(format!("{field} is required")));
    }
    if n > max {
        return Err(bad(format!("{field} must be at most {max} characters")));
    }
    Ok(t.to_string())
}

fn number(value: f64, field: &str, min: f64, max: f64) -> Result<f64, AppError> {
    if !value.is_finite() || value < min || value > max {
        return Err(bad(format!("{field} must be between {min} and {max}")));
    }
    Ok(value)
}

fn positive(value: f64, field: &str) -> Result<f64, AppError> {
    if !value.is_finite() || value <= 0.0 {
        return Err(bad(format!("{field} must be more than 0")));
    }
    if value > 1_000_000_000.0 {
        return Err(bad(format!("{field} is too large")));
    }
    Ok(value)
}

static DATE_RE: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| regex::Regex::new(r"^\d{4}-\d{2}-\d{2}$").expect("date regex"));
static PHONE_RE: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| regex::Regex::new(r"^[0-9]{10}$").expect("phone regex"));

fn date(value: &str, field: &str) -> Result<String, AppError> {
    let v = value.trim();
    if !DATE_RE.is_match(v) {
        return Err(bad(format!("{field} must be a date (YYYY-MM-DD)")));
    }
    Ok(v.to_string())
}

fn phone(value: &str) -> Result<String, AppError> {
    let v: String = value.chars().filter(|c| !c.is_whitespace()).collect();
    if !PHONE_RE.is_match(&v) {
        return Err(bad("Mobile number must be 10 digits"));
    }
    Ok(v)
}

async fn user_role(pool: &SqlitePool, user_id: i64) -> Result<String, AppError> {
    db::get_user_role(pool, user_id)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Unknown user. Please sign in again.".into()))
}

async fn require(pool: &SqlitePool, user: &AuthUser, roles: &[&str]) -> Result<String, AppError> {
    let role = user_role(pool, user.user_id).await?;
    if roles.contains(&role.as_str()) {
        Ok(role)
    } else {
        Err(forbidden(format!(
            "This action is only for {} accounts",
            roles.join(" / ")
        )))
    }
}

/// Notifies the manager of an FPO.
async fn notify_manager(
    pool: &SqlitePool,
    fpo_id: i64,
    kind: &str,
    title: &str,
    body: &str,
    link: &str,
) -> Result<(), AppError> {
    let manager: Option<i64> =
        sqlx::query_scalar("SELECT manager_user_id FROM fpo_organizations WHERE id = ?")
            .bind(fpo_id)
            .fetch_optional(pool)
            .await?;
    if let Some(m) = manager {
        crate::admin::notify_typed(pool, m, kind, title, body, Some(link)).await?;
    }
    Ok(())
}

/// Notifies an FPO member, if the member has a farmer account.
async fn notify_member(
    pool: &SqlitePool,
    member_id: i64,
    kind: &str,
    title: &str,
    body: &str,
    link: &str,
) -> Result<(), AppError> {
    let user: Option<i64> = sqlx::query_scalar("SELECT user_id FROM fpo_members WHERE id = ?")
        .bind(member_id)
        .fetch_optional(pool)
        .await?
        .flatten();
    if let Some(u) = user {
        crate::admin::notify_typed(pool, u, kind, title, body, Some(link)).await?;
    }
    Ok(())
}

/// Notifies every member with an account who has a contribution in this filter.
async fn notify_contributors(
    pool: &SqlitePool,
    filter_sql: &str,
    id: i64,
    kind: &str,
    title: &str,
    body: &str,
    link: &str,
) -> Result<(), AppError> {
    let users: Vec<i64> = sqlx::query_scalar(&format!(
        "SELECT DISTINCT m.user_id FROM fpo_contributions c JOIN fpo_members m ON m.id = c.member_id
         WHERE m.user_id IS NOT NULL AND {filter_sql}"
    ))
    .bind(id)
    .fetch_all(pool)
    .await?;
    for u in users {
        crate::admin::notify_typed(pool, u, kind, title, body, Some(link)).await?;
    }
    Ok(())
}

async fn org_name(pool: &SqlitePool, fpo_id: i64) -> Result<String, AppError> {
    Ok(
        sqlx::query_scalar("SELECT name FROM fpo_organizations WHERE id = ?")
            .bind(fpo_id)
            .fetch_optional(pool)
            .await?
            .unwrap_or_default(),
    )
}

async fn audit<'c, E>(
    ex: E,
    fpo_id: i64,
    actor: i64,
    action: &str,
    entity: &str,
    entity_id: Option<i64>,
    detail: String,
) -> Result<(), AppError>
where
    E: sqlx::Executor<'c, Database = Sqlite>,
{
    sqlx::query(
        "INSERT INTO fpo_audit_log (fpo_id, actor_id, action, entity, entity_id, detail)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(fpo_id)
    .bind(actor)
    .bind(action)
    .bind(entity)
    .bind(entity_id)
    .bind(detail)
    .execute(ex)
    .await?;
    Ok(())
}

/* ------------------------------- organisation ------------------------------ */

#[derive(Debug, Serialize, FromRow, Clone)]
pub struct Org {
    id: i64,
    manager_user_id: i64,
    name: String,
    registration_no: Option<String>,
    district: String,
    state: String,
    contact_phone: Option<String>,
    commission_pct: f64,
    verified: i64,
    verified_at: Option<String>,
    created_at: Option<String>,
    verified_by: Option<i64>,
    primary_crops: String,
    rejection_reason: Option<String>,
}

const ORG_COLS: &str =
    "id, manager_user_id, name, registration_no, district, state, contact_phone, \
     commission_pct, verified, verified_at, created_at, verified_by, primary_crops, rejection_reason";

/// The signed-in FPO manager's organisation (created on first use).
/// The signed-in FPO manager's organisation, allowed even while the FPO is
/// waiting for verification (used for its own profile only).
async fn manager_org_any(pool: &SqlitePool, user: &AuthUser) -> Result<Org, AppError> {
    if user.role != "fpo" {
        return Err(forbidden("Only FPO managers can use the FPO portal"));
    }
    let sql = format!("SELECT {ORG_COLS} FROM fpo_organizations WHERE manager_user_id = ?");
    if let Some(org) = sqlx::query_as::<_, Org>(&sql)
        .bind(user.user_id)
        .fetch_optional(pool)
        .await?
    {
        return Ok(org);
    }
    // FPO accounts created before organisations existed get one on first use.
    let phone_number: String = sqlx::query_scalar("SELECT phone_number FROM users WHERE id = ?")
        .bind(user.user_id)
        .fetch_one(pool)
        .await?;
    create_org_for_manager(
        pool,
        user.user_id,
        &user.name,
        &phone_number,
        &crate::db::FpoSignup::default(),
    )
    .await?;
    Ok(sqlx::query_as::<_, Org>(&sql)
        .bind(user.user_id)
        .fetch_one(pool)
        .await?)
}

/// The signed-in FPO manager's organisation. Every FPO operation goes through
/// this, so a pending (unverified) FPO cannot use the portal yet.
async fn manager_org(pool: &SqlitePool, user: &AuthUser) -> Result<Org, AppError> {
    let org = manager_org_any(pool, user).await?;
    if user.status == "pending" {
        return Err(forbidden(
            "Your FPO is waiting for verification by the AgriSense admin. You can use the portal once it is approved.",
        ));
    }
    Ok(org)
}

/// Called from registration so a new FPO account starts with an organisation.
pub async fn create_org_for_manager<'c, E>(
    ex: E,
    user_id: i64,
    name: &str,
    phone_number: &str,
    signup: &crate::db::FpoSignup<'_>,
) -> Result<(), sqlx::Error>
where
    E: sqlx::Executor<'c, Database = Sqlite>,
{
    sqlx::query(
        "INSERT OR IGNORE INTO fpo_organizations
            (manager_user_id, name, contact_phone, registration_no, district, state, primary_crops)
         VALUES (?, ?, ?, ?, ?, COALESCE(NULLIF(?, ''), 'Maharashtra'), ?)",
    )
    .bind(user_id)
    .bind(name)
    .bind(phone_number)
    .bind(signup.registration_no.map(str::trim))
    .bind(signup.district.map(str::trim).unwrap_or(""))
    .bind(signup.state.map(str::trim).unwrap_or(""))
    .bind(signup.primary_crops.map(str::trim).unwrap_or(""))
    .execute(ex)
    .await?;
    Ok(())
}

async fn get_org(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Org> {
    Ok(Json(manager_org_any(&pool, &user).await?))
}

#[derive(Deserialize)]
struct OrgBody {
    name: String,
    registration_no: Option<String>,
    district: String,
    state: String,
    contact_phone: Option<String>,
    commission_pct: f64,
    primary_crops: Option<String>,
}

async fn update_org(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<OrgBody>,
) -> ApiResult<Org> {
    let org = manager_org_any(&pool, &user).await?;
    let name = text(&b.name, "FPO name", 2, 120)?;
    let reg = b
        .registration_no
        .as_deref()
        .map(|v| text(v, "Registration number", 0, 60))
        .transpose()?
        .filter(|v| !v.is_empty());
    let district = text(&b.district, "District", 0, 80)?;
    let state = text(&b.state, "State", 2, 80)?;
    let contact = match b.contact_phone.as_deref().map(str::trim) {
        Some(v) if !v.is_empty() => Some(phone(v)?),
        _ => None,
    };
    let commission = number(b.commission_pct, "FPO service charge %", 0.0, 20.0)?;
    let crops = text(
        b.primary_crops.as_deref().unwrap_or(&org.primary_crops),
        "Primary crops",
        0,
        300,
    )?;
    sqlx::query(
        "UPDATE fpo_organizations SET name = ?, registration_no = ?, district = ?, state = ?,
         contact_phone = ?, commission_pct = ?, primary_crops = ?,
         rejection_reason = CASE WHEN verified = 0 THEN NULL ELSE rejection_reason END
         WHERE id = ?",
    )
    .bind(&name)
    .bind(&reg)
    .bind(&district)
    .bind(&state)
    .bind(&contact)
    .bind(commission)
    .bind(&crops)
    .bind(org.id)
    .execute(&pool)
    .await?;
    audit(
        &pool,
        org.id,
        user.user_id,
        "updated",
        "organisation",
        Some(org.id),
        format!("{name}, service charge {commission}%"),
    )
    .await?;
    Ok(Json(manager_org_any(&pool, &user).await?))
}

/* -------------------------------- documents -------------------------------- */

#[derive(Deserialize)]
struct Upload {
    file_name: String,
    mime_type: String,
    data_base64: String,
}

pub(crate) fn decode_base64(input: &str) -> Option<Vec<u8>> {
    let s = match input.find("base64,") {
        Some(i) => &input[i + 7..],
        None => input,
    };
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut buf, mut bits) = (0u32, 0u32);
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' => break,
            b'\r' | b'\n' | b' ' => continue,
            _ => return None,
        };
        buf = (buf << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Some(out)
}

async fn save_document<'c, E>(
    ex: E,
    fpo_id: i64,
    owner_type: &str,
    owner_id: i64,
    upload: &Upload,
    user_id: i64,
) -> Result<i64, AppError>
where
    E: sqlx::Executor<'c, Database = Sqlite>,
{
    let mime = upload.mime_type.trim().to_lowercase();
    if !matches!(
        mime.as_str(),
        "application/pdf" | "image/png" | "image/jpeg" | "image/webp"
    ) {
        return Err(bad("Upload a PDF, JPG, PNG or WEBP file"));
    }
    let bytes =
        decode_base64(&upload.data_base64).ok_or_else(|| bad("The file could not be read"))?;
    if bytes.is_empty() {
        return Err(bad("The file is empty"));
    }
    if bytes.len() > MAX_UPLOAD_BYTES {
        return Err(bad(
            "The file is larger than 1 MB. Please upload a smaller file.",
        ));
    }
    let name = text(&upload.file_name, "File name", 1, 150)?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_documents (fpo_id, owner_type, owner_id, file_name, mime_type, size_bytes, data, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(fpo_id)
    .bind(owner_type)
    .bind(owner_id)
    .bind(name)
    .bind(mime)
    .bind(bytes.len() as i64)
    .bind(bytes)
    .bind(user_id)
    .fetch_all(ex)
    .await
    .and_then(|mut rows| rows.pop().ok_or(sqlx::Error::RowNotFound))?;
    Ok(id)
}

#[derive(Debug, Serialize, FromRow, Clone)]
struct DocInfo {
    id: i64,
    owner_type: String,
    owner_id: i64,
    file_name: String,
    mime_type: String,
    size_bytes: i64,
    created_at: Option<String>,
}

async fn download_document(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> Result<Response, AppError> {
    let role = user_role(&pool, user.user_id).await?;
    let row: (i64, String, i64, String, String, Vec<u8>) = sqlx::query_as(
        "SELECT fpo_id, owner_type, owner_id, file_name, mime_type, data FROM fpo_documents WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| not_found("Document not found"))?;
    let (fpo_id, owner_type, owner_id, file_name, mime, data) = row;
    let allowed = match role.as_str() {
        "admin" => true,
        "fpo" => manager_org(&pool, &user).await?.id == fpo_id,
        _ if owner_type == "grievance" => {
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM fpo_grievances WHERE id = ? AND raised_by = ?",
            )
            .bind(owner_id)
            .bind(user.user_id)
            .fetch_one(&pool)
            .await?
                > 0
        }
        _ => false,
    };
    if !allowed {
        return Err(forbidden("You cannot open this document"));
    }
    let safe_name: String = file_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    Ok((
        [
            (header::CONTENT_TYPE, mime),
            (
                header::CONTENT_DISPOSITION,
                format!("inline; filename=\"{safe_name}\""),
            ),
        ],
        data,
    )
        .into_response())
}

/* -------------------------------------------------------------------------- */
/*                                   members                                  */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Serialize, FromRow)]
struct Member {
    id: i64,
    user_id: Option<i64>,
    name: String,
    phone: String,
    village: String,
    land_acres: f64,
    crops: String,
    status: String,
    joined_at: Option<String>,
    contributed_quintals: f64,
    pending_quintals: f64,
    payouts_net: f64,
    payouts_paid: f64,
}

const MEMBER_SELECT: &str = "SELECT m.id, m.user_id, m.name, m.phone, m.village, CAST(m.land_acres AS REAL) AS land_acres,
    m.crops, m.status, m.joined_at,
    COALESCE((SELECT SUM(c.quantity_quintals) FROM fpo_contributions c WHERE c.member_id = m.id AND c.status IN ('approved','pooled')), 0.0) AS contributed_quintals,
    COALESCE((SELECT SUM(c.quantity_quintals) FROM fpo_contributions c WHERE c.member_id = m.id AND c.status = 'pending'), 0.0) AS pending_quintals,
    COALESCE((SELECT SUM(p.net) FROM fpo_payouts p WHERE p.member_id = m.id), 0.0) AS payouts_net,
    COALESCE((SELECT SUM(p.net) FROM fpo_payouts p WHERE p.member_id = m.id AND p.status = 'paid'), 0.0) AS payouts_paid
    FROM fpo_members m";

#[derive(Deserialize)]
struct MemberQuery {
    q: Option<String>,
    status: Option<String>,
}

async fn list_members(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Query(q): Query<MemberQuery>,
) -> ApiResult<Vec<Member>> {
    let org = manager_org(&pool, &user).await?;
    let search = format!("%{}%", q.q.unwrap_or_default().trim().to_lowercase());
    let status = q.status.unwrap_or_default();
    let sql = format!(
        "{MEMBER_SELECT} WHERE m.fpo_id = ?
         AND (lower(m.name) LIKE ? OR m.phone LIKE ? OR lower(m.village) LIKE ? OR lower(m.crops) LIKE ?)
         AND (? = '' OR m.status = ?)
         ORDER BY m.name"
    );
    Ok(Json(
        sqlx::query_as::<_, Member>(&sql)
            .bind(org.id)
            .bind(&search)
            .bind(&search)
            .bind(&search)
            .bind(&search)
            .bind(&status)
            .bind(&status)
            .fetch_all(&pool)
            .await?,
    ))
}

#[derive(Deserialize)]
struct MemberBody {
    name: String,
    phone: String,
    village: String,
    land_acres: f64,
    crops: String,
    status: Option<String>,
    /// When the farmer has no AgriSense login yet: create one with this PIN.
    create_login_pin: Option<String>,
}

async fn create_member(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<MemberBody>,
) -> ApiResult<Member> {
    let org = manager_org(&pool, &user).await?;
    let name = text(&b.name, "Farmer name", 2, 100)?;
    let mobile = phone(&b.phone)?;
    let village = text(&b.village, "Village", 1, 100)?;
    let land = number(b.land_acres, "Land size (acres)", 0.0, 10_000.0)?;
    let crops = text(&b.crops, "Crops", 0, 300)?;
    // Link to an existing farmer account with the same mobile number.
    let mut linked: Option<i64> =
        sqlx::query_scalar("SELECT id FROM users WHERE phone_number = ? AND role = 'farmer'")
            .bind(&mobile)
            .fetch_optional(&pool)
            .await?;
    let mut tx = pool.begin().await?;
    if let Some(pin) = b
        .create_login_pin
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        if linked.is_some() {
            return Err(bad(
                "This farmer already has an AgriSense login; no PIN is needed",
            ));
        }
        if pin.len() != 4 || !pin.chars().all(|c| c.is_ascii_digit()) {
            return Err(bad("The login PIN must be 4 digits"));
        }
        let uid = sqlx::query_scalar::<_, i64>(
            "INSERT INTO users (name, role, phone_number, pin_hash, status) VALUES (?, 'farmer', ?, ?, 'active') RETURNING id",
        )
        .bind(&name)
        .bind(&mobile)
        .bind(crate::auth::hash_pin(pin))
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(d) if d.message().contains("UNIQUE") => {
                bad("This mobile number already belongs to another AgriSense account")
            }
            other => AppError::from(other),
        })?;
        sqlx::query("INSERT INTO farmers (id, location, urgency_level) VALUES (?, ?, 'medium')")
            .bind(uid)
            .bind(&org.state)
            .execute(&mut *tx)
            .await?;
        linked = Some(uid);
    }
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_members (fpo_id, user_id, name, phone, village, land_acres, crops)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org.id)
    .bind(linked)
    .bind(&name)
    .bind(&mobile)
    .bind(&village)
    .bind(land)
    .bind(&crops)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(d) if d.message().contains("UNIQUE") => {
            bad("A farmer with this mobile number is already a member")
        }
        other => AppError::from(other),
    })?;
    tx.commit().await?;
    audit(
        &pool,
        org.id,
        user.user_id,
        "added",
        "farmer",
        Some(id),
        name,
    )
    .await?;
    fetch_member(&pool, org.id, id).await.map(Json)
}

async fn fetch_member(pool: &SqlitePool, fpo_id: i64, id: i64) -> Result<Member, AppError> {
    let sql = format!("{MEMBER_SELECT} WHERE m.fpo_id = ? AND m.id = ?");
    sqlx::query_as::<_, Member>(&sql)
        .bind(fpo_id)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| not_found("Farmer not found in your FPO"))
}

async fn update_member(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<MemberBody>,
) -> ApiResult<Member> {
    let org = manager_org(&pool, &user).await?;
    fetch_member(&pool, org.id, id).await?;
    let status = b.status.unwrap_or_else(|| "active".into());
    if !matches!(status.as_str(), "active" | "inactive") {
        return Err(bad("Status must be active or inactive"));
    }
    let name = text(&b.name, "Farmer name", 2, 100)?;
    let mobile = phone(&b.phone)?;
    sqlx::query(
        "UPDATE fpo_members SET name = ?, phone = ?, village = ?, land_acres = ?, crops = ?, status = ?,
         user_id = COALESCE((SELECT id FROM users WHERE phone_number = ? AND role = 'farmer'), user_id)
         WHERE id = ? AND fpo_id = ?",
    )
    .bind(&name)
    .bind(&mobile)
    .bind(text(&b.village, "Village", 1, 100)?)
    .bind(number(b.land_acres, "Land size (acres)", 0.0, 10_000.0)?)
    .bind(text(&b.crops, "Crops", 0, 300)?)
    .bind(&status)
    .bind(&mobile)
    .bind(id)
    .bind(org.id)
    .execute(&pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(d) if d.message().contains("UNIQUE") => {
            bad("Another member already uses this mobile number")
        }
        other => AppError::from(other),
    })?;
    audit(
        &pool,
        org.id,
        user.user_id,
        "updated",
        "farmer",
        Some(id),
        format!("{name} ({status})"),
    )
    .await?;
    fetch_member(&pool, org.id, id).await.map(Json)
}

async fn member_detail(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let member = fetch_member(&pool, org.id, id).await?;
    let contributions =
        contributions_where(&pool, "c.fpo_id = ? AND c.member_id = ?", &[org.id, id]).await?;
    let payouts = payouts_where(&pool, "s.fpo_id = ? AND p.member_id = ?", &[org.id, id]).await?;
    Ok(Json(
        json!({ "member": member, "contributions": contributions, "payouts": payouts }),
    ))
}

/* -------------------------------------------------------------------------- */
/*                                contributions                               */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Serialize, FromRow)]
struct Contribution {
    id: i64,
    member_id: i64,
    member_name: String,
    crop_id: i64,
    crop_name: String,
    variety: String,
    quantity_quintals: f64,
    harvest_date: String,
    quality_note: String,
    status: String,
    lot_id: Option<i64>,
    lot_code: Option<String>,
    created_at: Option<String>,
    pool_id: Option<i64>,
    pledged_quintals: Option<f64>,
    received_quintals: Option<f64>,
    assessed_grade: Option<String>,
    source_lot_id: Option<i64>,
    pledged_by: String,
    rejection_note: String,
    received_at: Option<String>,
}

const CONTRIB_SELECT: &str = "SELECT c.id, c.member_id, m.name AS member_name, c.crop_id, cr.name AS crop_name,
    c.variety, c.quantity_quintals, c.harvest_date, c.quality_note, c.status, c.lot_id, l.lot_code, c.created_at,
    c.pool_id, c.pledged_quintals, c.received_quintals, c.assessed_grade, c.source_lot_id, c.pledged_by,
    c.rejection_note, c.received_at
    FROM fpo_contributions c
    JOIN fpo_members m ON m.id = c.member_id
    JOIN crops cr ON cr.id = c.crop_id
    LEFT JOIN fpo_lots l ON l.id = c.lot_id";

async fn contributions_where(
    pool: &SqlitePool,
    filter: &str,
    binds: &[i64],
) -> Result<Vec<Contribution>, AppError> {
    let sql = format!("{CONTRIB_SELECT} WHERE {filter} ORDER BY c.id DESC");
    let mut q = sqlx::query_as::<_, Contribution>(&sql);
    for b in binds {
        q = q.bind(*b);
    }
    Ok(q.fetch_all(pool).await?)
}

#[derive(Deserialize)]
struct StatusQuery {
    status: Option<String>,
}

async fn list_contributions(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Query(q): Query<StatusQuery>,
) -> ApiResult<Vec<Contribution>> {
    let org = manager_org(&pool, &user).await?;
    let status = q.status.unwrap_or_default();
    let sql = format!(
        "{CONTRIB_SELECT} WHERE c.fpo_id = ? AND (? = '' OR c.status = ?) ORDER BY c.id DESC"
    );
    Ok(Json(
        sqlx::query_as::<_, Contribution>(&sql)
            .bind(org.id)
            .bind(&status)
            .bind(&status)
            .fetch_all(&pool)
            .await?,
    ))
}

#[derive(Deserialize)]
struct ContributionBody {
    member_id: i64,
    crop_name: String,
    variety: Option<String>,
    quantity_quintals: f64,
    harvest_date: String,
    quality_note: Option<String>,
}

async fn create_contribution(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<ContributionBody>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let member = fetch_member(&pool, org.id, b.member_id).await?;
    if member.status != "active" {
        return Err(bad("This farmer's membership is inactive"));
    }
    let qty = positive(b.quantity_quintals, "Quantity (quintals)")?;
    if qty > 100_000.0 {
        return Err(bad(
            "Quantity looks too large. Enter it in quintals (1 MT = 10 quintals).",
        ));
    }
    let harvest = date(&b.harvest_date, "Harvest date")?;
    let crop = db::find_crop(&pool, &text(&b.crop_name, "Crop", 1, 80)?).await?;
    let variety = text(b.variety.as_deref().unwrap_or(""), "Variety", 0, 80)?;
    let note = text(
        b.quality_note.as_deref().unwrap_or(""),
        "Quality note",
        0,
        300,
    )?;

    let duplicate: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM fpo_contributions WHERE member_id = ? AND crop_id = ? AND harvest_date = ?
         AND abs(quantity_quintals - ?) < 0.0001 AND status IN ('pending', 'approved')",
    )
    .bind(member.id)
    .bind(crop.id)
    .bind(&harvest)
    .bind(qty)
    .fetch_one(&pool)
    .await?;
    if duplicate > 0 {
        return Err(bad("This contribution is already recorded for this farmer"));
    }

    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_contributions (fpo_id, member_id, crop_id, variety, quantity_quintals, harvest_date, quality_note)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org.id)
    .bind(member.id)
    .bind(crop.id)
    .bind(&variety)
    .bind(qty)
    .bind(&harvest)
    .bind(&note)
    .fetch_all(&pool)
    .await
    .and_then(|mut rows| rows.pop().ok_or(sqlx::Error::RowNotFound))?;
    audit(
        &pool,
        org.id,
        user.user_id,
        "recorded",
        "contribution",
        Some(id),
        format!("{} q {} from {}", qty, crop.name, member.name),
    )
    .await?;
    Ok(Json(json!({ "id": id })))
}

async fn review_contribution(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path((id, action)): Path<(i64, String)>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let next = match action.as_str() {
        "approve" => "approved",
        "reject" => "rejected",
        _ => return Err(bad("Action must be approve or reject")),
    };
    let done = sqlx::query(
        "UPDATE fpo_contributions SET status = ? WHERE id = ? AND fpo_id = ? AND status = 'pending'
         AND pool_id IS NULL",
    )
    .bind(next)
    .bind(id)
    .bind(org.id)
    .execute(&pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(bad(
            "Only pending contributions can be approved or rejected here. Pool pledges are weighed and graded in the pool's intake.",
        ));
    }
    audit(
        &pool,
        org.id,
        user.user_id,
        next,
        "contribution",
        Some(id),
        String::new(),
    )
    .await?;
    Ok(Json(json!({ "id": id, "status": next })))
}

/* -------------------------------------------------------------------------- */
/*                                  bulk lots                                 */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Serialize, FromRow)]
struct FpoLot {
    id: i64,
    fpo_id: i64,
    lot_code: Option<String>,
    crop_id: i64,
    crop_name: String,
    variety: String,
    total_quintals: f64,
    reserved_quintals: f64,
    sold_quintals: f64,
    available_quintals: f64,
    grade: Option<String>,
    warehouse_id: Option<i64>,
    warehouse_name: Option<String>,
    contributor_count: i64,
    status: String,
    created_at: Option<String>,
    fpo_name: String,
    fpo_verified: i64,
    fpo_district: String,
    fpo_state: String,
    last_moisture_pct: Option<f64>,
    last_inspected_on: Option<String>,
}

const LOT_SELECT: &str = "SELECT l.id, l.fpo_id, l.lot_code, l.crop_id, c.name AS crop_name, l.variety,
    l.total_quintals, l.reserved_quintals, l.sold_quintals,
    CAST(l.total_quintals - l.reserved_quintals - l.sold_quintals AS REAL) AS available_quintals,
    l.grade, l.warehouse_id, w.name AS warehouse_name,
    (SELECT COUNT(*) FROM fpo_contributions fc WHERE fc.lot_id = l.id) AS contributor_count,
    CASE WHEN l.sold_quintals >= l.total_quintals - 0.0001 THEN 'sold'
         WHEN l.reserved_quintals + l.sold_quintals >= l.total_quintals - 0.0001 THEN 'reserved'
         WHEN l.reserved_quintals + l.sold_quintals > 0 THEN 'partly_sold'
         ELSE 'available' END AS status,
    l.created_at, o.name AS fpo_name, o.verified AS fpo_verified, o.district AS fpo_district, o.state AS fpo_state,
    (SELECT q.moisture_pct FROM fpo_quality_records q WHERE q.lot_id = l.id ORDER BY q.id DESC LIMIT 1) AS last_moisture_pct,
    (SELECT q.inspected_on FROM fpo_quality_records q WHERE q.lot_id = l.id ORDER BY q.id DESC LIMIT 1) AS last_inspected_on
    FROM fpo_lots l
    JOIN crops c ON c.id = l.crop_id
    JOIN fpo_organizations o ON o.id = l.fpo_id
    LEFT JOIN fpo_warehouses w ON w.id = l.warehouse_id";

async fn fetch_lot(pool: &SqlitePool, fpo_id: i64, id: i64) -> Result<FpoLot, AppError> {
    let sql = format!("{LOT_SELECT} WHERE l.fpo_id = ? AND l.id = ?");
    sqlx::query_as::<_, FpoLot>(&sql)
        .bind(fpo_id)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| not_found("Lot not found in your FPO"))
}

async fn list_lots(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Vec<FpoLot>> {
    let org = manager_org(&pool, &user).await?;
    let sql = format!("{LOT_SELECT} WHERE l.fpo_id = ? ORDER BY l.id DESC");
    Ok(Json(
        sqlx::query_as::<_, FpoLot>(&sql)
            .bind(org.id)
            .fetch_all(&pool)
            .await?,
    ))
}

#[derive(Deserialize)]
struct CreateLotBody {
    contribution_ids: Vec<i64>,
    variety: Option<String>,
    warehouse_id: Option<i64>,
}

fn crop_code(name: &str) -> String {
    let letters: String = name
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .take(3)
        .collect();
    if letters.is_empty() {
        "CRP".into()
    } else {
        letters.to_uppercase()
    }
}

async fn create_lot(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<CreateLotBody>,
) -> ApiResult<FpoLot> {
    let org = manager_org(&pool, &user).await?;
    let mut ids = b.contribution_ids.clone();
    ids.sort_unstable();
    ids.dedup();
    if ids.is_empty() {
        return Err(bad("Select at least one approved contribution"));
    }
    if ids.len() > 500 {
        return Err(bad("Too many contributions in one lot"));
    }
    let placeholders = vec!["?"; ids.len()].join(",");
    let sql = format!(
        "SELECT c.id, c.crop_id, cr.name, c.quantity_quintals, c.status, c.lot_id
         FROM fpo_contributions c JOIN crops cr ON cr.id = c.crop_id
         WHERE c.fpo_id = ? AND c.id IN ({placeholders})"
    );
    let mut q =
        sqlx::query_as::<_, (i64, i64, String, f64, String, Option<i64>)>(&sql).bind(org.id);
    for id in &ids {
        q = q.bind(*id);
    }
    let rows = q.fetch_all(&pool).await?;
    if rows.len() != ids.len() {
        return Err(bad("Some selected contributions were not found"));
    }
    if let Some(r) = rows.iter().find(|r| r.4 != "approved" || r.5.is_some()) {
        return Err(bad(format!(
            "Contribution #{} is {} — only approved, unpooled contributions can be combined",
            r.0, r.4
        )));
    }
    let crop_id = rows[0].1;
    if rows.iter().any(|r| r.1 != crop_id) {
        return Err(bad("All contributions in a lot must be the same crop"));
    }
    let crop_name = rows[0].2.clone();
    let total: f64 = rows.iter().map(|r| r.3).sum();
    let variety = text(b.variety.as_deref().unwrap_or(""), "Variety", 0, 80)?;

    let mut tx = pool.begin().await?;
    if let Some(w) = b.warehouse_id {
        check_warehouse_space(&mut tx, org.id, w, total, None).await?;
    }
    let lot_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_lots (fpo_id, crop_id, variety, total_quintals, warehouse_id) VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org.id)
    .bind(crop_id)
    .bind(&variety)
    .bind(total)
    .bind(b.warehouse_id)
    .fetch_one(&mut *tx)
    .await?;
    let today: String = sqlx::query_scalar("SELECT strftime('%Y%m%d', 'now')")
        .fetch_one(&mut *tx)
        .await?;
    let code = format!(
        "FPO{}-{}-{}-{:04}",
        org.id,
        crop_code(&crop_name),
        today,
        lot_id
    );
    sqlx::query("UPDATE fpo_lots SET lot_code = ? WHERE id = ?")
        .bind(&code)
        .bind(lot_id)
        .execute(&mut *tx)
        .await?;
    let sql = format!(
        "UPDATE fpo_contributions SET status = 'pooled', lot_id = ?
         WHERE fpo_id = ? AND status = 'approved' AND lot_id IS NULL AND id IN ({placeholders})"
    );
    let mut upd = sqlx::query(&sql).bind(lot_id).bind(org.id);
    for id in &ids {
        upd = upd.bind(*id);
    }
    // Guards against two managers pooling the same contribution at once.
    if upd.execute(&mut *tx).await?.rows_affected() as usize != ids.len() {
        return Err(bad(
            "Some contributions were just added to another lot. Refresh and try again.",
        ));
    }
    audit(
        &mut *tx,
        org.id,
        user.user_id,
        "created",
        "lot",
        Some(lot_id),
        format!(
            "{code}: {total} q {crop_name} from {} contributions",
            ids.len()
        ),
    )
    .await?;
    tx.commit().await?;
    notify_buyers_for_fpo_lot(&pool, lot_id).await?;
    fetch_lot(&pool, org.id, lot_id).await.map(Json)
}

async fn check_warehouse_space(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    fpo_id: i64,
    warehouse_id: i64,
    adding: f64,
    exclude_lot: Option<i64>,
) -> Result<(), AppError> {
    let (capacity, used): (f64, f64) = sqlx::query_as(
        "SELECT w.capacity_quintals,
            COALESCE((SELECT SUM(l.total_quintals - l.sold_quintals) FROM fpo_lots l
                      WHERE l.warehouse_id = w.id AND l.id IS NOT ?), 0.0)
         FROM fpo_warehouses w WHERE w.id = ? AND w.fpo_id = ?",
    )
    .bind(exclude_lot)
    .bind(warehouse_id)
    .bind(fpo_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| bad("Warehouse not found"))?;
    if used + adding > capacity + EPS {
        return Err(bad(format!(
            "Warehouse has only {:.1} quintals of free space",
            (capacity - used).max(0.0)
        )));
    }
    Ok(())
}

#[derive(Deserialize)]
struct WarehouseAssign {
    warehouse_id: Option<i64>,
}

async fn assign_warehouse(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<WarehouseAssign>,
) -> ApiResult<FpoLot> {
    let org = manager_org(&pool, &user).await?;
    let lot = fetch_lot(&pool, org.id, id).await?;
    let mut tx = pool.begin().await?;
    if let Some(w) = b.warehouse_id {
        check_warehouse_space(
            &mut tx,
            org.id,
            w,
            lot.total_quintals - lot.sold_quintals,
            Some(id),
        )
        .await?;
    }
    sqlx::query("UPDATE fpo_lots SET warehouse_id = ? WHERE id = ? AND fpo_id = ?")
        .bind(b.warehouse_id)
        .bind(id)
        .bind(org.id)
        .execute(&mut *tx)
        .await?;
    audit(
        &mut *tx,
        org.id,
        user.user_id,
        "moved",
        "lot",
        Some(id),
        format!("warehouse {:?}", b.warehouse_id),
    )
    .await?;
    tx.commit().await?;
    fetch_lot(&pool, org.id, id).await.map(Json)
}

async fn lot_detail(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let lot = fetch_lot(&pool, org.id, id).await?;
    let contributions =
        contributions_where(&pool, "c.fpo_id = ? AND c.lot_id = ?", &[org.id, id]).await?;
    let quality = quality_where(&pool, "l.fpo_id = ? AND q.lot_id = ?", &[org.id, id]).await?;
    let offers = offers_where(&pool, "f.fpo_id = ? AND f.lot_id = ?", &[org.id, id]).await?;
    let sales = sales_where(&pool, "s.fpo_id = ? AND s.lot_id = ?", &[org.id, id]).await?;
    Ok(Json(
        json!({ "lot": lot, "contributions": contributions, "quality": quality, "offers": offers, "sales": sales }),
    ))
}

/* -------------------------------------------------------------------------- */
/*                                   quality                                  */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Serialize, FromRow)]
struct QualityRecord {
    id: i64,
    lot_id: i64,
    lot_code: Option<String>,
    crop_name: String,
    inspector_name: String,
    inspected_on: String,
    moisture_pct: f64,
    foreign_matter_pct: f64,
    damaged_pct: f64,
    grain_quality: String,
    grade: String,
    certificate_doc_id: Option<i64>,
    certificate_name: Option<String>,
    created_at: Option<String>,
}

async fn quality_where(
    pool: &SqlitePool,
    filter: &str,
    binds: &[i64],
) -> Result<Vec<QualityRecord>, AppError> {
    let sql = format!(
        "SELECT q.id, q.lot_id, l.lot_code, c.name AS crop_name, q.inspector_name, q.inspected_on,
            q.moisture_pct, q.foreign_matter_pct, q.damaged_pct, q.grain_quality, q.grade,
            q.certificate_doc_id, d.file_name AS certificate_name, q.created_at
         FROM fpo_quality_records q
         JOIN fpo_lots l ON l.id = q.lot_id
         JOIN crops c ON c.id = l.crop_id
         LEFT JOIN fpo_documents d ON d.id = q.certificate_doc_id
         WHERE {filter} ORDER BY q.id DESC"
    );
    let mut q = sqlx::query_as::<_, QualityRecord>(&sql);
    for b in binds {
        q = q.bind(*b);
    }
    Ok(q.fetch_all(pool).await?)
}

async fn list_quality(
    State(pool): State<SqlitePool>,
    user: AuthUser,
) -> ApiResult<Vec<QualityRecord>> {
    let org = manager_org(&pool, &user).await?;
    Ok(Json(quality_where(&pool, "l.fpo_id = ?", &[org.id]).await?))
}

#[derive(Deserialize)]
struct QualityBody {
    inspector_name: String,
    inspected_on: String,
    moisture_pct: f64,
    foreign_matter_pct: f64,
    damaged_pct: Option<f64>,
    grain_quality: Option<String>,
    grade: String,
    certificate: Option<Upload>,
}

async fn add_quality(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<QualityBody>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let lot = fetch_lot(&pool, org.id, id).await?;
    if !matches!(b.grade.as_str(), "A" | "B" | "C") {
        return Err(bad("Grade must be A, B or C"));
    }
    let inspector = text(&b.inspector_name, "Inspector name", 2, 100)?;
    let on = date(&b.inspected_on, "Inspection date")?;
    let moisture = number(b.moisture_pct, "Moisture %", 0.0, 100.0)?;
    let fm = number(b.foreign_matter_pct, "Foreign matter %", 0.0, 100.0)?;
    let damaged = number(b.damaged_pct.unwrap_or(0.0), "Damaged %", 0.0, 100.0)?;
    let remarks = text(
        b.grain_quality.as_deref().unwrap_or(""),
        "Grain quality",
        0,
        300,
    )?;

    let mut tx = pool.begin().await?;
    let rec_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_quality_records (lot_id, inspector_name, inspected_on, moisture_pct, foreign_matter_pct,
            damaged_pct, grain_quality, grade) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(id)
    .bind(&inspector)
    .bind(&on)
    .bind(moisture)
    .bind(fm)
    .bind(damaged)
    .bind(&remarks)
    .bind(&b.grade)
    .fetch_one(&mut *tx)
    .await?;
    if let Some(upload) = &b.certificate {
        let doc = save_document(&mut *tx, org.id, "quality", rec_id, upload, user.user_id).await?;
        sqlx::query("UPDATE fpo_quality_records SET certificate_doc_id = ? WHERE id = ?")
            .bind(doc)
            .bind(rec_id)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("UPDATE fpo_lots SET grade = ? WHERE id = ?")
        .bind(&b.grade)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    audit(
        &mut *tx,
        org.id,
        user.user_id,
        "graded",
        "lot",
        Some(id),
        format!(
            "{} grade {} (moisture {}%, foreign matter {}%)",
            lot.lot_code.unwrap_or_default(),
            b.grade,
            moisture,
            fm
        ),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": rec_id })))
}

/* -------------------------------------------------------------------------- */
/*                         buyers, trust and matching                         */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Serialize, FromRow)]
struct BuyerStats {
    id: i64,
    name: String,
    verified: i64,
    marketplace_deals: i64,
    fpo_deals: i64,
    fpo_delivered: i64,
    fpo_paid_in_full: i64,
    fpo_value: f64,
    disputes: i64,
}

const BUYER_STATS_SELECT: &str = "SELECT u.id, u.name, COALESCE(b.is_verified, 0) AS verified,
    (SELECT COUNT(*) FROM transactions t JOIN offers o ON o.id = t.offer_id WHERE o.buyer_id = u.id) AS marketplace_deals,
    (SELECT COUNT(*) FROM fpo_sales s WHERE s.buyer_id = u.id) AS fpo_deals,
    (SELECT COUNT(*) FROM fpo_sales s WHERE s.buyer_id = u.id AND s.delivery_status = 'delivered') AS fpo_delivered,
    (SELECT COUNT(*) FROM fpo_sales s WHERE s.buyer_id = u.id AND s.delivery_status = 'delivered'
        AND COALESCE((SELECT SUM(p.amount) FROM fpo_payments p WHERE p.sale_id = s.id), 0.0) >= s.amount - 0.01) AS fpo_paid_in_full,
    COALESCE((SELECT SUM(s.amount) FROM fpo_sales s WHERE s.buyer_id = u.id), 0.0) AS fpo_value,
    (SELECT COUNT(*) FROM fpo_grievances g JOIN fpo_sales s ON s.id = g.sale_id
        WHERE s.buyer_id = u.id AND g.category IN ('payment_delay', 'buyer_issue', 'quality_dispute')) AS disputes
    FROM users u LEFT JOIN buyers b ON b.id = u.id WHERE u.role = 'buyer'";

/// Trust score built only from recorded AgriSense deals; None when there is no history.
fn trust(b: &BuyerStats) -> Value {
    let paid_ratio = if b.fpo_delivered > 0 {
        Some(b.fpo_paid_in_full as f64 / b.fpo_delivered as f64)
    } else {
        None
    };
    let dispute_ratio = if b.fpo_deals > 0 {
        (b.disputes as f64 / b.fpo_deals as f64).min(1.0)
    } else {
        0.0
    };
    let score = paid_ratio.map(|p| {
        (100.0 * (0.2 * b.verified as f64 + 0.5 * p + 0.3 * (1.0 - dispute_ratio))).round()
    });
    json!({
        "score": score,
        "basis": if score.is_some() {
            format!("From {} delivered FPO deal(s) on AgriSense", b.fpo_delivered)
        } else {
            "No delivered deals yet — not enough history for a score".to_string()
        },
        "paid_in_full_pct": paid_ratio.map(|p| (p * 100.0).round()),
        "dispute_count": b.disputes,
        "verified": b.verified == 1,
    })
}

#[derive(Debug, Serialize, FromRow)]
struct Demand {
    id: i64,
    buyer_id: i64,
    buyer_name: String,
    crop_id: i64,
    crop_name: String,
    min_quantity: f64,
    max_price: f64,
    required_quality: String,
    delivery_location: String,
    required_by: String,
}

const DEMAND_SELECT: &str =
    "SELECT d.id, d.buyer_id, u.name AS buyer_name, d.crop_id, c.name AS crop_name,
    d.min_quantity, d.max_price, d.required_quality, d.delivery_location, d.required_by
    FROM buyer_demand d JOIN users u ON u.id = d.buyer_id JOIN crops c ON c.id = d.crop_id
    WHERE d.status = 'open'";

async fn all_buyer_stats(pool: &SqlitePool) -> Result<Vec<BuyerStats>, AppError> {
    let sql = format!("{BUYER_STATS_SELECT} ORDER BY verified DESC, u.name");
    Ok(sqlx::query_as::<_, BuyerStats>(&sql)
        .fetch_all(pool)
        .await?)
}

async fn list_buyers(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Vec<Value>> {
    manager_org(&pool, &user).await?;
    let stats = all_buyer_stats(&pool).await?;
    let demands = sqlx::query_as::<_, Demand>(&format!("{DEMAND_SELECT} ORDER BY d.required_by"))
        .fetch_all(&pool)
        .await?;
    let terms: Vec<(i64, String, i64)> = sqlx::query_as(
        "SELECT buyer_id, payment_terms, COUNT(*) FROM fpo_offers WHERE payment_terms <> ''
         GROUP BY buyer_id, payment_terms ORDER BY COUNT(*) DESC",
    )
    .fetch_all(&pool)
    .await?;
    Ok(Json(
        stats
            .iter()
            .map(|b| {
                let mine: Vec<&Demand> = demands.iter().filter(|d| d.buyer_id == b.id).collect();
                let usual_terms = terms.iter().find(|t| t.0 == b.id).map(|t| t.1.clone());
                json!({
                    "id": b.id, "name": b.name, "verified": b.verified == 1,
                    "deals": { "fpo": b.fpo_deals, "fpo_delivered": b.fpo_delivered, "marketplace": b.marketplace_deals, "fpo_value": r2(b.fpo_value) },
                    "trust": trust(b),
                    "usual_payment_terms": usual_terms,
                    "locations": mine.iter().map(|d| d.delivery_location.clone()).collect::<std::collections::BTreeSet<_>>(),
                    "requirements": mine,
                })
            })
            .collect(),
    ))
}

pub(crate) fn grade_rank(s: &str) -> Option<i32> {
    let u = s.to_uppercase();
    if u.contains("EXPORT") || u.contains("GRADE A") || u.trim() == "A" {
        Some(3)
    } else if u.contains("GRADE B") || u.trim() == "B" || u.contains("STANDARD") {
        Some(2)
    } else if u.contains("GRADE C")
        || u.trim() == "C"
        || u.contains("PROCESS")
        || u.contains("FAQ")
        || u.contains("ANY")
    {
        Some(1)
    } else {
        None
    }
}

async fn lot_matches(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let lot = fetch_lot(&pool, org.id, id).await?;
    let demands = sqlx::query_as::<_, Demand>(&format!(
        "{DEMAND_SELECT} AND d.crop_id = ? ORDER BY d.max_price DESC"
    ))
    .bind(lot.crop_id)
    .fetch_all(&pool)
    .await?;
    let stats = all_buyer_stats(&pool).await?;
    let best_price = demands.iter().map(|d| d.max_price).fold(0.0_f64, f64::max);
    let place = [org.district.to_lowercase(), org.state.to_lowercase()];
    let mut out: Vec<Value> = demands
        .iter()
        .map(|d| {
            let b = stats.iter().find(|s| s.id == d.buyer_id);
            let qty = if d.min_quantity <= 0.0 { 1.0 } else { (lot.available_quintals / d.min_quantity).min(1.0) };
            let price = if best_price > 0.0 { d.max_price / best_price } else { 0.0 };
            let quality = match (lot.grade.as_deref().and_then(grade_rank), grade_rank(&d.required_quality)) {
                (Some(have), Some(need)) if have >= need => 1.0,
                (Some(_), Some(_)) => 0.2,
                _ => 0.5,
            };
            let loc = d.delivery_location.to_lowercase();
            let location = if place.iter().any(|p| !p.is_empty() && loc.contains(p.as_str())) { 1.0 } else { 0.5 };
            let t = b.map(trust).unwrap_or(json!({ "score": null }));
            let reliability = t["score"].as_f64().map(|s| s / 100.0).unwrap_or(0.5);
            let total = 100.0 * (0.3 * qty + 0.25 * price + 0.2 * quality + 0.1 * location + 0.15 * reliability);
            json!({
                "demand": d,
                "buyer_verified": b.map(|s| s.verified == 1).unwrap_or(false),
                "trust": t,
                "score": total.round(),
                "parts": {
                    "quantity": (qty * 100.0).round(), "price": (price * 100.0).round(),
                    "quality": (quality * 100.0).round(), "location": (location * 100.0).round(),
                    "reliability": (reliability * 100.0).round()
                },
                "can_supply_quintals": lot.available_quintals.min(d.min_quantity.max(lot.available_quintals)),
            })
        })
        .collect();
    out.sort_by(|a, b| {
        b["score"]
            .as_f64()
            .partial_cmp(&a["score"].as_f64())
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(Json(
        json!({ "lot": lot, "matches": out, "basis": "Open buyer requirements on AgriSense for this crop. Weights: quantity 30%, price 25%, quality 20%, payment reliability 15%, location 10%." }),
    ))
}

/* ------------------------------ AI bulk selling ----------------------------- */

fn median(mut v: Vec<f64>) -> Option<f64> {
    if v.is_empty() {
        return None;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let m = v.len() / 2;
    Some(if v.len().is_multiple_of(2) {
        (v[m - 1] + v[m]) / 2.0
    } else {
        v[m]
    })
}

/// Least-squares slope (₹ per day) over a daily price series.
fn slope(points: &[f64]) -> f64 {
    let n = points.len() as f64;
    if n < 2.0 {
        return 0.0;
    }
    let mean_x = (n - 1.0) / 2.0;
    let mean_y = points.iter().sum::<f64>() / n;
    let (mut num, mut den) = (0.0, 0.0);
    for (i, y) in points.iter().enumerate() {
        let dx = i as f64 - mean_x;
        num += dx * (y - mean_y);
        den += dx * dx;
    }
    if den == 0.0 {
        0.0
    } else {
        num / den
    }
}

async fn lot_advice(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let lot = fetch_lot(&pool, org.id, id).await?;
    if lot.available_quintals <= EPS {
        return Err(bad("This lot has no unsold stock left"));
    }
    let crop = db::get_crop(&pool, lot.crop_id).await?;
    let state = if org.state.trim().is_empty() {
        "Maharashtra".to_string()
    } else {
        org.state.clone()
    };

    let prices = crate::services::mandi::fetch_prices(Some(&state), Some(&crop.name))
        .await
        .map_err(|e| {
            bad(format!(
                "Live mandi prices are unavailable right now ({e}). Try again in a few minutes."
            ))
        })?;
    let modal: Vec<f64> = prices
        .iter()
        .map(|p| p.modal_price)
        .filter(|p| *p > 0.0)
        .collect();
    let current = median(modal.clone()).ok_or_else(|| {
        bad(format!(
            "No mandi in {state} reported a {} price today, so no recommendation can be made",
            crop.name
        ))
    })?;
    let best_market = prices
        .iter()
        .max_by(|a, b| a.modal_price.partial_cmp(&b.modal_price).unwrap_or(std::cmp::Ordering::Equal))
        .map(|p| json!({ "market": p.market, "district": p.district, "modal_price": p.modal_price, "date": p.date }));

    let history = crate::services::mandi::fetch_history(&state, &crop.name)
        .await
        .unwrap_or_default();
    let series: Vec<f64> = history
        .iter()
        .rev()
        .take(30)
        .rev()
        .map(|(_, p)| *p)
        .collect();
    let trend_available = series.len() >= 5;
    let per_day = if trend_available { slope(&series) } else { 0.0 };
    let horizon_days = (crop.perishability_days as f64 / 2.0).max(1.0);
    let expected = (current + per_day * horizon_days).clamp(current * 0.75, current * 1.25);

    let storage_per_day = match lot.warehouse_id {
        Some(w) => {
            sqlx::query_scalar::<_, f64>(
                "SELECT rate_per_quintal_month / 30.0 FROM fpo_warehouses WHERE id = ?",
            )
            .bind(w)
            .fetch_one(&pool)
            .await?
        }
        None => 0.0,
    };
    let demand_quintals: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(min_quantity), 0.0) FROM buyer_demand WHERE status = 'open' AND crop_id = ?",
    )
    .bind(lot.crop_id)
    .fetch_one(&pool)
    .await?;
    let open_offer_best: Option<f64> = sqlx::query_scalar(
        "SELECT MAX(price_per_quintal) FROM fpo_offers WHERE lot_id = ? AND status = 'open'",
    )
    .bind(id)
    .fetch_one(&pool)
    .await?;

    let req = SmartSaleRequest {
        crop_id: crop.id,
        quantity_quintals: lot.available_quintals,
        current_price_per_quintal: open_offer_best.unwrap_or(current).max(0.01),
        expected_future_price: expected.max(0.01),
        storage_cost_per_day: storage_per_day,
        farmer_urgency: UrgencyLevel::Medium,
        handling_costs: 0.0,
    };
    let advice = evaluate_smart_sale(&req, &crop);
    Ok(Json(json!({
        "lot_code": lot.lot_code,
        "crop": crop.name,
        "state": state,
        "available_quintals": lot.available_quintals,
        "current_price": r2(current),
        "markets_reporting": modal.len(),
        "best_market": best_market,
        "best_open_offer": open_offer_best,
        "trend_available": trend_available,
        "trend_points": series.len(),
        "trend_per_day": r2(per_day),
        "horizon_days": horizon_days,
        "expected_price": r2(expected),
        "storage_cost_per_day": r2(storage_per_day),
        "open_demand_quintals": demand_quintals,
        "advice": advice,
        "is_estimate": true,
        "basis": if trend_available {
            format!("Median of {} live {} mandi prices today, {}-day price trend from Mandi API history, warehouse charges and open buyer demand.", modal.len(), state, series.len())
        } else {
            format!("Median of {} live {} mandi prices today. Price history was not available, so no price rise is assumed.", modal.len(), state)
        },
    })))
}

async fn demand_forecast(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let requirements: Vec<(String, String, f64, i64, f64)> = sqlx::query_as(
        "SELECT c.name, strftime('%Y-%m', d.required_by) AS month, CAST(SUM(d.min_quantity) AS REAL),
                COUNT(DISTINCT d.buyer_id), CAST(AVG(d.max_price) AS REAL)
         FROM buyer_demand d JOIN crops c ON c.id = d.crop_id
         WHERE d.status = 'open' AND date(d.required_by) >= date('now')
         GROUP BY c.name, month ORDER BY month, c.name",
    )
    .fetch_all(&pool)
    .await?;
    let offers: Vec<(String, f64, i64, f64)> = sqlx::query_as(
        "SELECT c.name, CAST(SUM(f.quantity_quintals) AS REAL), COUNT(*), CAST(AVG(f.price_per_quintal) AS REAL)
         FROM fpo_offers f JOIN fpo_lots l ON l.id = f.lot_id JOIN crops c ON c.id = l.crop_id
         WHERE f.created_at >= datetime('now', '-30 days') GROUP BY c.name",
    )
    .fetch_all(&pool)
    .await?;
    let stock: Vec<(String, f64)> = sqlx::query_as(
        "SELECT c.name, CAST(SUM(l.total_quintals - l.reserved_quintals - l.sold_quintals) AS REAL)
         FROM fpo_lots l JOIN crops c ON c.id = l.crop_id WHERE l.fpo_id = ? GROUP BY c.name",
    )
    .bind(org.id)
    .fetch_all(&pool)
    .await?;
    Ok(Json(json!({
        "requirements": requirements.iter().map(|r| json!({"crop": r.0, "month": r.1, "quantity_quintals": r.2, "buyers": r.3, "avg_max_price": r2(r.4)})).collect::<Vec<_>>(),
        "recent_offers": offers.iter().map(|r| json!({"crop": r.0, "quantity_quintals": r.1, "offers": r.2, "avg_price": r2(r.3)})).collect::<Vec<_>>(),
        "your_stock": stock.iter().map(|r| json!({"crop": r.0, "available_quintals": r.1})).collect::<Vec<_>>(),
        "basis": "Expected demand = open buyer requirements on AgriSense by required-by month, plus offers made on FPO lots in the last 30 days. It is not a statistical forecast.",
    })))
}

/* -------------------------------------------------------------------------- */
/*                            offers & negotiation                            */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Serialize, FromRow, Clone)]
struct OfferEvent {
    id: i64,
    offer_id: i64,
    actor_role: String,
    action: String,
    quantity_quintals: f64,
    price_per_quintal: f64,
    note: String,
    created_at: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
struct Offer {
    id: i64,
    fpo_id: i64,
    fpo_name: String,
    fpo_verified: i64,
    lot_id: i64,
    lot_code: Option<String>,
    crop_name: String,
    grade: Option<String>,
    lot_available: f64,
    buyer_id: i64,
    buyer_name: String,
    buyer_verified: i64,
    quantity_quintals: f64,
    price_per_quintal: f64,
    payment_terms: String,
    status: String,
    awaiting: String,
    round: i64,
    created_by_role: String,
    created_at: Option<String>,
    updated_at: Option<String>,
    sale_id: Option<i64>,
    #[sqlx(skip)]
    events: Vec<OfferEvent>,
}

async fn offers_where(
    pool: &SqlitePool,
    filter: &str,
    binds: &[i64],
) -> Result<Vec<Offer>, AppError> {
    let sql = format!(
        "SELECT f.id, f.fpo_id, o.name AS fpo_name, o.verified AS fpo_verified, f.lot_id, l.lot_code,
            c.name AS crop_name, l.grade,
            CAST(l.total_quintals - l.reserved_quintals - l.sold_quintals AS REAL) AS lot_available,
            f.buyer_id, u.name AS buyer_name, COALESCE(b.is_verified, 0) AS buyer_verified,
            f.quantity_quintals, f.price_per_quintal, f.payment_terms, f.status, f.awaiting, f.round,
            f.created_by_role, f.created_at, f.updated_at,
            (SELECT s.id FROM fpo_sales s WHERE s.offer_id = f.id) AS sale_id
         FROM fpo_offers f
         JOIN fpo_lots l ON l.id = f.lot_id
         JOIN crops c ON c.id = l.crop_id
         JOIN users u ON u.id = f.buyer_id
         LEFT JOIN buyers b ON b.id = f.buyer_id
         JOIN fpo_organizations o ON o.id = f.fpo_id
         WHERE {filter} ORDER BY f.status = 'open' DESC, f.updated_at DESC"
    );
    let mut q = sqlx::query_as::<_, Offer>(&sql);
    for b in binds {
        q = q.bind(*b);
    }
    let mut offers = q.fetch_all(pool).await?;
    if offers.is_empty() {
        return Ok(offers);
    }
    let ids: Vec<String> = offers.iter().map(|o| o.id.to_string()).collect();
    // ids are integers from the database, safe to inline.
    let events = sqlx::query_as::<_, OfferEvent>(&format!(
        "SELECT id, offer_id, actor_role, action, quantity_quintals, price_per_quintal, note, created_at
         FROM fpo_offer_events WHERE offer_id IN ({}) ORDER BY id",
        ids.join(",")
    ))
    .fetch_all(pool)
    .await?;
    let mut by_offer: HashMap<i64, Vec<OfferEvent>> = HashMap::new();
    for e in events {
        by_offer.entry(e.offer_id).or_default().push(e);
    }
    for o in &mut offers {
        o.events = by_offer.remove(&o.id).unwrap_or_default();
    }
    Ok(offers)
}

async fn list_fpo_offers(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Vec<Offer>> {
    let org = manager_org(&pool, &user).await?;
    Ok(Json(offers_where(&pool, "f.fpo_id = ?", &[org.id]).await?))
}

#[derive(Deserialize)]
struct NewOfferBody {
    lot_id: i64,
    buyer_id: Option<i64>,
    quantity_quintals: f64,
    price_per_quintal: f64,
    payment_terms: Option<String>,
    note: Option<String>,
}

/// Tells buyers with an open requirement for this crop that a new FPO lot is listed.
pub(crate) async fn notify_buyers_for_fpo_lot(
    pool: &SqlitePool,
    lot_id: i64,
) -> Result<(), AppError> {
    type LotRow = (i64, String, f64, Option<String>, String, String);
    let (crop_id, crop, qty, grade, fpo, place): LotRow = sqlx::query_as(
        "SELECT l.crop_id, c.name, l.total_quintals, l.grade, o.name, trim(o.district || ', ' || o.state, ', ')
         FROM fpo_lots l JOIN crops c ON c.id = l.crop_id JOIN fpo_organizations o ON o.id = l.fpo_id
         WHERE l.id = ?",
    )
    .bind(lot_id)
    .fetch_one(pool)
    .await?;
    let buyers: Vec<i64> = sqlx::query_scalar(
        "SELECT DISTINCT d.buyer_id FROM buyer_demand d JOIN users u ON u.id = d.buyer_id
         WHERE d.crop_id = ? AND d.status = 'open' AND date(d.required_by) >= date('now') AND u.status = 'active'",
    )
    .bind(crop_id)
    .fetch_all(pool)
    .await?;
    let grade = grade
        .as_deref()
        .map(|g| format!(" (grade {g})"))
        .unwrap_or_default();
    let place = if place.is_empty() {
        String::new()
    } else {
        format!(", {place}")
    };
    for buyer in buyers {
        crate::admin::notify_typed(
            pool,
            buyer,
            "matching_lot",
            &format!("New {crop} FPO lot matches your requirement"),
            &format!("{qty} q of {crop}{grade} from {fpo}{place}."),
            Some("/browse-produce"),
        )
        .await?;
    }
    Ok(())
}

async fn insert_offer(
    pool: &SqlitePool,
    fpo_id: i64,
    lot: &FpoLot,
    buyer_id: i64,
    side: &str,
    actor_id: i64,
    b: &NewOfferBody,
) -> Result<i64, AppError> {
    let qty = positive(b.quantity_quintals, "Quantity (quintals)")?;
    let price = positive(b.price_per_quintal, "Price per quintal")?;
    if qty > lot.available_quintals + EPS {
        return Err(bad(format!(
            "Only {:.1} quintals are available in this lot",
            lot.available_quintals
        )));
    }
    let terms = text(
        b.payment_terms.as_deref().unwrap_or(""),
        "Payment terms",
        0,
        200,
    )?;
    let note = text(b.note.as_deref().unwrap_or(""), "Note", 0, 300)?;
    let open: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM fpo_offers WHERE lot_id = ? AND buyer_id = ? AND status = 'open'",
    )
    .bind(lot.id)
    .bind(buyer_id)
    .fetch_one(pool)
    .await?;
    if open > 0 {
        return Err(bad("There is already an open offer between this buyer and lot. Continue that negotiation instead."));
    }
    let awaiting = if side == "buyer" { "fpo" } else { "buyer" };
    let mut tx = pool.begin().await?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_offers (fpo_id, lot_id, buyer_id, quantity_quintals, price_per_quintal, payment_terms, awaiting, created_by_role)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(fpo_id)
    .bind(lot.id)
    .bind(buyer_id)
    .bind(qty)
    .bind(price)
    .bind(&terms)
    .bind(awaiting)
    .bind(side)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO fpo_offer_events (offer_id, actor_role, action, quantity_quintals, price_per_quintal, note)
         VALUES (?, ?, 'offered', ?, ?, ?)",
    )
    .bind(id)
    .bind(side)
    .bind(qty)
    .bind(price)
    .bind(&note)
    .execute(&mut *tx)
    .await?;
    audit(
        &mut *tx,
        fpo_id,
        actor_id,
        "offered",
        "offer",
        Some(id),
        format!(
            "{side}: {qty} q at ₹{price}/q on {}",
            lot.lot_code.clone().unwrap_or_default()
        ),
    )
    .await?;
    tx.commit().await?;
    let code = lot
        .lot_code
        .clone()
        .unwrap_or_else(|| lot.crop_name.clone());
    if side == "buyer" {
        let buyer: String = sqlx::query_scalar("SELECT name FROM users WHERE id = ?")
            .bind(buyer_id)
            .fetch_one(pool)
            .await?;
        notify_manager(
            pool,
            fpo_id,
            "offer",
            &format!("New offer on {code}"),
            &format!(
                "{buyer} offered ₹{price}/q for {qty} q of {}.",
                lot.crop_name
            ),
            "/fpo/marketplace",
        )
        .await?;
    } else {
        let fpo = org_name(pool, fpo_id).await?;
        crate::admin::notify_typed(
            pool,
            buyer_id,
            "offer",
            &format!("{fpo} sent you an offer"),
            &format!("{qty} q of {} at ₹{price}/q.", lot.crop_name),
            Some("/browse-produce"),
        )
        .await?;
    }
    Ok(id)
}

async fn fpo_create_offer(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<NewOfferBody>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let lot = fetch_lot(&pool, org.id, b.lot_id).await?;
    let buyer_id = b.buyer_id.ok_or_else(|| bad("Choose a buyer"))?;
    if user_role(&pool, buyer_id).await? != "buyer" {
        return Err(bad("Offers can only be sent to buyer accounts"));
    }
    let id = insert_offer(&pool, org.id, &lot, buyer_id, "fpo", user.user_id, &b).await?;
    Ok(Json(json!({ "id": id })))
}

#[derive(Deserialize)]
struct RespondBody {
    action: String,
    price_per_quintal: Option<f64>,
    quantity_quintals: Option<f64>,
    payment_terms: Option<String>,
    note: Option<String>,
}

#[derive(FromRow)]
struct OfferCore {
    id: i64,
    fpo_id: i64,
    lot_id: i64,
    buyer_id: i64,
    quantity_quintals: f64,
    price_per_quintal: f64,
    payment_terms: String,
    status: String,
    awaiting: String,
}

async fn respond(
    pool: &SqlitePool,
    offer: OfferCore,
    side: &str,
    actor_id: i64,
    b: RespondBody,
) -> Result<Value, AppError> {
    if offer.status != "open" {
        return Err(bad(format!("This offer is already {}", offer.status)));
    }
    if offer.awaiting != side {
        return Err(bad("Waiting for the other party to respond"));
    }
    let note = text(b.note.as_deref().unwrap_or(""), "Note", 0, 300)?;
    let other = if side == "fpo" { "buyer" } else { "fpo" };
    let mut tx = pool.begin().await?;
    let result = match b.action.as_str() {
        "counter" => {
            let price = positive(
                b.price_per_quintal.unwrap_or(offer.price_per_quintal),
                "Price per quintal",
            )?;
            let qty = positive(
                b.quantity_quintals.unwrap_or(offer.quantity_quintals),
                "Quantity (quintals)",
            )?;
            let available: f64 = sqlx::query_scalar("SELECT total_quintals - reserved_quintals - sold_quintals FROM fpo_lots WHERE id = ?")
                .bind(offer.lot_id)
                .fetch_one(&mut *tx)
                .await?;
            if qty > available + EPS {
                return Err(bad(format!(
                    "Only {available:.1} quintals are available in this lot"
                )));
            }
            let terms = match b.payment_terms.as_deref() {
                Some(t) => text(t, "Payment terms", 0, 200)?,
                None => offer.payment_terms.clone(),
            };
            sqlx::query(
                "UPDATE fpo_offers SET price_per_quintal = ?, quantity_quintals = ?, payment_terms = ?, awaiting = ?,
                 round = round + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open' AND awaiting = ?",
            )
            .bind(price)
            .bind(qty)
            .bind(&terms)
            .bind(other)
            .bind(offer.id)
            .bind(side)
            .execute(&mut *tx)
            .await?;
            event(&mut tx, offer.id, side, "countered", qty, price, &note).await?;
            json!({ "id": offer.id, "status": "open", "awaiting": other })
        }
        "reject" => {
            sqlx::query("UPDATE fpo_offers SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'")
                .bind(offer.id)
                .execute(&mut *tx)
                .await?;
            event(
                &mut tx,
                offer.id,
                side,
                "rejected",
                offer.quantity_quintals,
                offer.price_per_quintal,
                &note,
            )
            .await?;
            json!({ "id": offer.id, "status": "rejected" })
        }
        "accept" => {
            let changed = sqlx::query(
                "UPDATE fpo_offers SET status = 'accepted', updated_at = CURRENT_TIMESTAMP
                 WHERE id = ? AND status = 'open' AND awaiting = ?",
            )
            .bind(offer.id)
            .bind(side)
            .execute(&mut *tx)
            .await?;
            if changed.rows_affected() == 0 {
                return Err(bad("This offer was just changed. Refresh and try again."));
            }
            // Reserve stock atomically — fails if the quantity is no longer free.
            let reserved = sqlx::query(
                "UPDATE fpo_lots SET reserved_quintals = reserved_quintals + ?
                 WHERE id = ? AND total_quintals - reserved_quintals - sold_quintals >= ? - 0.0001",
            )
            .bind(offer.quantity_quintals)
            .bind(offer.lot_id)
            .bind(offer.quantity_quintals)
            .execute(&mut *tx)
            .await?;
            if reserved.rows_affected() == 0 {
                return Err(bad(
                    "Not enough unsold stock left in this lot for this offer",
                ));
            }
            let commission: f64 =
                sqlx::query_scalar("SELECT commission_pct FROM fpo_organizations WHERE id = ?")
                    .bind(offer.fpo_id)
                    .fetch_one(&mut *tx)
                    .await?;
            let amount = r2(offer.quantity_quintals * offer.price_per_quintal);
            let sale_id = sqlx::query_scalar::<_, i64>(
                "INSERT INTO fpo_sales (fpo_id, lot_id, offer_id, buyer_id, quantity_quintals, price_per_quintal, amount, payment_terms, commission_pct)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
            )
            .bind(offer.fpo_id)
            .bind(offer.lot_id)
            .bind(offer.id)
            .bind(offer.buyer_id)
            .bind(offer.quantity_quintals)
            .bind(offer.price_per_quintal)
            .bind(amount)
            .bind(&offer.payment_terms)
            .bind(commission)
            .fetch_one(&mut *tx)
            .await?;
            event(
                &mut tx,
                offer.id,
                side,
                "accepted",
                offer.quantity_quintals,
                offer.price_per_quintal,
                &note,
            )
            .await?;
            audit(
                &mut *tx,
                offer.fpo_id,
                actor_id,
                "sale created",
                "sale",
                Some(sale_id),
                format!(
                    "{} q at ₹{}/q = ₹{amount}",
                    offer.quantity_quintals, offer.price_per_quintal
                ),
            )
            .await?;
            json!({ "id": offer.id, "status": "accepted", "sale_id": sale_id })
        }
        _ => return Err(bad("Action must be accept, reject or counter")),
    };
    audit(
        &mut *tx,
        offer.fpo_id,
        actor_id,
        &format!("{side} {}", b.action),
        "offer",
        Some(offer.id),
        note,
    )
    .await?;
    tx.commit().await?;
    notify_offer_response(pool, &offer, side, &b.action).await?;
    Ok(result)
}

/// Tells the other side what happened to an FPO offer, and pool contributors when it sold.
async fn notify_offer_response(
    pool: &SqlitePool,
    offer: &OfferCore,
    side: &str,
    action: &str,
) -> Result<(), AppError> {
    let (crop, code): (String, Option<String>) = sqlx::query_as(
        "SELECT c.name, l.lot_code FROM fpo_lots l JOIN crops c ON c.id = l.crop_id WHERE l.id = ?",
    )
    .bind(offer.lot_id)
    .fetch_one(pool)
    .await?;
    let code = code.unwrap_or_else(|| crop.clone());
    let (kind, verb) = match action {
        "accept" => ("accepted", "accepted"),
        "reject" => ("rejected", "rejected"),
        _ => ("counter", "countered"),
    };
    if side == "fpo" {
        let fpo = org_name(pool, offer.fpo_id).await?;
        crate::admin::notify_typed(
            pool,
            offer.buyer_id,
            kind,
            &format!("{fpo} {verb} your offer"),
            &format!("{code}: {crop}."),
            Some("/browse-produce"),
        )
        .await?;
    } else {
        let buyer: String = sqlx::query_scalar("SELECT name FROM users WHERE id = ?")
            .bind(offer.buyer_id)
            .fetch_one(pool)
            .await?;
        notify_manager(
            pool,
            offer.fpo_id,
            kind,
            &format!("{buyer} {verb} on {code}"),
            &format!("The buyer {verb} the offer on {crop}."),
            "/fpo/marketplace",
        )
        .await?;
    }
    if action == "accept" {
        notify_contributors(
            pool,
            "c.lot_id = ?",
            offer.lot_id,
            "order",
            &format!("Your pooled {crop} has sold"),
            &format!(
                "A buyer bought {} q at ₹{}/q. Your share is paid after the buyer pays in full.",
                offer.quantity_quintals, offer.price_per_quintal
            ),
            "/my-fpo",
        )
        .await?;
    }
    Ok(())
}

async fn event(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    offer_id: i64,
    role: &str,
    action: &str,
    qty: f64,
    price: f64,
    note: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO fpo_offer_events (offer_id, actor_role, action, quantity_quintals, price_per_quintal, note)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(offer_id)
    .bind(role)
    .bind(action)
    .bind(qty)
    .bind(price)
    .bind(note)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

const OFFER_CORE: &str = "SELECT id, fpo_id, lot_id, buyer_id, quantity_quintals, price_per_quintal, payment_terms, status, awaiting FROM fpo_offers WHERE id = ?";

async fn fpo_respond_offer(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<RespondBody>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let offer = sqlx::query_as::<_, OfferCore>(OFFER_CORE)
        .bind(id)
        .fetch_optional(&pool)
        .await?
        .filter(|o| o.fpo_id == org.id)
        .ok_or_else(|| not_found("Offer not found"))?;
    Ok(Json(respond(&pool, offer, "fpo", user.user_id, b).await?))
}

/* ------------------------------ buyer endpoints ----------------------------- */

async fn market_lots(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Vec<FpoLot>> {
    require(&pool, &user, &["buyer", "admin"]).await?;
    let sql = format!(
        "{LOT_SELECT} WHERE l.total_quintals - l.reserved_quintals - l.sold_quintals > 0.0001 ORDER BY o.verified DESC, l.id DESC"
    );
    Ok(Json(
        sqlx::query_as::<_, FpoLot>(&sql).fetch_all(&pool).await?,
    ))
}

async fn buyer_offers(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Vec<Offer>> {
    require(&pool, &user, &["buyer"]).await?;
    Ok(Json(
        offers_where(&pool, "f.buyer_id = ?", &[user.user_id]).await?,
    ))
}

async fn buyer_create_offer(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<NewOfferBody>,
) -> ApiResult<Value> {
    require(&pool, &user, &["buyer"]).await?;
    crate::verification::require_buyer_can_trade(
        &pool,
        user.user_id,
        b.price_per_quintal * b.quantity_quintals,
    )
    .await?;
    let fpo_id: i64 = sqlx::query_scalar("SELECT fpo_id FROM fpo_lots WHERE id = ?")
        .bind(b.lot_id)
        .fetch_optional(&pool)
        .await?
        .ok_or_else(|| not_found("Lot not found"))?;
    let lot = fetch_lot(&pool, fpo_id, b.lot_id).await?;
    let id = insert_offer(&pool, fpo_id, &lot, user.user_id, "buyer", user.user_id, &b).await?;
    Ok(Json(json!({ "id": id })))
}

async fn buyer_respond_offer(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<RespondBody>,
) -> ApiResult<Value> {
    require(&pool, &user, &["buyer"]).await?;
    let offer = sqlx::query_as::<_, OfferCore>(OFFER_CORE)
        .bind(id)
        .fetch_optional(&pool)
        .await?
        .filter(|o| o.buyer_id == user.user_id)
        .ok_or_else(|| not_found("Offer not found"))?;
    if b.action != "reject" {
        let amount = b.price_per_quintal.unwrap_or(offer.price_per_quintal)
            * b.quantity_quintals.unwrap_or(offer.quantity_quintals);
        crate::verification::require_buyer_can_trade(&pool, user.user_id, amount).await?;
    }
    Ok(Json(respond(&pool, offer, "buyer", user.user_id, b).await?))
}

/* -------------------------------------------------------------------------- */
/*                         sales, payments and payouts                        */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Serialize, FromRow)]
struct Sale {
    id: i64,
    fpo_id: i64,
    lot_id: i64,
    lot_code: Option<String>,
    crop_name: String,
    buyer_id: i64,
    buyer_name: String,
    buyer_verified: i64,
    quantity_quintals: f64,
    price_per_quintal: f64,
    amount: f64,
    payment_terms: String,
    transport_cost: f64,
    storage_cost: f64,
    handling_cost: f64,
    commission_pct: f64,
    delivery_status: String,
    created_at: Option<String>,
    received: f64,
    pending_amount: f64,
    open_disputes: i64,
    payout_count: i64,
    payouts_paid: i64,
    payment_status: String,
}

async fn sales_where(
    pool: &SqlitePool,
    filter: &str,
    binds: &[i64],
) -> Result<Vec<Sale>, AppError> {
    let sql = format!(
        "SELECT x.*, CAST(x.amount - x.received AS REAL) AS pending_amount,
            CASE WHEN x.open_disputes > 0 THEN 'disputed'
                 WHEN x.received >= x.amount - 0.01 THEN 'fully_paid'
                 WHEN x.received > 0 AND x.non_advance = 0 THEN 'advance_paid'
                 WHEN x.received > 0 THEN 'partially_paid'
                 ELSE 'pending' END AS payment_status
         FROM (
            SELECT s.id, s.fpo_id, s.lot_id, l.lot_code, c.name AS crop_name, s.buyer_id, u.name AS buyer_name,
                COALESCE(b.is_verified, 0) AS buyer_verified, s.quantity_quintals, s.price_per_quintal, s.amount,
                s.payment_terms, s.transport_cost, s.storage_cost, s.handling_cost, s.commission_pct,
                s.delivery_status, s.created_at,
                COALESCE((SELECT SUM(p.amount) FROM fpo_payments p WHERE p.sale_id = s.id), 0.0) AS received,
                (SELECT COUNT(*) FROM fpo_payments p WHERE p.sale_id = s.id AND p.kind <> 'advance') AS non_advance,
                (SELECT COUNT(*) FROM fpo_grievances g WHERE g.sale_id = s.id AND g.status IN ('submitted', 'under_review')) AS open_disputes,
                (SELECT COUNT(*) FROM fpo_payouts po WHERE po.sale_id = s.id) AS payout_count,
                (SELECT COUNT(*) FROM fpo_payouts po WHERE po.sale_id = s.id AND po.status = 'paid') AS payouts_paid
            FROM fpo_sales s
            JOIN fpo_lots l ON l.id = s.lot_id
            JOIN crops c ON c.id = l.crop_id
            JOIN users u ON u.id = s.buyer_id
            LEFT JOIN buyers b ON b.id = s.buyer_id
            WHERE {filter}
         ) x ORDER BY x.id DESC"
    );
    let mut q = sqlx::query_as::<_, Sale>(&sql);
    for b in binds {
        q = q.bind(*b);
    }
    Ok(q.fetch_all(pool).await?)
}

async fn fetch_sale(pool: &SqlitePool, fpo_id: i64, id: i64) -> Result<Sale, AppError> {
    sales_where(pool, "s.fpo_id = ? AND s.id = ?", &[fpo_id, id])
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| not_found("Sale not found in your FPO"))
}

async fn list_sales(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Vec<Sale>> {
    let org = manager_org(&pool, &user).await?;
    Ok(Json(sales_where(&pool, "s.fpo_id = ?", &[org.id]).await?))
}

#[derive(Debug, Serialize, FromRow)]
struct Payment {
    id: i64,
    sale_id: i64,
    amount: f64,
    kind: String,
    method: String,
    reference: String,
    paid_on: String,
    receipt_doc_id: Option<i64>,
    receipt_name: Option<String>,
    created_at: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
struct Payout {
    id: i64,
    sale_id: i64,
    member_id: i64,
    member_name: String,
    contribution_id: i64,
    quantity_quintals: f64,
    gross: f64,
    deductions: f64,
    net: f64,
    status: String,
    reference: Option<String>,
    paid_on: Option<String>,
    lot_code: Option<String>,
    crop_name: String,
    buyer_name: String,
    fpo_name: String,
}

async fn payouts_where(
    pool: &SqlitePool,
    filter: &str,
    binds: &[i64],
) -> Result<Vec<Payout>, AppError> {
    let sql = format!(
        "SELECT p.id, p.sale_id, p.member_id, m.name AS member_name, p.contribution_id, p.quantity_quintals,
            p.gross, p.deductions, p.net, p.status, p.reference, p.paid_on, l.lot_code, c.name AS crop_name,
            u.name AS buyer_name, o.name AS fpo_name
         FROM fpo_payouts p
         JOIN fpo_sales s ON s.id = p.sale_id
         JOIN fpo_members m ON m.id = p.member_id
         JOIN fpo_lots l ON l.id = s.lot_id
         JOIN crops c ON c.id = l.crop_id
         JOIN users u ON u.id = s.buyer_id
         JOIN fpo_organizations o ON o.id = s.fpo_id
         WHERE {filter} ORDER BY p.id DESC"
    );
    let mut q = sqlx::query_as::<_, Payout>(&sql);
    for b in binds {
        q = q.bind(*b);
    }
    Ok(q.fetch_all(pool).await?)
}

async fn sale_detail(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let sale = fetch_sale(&pool, org.id, id).await?;
    let payments = sqlx::query_as::<_, Payment>(
        "SELECT p.id, p.sale_id, p.amount, p.kind, p.method, p.reference, p.paid_on, p.receipt_doc_id,
            d.file_name AS receipt_name, p.created_at
         FROM fpo_payments p LEFT JOIN fpo_documents d ON d.id = p.receipt_doc_id
         WHERE p.sale_id = ? ORDER BY p.id",
    )
    .bind(id)
    .fetch_all(&pool)
    .await?;
    let payouts = payouts_where(&pool, "s.fpo_id = ? AND p.sale_id = ?", &[org.id, id]).await?;
    let shipments =
        shipments_where(&pool, "sh.fpo_id = ? AND sh.sale_id = ?", &[org.id, id]).await?;
    Ok(Json(
        json!({ "sale": sale, "payments": payments, "payouts": payouts, "shipments": shipments,
                "buyer_contact": crate::verification::contact(&pool, sale.buyer_id).await? }),
    ))
}

#[derive(Deserialize)]
struct PaymentBody {
    amount: f64,
    kind: String,
    method: String,
    reference: Option<String>,
    paid_on: String,
    receipt: Option<Upload>,
}

async fn record_payment(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<PaymentBody>,
) -> ApiResult<Sale> {
    let org = manager_org(&pool, &user).await?;
    let sale = fetch_sale(&pool, org.id, id).await?;
    let amount = r2(positive(b.amount, "Amount received")?);
    if !matches!(b.kind.as_str(), "advance" | "part" | "final") {
        return Err(bad("Payment type must be advance, part or final"));
    }
    if !matches!(
        b.method.as_str(),
        "upi" | "neft" | "rtgs" | "cheque" | "cash"
    ) {
        return Err(bad("Choose a payment method"));
    }
    let reference = text(
        b.reference.as_deref().unwrap_or(""),
        "Reference / UTR number",
        0,
        80,
    )?;
    if b.method != "cash" && reference.len() < 4 {
        return Err(bad(
            "Enter the UTR / transaction or cheque number shown on the bank statement",
        ));
    }
    let paid_on = date(&b.paid_on, "Payment date")?;
    if amount > sale.pending_amount + 0.01 {
        return Err(bad(format!(
            "Only ₹{:.2} is pending on this sale",
            sale.pending_amount
        )));
    }
    let mut tx = pool.begin().await?;
    let pay_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_payments (sale_id, amount, kind, method, reference, paid_on, recorded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(id)
    .bind(amount)
    .bind(&b.kind)
    .bind(&b.method)
    .bind(&reference)
    .bind(&paid_on)
    .bind(user.user_id)
    .fetch_one(&mut *tx)
    .await?;
    if let Some(upload) = &b.receipt {
        let doc = save_document(&mut *tx, org.id, "payment", pay_id, upload, user.user_id).await?;
        sqlx::query("UPDATE fpo_payments SET receipt_doc_id = ? WHERE id = ?")
            .bind(doc)
            .bind(pay_id)
            .execute(&mut *tx)
            .await?;
    }
    audit(
        &mut *tx,
        org.id,
        user.user_id,
        "payment recorded",
        "sale",
        Some(id),
        format!("₹{amount} {} via {} ref {reference}", b.kind, b.method),
    )
    .await?;
    tx.commit().await?;
    fetch_sale(&pool, org.id, id).await.map(Json)
}

#[derive(Deserialize)]
struct ExpensesBody {
    transport_cost: f64,
    storage_cost: f64,
    handling_cost: f64,
}

async fn update_expenses(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<ExpensesBody>,
) -> ApiResult<Sale> {
    let org = manager_org(&pool, &user).await?;
    let sale = fetch_sale(&pool, org.id, id).await?;
    if sale.payout_count > 0 {
        return Err(bad(
            "Farmer payments are already calculated for this sale; expenses are locked",
        ));
    }
    let t = number(b.transport_cost, "Transport cost", 0.0, sale.amount)?;
    let s = number(b.storage_cost, "Storage cost", 0.0, sale.amount)?;
    let h = number(b.handling_cost, "Handling cost", 0.0, sale.amount)?;
    if t + s + h > sale.amount {
        return Err(bad("Expenses cannot be more than the sale amount"));
    }
    sqlx::query(
        "UPDATE fpo_sales SET transport_cost = ?, storage_cost = ?, handling_cost = ? WHERE id = ?",
    )
    .bind(t)
    .bind(s)
    .bind(h)
    .bind(id)
    .execute(&pool)
    .await?;
    audit(
        &pool,
        org.id,
        user.user_id,
        "expenses set",
        "sale",
        Some(id),
        format!("transport ₹{t}, storage ₹{s}, handling ₹{h}"),
    )
    .await?;
    fetch_sale(&pool, org.id, id).await.map(Json)
}

/// Splits a sale across the lot's contributors in proportion to what each one put in.
/// Splits a sale between the lot's contributors: gross by quantity × grade factor,
/// freight/storage/handling by quantity, FPO commission on each farmer's gross.
async fn compute_distribution(pool: &SqlitePool, sale: &Sale) -> Result<Vec<Value>, AppError> {
    let rows: Vec<(i64, i64, String, f64, Option<String>)> = sqlx::query_as(
        "SELECT c.id, c.member_id, m.name, c.quantity_quintals, c.assessed_grade FROM fpo_contributions c
         JOIN fpo_members m ON m.id = c.member_id WHERE c.lot_id = ? ORDER BY c.id",
    )
    .bind(sale.lot_id)
    .fetch_all(pool)
    .await?;
    let input: Vec<pools::ShareIn> = rows
        .into_iter()
        .map(|(cid, mid, name, q, grade)| pools::ShareIn {
            contribution_id: cid,
            member_id: mid,
            member_name: name,
            quantity: q,
            grade,
        })
        .collect();
    let out = pools::split_sale(
        &input,
        &pools::SaleTerms {
            quantity: sale.quantity_quintals,
            amount: sale.amount,
            transport: sale.transport_cost,
            storage: sale.storage_cost,
            handling: sale.handling_cost,
            commission_pct: sale.commission_pct,
        },
    );
    if out.is_empty() {
        return Err(bad("This lot has no contributions to distribute"));
    }
    Ok(out.into_iter().map(|o| json!(o)).collect())
}

async fn preview_distribution(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let sale = fetch_sale(&pool, org.id, id).await?;
    let rows = compute_distribution(&pool, &sale).await?;
    let commission = r2(sale.amount * sale.commission_pct / 100.0);
    Ok(Json(json!({
        "sale_id": id, "amount": sale.amount,
        "expenses": { "transport": sale.transport_cost, "storage": sale.storage_cost, "handling": sale.handling_cost,
                      "fpo_service_charge": commission, "fpo_service_charge_pct": sale.commission_pct },
        "rows": rows, "saved": sale.payout_count > 0,
    })))
}

async fn create_distribution(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let sale = fetch_sale(&pool, org.id, id).await?;
    if sale.payout_count > 0 {
        return Err(bad("Farmer payments are already calculated for this sale"));
    }
    let rows = compute_distribution(&pool, &sale).await?;
    let mut tx = pool.begin().await?;
    for r in &rows {
        sqlx::query(
            "INSERT INTO fpo_payouts (sale_id, member_id, contribution_id, quantity_quintals, gross, deductions, net)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(r["member_id"].as_i64())
        .bind(r["contribution_id"].as_i64())
        .bind(r["quantity_quintals"].as_f64())
        .bind(r["gross"].as_f64())
        .bind(r["deductions"].as_f64())
        .bind(r["net"].as_f64())
        .execute(&mut *tx)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(d) if d.message().contains("UNIQUE") => bad("Farmer payments are already calculated for this sale"),
            other => AppError::from(other),
        })?;
    }
    audit(
        &mut *tx,
        org.id,
        user.user_id,
        "payouts calculated",
        "sale",
        Some(id),
        format!("{} farmers", rows.len()),
    )
    .await?;
    tx.commit().await?;
    for r in &rows {
        if let Some(member) = r["member_id"].as_i64() {
            let net = r["net"].as_f64().unwrap_or_default();
            notify_member(
                &pool,
                member,
                "payment",
                &format!("Your {} payout is ready", sale.crop_name),
                &format!(
                    "{} calculated your share: {} after deductions.",
                    org.name,
                    crate::market::rupees(net)
                ),
                "/my-fpo",
            )
            .await?;
        }
    }
    Ok(Json(json!({ "created": rows.len() })))
}

#[derive(Deserialize)]
struct PayoutPayBody {
    reference: String,
    paid_on: String,
}

async fn pay_payout(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<PayoutPayBody>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let (sale_id, status, member_id, net): (i64, String, i64, f64) = sqlx::query_as(
        "SELECT p.sale_id, p.status, p.member_id, CAST(p.net AS REAL) FROM fpo_payouts p JOIN fpo_sales s ON s.id = p.sale_id WHERE p.id = ? AND s.fpo_id = ?",
    )
    .bind(id)
    .bind(org.id)
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| not_found("Farmer payment not found"))?;
    if status == "paid" {
        return Err(bad("This farmer is already marked as paid"));
    }
    let sale = fetch_sale(&pool, org.id, sale_id).await?;
    if sale.payment_status != "fully_paid" {
        return Err(bad("Pay farmers only after the buyer's full payment is received and there is no open dispute"));
    }
    let reference = text(&b.reference, "Payment reference / UTR", 4, 80)?;
    let paid_on = date(&b.paid_on, "Payment date")?;
    sqlx::query("UPDATE fpo_payouts SET status = 'paid', reference = ?, paid_on = ? WHERE id = ? AND status = 'due'")
        .bind(&reference)
        .bind(&paid_on)
        .bind(id)
        .execute(&pool)
        .await?;
    audit(
        &pool,
        org.id,
        user.user_id,
        "farmer paid",
        "payout",
        Some(id),
        reference.clone(),
    )
    .await?;
    notify_member(
        &pool,
        member_id,
        "payment",
        &format!("{} paid by {}", crate::market::rupees(net), org.name),
        &format!(
            "Your {} payout was paid on {paid_on}. Reference: {reference}.",
            sale.crop_name
        ),
        "/my-fpo",
    )
    .await?;
    Ok(Json(json!({ "id": id, "status": "paid" })))
}

/* -------------------------------------------------------------------------- */
/*                            logistics & storage                             */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Serialize, FromRow)]
struct Warehouse {
    id: i64,
    name: String,
    location: String,
    capacity_quintals: f64,
    rate_per_quintal_month: f64,
    used_quintals: f64,
    lot_count: i64,
}

async fn list_warehouses(
    State(pool): State<SqlitePool>,
    user: AuthUser,
) -> ApiResult<Vec<Warehouse>> {
    let org = manager_org(&pool, &user).await?;
    Ok(Json(
        sqlx::query_as::<_, Warehouse>(
            "SELECT w.id, w.name, w.location, w.capacity_quintals, CAST(w.rate_per_quintal_month AS REAL) AS rate_per_quintal_month,
                COALESCE((SELECT SUM(l.total_quintals - l.sold_quintals) FROM fpo_lots l WHERE l.warehouse_id = w.id), 0.0) AS used_quintals,
                (SELECT COUNT(*) FROM fpo_lots l WHERE l.warehouse_id = w.id AND l.total_quintals - l.sold_quintals > 0.0001) AS lot_count
             FROM fpo_warehouses w WHERE w.fpo_id = ? ORDER BY w.name",
        )
        .bind(org.id)
        .fetch_all(&pool)
        .await?,
    ))
}

#[derive(Deserialize)]
struct WarehouseBody {
    name: String,
    location: String,
    capacity_quintals: f64,
    rate_per_quintal_month: f64,
}

async fn create_warehouse(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<WarehouseBody>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let name = text(&b.name, "Warehouse name", 2, 100)?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_warehouses (fpo_id, name, location, capacity_quintals, rate_per_quintal_month) VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org.id)
    .bind(&name)
    .bind(text(&b.location, "Location", 2, 150)?)
    .bind(positive(b.capacity_quintals, "Capacity (quintals)")?)
    .bind(number(b.rate_per_quintal_month, "Storage charge", 0.0, 100_000.0)?)
    .fetch_all(&pool)
    .await
    .and_then(|mut rows| rows.pop().ok_or(sqlx::Error::RowNotFound))?;
    audit(
        &pool,
        org.id,
        user.user_id,
        "added",
        "warehouse",
        Some(id),
        name,
    )
    .await?;
    Ok(Json(json!({ "id": id })))
}

#[derive(Debug, Serialize, FromRow)]
struct Transporter {
    id: i64,
    name: String,
    phone: String,
    vehicle_number: String,
    capacity_quintals: f64,
    rate_per_km: f64,
}

async fn list_transporters(
    State(pool): State<SqlitePool>,
    user: AuthUser,
) -> ApiResult<Vec<Transporter>> {
    let org = manager_org(&pool, &user).await?;
    Ok(Json(
        sqlx::query_as::<_, Transporter>(
            "SELECT id, name, phone, vehicle_number, capacity_quintals, CAST(rate_per_km AS REAL) AS rate_per_km
             FROM fpo_transporters WHERE fpo_id = ? ORDER BY name",
        )
        .bind(org.id)
        .fetch_all(&pool)
        .await?,
    ))
}

#[derive(Deserialize)]
struct TransporterBody {
    name: String,
    phone: String,
    vehicle_number: String,
    capacity_quintals: f64,
    rate_per_km: f64,
}

async fn create_transporter(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<TransporterBody>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let name = text(&b.name, "Transporter name", 2, 100)?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_transporters (fpo_id, name, phone, vehicle_number, capacity_quintals, rate_per_km) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org.id)
    .bind(&name)
    .bind(phone(&b.phone)?)
    .bind(text(&b.vehicle_number, "Vehicle number", 4, 20)?.to_uppercase())
    .bind(positive(b.capacity_quintals, "Truck capacity (quintals)")?)
    .bind(number(b.rate_per_km, "Rate per km", 0.0, 10_000.0)?)
    .fetch_all(&pool)
    .await
    .and_then(|mut rows| rows.pop().ok_or(sqlx::Error::RowNotFound))?;
    audit(
        &pool,
        org.id,
        user.user_id,
        "added",
        "transporter",
        Some(id),
        name,
    )
    .await?;
    Ok(Json(json!({ "id": id })))
}

#[derive(Debug, Serialize, FromRow)]
struct Shipment {
    id: i64,
    sale_id: i64,
    lot_code: Option<String>,
    crop_name: String,
    buyer_name: String,
    quantity_quintals: f64,
    transporter_id: Option<i64>,
    transporter_name: Option<String>,
    transporter_phone: Option<String>,
    vehicle_number: Option<String>,
    pickup_location: String,
    delivery_address: String,
    distance_km: f64,
    estimated_cost: f64,
    expected_date: String,
    status: String,
    updated_at: Option<String>,
}

async fn shipments_where(
    pool: &SqlitePool,
    filter: &str,
    binds: &[i64],
) -> Result<Vec<Shipment>, AppError> {
    let sql = format!(
        "SELECT sh.id, sh.sale_id, l.lot_code, c.name AS crop_name, u.name AS buyer_name, s.quantity_quintals,
            sh.transporter_id, t.name AS transporter_name, t.phone AS transporter_phone, t.vehicle_number,
            sh.pickup_location, sh.delivery_address, CAST(sh.distance_km AS REAL) AS distance_km,
            CAST(sh.estimated_cost AS REAL) AS estimated_cost, sh.expected_date, sh.status, sh.updated_at
         FROM fpo_shipments sh
         JOIN fpo_sales s ON s.id = sh.sale_id
         JOIN fpo_lots l ON l.id = s.lot_id
         JOIN crops c ON c.id = l.crop_id
         JOIN users u ON u.id = s.buyer_id
         LEFT JOIN fpo_transporters t ON t.id = sh.transporter_id
         WHERE {filter} ORDER BY sh.status IN ('delivered', 'cancelled'), sh.expected_date"
    );
    let mut q = sqlx::query_as::<_, Shipment>(&sql);
    for b in binds {
        q = q.bind(*b);
    }
    Ok(q.fetch_all(pool).await?)
}

async fn list_shipments(
    State(pool): State<SqlitePool>,
    user: AuthUser,
) -> ApiResult<Vec<Shipment>> {
    let org = manager_org(&pool, &user).await?;
    Ok(Json(
        shipments_where(&pool, "sh.fpo_id = ?", &[org.id]).await?,
    ))
}

#[derive(Deserialize)]
struct ShipmentBody {
    sale_id: i64,
    transporter_id: Option<i64>,
    pickup_location: String,
    delivery_address: String,
    distance_km: f64,
    expected_date: String,
}

async fn create_shipment(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<ShipmentBody>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let sale = fetch_sale(&pool, org.id, b.sale_id).await?;
    if sale.delivery_status == "delivered" {
        return Err(bad("This sale is already delivered"));
    }
    let active: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM fpo_shipments WHERE sale_id = ? AND status NOT IN ('cancelled', 'delivered')",
    )
    .bind(sale.id)
    .fetch_one(&pool)
    .await?;
    if active > 0 {
        return Err(bad("Transport is already arranged for this sale"));
    }
    let km = number(b.distance_km, "Distance (km)", 0.0, 5000.0)?;
    let cost = match b.transporter_id {
        Some(t) => {
            let (cap, rate): (f64, f64) = sqlx::query_as(
                "SELECT capacity_quintals, CAST(rate_per_km AS REAL) FROM fpo_transporters WHERE id = ? AND fpo_id = ?",
            )
            .bind(t)
            .bind(org.id)
            .fetch_optional(&pool)
            .await?
            .ok_or_else(|| bad("Transporter not found"))?;
            let trips = (sale.quantity_quintals / cap).ceil().max(1.0);
            r2(km * rate * trips)
        }
        None => 0.0,
    };
    let mut tx = pool.begin().await?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_shipments (fpo_id, sale_id, transporter_id, pickup_location, delivery_address, distance_km, estimated_cost, expected_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org.id)
    .bind(sale.id)
    .bind(b.transporter_id)
    .bind(text(&b.pickup_location, "Pickup location", 2, 200)?)
    .bind(text(&b.delivery_address, "Delivery address", 5, 300)?)
    .bind(km)
    .bind(cost)
    .bind(date(&b.expected_date, "Expected delivery date")?)
    .fetch_one(&mut *tx)
    .await?;
    if sale.payout_count == 0 && cost > 0.0 {
        sqlx::query("UPDATE fpo_sales SET transport_cost = ? WHERE id = ?")
            .bind(cost)
            .bind(sale.id)
            .execute(&mut *tx)
            .await?;
    }
    audit(
        &mut *tx,
        org.id,
        user.user_id,
        "transport arranged",
        "shipment",
        Some(id),
        format!("sale #{} · est. ₹{cost}", sale.id),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": id, "estimated_cost": cost })))
}

#[derive(Deserialize)]
struct ShipmentStatusBody {
    status: String,
}

async fn update_shipment_status(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<ShipmentStatusBody>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let (sale_id, current): (i64, String) =
        sqlx::query_as("SELECT sale_id, status FROM fpo_shipments WHERE id = ? AND fpo_id = ?")
            .bind(id)
            .bind(org.id)
            .fetch_optional(&pool)
            .await?
            .ok_or_else(|| not_found("Shipment not found"))?;
    let order = ["planned", "dispatched", "in_transit", "delivered"];
    let next = b.status.as_str();
    let pos = |s: &str| order.iter().position(|o| *o == s);
    let allowed = match (pos(&current), next) {
        (Some(_), "cancelled") => current != "delivered",
        (Some(c), n) => pos(n).map(|p| p > c).unwrap_or(false),
        (None, _) => false,
    };
    if !allowed {
        return Err(bad(format!(
            "A shipment that is {current} cannot be changed to {next}"
        )));
    }
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE fpo_shipments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(next)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    match next {
        "dispatched" | "in_transit" => {
            sqlx::query("UPDATE fpo_sales SET delivery_status = 'in_transit' WHERE id = ? AND delivery_status <> 'delivered'")
                .bind(sale_id)
                .execute(&mut *tx)
                .await?;
        }
        "cancelled" => {
            sqlx::query("UPDATE fpo_sales SET delivery_status = 'awaiting_dispatch' WHERE id = ? AND delivery_status <> 'delivered'")
                .bind(sale_id)
                .execute(&mut *tx)
                .await?;
        }
        "delivered" => {
            let (lot_id, qty): (i64, f64) =
                sqlx::query_as("SELECT lot_id, quantity_quintals FROM fpo_sales WHERE id = ?")
                    .bind(sale_id)
                    .fetch_one(&mut *tx)
                    .await?;
            let changed = sqlx::query("UPDATE fpo_sales SET delivery_status = 'delivered' WHERE id = ? AND delivery_status <> 'delivered'")
                .bind(sale_id)
                .execute(&mut *tx)
                .await?;
            // Move reserved stock to sold exactly once.
            if changed.rows_affected() == 1 {
                sqlx::query(
                    "UPDATE fpo_lots SET reserved_quintals = MAX(reserved_quintals - ?, 0), sold_quintals = sold_quintals + ? WHERE id = ?",
                )
                .bind(qty)
                .bind(qty)
                .bind(lot_id)
                .execute(&mut *tx)
                .await?;
            }
        }
        _ => {}
    }
    audit(
        &mut *tx,
        org.id,
        user.user_id,
        &format!("shipment {next}"),
        "shipment",
        Some(id),
        format!("sale #{sale_id}"),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": id, "status": next })))
}

/* -------------------------------------------------------------------------- */
/*                                 grievances                                 */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Serialize, FromRow, Clone)]
struct GrievanceEvent {
    id: i64,
    grievance_id: i64,
    actor_name: String,
    status: String,
    note: String,
    created_at: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
struct Grievance {
    id: i64,
    fpo_id: i64,
    fpo_name: String,
    raised_by: i64,
    raised_by_name: String,
    raised_by_role: String,
    member_id: Option<i64>,
    member_name: Option<String>,
    sale_id: Option<i64>,
    category: String,
    subject: String,
    description: String,
    status: String,
    created_at: Option<String>,
    updated_at: Option<String>,
    #[sqlx(skip)]
    events: Vec<GrievanceEvent>,
    #[sqlx(skip)]
    documents: Vec<DocInfo>,
}

async fn grievances_where(
    pool: &SqlitePool,
    filter: &str,
    binds: &[i64],
) -> Result<Vec<Grievance>, AppError> {
    let sql = format!(
        "SELECT g.id, g.fpo_id, o.name AS fpo_name, g.raised_by, u.name AS raised_by_name, g.raised_by_role,
            g.member_id, m.name AS member_name, g.sale_id, g.category, g.subject, g.description, g.status,
            g.created_at, g.updated_at
         FROM fpo_grievances g
         JOIN fpo_organizations o ON o.id = g.fpo_id
         JOIN users u ON u.id = g.raised_by
         LEFT JOIN fpo_members m ON m.id = g.member_id
         WHERE {filter} ORDER BY g.status IN ('resolved', 'rejected'), g.id DESC"
    );
    let mut q = sqlx::query_as::<_, Grievance>(&sql);
    for b in binds {
        q = q.bind(*b);
    }
    let mut list = q.fetch_all(pool).await?;
    if list.is_empty() {
        return Ok(list);
    }
    let ids = list
        .iter()
        .map(|g| g.id.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let events = sqlx::query_as::<_, GrievanceEvent>(&format!(
        "SELECT e.id, e.grievance_id, u.name AS actor_name, e.status, e.note, e.created_at
         FROM fpo_grievance_events e JOIN users u ON u.id = e.actor_id WHERE e.grievance_id IN ({ids}) ORDER BY e.id"
    ))
    .fetch_all(pool)
    .await?;
    let docs = sqlx::query_as::<_, DocInfo>(&format!(
        "SELECT id, owner_type, owner_id, file_name, mime_type, size_bytes, created_at FROM fpo_documents
         WHERE owner_type = 'grievance' AND owner_id IN ({ids}) ORDER BY id"
    ))
    .fetch_all(pool)
    .await?;
    for g in &mut list {
        g.events = events
            .iter()
            .filter(|e| e.grievance_id == g.id)
            .cloned()
            .collect();
        g.documents = docs
            .iter()
            .filter(|d| d.owner_id == g.id)
            .cloned()
            .collect();
    }
    Ok(list)
}

async fn list_grievances(
    State(pool): State<SqlitePool>,
    user: AuthUser,
) -> ApiResult<Vec<Grievance>> {
    let org = manager_org(&pool, &user).await?;
    Ok(Json(
        grievances_where(&pool, "g.fpo_id = ?", &[org.id]).await?,
    ))
}

#[derive(Deserialize)]
struct GrievanceBody {
    fpo_id: Option<i64>,
    category: String,
    subject: String,
    description: String,
    sale_id: Option<i64>,
    member_id: Option<i64>,
    document: Option<Upload>,
}

async fn insert_grievance(
    pool: &SqlitePool,
    fpo_id: i64,
    user_id: i64,
    role: &str,
    member_id: Option<i64>,
    b: &GrievanceBody,
) -> Result<i64, AppError> {
    if !matches!(
        b.category.as_str(),
        "payment_delay" | "quality_dispute" | "buyer_issue" | "other"
    ) {
        return Err(bad("Choose a complaint type"));
    }
    let subject = text(&b.subject, "Subject", 3, 150)?;
    let description = text(&b.description, "Details", 10, 2000)?;
    if let Some(s) = b.sale_id {
        let ok: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM fpo_sales WHERE id = ? AND fpo_id = ?")
                .bind(s)
                .bind(fpo_id)
                .fetch_one(pool)
                .await?;
        if ok == 0 {
            return Err(bad("Sale not found for this FPO"));
        }
    }
    let mut tx = pool.begin().await?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_grievances (fpo_id, raised_by, raised_by_role, member_id, sale_id, category, subject, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(fpo_id)
    .bind(user_id)
    .bind(role)
    .bind(member_id)
    .bind(b.sale_id)
    .bind(&b.category)
    .bind(&subject)
    .bind(&description)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO fpo_grievance_events (grievance_id, actor_id, status, note) VALUES (?, ?, 'submitted', '')")
        .bind(id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    if let Some(upload) = &b.document {
        save_document(&mut *tx, fpo_id, "grievance", id, upload, user_id).await?;
    }
    audit(
        &mut *tx,
        fpo_id,
        user_id,
        "grievance raised",
        "grievance",
        Some(id),
        subject.clone(),
    )
    .await?;
    tx.commit().await?;
    if role != "fpo" {
        let who: String = sqlx::query_scalar("SELECT name FROM users WHERE id = ?")
            .bind(user_id)
            .fetch_one(pool)
            .await?;
        let what = if role == "buyer" {
            "dispute"
        } else {
            "complaint"
        };
        notify_manager(
            pool,
            fpo_id,
            "dispute",
            &format!("New {what} from {who}"),
            &subject,
            "/fpo/grievances",
        )
        .await?;
    }
    Ok(id)
}

async fn create_grievance(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<GrievanceBody>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    if let Some(m) = b.member_id {
        fetch_member(&pool, org.id, m).await?;
    }
    let id = insert_grievance(&pool, org.id, user.user_id, "fpo", b.member_id, &b).await?;
    Ok(Json(json!({ "id": id })))
}

#[derive(Deserialize)]
struct GrievanceStatusBody {
    status: String,
    note: Option<String>,
}

async fn update_grievance_status(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<GrievanceStatusBody>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let current: String =
        sqlx::query_scalar("SELECT status FROM fpo_grievances WHERE id = ? AND fpo_id = ?")
            .bind(id)
            .bind(org.id)
            .fetch_optional(&pool)
            .await?
            .ok_or_else(|| not_found("Grievance not found"))?;
    let allowed = matches!(
        (current.as_str(), b.status.as_str()),
        ("submitted", "under_review" | "resolved" | "rejected")
            | ("under_review", "resolved" | "rejected")
    );
    if !allowed {
        return Err(bad(format!(
            "A {current} grievance cannot be moved to {}",
            b.status
        )));
    }
    let note = text(b.note.as_deref().unwrap_or(""), "Note", 0, 1000)?;
    if matches!(b.status.as_str(), "resolved" | "rejected") && note.len() < 5 {
        return Err(bad("Write a short note explaining the decision"));
    }
    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE fpo_grievances SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .bind(&b.status)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO fpo_grievance_events (grievance_id, actor_id, status, note) VALUES (?, ?, ?, ?)")
        .bind(id)
        .bind(user.user_id)
        .bind(&b.status)
        .bind(&note)
        .execute(&mut *tx)
        .await?;
    audit(
        &mut *tx,
        org.id,
        user.user_id,
        &format!("grievance {}", b.status),
        "grievance",
        Some(id),
        note,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": id, "status": b.status })))
}

#[derive(Deserialize)]
struct DocBody {
    document: Upload,
}

async fn add_grievance_document(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<DocBody>,
) -> ApiResult<Value> {
    let role = user_role(&pool, user.user_id).await?;
    let (fpo_id, raised_by): (i64, i64) =
        sqlx::query_as("SELECT fpo_id, raised_by FROM fpo_grievances WHERE id = ?")
            .bind(id)
            .fetch_optional(&pool)
            .await?
            .ok_or_else(|| not_found("Grievance not found"))?;
    let allowed = (role == "fpo" && manager_org(&pool, &user).await?.id == fpo_id)
        || raised_by == user.user_id;
    if !allowed {
        return Err(forbidden("You cannot add documents to this grievance"));
    }
    let doc = save_document(&pool, fpo_id, "grievance", id, &b.document, user.user_id).await?;
    Ok(Json(json!({ "id": doc })))
}

/* -------------------------------------------------------------------------- */
/*                               farmer view                                  */
/* -------------------------------------------------------------------------- */

async fn my_fpo(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Value> {
    require(&pool, &user, &["farmer"]).await?;
    // Link memberships recorded with this farmer's mobile number.
    sqlx::query(
        "UPDATE fpo_members SET user_id = ? WHERE user_id IS NULL AND phone = (SELECT phone_number FROM users WHERE id = ?)",
    )
    .bind(user.user_id)
    .bind(user.user_id)
    .execute(&pool)
    .await?;
    type Row3350 = (
        i64,
        i64,
        String,
        i64,
        String,
        String,
        String,
        Option<String>,
    );
    let memberships: Vec<Row3350> = sqlx::query_as(
        "SELECT m.id, o.id, o.name, o.verified, o.district, o.state, m.status, m.joined_at
         FROM fpo_members m JOIN fpo_organizations o ON o.id = m.fpo_id WHERE m.user_id = ?",
    )
    .bind(user.user_id)
    .fetch_all(&pool)
    .await?;
    let member_ids: Vec<i64> = memberships.iter().map(|m| m.0).collect();
    let (contributions, payouts) = if member_ids.is_empty() {
        (vec![], vec![])
    } else {
        let ids = member_ids
            .iter()
            .map(i64::to_string)
            .collect::<Vec<_>>()
            .join(",");
        (
            contributions_where(&pool, &format!("c.member_id IN ({ids})"), &[]).await?,
            payouts_where(&pool, &format!("p.member_id IN ({ids})"), &[]).await?,
        )
    };
    let grievances = grievances_where(&pool, "g.raised_by = ?", &[user.user_id]).await?;
    Ok(Json(json!({
        "memberships": memberships.iter().map(|m| json!({
            "member_id": m.0, "fpo_id": m.1, "fpo_name": m.2, "fpo_verified": m.3 == 1,
            "district": m.4, "state": m.5, "status": m.6, "joined_at": m.7,
        })).collect::<Vec<_>>(),
        "contributions": contributions,
        "payouts": payouts,
        "grievances": grievances,
    })))
}

async fn farmer_grievance(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<GrievanceBody>,
) -> ApiResult<Value> {
    require(&pool, &user, &["farmer"]).await?;
    let fpo_id = b.fpo_id.ok_or_else(|| bad("Choose your FPO"))?;
    let member_id: i64 =
        sqlx::query_scalar("SELECT id FROM fpo_members WHERE fpo_id = ? AND user_id = ?")
            .bind(fpo_id)
            .bind(user.user_id)
            .fetch_optional(&pool)
            .await?
            .ok_or_else(|| forbidden("You are not a member of this FPO"))?;
    if let Some(s) = b.sale_id {
        let mine: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM fpo_payouts WHERE sale_id = ? AND member_id = ?",
        )
        .bind(s)
        .bind(member_id)
        .fetch_one(&pool)
        .await?;
        if mine == 0 {
            return Err(bad(
                "You can only complain about sales that included your crop",
            ));
        }
    }
    let id = insert_grievance(&pool, fpo_id, user.user_id, "farmer", Some(member_id), &b).await?;
    Ok(Json(json!({ "id": id })))
}

/// POST /api/fpo-market/sales/:id/disputes — a buyer raises a dispute on an FPO sale.
async fn buyer_raise_dispute(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(sale_id): Path<i64>,
    Json(mut b): Json<GrievanceBody>,
) -> ApiResult<Value> {
    require(&pool, &user, &["buyer"]).await?;
    let fpo_id: i64 =
        sqlx::query_scalar("SELECT fpo_id FROM fpo_sales WHERE id = ? AND buyer_id = ?")
            .bind(sale_id)
            .bind(user.user_id)
            .fetch_optional(&pool)
            .await?
            .ok_or_else(|| not_found("Sale not found"))?;
    b.sale_id = Some(sale_id);
    b.member_id = None;
    let id = insert_grievance(&pool, fpo_id, user.user_id, "buyer", None, &b).await?;
    Ok(Json(json!({ "id": id })))
}

/* -------------------------------------------------------------------------- */
/*                       dashboard, notifications, audit                      */
/* -------------------------------------------------------------------------- */

async fn build_notifications(pool: &SqlitePool, fpo_id: i64) -> Result<Vec<Value>, AppError> {
    let mut out = vec![];
    let pending: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM fpo_contributions WHERE fpo_id = ? AND status = 'pending'",
    )
    .bind(fpo_id)
    .fetch_one(pool)
    .await?;
    if pending > 0 {
        out.push(json!({ "kind": "contribution", "tone": "warn", "message": format!("{pending} crop pledge(s) or contribution(s) waiting for intake or approval"), "link": "/fpo/aggregation" }));
    }
    let joins: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM fpo_join_requests WHERE fpo_id = ? AND status = 'pending'",
    )
    .bind(fpo_id)
    .fetch_one(pool)
    .await?;
    if joins > 0 {
        out.push(json!({ "kind": "join", "tone": "info", "message": format!("{joins} farmer(s) asked to join your FPO"), "link": "/fpo/farmers" }));
    }
    let overdue: Vec<(i64, String)> = sqlx::query_as(
        "SELECT p.id, c.name FROM fpo_pools p JOIN crops c ON c.id = p.crop_id
         WHERE p.fpo_id = ? AND p.status = 'collecting' AND p.collection_deadline < date('now')",
    )
    .bind(fpo_id)
    .fetch_all(pool)
    .await?;
    for (_, crop) in overdue {
        out.push(json!({ "kind": "pool", "tone": "warn", "message": format!("{crop} pool is past its collection deadline. Lock it or extend collection."), "link": "/fpo/aggregation" }));
    }
    let offers: Vec<(i64, String, Option<String>, f64, f64)> = sqlx::query_as(
        "SELECT f.id, u.name, l.lot_code, f.quantity_quintals, f.price_per_quintal FROM fpo_offers f
         JOIN users u ON u.id = f.buyer_id JOIN fpo_lots l ON l.id = f.lot_id
         WHERE f.fpo_id = ? AND f.status = 'open' AND f.awaiting = 'fpo' ORDER BY f.updated_at DESC LIMIT 10",
    )
    .bind(fpo_id)
    .fetch_all(pool)
    .await?;
    for o in offers {
        out.push(json!({ "kind": "offer", "tone": "info", "message": format!("{} offers ₹{}/q for {} q of {}", o.1, o.4, o.3, o.2.unwrap_or_default()), "link": "/fpo/marketplace" }));
    }
    let ships: Vec<(i64, String, String, String)> = sqlx::query_as(
        "SELECT sh.id, u.name, sh.expected_date, sh.status FROM fpo_shipments sh
         JOIN fpo_sales s ON s.id = sh.sale_id JOIN users u ON u.id = s.buyer_id
         WHERE sh.fpo_id = ? AND sh.status NOT IN ('delivered', 'cancelled') AND date(sh.expected_date) <= date('now', '+3 days')
         ORDER BY sh.expected_date",
    )
    .bind(fpo_id)
    .fetch_all(pool)
    .await?;
    for s in ships {
        out.push(json!({ "kind": "delivery", "tone": "warn", "message": format!("Delivery to {} due {} ({})", s.1, s.2, s.3.replace('_', " ")), "link": "/fpo/logistics" }));
    }
    let unpaid = sales_where(
        pool,
        "s.fpo_id = ? AND s.delivery_status = 'delivered'",
        &[fpo_id],
    )
    .await?;
    for s in unpaid.iter().filter(|s| s.payment_status != "fully_paid") {
        out.push(json!({ "kind": "payment", "tone": "bad", "message": format!("{} still owes ₹{:.0} for {}", s.buyer_name, s.pending_amount, s.lot_code.clone().unwrap_or_default()), "link": "/fpo/transactions" }));
    }
    let griev: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fpo_grievances WHERE fpo_id = ? AND status IN ('submitted', 'under_review')")
        .bind(fpo_id)
        .fetch_one(pool)
        .await?;
    if griev > 0 {
        out.push(json!({ "kind": "grievance", "tone": "bad", "message": format!("{griev} open grievance(s)"), "link": "/fpo/grievances" }));
    }
    let ungraded: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM fpo_lots l WHERE l.fpo_id = ? AND l.grade IS NULL AND l.total_quintals - l.sold_quintals > 0",
    )
    .bind(fpo_id)
    .fetch_one(pool)
    .await?;
    if ungraded > 0 {
        out.push(json!({ "kind": "quality", "tone": "warn", "message": format!("{ungraded} lot(s) have no quality check yet"), "link": "/fpo/quality" }));
    }
    Ok(out)
}

async fn notifications(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Vec<Value>> {
    let org = manager_org(&pool, &user).await?;
    Ok(Json(build_notifications(&pool, org.id).await?))
}

async fn dashboard(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let farmers: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM fpo_members WHERE fpo_id = ? AND status = 'active'",
    )
    .bind(org.id)
    .fetch_one(&pool)
    .await?;
    let (available, reserved): (f64, f64) = sqlx::query_as(
        "SELECT COALESCE(SUM(total_quintals - reserved_quintals - sold_quintals), 0.0), COALESCE(SUM(reserved_quintals), 0.0)
         FROM fpo_lots WHERE fpo_id = ?",
    )
    .bind(org.id)
    .fetch_one(&pool)
    .await?;
    let active_offers: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM fpo_offers WHERE fpo_id = ? AND status = 'open'")
            .bind(org.id)
            .fetch_one(&pool)
            .await?;
    let sales = sales_where(&pool, "s.fpo_id = ?", &[org.id]).await?;
    let revenue: f64 = sales.iter().map(|s| s.amount).sum();
    let received: f64 = sales.iter().map(|s| s.received).sum();
    let active_deals = sales
        .iter()
        .filter(|s| s.delivery_status != "delivered" || s.payment_status != "fully_paid")
        .count();
    let stock_by_crop: Vec<(String, f64, f64, f64)> = sqlx::query_as(
        "SELECT c.name, CAST(SUM(l.total_quintals - l.reserved_quintals - l.sold_quintals) AS REAL),
                CAST(SUM(l.reserved_quintals) AS REAL), CAST(SUM(l.sold_quintals) AS REAL)
         FROM fpo_lots l JOIN crops c ON c.id = l.crop_id WHERE l.fpo_id = ? GROUP BY c.name ORDER BY c.name",
    )
    .bind(org.id)
    .fetch_all(&pool)
    .await?;
    let by_month: Vec<(String, f64, f64, i64)> = sqlx::query_as(
        "SELECT strftime('%Y-%m', created_at) AS month, CAST(SUM(amount) AS REAL), CAST(SUM(quantity_quintals) AS REAL), COUNT(*)
         FROM fpo_sales WHERE fpo_id = ? AND created_at >= date('now', 'start of month', '-5 months')
         GROUP BY month ORDER BY month",
    )
    .bind(org.id)
    .fetch_all(&pool)
    .await?;
    let pending_contributions =
        contributions_where(&pool, "c.fpo_id = ? AND c.status = 'pending'", &[org.id]).await?;
    let offers = offers_where(&pool, "f.fpo_id = ?", &[org.id]).await?;
    let shipments = shipments_where(
        &pool,
        "sh.fpo_id = ? AND sh.status NOT IN ('delivered', 'cancelled')",
        &[org.id],
    )
    .await?;
    Ok(Json(json!({
        "org": org,
        "farmers": farmers,
        "available_quintals": r2(available),
        "reserved_quintals": r2(reserved),
        "active_offers": active_offers,
        "revenue": r2(revenue),
        "received": r2(received),
        "pending_payments": r2(revenue - received),
        "active_deals": active_deals,
        "stock_by_crop": stock_by_crop.iter().map(|r| json!({"crop": r.0, "available": r2(r.1), "reserved": r2(r.2), "sold": r2(r.3)})).collect::<Vec<_>>(),
        "sales_by_month": by_month.iter().map(|r| json!({"month": r.0, "revenue": r2(r.1), "quantity": r2(r.2), "deals": r.3})).collect::<Vec<_>>(),
        "pending_contributions": pending_contributions.into_iter().take(6).collect::<Vec<_>>(),
        "recent_offers": offers.into_iter().take(5).collect::<Vec<_>>(),
        "recent_sales": sales.into_iter().take(5).collect::<Vec<_>>(),
        "upcoming_shipments": shipments.into_iter().take(5).collect::<Vec<_>>(),
        "notifications": build_notifications(&pool, org.id).await?,
        "pools": pools::pools_where(&pool, "p.fpo_id = ? AND p.status IN ('collecting', 'locked', 'listed')", &[org.id]).await?,
        "demand_highlights": pools::demand_highlights(&pool, org.id).await?,
    })))
}

async fn audit_log(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Vec<Value>> {
    let org = manager_org(&pool, &user).await?;
    type Row3590 = (
        i64,
        String,
        String,
        String,
        Option<i64>,
        String,
        Option<String>,
    );
    let rows: Vec<Row3590> = sqlx::query_as(
        "SELECT a.id, u.name, a.action, a.entity, a.entity_id, a.detail, a.created_at
         FROM fpo_audit_log a JOIN users u ON u.id = a.actor_id WHERE a.fpo_id = ? ORDER BY a.id DESC LIMIT 200",
    )
    .bind(org.id)
    .fetch_all(&pool)
    .await?;
    Ok(Json(rows.iter().map(|r| json!({"id": r.0, "actor": r.1, "action": r.2, "entity": r.3, "entity_id": r.4, "detail": r.5, "created_at": r.6})).collect()))
}

/* -------------------------------------------------------------------------- */
/*                                   reports                                  */
/* -------------------------------------------------------------------------- */

#[derive(Deserialize)]
struct ReportQuery {
    from: Option<String>,
    to: Option<String>,
}

async fn report(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(kind): Path<String>,
    Query(q): Query<ReportQuery>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let from = match q.from.as_deref() {
        Some(v) if !v.is_empty() => date(v, "From date")?,
        _ => "0000-01-01".into(),
    };
    let to = match q.to.as_deref() {
        Some(v) if !v.is_empty() => date(v, "To date")?,
        _ => "9999-12-31".into(),
    };
    let (title, columns, rows): (&str, Vec<&str>, Vec<Value>) = match kind.as_str() {
        "monthly_sales" => {
            let r: Vec<(String, i64, f64, f64, f64)> = sqlx::query_as(
                "SELECT strftime('%Y-%m', s.created_at) AS m, COUNT(*), CAST(SUM(s.quantity_quintals) AS REAL), CAST(SUM(s.amount) AS REAL),
                    CAST(COALESCE(SUM((SELECT SUM(p.amount) FROM fpo_payments p WHERE p.sale_id = s.id)), 0) AS REAL)
                 FROM fpo_sales s WHERE s.fpo_id = ? AND date(s.created_at) BETWEEN ? AND ? GROUP BY m ORDER BY m",
            ).bind(org.id).bind(&from).bind(&to).fetch_all(&pool).await?;
            (
                "Monthly sales",
                vec![
                    "Month",
                    "Deals",
                    "Quantity (q)",
                    "Sale value (₹)",
                    "Received (₹)",
                ],
                r.iter()
                    .map(|x| json!([x.0, x.1, r2(x.2), r2(x.3), r2(x.4)]))
                    .collect(),
            )
        }
        "farmer_contributions" => {
            type Row3647 = (String, String, String, i64, f64, f64, f64, f64);
            let r: Vec<Row3647> = sqlx::query_as(
                "SELECT m.name, m.village, COALESCE(GROUP_CONCAT(DISTINCT cr.name), ''), COUNT(c.id),
                    CAST(COALESCE(SUM(CASE WHEN c.status IN ('approved','pooled') THEN c.quantity_quintals END), 0) AS REAL),
                    CAST(COALESCE(SUM(CASE WHEN c.status = 'pending' THEN c.quantity_quintals END), 0) AS REAL),
                    CAST(COALESCE((SELECT SUM(p.net) FROM fpo_payouts p WHERE p.member_id = m.id), 0) AS REAL),
                    CAST(COALESCE((SELECT SUM(p.net) FROM fpo_payouts p WHERE p.member_id = m.id AND p.status = 'paid'), 0) AS REAL)
                 FROM fpo_members m
                 LEFT JOIN fpo_contributions c ON c.member_id = m.id AND date(c.created_at) BETWEEN ? AND ?
                 LEFT JOIN crops cr ON cr.id = c.crop_id
                 WHERE m.fpo_id = ? GROUP BY m.id ORDER BY m.name",
            ).bind(&from).bind(&to).bind(org.id).fetch_all(&pool).await?;
            (
                "Farmer contributions",
                vec![
                    "Farmer",
                    "Village",
                    "Crops",
                    "Entries",
                    "Accepted (q)",
                    "Pending (q)",
                    "Earnings (₹)",
                    "Paid (₹)",
                ],
                r.iter()
                    .map(|x| json!([x.0, x.1, x.2, x.3, r2(x.4), r2(x.5), r2(x.6), r2(x.7)]))
                    .collect(),
            )
        }
        "inventory" => {
            let sql = format!("{LOT_SELECT} WHERE l.fpo_id = ? ORDER BY l.id DESC");
            let lots = sqlx::query_as::<_, FpoLot>(&sql)
                .bind(org.id)
                .fetch_all(&pool)
                .await?;
            (
                "Crop aggregation & inventory",
                vec![
                    "Lot ID",
                    "Crop",
                    "Grade",
                    "Farmers",
                    "Total (q)",
                    "Reserved (q)",
                    "Sold (q)",
                    "Available (q)",
                    "Warehouse",
                    "Status",
                ],
                lots.iter()
                    .map(|l| {
                        json!([
                            l.lot_code,
                            l.crop_name,
                            l.grade,
                            l.contributor_count,
                            r2(l.total_quintals),
                            r2(l.reserved_quintals),
                            r2(l.sold_quintals),
                            r2(l.available_quintals),
                            l.warehouse_name,
                            l.status
                        ])
                    })
                    .collect(),
            )
        }
        "buyer_transactions" => {
            let sales = sales_where(&pool, "s.fpo_id = ?", &[org.id]).await?;
            (
                "Buyer transactions",
                vec![
                    "Date",
                    "Buyer",
                    "Verified",
                    "Lot ID",
                    "Crop",
                    "Quantity (q)",
                    "Price (₹/q)",
                    "Amount (₹)",
                    "Payment",
                    "Delivery",
                ],
                sales
                    .iter()
                    .filter(|s| in_range(&s.created_at, &from, &to))
                    .map(|s| {
                        json!([
                            s.created_at,
                            s.buyer_name,
                            if s.buyer_verified == 1 { "Yes" } else { "No" },
                            s.lot_code,
                            s.crop_name,
                            s.quantity_quintals,
                            s.price_per_quintal,
                            s.amount,
                            s.payment_status,
                            s.delivery_status
                        ])
                    })
                    .collect(),
            )
        }
        "payments" => {
            type Row3750 = (String, String, Option<String>, String, String, String, f64);
            let r: Vec<Row3750> = sqlx::query_as(
                "SELECT p.paid_on, u.name, l.lot_code, p.kind, p.method, p.reference, p.amount
                 FROM fpo_payments p JOIN fpo_sales s ON s.id = p.sale_id JOIN users u ON u.id = s.buyer_id JOIN fpo_lots l ON l.id = s.lot_id
                 WHERE s.fpo_id = ? AND p.paid_on BETWEEN ? AND ? ORDER BY p.paid_on DESC",
            ).bind(org.id).bind(&from).bind(&to).fetch_all(&pool).await?;
            (
                "Payments received",
                vec![
                    "Date",
                    "Buyer",
                    "Lot ID",
                    "Type",
                    "Method",
                    "Reference",
                    "Amount (₹)",
                ],
                r.iter()
                    .map(|x| json!([x.0, x.1, x.2, x.3, x.4.to_uppercase(), x.5, r2(x.6)]))
                    .collect(),
            )
        }
        "profit_expense" => {
            let sales = sales_where(&pool, "s.fpo_id = ?", &[org.id]).await?;
            (
                "Profit & expenses",
                vec![
                    "Lot ID",
                    "Buyer",
                    "Sale value (₹)",
                    "Transport (₹)",
                    "Storage (₹)",
                    "Handling (₹)",
                    "FPO service charge (₹)",
                    "Net to farmers (₹)",
                ],
                sales
                    .iter()
                    .filter(|s| in_range(&s.created_at, &from, &to))
                    .map(|s| {
                        let c = r2(s.amount * s.commission_pct / 100.0);
                        json!([
                            s.lot_code,
                            s.buyer_name,
                            s.amount,
                            s.transport_cost,
                            s.storage_cost,
                            s.handling_cost,
                            c,
                            r2(s.amount - s.transport_cost - s.storage_cost - s.handling_cost - c)
                        ])
                    })
                    .collect(),
            )
        }
        _ => return Err(not_found("Unknown report")),
    };
    Ok(Json(
        json!({ "title": title, "fpo": org.name, "from": q.from, "to": q.to, "columns": columns, "rows": rows }),
    ))
}

fn in_range(created: &Option<String>, from: &str, to: &str) -> bool {
    match created {
        Some(c) => {
            let d = c.get(0..10).unwrap_or(c);
            d >= from && d <= to
        }
        None => true,
    }
}

/* -------------------------------------------------------------------------- */
/*                                    admin                                   */
/* -------------------------------------------------------------------------- */

async fn admin_fpos(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Vec<Value>> {
    require(&pool, &user, &["admin"]).await?;
    type Row3827 = (
        i64,
        String,
        Option<String>,
        String,
        String,
        i64,
        String,
        String,
        i64,
        i64,
        f64,
    );
    let rows: Vec<Row3827> = sqlx::query_as(
        "SELECT o.id, o.name, o.registration_no, o.district, o.state, o.verified, u.name, u.phone_number,
            (SELECT COUNT(*) FROM fpo_members m WHERE m.fpo_id = o.id),
            (SELECT COUNT(*) FROM fpo_lots l WHERE l.fpo_id = o.id),
            COALESCE((SELECT SUM(s.amount) FROM fpo_sales s WHERE s.fpo_id = o.id), 0.0)
         FROM fpo_organizations o JOIN users u ON u.id = o.manager_user_id ORDER BY o.verified, o.name",
    )
    .fetch_all(&pool)
    .await?;
    Ok(Json(rows.iter().map(|r| json!({
        "id": r.0, "name": r.1, "registration_no": r.2, "district": r.3, "state": r.4, "verified": r.5 == 1,
        "manager": r.6, "manager_phone": r.7, "members": r.8, "lots": r.9, "sales_value": r2(r.10),
    })).collect()))
}

async fn admin_buyers(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Vec<Value>> {
    require(&pool, &user, &["admin"]).await?;
    let stats = all_buyer_stats(&pool).await?;
    Ok(Json(stats.iter().map(|b| json!({ "id": b.id, "name": b.name, "verified": b.verified == 1, "fpo_deals": b.fpo_deals, "marketplace_deals": b.marketplace_deals, "trust": trust(b) })).collect()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_base64_and_data_urls() {
        assert_eq!(decode_base64("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(decode_base64("data:text/plain;base64,aGk=").unwrap(), b"hi");
        assert!(decode_base64("a$b").is_none());
    }

    #[test]
    fn slope_of_rising_series() {
        assert!((slope(&[10.0, 12.0, 14.0, 16.0]) - 2.0).abs() < 1e-9);
        assert_eq!(slope(&[5.0]), 0.0);
    }

    #[test]
    fn grade_ranking() {
        assert_eq!(grade_rank("Grade A"), Some(3));
        assert_eq!(grade_rank("B"), Some(2));
        assert_eq!(grade_rank("FAQ"), Some(1));
        assert_eq!(grade_rank("whatever"), None);
    }

    #[test]
    fn lot_code_prefix() {
        assert_eq!(crop_code("Wheat"), "WHE");
        assert_eq!(crop_code("Paddy(Dhan)"), "PAD");
        assert_eq!(crop_code("123"), "CRP");
    }
}
