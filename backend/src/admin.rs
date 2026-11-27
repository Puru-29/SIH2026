//! Admin portal API (`/api/admin/*`) plus the dispute and notification
//! endpoints farmers and buyers use.
//!
//! Every admin endpoint requires the `admin` role, read from the session (DB),
//! and every admin write adds a row to `audit_logs`.

use std::collections::{BTreeMap, HashMap};

use axum::{
    extract::{Path, Query, State},
    routing::{get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, Sqlite, SqlitePool};

use crate::{auth::AuthUser, errors::AppError};

type ApiResult<T> = Result<Json<T>, AppError>;

pub fn routes() -> Router<SqlitePool> {
    Router::new()
        .route("/api/admin/overview", get(overview))
        .route("/api/admin/verifications", get(verifications))
        .route("/api/admin/fpos/:id/decision", post(decide_fpo))
        .route("/api/admin/buyers/:id/decision", post(decide_buyer))
        .route("/api/admin/buyers/:id/trust", post(set_trust))
        .route("/api/admin/users", get(list_users))
        .route("/api/admin/users/:id", get(user_detail))
        .route("/api/admin/users/:id/status", post(set_user_status))
        .route("/api/admin/market/lots", get(market_lots))
        .route("/api/admin/market/offers", get(market_offers))
        .route("/api/admin/market/demands", get(market_demands))
        .route("/api/admin/market/transactions", get(market_transactions))
        .route("/api/admin/market/flags", get(market_flags))
        .route("/api/admin/lots/:id/cancel", post(cancel_lot))
        .route("/api/admin/offers/:id/cancel", post(cancel_offer))
        .route("/api/admin/fpo-offers/:id/cancel", post(cancel_fpo_offer))
        .route("/api/admin/disputes", get(list_disputes))
        .route("/api/admin/disputes/:id", get(dispute_detail))
        .route("/api/admin/disputes/:id/status", post(set_dispute_status))
        .route("/api/admin/intel/supply-demand", get(supply_demand))
        .route("/api/admin/intel/prices", get(price_trend))
        .route(
            "/api/admin/master/:table",
            get(master_list).post(master_create),
        )
        .route(
            "/api/admin/master/:table/:id",
            put(master_update).delete(master_delete),
        )
        .route(
            "/api/admin/announcements",
            get(list_announcements).post(post_announcement),
        )
        .route("/api/admin/audit", get(audit_list))
        .route("/api/disputes", post(raise_dispute))
        .route("/api/disputes/mine", get(my_disputes))
        .route("/api/crop-requests", post(request_crop))
        .route("/api/admin/crop-requests", get(list_crop_requests))
        .route(
            "/api/admin/crop-requests/:id/:action",
            post(decide_crop_request),
        )
}

/* -------------------------------------------------------------------------- */
/*                                   helpers                                  */
/* -------------------------------------------------------------------------- */

fn bad(msg: impl Into<String>) -> AppError {
    AppError::BadRequest(msg.into())
}
fn not_found(msg: impl Into<String>) -> AppError {
    AppError::NotFound(msg.into())
}

fn require_admin(user: &AuthUser) -> Result<(), AppError> {
    if user.role == "admin" {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "This is for AgriSense administrators only".into(),
        ))
    }
}

fn text(value: &str, field: &str, min: usize, max: usize) -> Result<String, AppError> {
    let t = value.trim();
    let n = t.chars().count();
    if n < min {
        return Err(bad(if min <= 1 {
            format!("{field} is required")
        } else {
            format!("{field} must be at least {min} characters")
        }));
    }
    if n > max {
        return Err(bad(format!("{field} must be at most {max} characters")));
    }
    Ok(t.to_string())
}

fn r2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0 + 0.0
}

/// Writes one admin action to the audit log.
pub async fn log<'c, E>(
    ex: E,
    admin_id: i64,
    action: &str,
    entity_type: &str,
    entity_id: Option<i64>,
    details: Value,
) -> Result<(), AppError>
where
    E: sqlx::Executor<'c, Database = Sqlite>,
{
    sqlx::query(
        "INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, details_json) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(admin_id)
    .bind(action)
    .bind(entity_type)
    .bind(entity_id)
    .bind(details.to_string())
    .execute(ex)
    .await?;
    Ok(())
}

/// Sends an in-app notification to one user.
pub async fn notify<'c, E>(
    ex: E,
    user_id: i64,
    title: &str,
    body: &str,
    link: Option<&str>,
) -> Result<(), AppError>
where
    E: sqlx::Executor<'c, Database = Sqlite>,
{
    notify_typed(ex, user_id, "admin", title, body, link).await
}

/// Adds a notification of a given type (offer, counter, accepted, rejected,
/// matching_lot, payment, order, message, dispute, admin, general).
pub async fn notify_typed<'c, E>(
    ex: E,
    user_id: i64,
    kind: &str,
    title: &str,
    body: &str,
    link: Option<&str>,
) -> Result<(), AppError>
where
    E: sqlx::Executor<'c, Database = Sqlite>,
{
    sqlx::query(
        "INSERT INTO user_notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(user_id)
    .bind(kind)
    .bind(title)
    .bind(body)
    .bind(link)
    .execute(ex)
    .await?;
    Ok(())
}

#[derive(Deserialize, Default)]
struct ListQuery {
    page: Option<i64>,
    limit: Option<i64>,
    q: Option<String>,
    role: Option<String>,
    status: Option<String>,
    district: Option<String>,
    crop: Option<String>,
    state: Option<String>,
    action: Option<String>,
    entity_type: Option<String>,
}

impl ListQuery {
    /// (limit, offset, page) with limit 1–100 (default 25).
    fn paging(&self) -> (i64, i64, i64) {
        let limit = self.limit.unwrap_or(25).clamp(1, 100);
        let page = self.page.unwrap_or(1).max(1);
        (limit, (page - 1) * limit, page)
    }
    fn s(v: &Option<String>) -> String {
        v.as_deref().unwrap_or("").trim().to_string()
    }
    fn like(v: &Option<String>) -> String {
        format!("%{}%", Self::s(v).to_lowercase())
    }
}

fn paged<T: Serialize>(items: Vec<T>, total: i64, page: i64, limit: i64) -> Value {
    json!({ "items": items, "total": total, "page": page, "limit": limit,
            "pages": ((total + limit - 1) / limit).max(1) })
}

/// Builds the stored farmer location "District, State" from sign-up or profile input.
/// Only places in the service area (where mandi price data exists) are accepted.
pub fn farmer_location(district: Option<&str>, state: Option<&str>) -> Result<String, AppError> {
    let (state, district) = served_place(district, state)?;
    Ok(format!("{district}, {state}"))
}

/// The official (state, district) spelling, or an error if AgriSense doesn't work there.
pub fn served_place(
    district: Option<&str>,
    state: Option<&str>,
) -> Result<(&'static str, &'static str), AppError> {
    let district = district.map(str::trim).unwrap_or("");
    let state = state.map(str::trim).unwrap_or("");
    if state.is_empty() {
        return Err(bad("Choose your state"));
    }
    if district.is_empty() {
        return Err(bad("Choose your district"));
    }
    crate::locations::canonical(state, district)
        .ok_or_else(|| bad(crate::locations::not_served_message()))
}

/// True when a stored farmer location has no district (old sign-ups saved only a state).
/// True when a stored location is not a served "District, State" (old sign-ups, or
/// places outside the service area) — the user is asked to pick one again.
pub fn location_needs_district(location: Option<&str>) -> bool {
    let l = location.map(str::trim).unwrap_or("");
    match l.rsplit_once(',') {
        Some((district, state)) => crate::locations::canonical(state, district).is_none(),
        None => true,
    }
}

/// States offered at sign-up; also used to read a state out of free-text places.
pub const STATES: [&str; 20] = [
    "Maharashtra",
    "Punjab",
    "Haryana",
    "Uttar Pradesh",
    "Madhya Pradesh",
    "Karnataka",
    "Gujarat",
    "Rajasthan",
    "Delhi",
    "Tamil Nadu",
    "Telangana",
    "Andhra Pradesh",
    "West Bengal",
    "Bihar",
    "Odisha",
    "Kerala",
    "Assam",
    "Chhattisgarh",
    "Jharkhand",
    "Himachal Pradesh",
];

/// Maps free-text places (state names and common mandi cities) to a state.
pub fn region_of(place: &str) -> Option<&'static str> {
    const CITIES: [(&str, &str); 34] = [
        ("navi mumbai", "Maharashtra"),
        ("mumbai", "Maharashtra"),
        ("vashi", "Maharashtra"),
        ("pune", "Maharashtra"),
        ("nashik", "Maharashtra"),
        ("lasalgaon", "Maharashtra"),
        ("nagpur", "Maharashtra"),
        ("latur", "Maharashtra"),
        ("solapur", "Maharashtra"),
        ("ludhiana", "Punjab"),
        ("khanna", "Punjab"),
        ("amritsar", "Punjab"),
        ("jalandhar", "Punjab"),
        ("karnal", "Haryana"),
        ("azadpur", "Delhi"),
        ("new delhi", "Delhi"),
        ("lucknow", "Uttar Pradesh"),
        ("kanpur", "Uttar Pradesh"),
        ("agra", "Uttar Pradesh"),
        ("indore", "Madhya Pradesh"),
        ("bhopal", "Madhya Pradesh"),
        ("bengaluru", "Karnataka"),
        ("bangalore", "Karnataka"),
        ("kolar", "Karnataka"),
        ("ahmedabad", "Gujarat"),
        ("surat", "Gujarat"),
        ("jaipur", "Rajasthan"),
        ("hyderabad", "Telangana"),
        ("chennai", "Tamil Nadu"),
        ("kolkata", "West Bengal"),
        ("guntur", "Andhra Pradesh"),
        ("patna", "Bihar"),
        ("bhubaneswar", "Odisha"),
        ("kochi", "Kerala"),
    ];
    let p = place.to_lowercase();
    STATES
        .iter()
        .find(|s| p.contains(&s.to_lowercase()))
        .copied()
        .or_else(|| CITIES.iter().find(|(c, _)| p.contains(c)).map(|(_, s)| *s))
}

/// Supply ÷ demand → shortage / balanced / oversupply.
pub fn gap_status(supply: f64, demand: f64) -> &'static str {
    if demand <= 0.0 && supply <= 0.0 {
        "none"
    } else if demand <= 0.0 {
        "no_demand"
    } else if supply / demand < 0.8 {
        "shortage"
    } else if supply / demand <= 1.25 {
        "balanced"
    } else {
        "oversupply"
    }
}

fn median(mut v: Vec<f64>) -> Option<f64> {
    v.retain(|x| *x > 0.0);
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

async fn mandi_median(state: &str, crop: &str) -> Option<f64> {
    let rows = crate::services::mandi::fetch_prices(Some(state), Some(crop))
        .await
        .ok()?;
    median(rows.into_iter().map(|r| r.modal_price).collect())
}

fn default_state() -> String {
    std::env::var("MANDI_API_STATE").unwrap_or_else(|_| "Maharashtra".into())
}

/* -------------------------------------------------------------------------- */
/*                                  overview                                  */
/* -------------------------------------------------------------------------- */

async fn overview(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Value> {
    require_admin(&user)?;
    let by_role: Vec<(String, String, i64)> =
        sqlx::query_as("SELECT role, status, COUNT(*) FROM users GROUP BY role, status")
            .fetch_all(&pool)
            .await?;
    let new_week: Vec<(String, i64)> = sqlx::query_as(
        "SELECT role, COUNT(*) FROM users WHERE created_at >= datetime('now', '-7 days') GROUP BY role",
    )
    .fetch_all(&pool)
    .await?;
    let regs: Vec<(String, i64)> = sqlx::query_as(
        "SELECT strftime('%Y-%m-%d', created_at, 'weekday 1', '-7 days') AS wk, COUNT(*)
         FROM users WHERE created_at >= date('now', '-56 days') GROUP BY wk ORDER BY wk",
    )
    .fetch_all(&pool)
    .await?;
    let (lots, lots_q): (i64, f64) = sqlx::query_as(
        "SELECT COUNT(*), CAST(COALESCE(SUM(quantity_quintals), 0) AS REAL) FROM lots WHERE status = 'open'",
    )
    .fetch_one(&pool)
    .await?;
    let (fpo_lots, fpo_q): (i64, f64) = sqlx::query_as(
        "SELECT COUNT(*), CAST(COALESCE(SUM(total_quintals - reserved_quintals - sold_quintals), 0) AS REAL)
         FROM fpo_lots WHERE total_quintals - reserved_quintals - sold_quintals > 0.0001",
    )
    .fetch_one(&pool)
    .await?;
    let (demands, demand_q): (i64, f64) = sqlx::query_as(
        "SELECT COUNT(*), CAST(COALESCE(SUM(min_quantity), 0) AS REAL) FROM buyer_demand
         WHERE status = 'open' AND date(required_by) >= date('now')",
    )
    .fetch_one(&pool)
    .await?;
    let (tx_count, tx_gmv): (i64, f64) = sqlx::query_as(
        "SELECT COUNT(*), CAST(COALESCE(SUM(t.final_price * l.quantity_quintals), 0) AS REAL)
         FROM transactions t JOIN offers o ON o.id = t.offer_id JOIN lots l ON l.id = o.lot_id",
    )
    .fetch_one(&pool)
    .await?;
    let (sale_count, sale_gmv): (i64, f64) =
        sqlx::query_as("SELECT COUNT(*), CAST(COALESCE(SUM(amount), 0) AS REAL) FROM fpo_sales")
            .fetch_one(&pool)
            .await?;
    let gmv_by_month: Vec<(String, f64, i64)> = sqlx::query_as(
        "SELECT m, CAST(SUM(v) AS REAL), CAST(SUM(n) AS INTEGER) FROM (
            SELECT strftime('%Y-%m', t.completed_at) AS m, t.final_price * l.quantity_quintals AS v, 1 AS n
            FROM transactions t JOIN offers o ON o.id = t.offer_id JOIN lots l ON l.id = o.lot_id
            UNION ALL
            SELECT strftime('%Y-%m', s.created_at), s.amount, 1 FROM fpo_sales s
         ) WHERE m >= strftime('%Y-%m', date('now', 'start of month', '-5 months'))
         GROUP BY m ORDER BY m",
    )
    .fetch_all(&pool)
    .await?;
    // Average realised ₹/quintal by crop (both farmer and FPO sales), top 5 by volume.
    let realised: Vec<(String, f64, f64)> = sqlx::query_as(
        "SELECT crop, CAST(SUM(v) / SUM(q) AS REAL), CAST(SUM(q) AS REAL) FROM (
            SELECT c.name AS crop, t.final_price * l.quantity_quintals AS v, l.quantity_quintals AS q
            FROM transactions t JOIN offers o ON o.id = t.offer_id JOIN lots l ON l.id = o.lot_id JOIN crops c ON c.id = l.crop_id
            UNION ALL
            SELECT c.name, s.amount, s.quantity_quintals FROM fpo_sales s JOIN fpo_lots l ON l.id = s.lot_id JOIN crops c ON c.id = l.crop_id
         ) GROUP BY crop HAVING SUM(q) > 0 ORDER BY SUM(q) DESC LIMIT 5",
    )
    .fetch_all(&pool)
    .await?;
    let state = default_state();
    let mut price_vs_mandi = vec![];
    for (crop, avg, qty) in &realised {
        let mandi = mandi_median(&state, crop).await;
        price_vs_mandi.push(json!({
            "crop": crop, "realised_per_quintal": r2(*avg), "quantity_quintals": r2(*qty),
            "mandi_modal": mandi.map(r2),
            "difference_pct": mandi.map(|m| r2((avg - m) / m * 100.0)),
        }));
    }
    let open_disputes: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM disputes WHERE status IN ('open', 'investigating')",
    )
    .fetch_one(&pool)
    .await?;
    let (pending_fpos, pending_buyers) = pending_counts(&pool).await?;

    Ok(Json(json!({
        "users_by_role": by_role.iter().map(|r| json!({"role": r.0, "status": r.1, "count": r.2})).collect::<Vec<_>>(),
        "new_this_week": new_week.iter().map(|r| json!({"role": r.0, "count": r.1})).collect::<Vec<_>>(),
        "registrations_by_week": regs.iter().map(|r| json!({"week": r.0, "count": r.1})).collect::<Vec<_>>(),
        "active_lots": { "farmer": lots, "farmer_quintals": r2(lots_q), "fpo": fpo_lots, "fpo_quintals": r2(fpo_q) },
        "open_demands": { "count": demands, "quintals": r2(demand_q) },
        "transactions": { "farmer": tx_count, "farmer_gmv": r2(tx_gmv), "fpo": sale_count, "fpo_gmv": r2(sale_gmv), "gmv": r2(tx_gmv + sale_gmv) },
        "gmv_by_month": gmv_by_month.iter().map(|r| json!({"month": r.0, "gmv": r2(r.1), "deals": r.2})).collect::<Vec<_>>(),
        "price_vs_mandi": price_vs_mandi,
        "mandi_state": state,
        "open_disputes": open_disputes,
        "pending_verifications": { "fpos": pending_fpos, "buyers": pending_buyers },
    })))
}

async fn pending_counts(pool: &SqlitePool) -> Result<(i64, i64), AppError> {
    let fpos: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM fpo_organizations o JOIN users u ON u.id = o.manager_user_id
         WHERE o.verified = 0 AND o.rejection_reason IS NULL AND u.status <> 'suspended'",
    )
    .fetch_one(pool)
    .await?;
    let buyers: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users u LEFT JOIN buyers b ON b.id = u.id
         WHERE u.role = 'buyer' AND COALESCE(b.is_verified, 0) = 0 AND b.verification_note IS NULL
           AND u.status = 'active'",
    )
    .fetch_one(pool)
    .await?;
    Ok((fpos, buyers))
}

/* -------------------------------------------------------------------------- */
/*                                verification                                */
/* -------------------------------------------------------------------------- */

#[derive(Serialize, FromRow)]
struct PendingFpo {
    id: i64,
    name: String,
    registration_no: Option<String>,
    district: String,
    state: String,
    primary_crops: String,
    manager_id: i64,
    manager: String,
    phone: String,
    created_at: Option<String>,
    members: i64,
    rejection_reason: Option<String>,
}

#[derive(Serialize, FromRow)]
struct PendingBuyer {
    id: i64,
    name: String,
    phone: String,
    created_at: String,
    demands: i64,
    offers: i64,
    verification_note: Option<String>,
}

async fn verifications(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Value> {
    require_admin(&user)?;
    let fpos = sqlx::query_as::<_, PendingFpo>(
        "SELECT o.id, o.name, o.registration_no, o.district, o.state, o.primary_crops, u.id AS manager_id,
            u.name AS manager, u.phone_number AS phone, o.created_at,
            (SELECT COUNT(*) FROM fpo_members m WHERE m.fpo_id = o.id) AS members, o.rejection_reason
         FROM fpo_organizations o JOIN users u ON u.id = o.manager_user_id
         WHERE o.verified = 0 AND u.status <> 'suspended'
         ORDER BY o.rejection_reason IS NOT NULL, o.id",
    )
    .fetch_all(&pool)
    .await?;
    let buyers = sqlx::query_as::<_, PendingBuyer>(
        "SELECT u.id, u.name, u.phone_number AS phone, u.created_at,
            (SELECT COUNT(*) FROM buyer_demand d WHERE d.buyer_id = u.id) AS demands,
            (SELECT COUNT(*) FROM offers x WHERE x.buyer_id = u.id) + (SELECT COUNT(*) FROM fpo_offers y WHERE y.buyer_id = u.id) AS offers,
            b.verification_note
         FROM users u LEFT JOIN buyers b ON b.id = u.id
         WHERE u.role = 'buyer' AND COALESCE(b.is_verified, 0) = 0 AND u.status = 'active'
         ORDER BY b.verification_note IS NOT NULL, u.id",
    )
    .fetch_all(&pool)
    .await?;
    Ok(Json(json!({ "fpos": fpos, "buyers": buyers })))
}

#[derive(Deserialize)]
struct DecisionBody {
    approve: bool,
    reason: Option<String>,
}

async fn decide_fpo(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<DecisionBody>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let (manager_id, name): (i64, String) =
        sqlx::query_as("SELECT manager_user_id, name FROM fpo_organizations WHERE id = ?")
            .bind(id)
            .fetch_optional(&pool)
            .await?
            .ok_or_else(|| not_found("FPO not found"))?;
    let reason = text(
        b.reason.as_deref().unwrap_or(""),
        "Reason",
        if b.approve { 0 } else { 5 },
        500,
    )?;
    let mut tx = pool.begin().await?;
    if b.approve {
        sqlx::query(
            "UPDATE fpo_organizations SET verified = 1, verified_at = CURRENT_TIMESTAMP, verified_by = ?, rejection_reason = NULL WHERE id = ?",
        )
        .bind(user.user_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("UPDATE users SET status = 'active' WHERE id = ? AND status = 'pending'")
            .bind(manager_id)
            .execute(&mut *tx)
            .await?;
        notify(
            &mut *tx,
            manager_id,
            "Your FPO is verified",
            "The AgriSense admin approved your FPO. You can now use the FPO portal.",
            Some("/fpo"),
        )
        .await?;
    } else {
        sqlx::query(
            "UPDATE fpo_organizations SET verified = 0, verified_at = NULL, verified_by = NULL, rejection_reason = ? WHERE id = ?",
        )
        .bind(&reason)
        .bind(id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("UPDATE users SET status = 'pending' WHERE id = ? AND status = 'active'")
            .bind(manager_id)
            .execute(&mut *tx)
            .await?;
        notify(&mut *tx, manager_id, "FPO verification needs changes",
            &format!("The AgriSense admin could not verify your FPO: {reason}. Update your details in the FPO portal to ask again."),
            Some("/fpo")).await?;
    }
    log(
        &mut *tx,
        user.user_id,
        if b.approve {
            "fpo.approve"
        } else {
            "fpo.reject"
        },
        "fpo",
        Some(id),
        json!({ "name": name, "reason": reason }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": id, "verified": b.approve })))
}

async fn decide_buyer(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<DecisionBody>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let name: String = sqlx::query_scalar("SELECT name FROM users WHERE id = ? AND role = 'buyer'")
        .bind(id)
        .fetch_optional(&pool)
        .await?
        .ok_or_else(|| not_found("Buyer not found"))?;
    let reason = text(
        b.reason.as_deref().unwrap_or(""),
        "Reason",
        if b.approve { 0 } else { 5 },
        500,
    )?;
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO buyers (id, trust_score, is_verified, verification_note) VALUES (?, 5.0, ?, ?)
         ON CONFLICT(id) DO UPDATE SET is_verified = excluded.is_verified, verification_note = excluded.verification_note",
    )
    .bind(id)
    .bind(b.approve as i64)
    .bind(if b.approve { None } else { Some(&reason) })
    .execute(&mut *tx)
    .await?;
    // Keep the verification level in step: approve = at least Level 1, decline = Level 0.
    sqlx::query(
        "INSERT INTO buyer_verifications (buyer_id, level, status, business_name, decided_by, decided_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(buyer_id) DO UPDATE SET
            level = CASE WHEN ? THEN MAX(level, 1) ELSE 0 END, status = excluded.status,
            decided_by = excluded.decided_by, decided_at = CURRENT_TIMESTAMP",
    )
    .bind(id)
    .bind(b.approve as i64)
    .bind(if b.approve { "approved" } else { "rejected" })
    .bind(&name)
    .bind(user.user_id)
    .bind(b.approve)
    .execute(&mut *tx)
    .await?;
    if b.approve {
        notify(
            &mut *tx,
            id,
            "Your buyer account is verified",
            "FPOs and farmers will now see a verified badge on your offers.",
            None,
        )
        .await?;
    } else {
        notify(
            &mut *tx,
            id,
            "Buyer verification not approved",
            &format!("The AgriSense admin could not verify your account: {reason}"),
            None,
        )
        .await?;
    }
    log(
        &mut *tx,
        user.user_id,
        if b.approve {
            "buyer.approve"
        } else {
            "buyer.reject"
        },
        "user",
        Some(id),
        json!({ "name": name, "reason": reason }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": id, "verified": b.approve })))
}

#[derive(Deserialize)]
struct TrustBody {
    trust_score: f64,
    reason: String,
}

async fn set_trust(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<TrustBody>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    if !b.trust_score.is_finite() || !(0.0..=5.0).contains(&b.trust_score) {
        return Err(bad("Trust score must be between 0 and 5"));
    }
    let reason = text(&b.reason, "Reason", 5, 500)?;
    let old: f64 = sqlx::query_scalar(
        "SELECT COALESCE((SELECT trust_score FROM buyers WHERE id = u.id), 5.0) FROM users u WHERE u.id = ? AND u.role = 'buyer'",
    )
    .bind(id)
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| not_found("Buyer not found"))?;
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO buyers (id, trust_score, is_verified) VALUES (?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET trust_score = excluded.trust_score",
    )
    .bind(id)
    .bind(r2(b.trust_score))
    .execute(&mut *tx)
    .await?;
    log(
        &mut *tx,
        user.user_id,
        "buyer.trust_score",
        "user",
        Some(id),
        json!({ "from": old, "to": r2(b.trust_score), "reason": reason }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": id, "trust_score": r2(b.trust_score) })))
}

/* -------------------------------------------------------------------------- */
/*                                    users                                   */
/* -------------------------------------------------------------------------- */

#[derive(Serialize, FromRow)]
struct UserRow {
    id: i64,
    name: String,
    role: String,
    phone: String,
    status: String,
    created_at: String,
    location: String,
    buyer_verified: i64,
    trust_score: f64,
    lots: i64,
    offers: i64,
    transactions: i64,
}

const USER_INNER: &str = "SELECT u.id, u.name, u.role, u.phone_number AS phone, u.status, u.created_at,
    COALESCE(CASE WHEN o.id IS NOT NULL THEN trim(o.district || ', ' || o.state, ', ') END, f.location, '') AS location,
    COALESCE(b.is_verified, 0) AS buyer_verified, CAST(COALESCE(b.trust_score, 0) AS REAL) AS trust_score,
    (SELECT COUNT(*) FROM lots l WHERE l.farmer_id = u.id) AS lots,
    (SELECT COUNT(*) FROM offers x WHERE x.buyer_id = u.id) + (SELECT COUNT(*) FROM fpo_offers y WHERE y.buyer_id = u.id) AS offers,
    (SELECT COUNT(*) FROM transactions t JOIN offers x ON x.id = t.offer_id JOIN lots l ON l.id = x.lot_id
        WHERE x.buyer_id = u.id OR l.farmer_id = u.id) AS transactions
    FROM users u LEFT JOIN farmers f ON f.id = u.id LEFT JOIN buyers b ON b.id = u.id
    LEFT JOIN fpo_organizations o ON o.manager_user_id = u.id";

const USER_FILTER: &str = "(? = '' OR x.role = ?) AND (? = '' OR x.status = ?)
    AND (lower(x.name) LIKE ? OR x.phone LIKE ?) AND lower(x.location) LIKE ?";

async fn list_users(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Query(q): Query<ListQuery>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let (limit, offset, page) = q.paging();
    let (role, status, search, district) = (
        ListQuery::s(&q.role),
        ListQuery::s(&q.status),
        ListQuery::like(&q.q),
        ListQuery::like(&q.district),
    );
    let total: i64 = sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM ({USER_INNER}) x WHERE {USER_FILTER}"
    ))
    .bind(&role)
    .bind(&role)
    .bind(&status)
    .bind(&status)
    .bind(&search)
    .bind(&search)
    .bind(&district)
    .fetch_one(&pool)
    .await?;
    let items = sqlx::query_as::<_, UserRow>(&format!(
        "SELECT * FROM ({USER_INNER}) x WHERE {USER_FILTER} ORDER BY x.id DESC LIMIT ? OFFSET ?"
    ))
    .bind(&role)
    .bind(&role)
    .bind(&status)
    .bind(&status)
    .bind(&search)
    .bind(&search)
    .bind(&district)
    .bind(limit)
    .bind(offset)
    .fetch_all(&pool)
    .await?;
    Ok(Json(paged(items, total, page, limit)))
}

async fn user_detail(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let row =
        sqlx::query_as::<_, UserRow>(&format!("SELECT * FROM ({USER_INNER}) x WHERE x.id = ?"))
            .bind(id)
            .fetch_optional(&pool)
            .await?
            .ok_or_else(|| not_found("User not found"))?;
    let lots: Vec<(i64, String, f64, String, String, Option<String>)> = sqlx::query_as(
        "SELECT l.id, c.name, l.quantity_quintals, l.expected_quality, l.status, l.created_at
         FROM lots l JOIN crops c ON c.id = l.crop_id WHERE l.farmer_id = ? ORDER BY l.id DESC LIMIT 50",
    )
    .bind(id)
    .fetch_all(&pool)
    .await?;
    let offers: Vec<(i64, i64, String, f64, String, String)> = sqlx::query_as(
        "SELECT o.id, o.lot_id, c.name, o.price_offered, o.status, o.created_by_role
         FROM offers o JOIN lots l ON l.id = o.lot_id JOIN crops c ON c.id = l.crop_id
         WHERE o.buyer_id = ? OR l.farmer_id = ? ORDER BY o.id DESC LIMIT 50",
    )
    .bind(id)
    .bind(id)
    .fetch_all(&pool)
    .await?;
    let txs: Vec<(i64, String, f64, f64, String, String, String)> = sqlx::query_as(
        "SELECT t.id, c.name, t.final_price, l.quantity_quintals, t.completed_at, buyer.name, farmer.name
         FROM transactions t JOIN offers o ON o.id = t.offer_id JOIN lots l ON l.id = o.lot_id JOIN crops c ON c.id = l.crop_id
         JOIN users buyer ON buyer.id = o.buyer_id JOIN users farmer ON farmer.id = l.farmer_id
         WHERE o.buyer_id = ? OR l.farmer_id = ? ORDER BY t.id DESC LIMIT 50",
    )
    .bind(id)
    .bind(id)
    .fetch_all(&pool)
    .await?;
    let fpo: Option<(i64, String, i64, Option<String>)> = sqlx::query_as(
        "SELECT id, name, verified, rejection_reason FROM fpo_organizations WHERE manager_user_id = ?",
    )
    .bind(id)
    .fetch_optional(&pool)
    .await?;
    let memberships: Vec<(String, String)> = sqlx::query_as(
        "SELECT o.name, m.status FROM fpo_members m JOIN fpo_organizations o ON o.id = m.fpo_id WHERE m.user_id = ?",
    )
    .bind(id)
    .fetch_all(&pool)
    .await?;
    Ok(Json(json!({
        "user": row,
        "lots": lots.iter().map(|l| json!({"id": l.0, "crop": l.1, "quantity_quintals": l.2, "quality": l.3, "status": l.4, "created_at": l.5})).collect::<Vec<_>>(),
        "offers": offers.iter().map(|o| json!({"id": o.0, "lot_id": o.1, "crop": o.2, "price_per_quintal": o.3, "status": o.4, "created_by_role": o.5})).collect::<Vec<_>>(),
        "transactions": txs.iter().map(|t| json!({"id": t.0, "crop": t.1, "price_per_quintal": t.2, "quantity_quintals": t.3, "completed_at": t.4, "buyer": t.5, "farmer": t.6})).collect::<Vec<_>>(),
        "fpo": fpo.map(|f| json!({"id": f.0, "name": f.1, "verified": f.2 == 1, "rejection_reason": f.3})),
        "memberships": memberships.iter().map(|m| json!({"fpo": m.0, "status": m.1})).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
struct StatusBody {
    status: String,
    reason: String,
}

async fn set_user_status(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<StatusBody>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    if !matches!(b.status.as_str(), "active" | "suspended") {
        return Err(bad("Status must be active or suspended"));
    }
    let reason = text(&b.reason, "Reason", 5, 500)?;
    let (role, old): (String, String) =
        sqlx::query_as("SELECT role, status FROM users WHERE id = ?")
            .bind(id)
            .fetch_optional(&pool)
            .await?
            .ok_or_else(|| not_found("User not found"))?;
    if role == "admin" {
        return Err(bad("Administrator accounts cannot be suspended here"));
    }
    // Reactivating an FPO whose organisation is not verified puts it back to pending.
    let next = if b.status == "active" && role == "fpo" {
        let verified: i64 = sqlx::query_scalar(
            "SELECT COALESCE((SELECT verified FROM fpo_organizations WHERE manager_user_id = ?), 0)",
        )
        .bind(id)
        .fetch_one(&pool)
        .await?;
        if verified == 1 {
            "active"
        } else {
            "pending"
        }
    } else {
        b.status.as_str()
    };
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE users SET status = ? WHERE id = ?")
        .bind(next)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if next == "suspended" {
        sqlx::query("DELETE FROM sessions WHERE user_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    } else {
        notify(
            &mut *tx,
            id,
            "Your account is active again",
            &format!("Reason: {reason}"),
            None,
        )
        .await?;
    }
    log(
        &mut *tx,
        user.user_id,
        if next == "suspended" {
            "user.suspend"
        } else {
            "user.reactivate"
        },
        "user",
        Some(id),
        json!({ "from": old, "to": next, "reason": reason }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": id, "status": next })))
}

/* -------------------------------------------------------------------------- */
/*                           marketplace monitoring                           */
/* -------------------------------------------------------------------------- */

async fn market_lots(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Query(q): Query<ListQuery>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let (limit, offset, page) = q.paging();
    let (status, crop) = (ListQuery::s(&q.status), ListQuery::like(&q.crop));
    let inner = "SELECT 'farmer' AS kind, l.id, c.name AS crop, u.name AS seller, l.quantity_quintals AS quantity,
            l.expected_quality AS quality, l.status, COALESCE(f.location, '') AS place, l.created_at, l.cancel_reason
         FROM lots l JOIN crops c ON c.id = l.crop_id JOIN users u ON u.id = l.farmer_id LEFT JOIN farmers f ON f.id = u.id
         UNION ALL
         SELECT 'fpo', l.id, c.name, o.name, l.total_quintals - l.reserved_quintals - l.sold_quintals,
            COALESCE('Grade ' || l.grade, ''),
            CASE WHEN l.sold_quintals >= l.total_quintals - 0.0001 THEN 'sold'
                 WHEN l.total_quintals - l.reserved_quintals - l.sold_quintals <= 0.0001 THEN 'reserved' ELSE 'open' END,
            trim(o.district || ', ' || o.state, ', '), l.created_at, NULL
         FROM fpo_lots l JOIN crops c ON c.id = l.crop_id JOIN fpo_organizations o ON o.id = l.fpo_id";
    let filter = "(? = '' OR x.status = ?) AND lower(x.crop) LIKE ?";
    let total: i64 =
        sqlx::query_scalar(&format!("SELECT COUNT(*) FROM ({inner}) x WHERE {filter}"))
            .bind(&status)
            .bind(&status)
            .bind(&crop)
            .fetch_one(&pool)
            .await?;
    type Row = (
        String,
        i64,
        String,
        String,
        f64,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
    );
    let rows: Vec<Row> = sqlx::query_as(&format!(
        "SELECT * FROM ({inner}) x WHERE {filter} ORDER BY x.created_at DESC LIMIT ? OFFSET ?"
    ))
    .bind(&status)
    .bind(&status)
    .bind(&crop)
    .bind(limit)
    .bind(offset)
    .fetch_all(&pool)
    .await?;
    let items: Vec<Value> = rows.into_iter().map(|r| json!({
        "kind": r.0, "id": r.1, "crop": r.2, "seller": r.3, "quantity_quintals": r2(r.4), "quality": r.5,
        "status": r.6, "place": r.7, "created_at": r.8, "cancel_reason": r.9,
    })).collect();
    Ok(Json(paged(items, total, page, limit)))
}

async fn market_offers(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Query(q): Query<ListQuery>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let (limit, offset, page) = q.paging();
    let (status, crop) = (ListQuery::s(&q.status), ListQuery::like(&q.crop));
    let inner = "SELECT 'farmer' AS kind, o.id, o.lot_id, c.name AS crop, b.name AS buyer, s.name AS seller,
            l.quantity_quintals AS quantity, o.price_offered AS price, o.status, o.created_at, o.cancel_reason
         FROM offers o JOIN lots l ON l.id = o.lot_id JOIN crops c ON c.id = l.crop_id
         JOIN users b ON b.id = o.buyer_id JOIN users s ON s.id = l.farmer_id
         UNION ALL
         SELECT 'fpo', f.id, f.lot_id, c.name, b.name, org.name, f.quantity_quintals, f.price_per_quintal,
            f.status, f.created_at, NULL
         FROM fpo_offers f JOIN fpo_lots l ON l.id = f.lot_id JOIN crops c ON c.id = l.crop_id
         JOIN users b ON b.id = f.buyer_id JOIN fpo_organizations org ON org.id = f.fpo_id";
    let filter = "(? = '' OR x.status = ?) AND lower(x.crop) LIKE ?";
    let total: i64 =
        sqlx::query_scalar(&format!("SELECT COUNT(*) FROM ({inner}) x WHERE {filter}"))
            .bind(&status)
            .bind(&status)
            .bind(&crop)
            .fetch_one(&pool)
            .await?;
    type Row = (
        String,
        i64,
        i64,
        String,
        String,
        String,
        f64,
        f64,
        String,
        Option<String>,
        Option<String>,
    );
    let rows: Vec<Row> = sqlx::query_as(&format!(
        "SELECT * FROM ({inner}) x WHERE {filter} ORDER BY x.created_at DESC LIMIT ? OFFSET ?"
    ))
    .bind(&status)
    .bind(&status)
    .bind(&crop)
    .bind(limit)
    .bind(offset)
    .fetch_all(&pool)
    .await?;
    let items: Vec<Value> = rows.into_iter().map(|r| json!({
        "kind": r.0, "id": r.1, "lot_id": r.2, "crop": r.3, "buyer": r.4, "seller": r.5,
        "quantity_quintals": r2(r.6), "price_per_quintal": r2(r.7), "status": r.8, "created_at": r.9, "cancel_reason": r.10,
    })).collect();
    Ok(Json(paged(items, total, page, limit)))
}

async fn market_demands(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Query(q): Query<ListQuery>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let (limit, offset, page) = q.paging();
    let (status, crop) = (ListQuery::s(&q.status), ListQuery::like(&q.crop));
    let filter = "(? = '' OR d.status = ?) AND lower(c.name) LIKE ?";
    let from =
        "FROM buyer_demand d JOIN crops c ON c.id = d.crop_id JOIN users u ON u.id = d.buyer_id";
    let total: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) {from} WHERE {filter}"))
        .bind(&status)
        .bind(&status)
        .bind(&crop)
        .fetch_one(&pool)
        .await?;
    type Row = (
        i64,
        String,
        String,
        f64,
        f64,
        String,
        String,
        String,
        String,
    );
    let rows: Vec<Row> = sqlx::query_as(&format!(
        "SELECT d.id, c.name, u.name, d.min_quantity, d.max_price, d.required_quality, d.delivery_location,
            d.required_by, d.status {from} WHERE {filter} ORDER BY d.id DESC LIMIT ? OFFSET ?"
    ))
    .bind(&status).bind(&status).bind(&crop)
    .bind(limit)
    .bind(offset)
    .fetch_all(&pool)
    .await?;
    let items: Vec<Value> = rows.into_iter().map(|r| json!({
        "id": r.0, "crop": r.1, "buyer": r.2, "quantity_quintals": r.3, "max_price": r.4, "quality": r.5,
        "location": r.6, "required_by": r.7, "status": r.8,
    })).collect();
    Ok(Json(paged(items, total, page, limit)))
}

async fn market_transactions(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Query(q): Query<ListQuery>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let (limit, offset, page) = q.paging();
    let crop = ListQuery::like(&q.crop);
    let inner = "SELECT 'farmer' AS kind, t.id, c.name AS crop, b.name AS buyer, s.name AS seller,
            l.quantity_quintals AS quantity, t.final_price AS price, t.final_price * l.quantity_quintals AS amount,
            t.status, t.completed_at AS created_at,
            (SELECT COUNT(*) FROM disputes d WHERE d.transaction_id = t.id AND d.status IN ('open', 'investigating')) AS disputes
         FROM transactions t JOIN offers o ON o.id = t.offer_id JOIN lots l ON l.id = o.lot_id JOIN crops c ON c.id = l.crop_id
         JOIN users b ON b.id = o.buyer_id JOIN users s ON s.id = l.farmer_id
         UNION ALL
         SELECT 'fpo', s.id, c.name, b.name, org.name, s.quantity_quintals, s.price_per_quintal, s.amount,
            s.delivery_status, s.created_at,
            (SELECT COUNT(*) FROM fpo_grievances g WHERE g.sale_id = s.id AND g.status IN ('submitted', 'under_review'))
         FROM fpo_sales s JOIN fpo_lots l ON l.id = s.lot_id JOIN crops c ON c.id = l.crop_id
         JOIN users b ON b.id = s.buyer_id JOIN fpo_organizations org ON org.id = s.fpo_id";
    let total: i64 = sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM ({inner}) x WHERE lower(x.crop) LIKE ?"
    ))
    .bind(&crop)
    .fetch_one(&pool)
    .await?;
    type Row = (
        String,
        i64,
        String,
        String,
        String,
        f64,
        f64,
        f64,
        String,
        String,
        i64,
    );
    let rows: Vec<Row> = sqlx::query_as(&format!(
        "SELECT * FROM ({inner}) x WHERE lower(x.crop) LIKE ? ORDER BY x.created_at DESC LIMIT ? OFFSET ?"
    ))
    .bind(&crop)
    .bind(limit)
    .bind(offset)
    .fetch_all(&pool)
    .await?;
    let items: Vec<Value> = rows.into_iter().map(|r| json!({
        "kind": r.0, "id": r.1, "crop": r.2, "buyer": r.3, "seller": r.4, "quantity_quintals": r2(r.5),
        "price_per_quintal": r2(r.6), "amount": r2(r.7), "status": r.8, "created_at": r.9, "open_disputes": r.10,
    })).collect();
    Ok(Json(paged(items, total, page, limit)))
}

/// Suspicious activity, computed on demand:
/// - offers below 70% of today's mandi modal price for the crop and state,
/// - buyers with 2+ FPO deals older than 7 days and nothing paid,
/// - the same farmer listing the same crop, quantity and quality twice within a day.
async fn market_flags(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Value> {
    require_admin(&user)?;
    let mut flags: Vec<Value> = vec![];
    let state_default = default_state();

    type OfferRow = (String, i64, i64, String, String, String, f64, String);
    let offers: Vec<OfferRow> = sqlx::query_as(
        "SELECT 'farmer', o.id, o.lot_id, c.name, COALESCE(f.location, ''), b.name, o.price_offered, o.status
         FROM offers o JOIN lots l ON l.id = o.lot_id JOIN crops c ON c.id = l.crop_id
         JOIN users b ON b.id = o.buyer_id LEFT JOIN farmers f ON f.id = l.farmer_id
         WHERE o.status IN ('pending', 'accepted') AND o.created_at >= datetime('now', '-90 days')
         UNION ALL
         SELECT 'fpo', x.id, x.lot_id, c.name, org.state, b.name, x.price_per_quintal, x.status
         FROM fpo_offers x JOIN fpo_lots l ON l.id = x.lot_id JOIN crops c ON c.id = l.crop_id
         JOIN users b ON b.id = x.buyer_id JOIN fpo_organizations org ON org.id = x.fpo_id
         WHERE x.status IN ('open', 'accepted') AND x.created_at >= datetime('now', '-90 days')",
    )
    .fetch_all(&pool)
    .await?;
    let mut medians: HashMap<(String, String), Option<f64>> = HashMap::new();
    let mut checked_pairs = 0;
    let mut unavailable = vec![];
    for (kind, id, lot_id, crop, place, buyer, price, status) in &offers {
        let state = region_of(place)
            .map(str::to_string)
            .unwrap_or_else(|| state_default.clone());
        let key = (state.clone(), crop.clone());
        if !medians.contains_key(&key) {
            if checked_pairs >= 8 {
                continue; // stay inside the Mandi API rate limit
            }
            checked_pairs += 1;
            medians.insert(key.clone(), mandi_median(&state, crop).await);
        }
        match medians.get(&key).copied().flatten() {
            Some(m) if *price < 0.7 * m => flags.push(json!({
                "kind": "low_price", "severity": if *price < 0.5 * m { "high" } else { "medium" },
                "entity_type": if kind == "fpo" { "fpo_offer" } else { "offer" }, "entity_id": id, "lot_id": lot_id,
                "message": format!("{buyer} offered ₹{price:.0}/q for {crop}, {:.0}% below today's {state} mandi modal of ₹{m:.0}/q", (1.0 - price / m) * 100.0),
                "status": status,
            })),
            Some(_) => {}
            None => unavailable.push(format!("{crop} ({state})")),
        }
    }

    let unpaid: Vec<(i64, String, i64, f64)> = sqlx::query_as(
        "SELECT s.buyer_id, u.name, COUNT(*), CAST(SUM(s.amount) AS REAL) FROM fpo_sales s JOIN users u ON u.id = s.buyer_id
         WHERE s.created_at <= datetime('now', '-7 days')
           AND COALESCE((SELECT SUM(p.amount) FROM fpo_payments p WHERE p.sale_id = s.id), 0) = 0
         GROUP BY s.buyer_id HAVING COUNT(*) >= 2",
    )
    .fetch_all(&pool)
    .await?;
    for (buyer_id, name, n, amount) in unpaid {
        flags.push(json!({
            "kind": "no_settlement", "severity": "high", "entity_type": "user", "entity_id": buyer_id,
            "message": format!("{name} has {n} accepted FPO deals older than 7 days with nothing paid (₹{amount:.0})"),
        }));
    }

    let dups: Vec<(i64, i64, String, String, f64)> = sqlx::query_as(
        "SELECT a.id, b.id, u.name, c.name, a.quantity_quintals FROM lots a
         JOIN lots b ON b.farmer_id = a.farmer_id AND b.crop_id = a.crop_id AND b.id > a.id
            AND abs(b.quantity_quintals - a.quantity_quintals) < 0.0001 AND b.expected_quality = a.expected_quality
            AND abs(julianday(b.created_at) - julianday(a.created_at)) < 1
         JOIN users u ON u.id = a.farmer_id JOIN crops c ON c.id = a.crop_id
         WHERE a.status = 'open' AND b.status = 'open'",
    )
    .fetch_all(&pool)
    .await?;
    for (a, b, name, crop, q) in dups {
        flags.push(json!({
            "kind": "duplicate_lot", "severity": "medium", "entity_type": "lot", "entity_id": b,
            "message": format!("{name} listed {q} q {crop} twice within a day (lots #{a} and #{b})"),
        }));
    }
    Ok(Json(json!({
        "flags": flags,
        "price_check_unavailable": unavailable,
        "rules": "Offers below 70% of today's mandi modal (high if below 50%); buyers with 2+ unpaid FPO deals older than 7 days; identical open lots by the same farmer within 24 hours.",
    })))
}

#[derive(Deserialize)]
struct ReasonBody {
    reason: String,
}

async fn cancel_lot(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<ReasonBody>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let reason = text(&b.reason, "Reason", 5, 500)?;
    let (farmer_id, status): (i64, String) =
        sqlx::query_as("SELECT farmer_id, status FROM lots WHERE id = ?")
            .bind(id)
            .fetch_optional(&pool)
            .await?
            .ok_or_else(|| not_found("Lot not found"))?;
    if status != "open" {
        return Err(bad(format!(
            "Only open lots can be cancelled; this lot is {status}"
        )));
    }
    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE lots SET status = 'cancelled', cancel_reason = ? WHERE id = ? AND status = 'open'",
    )
    .bind(&reason)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE offers SET status = 'cancelled', cancel_reason = 'Lot cancelled by admin' WHERE lot_id = ? AND status = 'pending'")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    notify(
        &mut *tx,
        farmer_id,
        "A lot was removed by the admin",
        &format!("Lot #{id}: {reason}"),
        Some("/crops"),
    )
    .await?;
    log(
        &mut *tx,
        user.user_id,
        "lot.cancel",
        "lot",
        Some(id),
        json!({ "reason": reason }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": id, "status": "cancelled" })))
}

async fn cancel_offer(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<ReasonBody>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let reason = text(&b.reason, "Reason", 5, 500)?;
    let (buyer_id, farmer_id, status): (i64, i64, String) = sqlx::query_as(
        "SELECT o.buyer_id, l.farmer_id, o.status FROM offers o JOIN lots l ON l.id = o.lot_id WHERE o.id = ?",
    )
    .bind(id)
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| not_found("Offer not found"))?;
    if status != "pending" {
        return Err(bad(format!(
            "Only pending offers can be cancelled; this offer is {status}"
        )));
    }
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE offers SET status = 'cancelled', cancel_reason = ? WHERE id = ? AND status = 'pending'")
        .bind(&reason)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    for uid in [buyer_id, farmer_id] {
        notify(
            &mut *tx,
            uid,
            "An offer was cancelled by the admin",
            &format!("Offer #{id}: {reason}"),
            None,
        )
        .await?;
    }
    log(
        &mut *tx,
        user.user_id,
        "offer.cancel",
        "offer",
        Some(id),
        json!({ "reason": reason }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": id, "status": "cancelled" })))
}

async fn cancel_fpo_offer(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<ReasonBody>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let reason = text(&b.reason, "Reason", 5, 500)?;
    let (buyer_id, manager_id, status, qty, price): (i64, i64, String, f64, f64) = sqlx::query_as(
        "SELECT f.buyer_id, o.manager_user_id, f.status, f.quantity_quintals, f.price_per_quintal
         FROM fpo_offers f JOIN fpo_organizations o ON o.id = f.fpo_id WHERE f.id = ?",
    )
    .bind(id)
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| not_found("Offer not found"))?;
    if status != "open" {
        return Err(bad(format!(
            "Only open offers can be cancelled; this offer is {status}"
        )));
    }
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE fpo_offers SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO fpo_offer_events (offer_id, actor_role, action, quantity_quintals, price_per_quintal, note)
         VALUES (?, 'admin', 'rejected', ?, ?, ?)",
    )
    .bind(id)
    .bind(qty)
    .bind(price)
    .bind(format!("Cancelled by AgriSense admin: {reason}"))
    .execute(&mut *tx)
    .await?;
    for uid in [buyer_id, manager_id] {
        notify(
            &mut *tx,
            uid,
            "An offer was cancelled by the admin",
            &format!("FPO offer #{id}: {reason}"),
            None,
        )
        .await?;
    }
    log(
        &mut *tx,
        user.user_id,
        "fpo_offer.cancel",
        "fpo_offer",
        Some(id),
        json!({ "reason": reason }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": id, "status": "rejected" })))
}

/* -------------------------------------------------------------------------- */
/*                                  disputes                                  */
/* -------------------------------------------------------------------------- */

#[derive(Serialize, FromRow)]
struct DisputeRow {
    id: i64,
    transaction_id: i64,
    raised_by: i64,
    raised_by_name: String,
    raised_by_role: String,
    reason: String,
    status: String,
    resolution_note: Option<String>,
    resolved_by_name: Option<String>,
    created_at: String,
    resolved_at: Option<String>,
    crop: String,
    amount: f64,
    buyer: String,
    farmer: String,
}

const DISPUTE_SELECT: &str = "SELECT d.id, d.transaction_id, d.raised_by, r.name AS raised_by_name, r.role AS raised_by_role,
    d.reason, d.status, d.resolution_note, a.name AS resolved_by_name, d.created_at, d.resolved_at,
    c.name AS crop, CAST(t.final_price * l.quantity_quintals AS REAL) AS amount, b.name AS buyer, f.name AS farmer
    FROM disputes d JOIN users r ON r.id = d.raised_by LEFT JOIN users a ON a.id = d.resolved_by
    JOIN transactions t ON t.id = d.transaction_id JOIN offers o ON o.id = t.offer_id JOIN lots l ON l.id = o.lot_id
    JOIN crops c ON c.id = l.crop_id JOIN users b ON b.id = o.buyer_id JOIN users f ON f.id = l.farmer_id";

#[derive(Deserialize)]
struct RaiseDisputeBody {
    transaction_id: i64,
    reason: String,
}

async fn raise_dispute(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<RaiseDisputeBody>,
) -> ApiResult<Value> {
    if !matches!(user.role.as_str(), "farmer" | "buyer") {
        return Err(AppError::Forbidden(
            "Only farmers and buyers can raise disputes on orders".into(),
        ));
    }
    let reason = text(&b.reason, "Reason", 10, 2000)?;
    let party: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM transactions t JOIN offers o ON o.id = t.offer_id JOIN lots l ON l.id = o.lot_id
         WHERE t.id = ? AND (o.buyer_id = ? OR l.farmer_id = ?)",
    )
    .bind(b.transaction_id)
    .bind(user.user_id)
    .bind(user.user_id)
    .fetch_one(&pool)
    .await?;
    if party == 0 {
        return Err(not_found("Order not found"));
    }
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO disputes (transaction_id, raised_by, reason) VALUES (?, ?, ?) RETURNING id",
    )
    .bind(b.transaction_id)
    .bind(user.user_id)
    .bind(&reason)
    .fetch_all(&pool)
    .await
    .and_then(|mut rows| rows.pop().ok_or(sqlx::Error::RowNotFound))
    .map_err(|e| match e {
        sqlx::Error::Database(d) if d.message().contains("UNIQUE") => {
            bad("You already have an open dispute on this order")
        }
        other => AppError::from(other),
    })?;
    Ok(Json(json!({ "id": id })))
}

async fn my_disputes(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Vec<DisputeRow>> {
    let sql =
        format!("{DISPUTE_SELECT} WHERE o.buyer_id = ? OR l.farmer_id = ? ORDER BY d.id DESC");
    Ok(Json(
        sqlx::query_as::<_, DisputeRow>(&sql)
            .bind(user.user_id)
            .bind(user.user_id)
            .fetch_all(&pool)
            .await?,
    ))
}

async fn list_disputes(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Query(q): Query<ListQuery>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let (limit, offset, page) = q.paging();
    let status = ListQuery::s(&q.status);
    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM disputes WHERE ? = '' OR status = ?")
        .bind(&status)
        .bind(&status)
        .fetch_one(&pool)
        .await?;
    let items = sqlx::query_as::<_, DisputeRow>(&format!(
        "{DISPUTE_SELECT} WHERE ? = '' OR d.status = ?
         ORDER BY d.status IN ('resolved', 'rejected'), d.id DESC LIMIT ? OFFSET ?"
    ))
    .bind(&status)
    .bind(&status)
    .bind(limit)
    .bind(offset)
    .fetch_all(&pool)
    .await?;
    Ok(Json(paged(items, total, page, limit)))
}

async fn dispute_detail(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let d = sqlx::query_as::<_, DisputeRow>(&format!("{DISPUTE_SELECT} WHERE d.id = ?"))
        .bind(id)
        .fetch_optional(&pool)
        .await?
        .ok_or_else(|| not_found("Dispute not found"))?;
    type T = (
        i64,
        f64,
        String,
        Option<String>,
        i64,
        f64,
        String,
        String,
        Option<String>,
        String,
        String,
        String,
        String,
    );
    let t: T = sqlx::query_as(
        "SELECT l.id, l.quantity_quintals, l.expected_quality, l.created_at, o.id, o.price_offered, o.created_by_role,
            COALESCE(o.created_at, ''), t.completed_at, b.name || ' · ' || b.phone_number, f.name || ' · ' || f.phone_number,
            t.status, c.name
         FROM transactions t JOIN offers o ON o.id = t.offer_id JOIN lots l ON l.id = o.lot_id JOIN crops c ON c.id = l.crop_id
         JOIN users b ON b.id = o.buyer_id JOIN users f ON f.id = l.farmer_id WHERE t.id = ?",
    )
    .bind(d.transaction_id)
    .fetch_one(&pool)
    .await?;
    let others: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM disputes WHERE transaction_id = ? AND id <> ?")
            .bind(d.transaction_id)
            .bind(id)
            .fetch_one(&pool)
            .await?;
    let mut timeline = vec![
        json!({ "at": t.3, "event": format!("Lot #{} listed: {} q {} ({})", t.0, t.1, t.12, t.2) }),
        json!({ "at": t.7, "event": format!("Offer #{} made by the {} at ₹{:.0}/q", t.4, t.6, t.5) }),
        json!({ "at": t.8, "event": format!("Offer accepted, transaction #{} {}", d.transaction_id, t.11) }),
        json!({ "at": d.created_at, "event": format!("Dispute raised by {} ({})", d.raised_by_name, d.raised_by_role) }),
    ];
    if let Some(at) = &d.resolved_at {
        timeline.push(json!({ "at": at, "event": format!("Dispute {} by {}", d.status, d.resolved_by_name.clone().unwrap_or_default()) }));
    }
    Ok(Json(json!({
        "dispute": d, "buyer_contact": t.9, "farmer_contact": t.10, "other_disputes_on_order": others,
        "timeline": timeline,
    })))
}

#[derive(Deserialize)]
struct DisputeStatusBody {
    status: String,
    note: Option<String>,
}

async fn set_dispute_status(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<DisputeStatusBody>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let (current, tx_id): (String, i64) =
        sqlx::query_as("SELECT status, transaction_id FROM disputes WHERE id = ?")
            .bind(id)
            .fetch_optional(&pool)
            .await?
            .ok_or_else(|| not_found("Dispute not found"))?;
    let ok = matches!(
        (current.as_str(), b.status.as_str()),
        ("open", "investigating" | "resolved" | "rejected")
            | ("investigating", "resolved" | "rejected")
    );
    if !ok {
        return Err(bad(format!(
            "A {current} dispute cannot be moved to {}",
            b.status
        )));
    }
    let closing = matches!(b.status.as_str(), "resolved" | "rejected");
    let note = text(
        b.note.as_deref().unwrap_or(""),
        "Resolution note",
        if closing { 5 } else { 0 },
        2000,
    )?;
    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE disputes SET status = ?, resolution_note = CASE WHEN ? <> '' THEN ? ELSE resolution_note END,
            resolved_by = CASE WHEN ? THEN ? ELSE resolved_by END,
            resolved_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE resolved_at END
         WHERE id = ?",
    )
    .bind(&b.status)
    .bind(&note)
    .bind(&note)
    .bind(closing)
    .bind(user.user_id)
    .bind(closing)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    let parties: (i64, i64) = sqlx::query_as(
        "SELECT o.buyer_id, l.farmer_id FROM transactions t JOIN offers o ON o.id = t.offer_id JOIN lots l ON l.id = o.lot_id WHERE t.id = ?",
    )
    .bind(tx_id)
    .fetch_one(&mut *tx)
    .await?;
    for uid in [parties.0, parties.1] {
        notify(
            &mut *tx,
            uid,
            &format!("Dispute #{id} is {}", b.status.replace('_', " ")),
            if note.is_empty() {
                "The AgriSense admin is looking into it."
            } else {
                &note
            },
            Some("/orders"),
        )
        .await?;
    }
    log(
        &mut *tx,
        user.user_id,
        &format!("dispute.{}", b.status),
        "dispute",
        Some(id),
        json!({ "note": note }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": id, "status": b.status })))
}

/* -------------------------------------------------------------------------- */
/*                            market intelligence                             */
/* -------------------------------------------------------------------------- */

async fn supply_demand(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Value> {
    require_admin(&user)?;
    let demand: Vec<(String, String, f64)> = sqlx::query_as(
        "SELECT c.name, d.delivery_location, d.min_quantity FROM buyer_demand d JOIN crops c ON c.id = d.crop_id
         WHERE d.status = 'open' AND date(d.required_by) >= date('now')",
    )
    .fetch_all(&pool)
    .await?;
    let lots: Vec<(String, String, f64)> = sqlx::query_as(
        "SELECT c.name, COALESCE(f.location, ''), l.quantity_quintals FROM lots l JOIN crops c ON c.id = l.crop_id
         LEFT JOIN farmers f ON f.id = l.farmer_id WHERE l.status = 'open'",
    )
    .fetch_all(&pool)
    .await?;
    let fpo: Vec<(String, String, f64)> = sqlx::query_as(
        "SELECT c.name, o.district || ' ' || o.state, l.total_quintals - l.reserved_quintals - l.sold_quintals
         FROM fpo_lots l JOIN crops c ON c.id = l.crop_id JOIN fpo_organizations o ON o.id = l.fpo_id
         WHERE l.total_quintals - l.reserved_quintals - l.sold_quintals > 0.0001",
    )
    .fetch_all(&pool)
    .await?;
    let pools: Vec<(String, String, f64)> = sqlx::query_as(
        "SELECT c.name, o.district || ' ' || o.state, x.quantity_quintals
         FROM fpo_contributions x JOIN fpo_pools p ON p.id = x.pool_id JOIN crops c ON c.id = p.crop_id
         JOIN fpo_organizations o ON o.id = p.fpo_id
         WHERE p.status IN ('collecting', 'locked') AND x.status IN ('pending', 'approved')",
    )
    .fetch_all(&pool)
    .await?;

    #[derive(Default)]
    struct Cell {
        demand: f64,
        lots: f64,
        fpo: f64,
        pools: f64,
    }
    let region = |place: &str| region_of(place).unwrap_or("Unmapped").to_string();
    let mut cells: BTreeMap<(String, String), Cell> = BTreeMap::new();
    for (crop, place, q) in &demand {
        cells
            .entry((crop.clone(), region(place)))
            .or_default()
            .demand += q;
    }
    for (crop, place, q) in &lots {
        cells.entry((crop.clone(), region(place))).or_default().lots += q;
    }
    for (crop, place, q) in &fpo {
        cells.entry((crop.clone(), region(place))).or_default().fpo += q;
    }
    for (crop, place, q) in &pools {
        cells
            .entry((crop.clone(), region(place)))
            .or_default()
            .pools += q;
    }
    let rows: Vec<Value> = cells
        .iter()
        .map(|((crop, state), c)| {
            let supply = c.lots + c.fpo + c.pools;
            json!({
                "crop": crop, "state": state, "demand_quintals": r2(c.demand),
                "farmer_lots_quintals": r2(c.lots), "fpo_lots_quintals": r2(c.fpo), "fpo_pools_quintals": r2(c.pools),
                "supply_quintals": r2(supply), "gap_quintals": r2(supply - c.demand),
                "status": gap_status(supply, c.demand),
            })
        })
        .collect();
    let mut by_crop: BTreeMap<String, (f64, f64)> = BTreeMap::new();
    for ((crop, _), c) in &cells {
        let e = by_crop.entry(crop.clone()).or_default();
        e.0 += c.demand;
        e.1 += c.lots + c.fpo + c.pools;
    }
    let mut crops: Vec<Value> = by_crop
        .iter()
        .map(|(crop, (d, s))| json!({"crop": crop, "demand_quintals": r2(*d), "supply_quintals": r2(*s), "status": gap_status(*s, *d)}))
        .collect();
    crops.sort_by(|a, b| {
        b["demand_quintals"]
            .as_f64()
            .partial_cmp(&a["demand_quintals"].as_f64())
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(Json(json!({
        "rows": rows,
        "top_crops": crops,
        "basis": "Demand = open buyer requirements still due. Supply = open farmer lots + unsold FPO bulk lots + crop pledged to FPO pools that are still collecting. Places are mapped to a state by name or by common mandi cities; anything else is shown as Unmapped. Shortage: supply under 80% of demand; oversupply: over 125%.",
    })))
}

async fn price_trend(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Query(q): Query<ListQuery>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let crop = text(q.crop.as_deref().unwrap_or(""), "Crop", 1, 80)?;
    let state = q
        .state
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(default_state);
    let realised: Vec<(String, f64, f64, i64)> = sqlx::query_as(
        "SELECT m, CAST(SUM(v) / SUM(q) AS REAL), CAST(SUM(q) AS REAL), CAST(SUM(n) AS INTEGER) FROM (
            SELECT strftime('%Y-%m', t.completed_at) AS m, t.final_price * l.quantity_quintals AS v, l.quantity_quintals AS q, 1 AS n
            FROM transactions t JOIN offers o ON o.id = t.offer_id JOIN lots l ON l.id = o.lot_id JOIN crops c ON c.id = l.crop_id
            WHERE lower(c.name) = lower(?1)
            UNION ALL
            SELECT strftime('%Y-%m', s.created_at), s.amount, s.quantity_quintals, 1
            FROM fpo_sales s JOIN fpo_lots l ON l.id = s.lot_id JOIN crops c ON c.id = l.crop_id
            WHERE lower(c.name) = lower(?1)
         ) GROUP BY m HAVING SUM(q) > 0 ORDER BY m",
    )
    .bind(&crop)
    .fetch_all(&pool)
    .await?;
    let today = mandi_median(&state, &crop).await;
    let history = crate::services::mandi::fetch_history(&state, &crop)
        .await
        .unwrap_or_default();
    let mut monthly: BTreeMap<String, (f64, u32)> = BTreeMap::new();
    for (date, price) in &history {
        let e = monthly.entry(date.chars().take(7).collect()).or_default();
        e.0 += price;
        e.1 += 1;
    }
    Ok(Json(json!({
        "crop": crop, "state": state,
        "realised": realised.iter().map(|r| json!({"month": r.0, "price_per_quintal": r2(r.1), "quantity_quintals": r2(r.2), "deals": r.3})).collect::<Vec<_>>(),
        "mandi_monthly": monthly.iter().map(|(m, (s, n))| json!({"month": m, "modal": r2(s / *n as f64)})).collect::<Vec<_>>(),
        "mandi_today": today.map(r2),
    })))
}

/* -------------------------------------------------------------------------- */
/*                                 master data                                */
/* -------------------------------------------------------------------------- */

#[derive(Deserialize)]
struct MasterBody {
    name: Option<String>,
    perishability_days: Option<i64>,
    location: Option<String>,
    from_location: Option<String>,
    to_location: Option<String>,
    cost_per_quintal: Option<f64>,
    market_id: Option<i64>,
    cost_per_quintal_per_day: Option<f64>,
}

fn master_table(t: &str) -> Result<&'static str, AppError> {
    match t {
        "crops" => Ok("crops"),
        "markets" => Ok("markets"),
        "transport" => Ok("transport_costs"),
        "storage" => Ok("storage_facilities"),
        _ => Err(not_found("Unknown master data table")),
    }
}

async fn master_list(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(table): Path<String>,
) -> ApiResult<Vec<Value>> {
    require_admin(&user)?;
    let rows: Vec<Value> = match master_table(&table)? {
        "crops" => sqlx::query_as::<_, (i64, String, i64, i64)>(
            "SELECT c.id, c.name, c.perishability_days,
                (SELECT COUNT(*) FROM lots WHERE crop_id = c.id) + (SELECT COUNT(*) FROM fpo_lots WHERE crop_id = c.id)
                + (SELECT COUNT(*) FROM buyer_demand WHERE crop_id = c.id) + (SELECT COUNT(*) FROM fpo_contributions WHERE crop_id = c.id)
             FROM crops c ORDER BY c.name",
        )
        .fetch_all(&pool)
        .await?
        .into_iter()
        .map(|r| json!({"id": r.0, "name": r.1, "perishability_days": r.2, "in_use": r.3}))
        .collect(),
        "markets" => sqlx::query_as::<_, (i64, String, String, i64)>(
            "SELECT m.id, m.name, m.location, (SELECT COUNT(*) FROM storage_facilities s WHERE s.market_id = m.id) FROM markets m ORDER BY m.name",
        )
        .fetch_all(&pool)
        .await?
        .into_iter()
        .map(|r| json!({"id": r.0, "name": r.1, "location": r.2, "in_use": r.3}))
        .collect(),
        "transport_costs" => sqlx::query_as::<_, (i64, String, String, f64)>(
            "SELECT id, from_location, to_location, cost_per_quintal FROM transport_costs ORDER BY from_location, to_location",
        )
        .fetch_all(&pool)
        .await?
        .into_iter()
        .map(|r| json!({"id": r.0, "from_location": r.1, "to_location": r.2, "cost_per_quintal": r.3, "in_use": 0}))
        .collect(),
        _ => sqlx::query_as::<_, (i64, i64, String, f64)>(
            "SELECT s.id, s.market_id, m.name, s.cost_per_quintal_per_day FROM storage_facilities s JOIN markets m ON m.id = s.market_id ORDER BY m.name",
        )
        .fetch_all(&pool)
        .await?
        .into_iter()
        .map(|r| json!({"id": r.0, "market_id": r.1, "market": r.2, "cost_per_quintal_per_day": r.3, "in_use": 0}))
        .collect(),
    };
    Ok(Json(rows))
}

fn unique_err(e: sqlx::Error, what: &str) -> AppError {
    match e {
        sqlx::Error::Database(d) if d.message().contains("UNIQUE") => {
            bad(format!("This {what} already exists"))
        }
        sqlx::Error::Database(d) if d.message().contains("FOREIGN KEY") => {
            bad("Choose an existing market")
        }
        other => AppError::from(other),
    }
}

/// Validates a master-data body for `table` and runs the insert or update.
async fn master_write(
    pool: &SqlitePool,
    table: &'static str,
    id: Option<i64>,
    b: &MasterBody,
) -> Result<i64, AppError> {
    match table {
        "crops" => {
            let name = text(b.name.as_deref().unwrap_or(""), "Crop name", 1, 80)?;
            let days = b.perishability_days.unwrap_or(0);
            if !(1..=3650).contains(&days) {
                return Err(bad("Shelf life must be between 1 and 3650 days"));
            }
            let q = match id {
                Some(id) => sqlx::query_scalar::<_, i64>(
                    "UPDATE crops SET name = ?, perishability_days = ? WHERE id = ? RETURNING id",
                )
                .bind(name)
                .bind(days)
                .bind(id),
                None => sqlx::query_scalar::<_, i64>(
                    "INSERT INTO crops (name, perishability_days) VALUES (?, ?) RETURNING id",
                )
                .bind(name)
                .bind(days),
            };
            q.fetch_all(pool)
                .await
                .map(|mut rows| rows.pop())
                .map_err(|e| unique_err(e, "crop"))?
                .ok_or_else(|| not_found("Not found"))
        }
        "markets" => {
            let name = text(b.name.as_deref().unwrap_or(""), "Market name", 2, 120)?;
            let loc = text(b.location.as_deref().unwrap_or(""), "Location", 2, 120)?;
            let q = match id {
                Some(id) => sqlx::query_scalar::<_, i64>(
                    "UPDATE markets SET name = ?, location = ? WHERE id = ? RETURNING id",
                )
                .bind(name)
                .bind(loc)
                .bind(id),
                None => sqlx::query_scalar::<_, i64>(
                    "INSERT INTO markets (name, location) VALUES (?, ?) RETURNING id",
                )
                .bind(name)
                .bind(loc),
            };
            q.fetch_all(pool)
                .await
                .map(|mut rows| rows.pop())
                .map_err(|e| unique_err(e, "market"))?
                .ok_or_else(|| not_found("Not found"))
        }
        "transport_costs" => {
            let from = text(b.from_location.as_deref().unwrap_or(""), "From", 2, 120)?;
            let to = text(b.to_location.as_deref().unwrap_or(""), "To", 2, 120)?;
            let cost = b.cost_per_quintal.unwrap_or(-1.0);
            if !cost.is_finite() || !(0.0..=100_000.0).contains(&cost) {
                return Err(bad("Cost per quintal must be between 0 and 100000"));
            }
            let q = match id {
                Some(id) => sqlx::query_scalar::<_, i64>("UPDATE transport_costs SET from_location = ?, to_location = ?, cost_per_quintal = ? WHERE id = ? RETURNING id").bind(from).bind(to).bind(cost).bind(id),
                None => sqlx::query_scalar::<_, i64>("INSERT INTO transport_costs (from_location, to_location, cost_per_quintal) VALUES (?, ?, ?) RETURNING id").bind(from).bind(to).bind(cost),
            };
            q.fetch_all(pool)
                .await
                .map(|mut rows| rows.pop())
                .map_err(|e| unique_err(e, "route"))?
                .ok_or_else(|| not_found("Not found"))
        }
        _ => {
            let market = b.market_id.ok_or_else(|| bad("Choose a market"))?;
            let cost = b.cost_per_quintal_per_day.unwrap_or(-1.0);
            if !cost.is_finite() || !(0.0..=10_000.0).contains(&cost) {
                return Err(bad(
                    "Storage cost must be between 0 and 10000 per quintal per day",
                ));
            }
            let q = match id {
                Some(id) => sqlx::query_scalar::<_, i64>("UPDATE storage_facilities SET market_id = ?, cost_per_quintal_per_day = ? WHERE id = ? RETURNING id").bind(market).bind(cost).bind(id),
                None => sqlx::query_scalar::<_, i64>("INSERT INTO storage_facilities (market_id, cost_per_quintal_per_day) VALUES (?, ?) RETURNING id").bind(market).bind(cost),
            };
            q.fetch_all(pool)
                .await
                .map(|mut rows| rows.pop())
                .map_err(|e| unique_err(e, "storage rate"))?
                .ok_or_else(|| not_found("Not found"))
        }
    }
}

async fn master_create(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(table): Path<String>,
    Json(b): Json<Value>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let t = master_table(&table)?;
    let body: MasterBody = serde_json::from_value(b.clone()).map_err(|e| bad(e.to_string()))?;
    let id = master_write(&pool, t, None, &body).await?;
    log(&pool, user.user_id, &format!("{t}.create"), t, Some(id), b).await?;
    Ok(Json(json!({ "id": id })))
}

async fn master_update(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path((table, id)): Path<(String, i64)>,
    Json(b): Json<Value>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let t = master_table(&table)?;
    let body: MasterBody = serde_json::from_value(b.clone()).map_err(|e| bad(e.to_string()))?;
    master_write(&pool, t, Some(id), &body).await?;
    log(&pool, user.user_id, &format!("{t}.update"), t, Some(id), b).await?;
    Ok(Json(json!({ "id": id })))
}

async fn master_delete(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path((table, id)): Path<(String, i64)>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let t = master_table(&table)?;
    let done = sqlx::query(&format!("DELETE FROM {t} WHERE id = ?"))
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(d) if d.message().contains("FOREIGN KEY") => {
                bad("This record is used by lots, demands or other data and cannot be deleted")
            }
            other => AppError::from(other),
        })?;
    if done.rows_affected() == 0 {
        return Err(not_found("Not found"));
    }
    log(
        &pool,
        user.user_id,
        &format!("{t}.delete"),
        t,
        Some(id),
        json!({}),
    )
    .await?;
    Ok(Json(json!({ "id": id, "deleted": true })))
}

/* -------------------------------------------------------------------------- */
/*                        announcements and audit log                         */
/* -------------------------------------------------------------------------- */

#[derive(Deserialize)]
struct AnnouncementBody {
    audience: String,
    district: Option<String>,
    title: String,
    body: String,
}

async fn post_announcement(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<AnnouncementBody>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    if !matches!(
        b.audience.as_str(),
        "all" | "all_farmers" | "all_buyers" | "all_fpos"
    ) {
        return Err(bad(
            "Audience must be all, all_farmers, all_buyers or all_fpos",
        ));
    }
    let title = text(&b.title, "Title", 3, 120)?;
    let body = text(&b.body, "Message", 3, 2000)?;
    let district = b
        .district
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .map(str::to_string);
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO announcements (author_id, audience, district, title, body) VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(user.user_id)
    .bind(&b.audience)
    .bind(&district)
    .bind(&title)
    .bind(&body)
    .fetch_all(&pool)
    .await
    .and_then(|mut rows| rows.pop().ok_or(sqlx::Error::RowNotFound))?;
    log(
        &pool,
        user.user_id,
        "announcement.post",
        "announcement",
        Some(id),
        json!({ "audience": b.audience, "district": district, "title": title }),
    )
    .await?;
    Ok(Json(json!({ "id": id })))
}

async fn list_announcements(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Query(q): Query<ListQuery>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let (limit, offset, page) = q.paging();
    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM announcements")
        .fetch_one(&pool)
        .await?;
    type Row = (
        i64,
        String,
        String,
        Option<String>,
        Option<String>,
        String,
        String,
        String,
    );
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT a.id, u.name, a.audience, a.district, o.name, a.title, a.body, a.created_at
         FROM announcements a JOIN users u ON u.id = a.author_id LEFT JOIN fpo_organizations o ON o.id = a.fpo_id
         ORDER BY a.id DESC LIMIT ? OFFSET ?",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(&pool)
    .await?;
    let items: Vec<Value> = rows.into_iter().map(|r| json!({
        "id": r.0, "author": r.1, "audience": r.2, "district": r.3, "fpo_name": r.4, "title": r.5, "body": r.6, "created_at": r.7,
    })).collect();
    Ok(Json(paged(items, total, page, limit)))
}

async fn audit_list(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Query(q): Query<ListQuery>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let (limit, offset, page) = q.paging();
    let (action, entity) = (ListQuery::like(&q.action), ListQuery::s(&q.entity_type));
    let filter = "lower(a.action) LIKE ? AND (? = '' OR a.entity_type = ?)";
    let total: i64 =
        sqlx::query_scalar(&format!("SELECT COUNT(*) FROM audit_logs a WHERE {filter}"))
            .bind(&action)
            .bind(&entity)
            .bind(&entity)
            .fetch_one(&pool)
            .await?;
    type Row = (i64, String, String, String, Option<i64>, String, String);
    let rows: Vec<Row> = sqlx::query_as(&format!(
        "SELECT a.id, u.name, a.action, a.entity_type, a.entity_id, a.details_json, a.created_at
         FROM audit_logs a JOIN users u ON u.id = a.admin_id WHERE {filter} ORDER BY a.id DESC LIMIT ? OFFSET ?"
    ))
    .bind(&action).bind(&entity).bind(&entity)
    .bind(limit)
    .bind(offset)
    .fetch_all(&pool)
    .await?;
    let items: Vec<Value> = rows.into_iter().map(|r| json!({
        "id": r.0, "admin": r.1, "action": r.2, "entity_type": r.3, "entity_id": r.4,
        "details": serde_json::from_str::<Value>(&r.5).unwrap_or(Value::Null), "created_at": r.6,
    })).collect();
    Ok(Json(paged(items, total, page, limit)))
}

/* -------------------------------------------------------------------------- */
/*                               crop requests                                */
/* -------------------------------------------------------------------------- */

#[derive(Deserialize)]
struct CropRequestBody {
    crop_name: String,
    note: Option<String>,
}

/// POST /api/crop-requests — a farmer, buyer or FPO asks the admin to add a missing crop.
async fn request_crop(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<CropRequestBody>,
) -> ApiResult<Value> {
    if user.role == "admin" {
        return Err(bad("Admins add crops directly on the Master data page"));
    }
    let name = text(&b.crop_name, "Crop name", 2, 80)?;
    let note = text(b.note.as_deref().unwrap_or(""), "Note", 0, 300)?;
    let existing: Option<String> =
        sqlx::query_scalar("SELECT name FROM crops WHERE lower(name) = lower(?)")
            .bind(&name)
            .fetch_optional(&pool)
            .await?;
    if let Some(n) = existing {
        return Err(bad(format!("{n} is already in the crop list")));
    }
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO crop_requests (requested_by, crop_name, note) VALUES (?, ?, ?) RETURNING id",
    )
    .bind(user.user_id)
    .bind(&name)
    .bind(&note)
    .fetch_all(&pool)
    .await
    .and_then(|mut rows| rows.pop().ok_or(sqlx::Error::RowNotFound))?;
    Ok(Json(json!({ "id": id })))
}

async fn list_crop_requests(
    State(pool): State<SqlitePool>,
    user: AuthUser,
) -> ApiResult<Vec<Value>> {
    require_admin(&user)?;
    type Row = (i64, String, String, String, String, String, String);
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT r.id, r.crop_name, r.note, r.status, u.name, u.role, COALESCE(r.created_at, '')
         FROM crop_requests r JOIN users u ON u.id = r.requested_by
         ORDER BY r.status = 'open' DESC, r.id DESC LIMIT 200",
    )
    .fetch_all(&pool)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| {
                json!({
                    "id": r.0, "crop_name": r.1, "note": r.2, "status": r.3,
                    "requested_by": r.4, "role": r.5, "created_at": r.6,
                })
            })
            .collect(),
    ))
}

#[derive(Deserialize, Default)]
struct CropDecisionBody {
    /// Corrected spelling to add instead of the requested name.
    name: Option<String>,
}

/// POST /api/admin/crop-requests/:id/add|dismiss
async fn decide_crop_request(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path((id, action)): Path<(i64, String)>,
    body: Option<Json<CropDecisionBody>>,
) -> ApiResult<Value> {
    require_admin(&user)?;
    let b = body.map(|Json(b)| b).unwrap_or_default();
    let (requester, requested): (i64, String) = sqlx::query_as(
        "SELECT requested_by, crop_name FROM crop_requests WHERE id = ? AND status = 'open'",
    )
    .bind(id)
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| bad("This request was already handled or does not exist"))?;
    let mut tx = pool.begin().await?;
    let (status, crop_id, title) = match action.as_str() {
        "add" => {
            let name = text(b.name.as_deref().unwrap_or(&requested), "Crop name", 2, 80)?;
            let crop = crate::db::find_or_create_crop_tx(&mut tx, &name).await?;
            log(
                &mut *tx,
                user.user_id,
                "crops.create",
                "crops",
                Some(crop.id),
                json!({ "name": crop.name, "from_request": id }),
            )
            .await?;
            (
                "added",
                Some(crop.id),
                format!("{} added to the crop list", crop.name),
            )
        }
        "dismiss" => (
            "dismissed",
            None,
            format!("Crop request for {requested} not added"),
        ),
        _ => return Err(bad("Action must be add or dismiss")),
    };
    sqlx::query(
        "UPDATE crop_requests SET status = ?, crop_id = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .bind(status)
    .bind(crop_id)
    .bind(user.user_id)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    log(
        &mut *tx,
        user.user_id,
        &format!("crop_request.{action}"),
        "crop_request",
        Some(id),
        json!({ "crop_name": requested }),
    )
    .await?;
    notify(
        &mut *tx,
        requester,
        &title,
        "Thank you for the suggestion.",
        None,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({ "id": id, "status": status, "crop_id": crop_id }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn regions_from_states_and_cities() {
        assert_eq!(region_of("Navi Mumbai"), Some("Maharashtra"));
        assert_eq!(region_of("Ludhiana Punjab"), Some("Punjab"));
        assert_eq!(region_of("Khanna"), Some("Punjab"));
        assert_eq!(region_of("Haryana"), Some("Haryana"));
        assert_eq!(region_of("somewhere"), None);
    }

    #[test]
    fn gap_labels() {
        assert_eq!(gap_status(0.0, 0.0), "none");
        assert_eq!(gap_status(10.0, 0.0), "no_demand");
        assert_eq!(gap_status(40.0, 100.0), "shortage");
        assert_eq!(gap_status(100.0, 100.0), "balanced");
        assert_eq!(gap_status(130.0, 100.0), "oversupply");
    }
}
