//! Farmer and buyer portals on real data.
//!
//! Lots (edit, withdraw, detail with negotiation history), offers (create,
//! accept, reject, counter, withdraw), orders (tracking events, payments,
//! net realisation), price forecast and lot signals, suppliers, messages,
//! profile, buyer requirements, notifications and storage options.
//!
//! Business rules that do not need the database live in `services::deals`
//! and `services::forecast`, where they are unit tested.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, patch, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, SqlitePool};

use crate::{
    admin::{gap_status, notify_typed, region_of},
    auth::AuthUser,
    errors::AppError,
    services::{deals, forecast},
};

type ApiResult<T> = Result<Json<T>, AppError>;

pub fn routes() -> Router<SqlitePool> {
    Router::new()
        // lots
        .route("/api/lots/:id", get(lot_detail).patch(update_lot))
        .route("/api/lots/:id/withdraw", post(withdraw_lot))
        .route("/api/lots/:id/signals", get(lot_signals))
        // offers
        .route("/api/offers/:id/accept", post(accept_offer))
        .route("/api/offers/:id/reject", post(reject_offer))
        .route("/api/offers/:id/counter", post(counter_offer))
        .route("/api/offers/:id/withdraw", post(withdraw_offer))
        // orders, tracking and payments
        .route("/api/transactions", get(list_orders))
        .route("/api/transactions/:id", get(order_detail))
        .route("/api/transactions/:id/events", post(add_order_event))
        .route("/api/transactions/:id/payments", post(record_payment))
        .route("/api/payments/:id/confirm", post(confirm_payment))
        .route("/api/payments/:id/not-received", post(payment_not_received))
        // prices
        .route("/api/forecast", get(price_forecast))
        .route("/api/storage-options", get(storage_options))
        // buyer side
        .route("/api/suppliers", get(list_suppliers))
        .route("/api/suppliers/:kind/:id", get(supplier_detail))
        .route(
            "/api/buyer-demands/:id",
            patch(update_demand).delete(delete_demand),
        )
        .route("/api/buyer-demands/:id/fulfil", post(fulfil_demand))
        .route("/api/buyer-demands/:id/matches", get(demand_matches))
        // messages
        .route("/api/conversations", get(list_conversations))
        .route(
            "/api/conversations/:user_id/messages",
            get(conversation_messages).post(send_message),
        )
        // profile and notifications
        .route("/api/me", get(get_profile).patch(update_profile))
        .route("/api/notifications", get(list_notifications))
        .route("/api/notifications/read-all", post(read_all_notifications))
        .route("/api/notifications/:id/read", post(read_notification))
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
    (x * 100.0).round() / 100.0 + 0.0
}

fn require_trader(user: &AuthUser) -> Result<(), AppError> {
    if user.role == "farmer" || user.role == "buyer" {
        Ok(())
    } else {
        Err(forbidden("This is for farmer and buyer accounts"))
    }
}

fn clean(value: Option<&str>, field: &str, max: usize) -> Result<Option<String>, AppError> {
    match value.map(str::trim) {
        None | Some("") => Ok(None),
        Some(v) if v.chars().count() > max => {
            Err(bad(format!("{field} must be at most {max} characters")))
        }
        Some(v) => Ok(Some(v.to_string())),
    }
}

fn rupees(x: f64) -> String {
    let n = x.round() as i64;
    let s = n.abs().to_string();
    // Indian grouping: last 3 digits, then pairs.
    let (head, tail) = s.split_at(s.len().saturating_sub(3));
    let mut groups: Vec<String> = vec![];
    let mut h = head.to_string();
    while h.len() > 2 {
        groups.insert(0, h[h.len() - 2..].to_string());
        h.truncate(h.len() - 2);
    }
    if !h.is_empty() {
        groups.insert(0, h);
    }
    groups.push(tail.to_string());
    format!("{}₹{}", if n < 0 { "-" } else { "" }, groups.join(","))
}

/// Freight per quintal between two places using the `transport_costs` table.
/// Places are matched by name first, then by the state they are in.
pub async fn freight_per_quintal(
    pool: &SqlitePool,
    from: &str,
    to: &str,
) -> Result<Option<f64>, AppError> {
    if from.trim().is_empty() || to.trim().is_empty() {
        return Ok(None);
    }
    let routes: Vec<(String, String, f64)> = sqlx::query_as(
        "SELECT from_location, to_location, CAST(cost_per_quintal AS REAL) FROM transport_costs",
    )
    .fetch_all(pool)
    .await?;
    let lower = |s: &str| s.trim().to_lowercase();
    let state = |s: &str| {
        region_of(s)
            .map(str::to_lowercase)
            .unwrap_or_else(|| lower(s))
    };
    let (f, t) = (lower(from), lower(to));
    if let Some(r) = routes
        .iter()
        .find(|(a, b, _)| lower(a) == f && lower(b) == t)
    {
        return Ok(Some(r.2));
    }
    let (fs, ts) = (state(from), state(to));
    Ok(routes
        .iter()
        .find(|(a, b, _)| state(a) == fs && state(b) == ts)
        .map(|r| r.2))
}

async fn active_user(pool: &SqlitePool, id: i64) -> Result<(String, String), AppError> {
    let row: Option<(String, String, String)> =
        sqlx::query_as("SELECT name, role, status FROM users WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    match row {
        Some((name, role, status)) if status == "active" => Ok((name, role)),
        Some(_) => Err(bad("This account is not active")),
        None => Err(not_found("User not found")),
    }
}

/// Saves mandi prices for the forecast: one row per crop, state and day
/// (median of the markets that reported).
pub async fn record_prices(pool: &SqlitePool, prices: &[crate::models::LiveMandiPrice]) {
    use std::collections::BTreeMap;
    /// (crop, state, date) → [(modal, min, max)]
    type ByDay = BTreeMap<(String, String, String), Vec<(f64, f64, f64)>>;
    let mut by_key: ByDay = BTreeMap::new();
    for p in prices
        .iter()
        .filter(|p| p.modal_price > 0.0 && p.date.len() >= 10)
    {
        by_key
            .entry((
                p.crop_name.clone(),
                p.state.clone(),
                p.date[..10].to_string(),
            ))
            .or_default()
            .push((p.modal_price, p.min_price, p.max_price));
    }
    for ((crop, state, date), mut rows) in by_key {
        rows.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        let mid = rows[rows.len() / 2];
        let min = rows
            .iter()
            .map(|r| r.1)
            .filter(|v| *v > 0.0)
            .fold(f64::MAX, f64::min);
        let max = rows.iter().map(|r| r.2).fold(0.0, f64::max);
        let _ = sqlx::query(
            "INSERT INTO mandi_price_history (commodity, state, arrival_date, modal_price, min_price, max_price, markets)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(commodity, state, arrival_date) DO UPDATE SET
               modal_price = excluded.modal_price, min_price = excluded.min_price,
               max_price = excluded.max_price,
               markets = MAX(mandi_price_history.markets, excluded.markets),
               fetched_at = CURRENT_TIMESTAMP",
        )
        .bind(&crop)
        .bind(&state)
        .bind(&date)
        .bind(mid.0)
        .bind(if min == f64::MAX { None } else { Some(min) })
        .bind(if max > 0.0 { Some(max) } else { None })
        .bind(rows.len() as i64)
        .execute(pool)
        .await;
    }
}

/// Loads daily price history for a crop and state, topping it up from the
/// Mandi API at most every 6 hours.
async fn price_history(
    pool: &SqlitePool,
    crop: &str,
    state: &str,
) -> Result<(Vec<(String, f64)>, bool), AppError> {
    let fresh: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM mandi_price_history
         WHERE lower(commodity) = lower(?) AND lower(state) = lower(?)
           AND fetched_at >= datetime('now', '-6 hours')",
    )
    .bind(crop)
    .bind(state)
    .fetch_one(pool)
    .await?;
    let mut api_ok = fresh > 0;
    if fresh == 0 {
        if let Ok(history) = crate::services::mandi::fetch_history(state, crop).await {
            api_ok = !history.is_empty();
            for (date, price) in history.iter().filter(|(_, p)| *p > 0.0) {
                sqlx::query(
                    "INSERT INTO mandi_price_history (commodity, state, arrival_date, modal_price)
                     VALUES (?, ?, ?, ?)
                     ON CONFLICT(commodity, state, arrival_date) DO UPDATE SET fetched_at = CURRENT_TIMESTAMP",
                )
                .bind(crop)
                .bind(state)
                .bind(date)
                .bind(price)
                .execute(pool)
                .await?;
            }
        }
        if let Ok(today) = crate::services::mandi::fetch_prices(Some(state), Some(crop)).await {
            api_ok |= !today.is_empty();
            record_prices(pool, &today).await;
        }
    }
    let rows: Vec<(String, f64)> = sqlx::query_as(
        "SELECT arrival_date, CAST(modal_price AS REAL) FROM (
           SELECT arrival_date, modal_price FROM mandi_price_history
           WHERE lower(commodity) = lower(?) AND lower(state) = lower(?)
           ORDER BY arrival_date DESC LIMIT 60
         ) ORDER BY arrival_date",
    )
    .bind(crop)
    .bind(state)
    .fetch_all(pool)
    .await?;
    Ok((rows, api_ok))
}

async fn farmer_state(pool: &SqlitePool, user_id: i64) -> Result<String, AppError> {
    let loc: Option<String> = sqlx::query_scalar(
        "SELECT location FROM farmers WHERE id = ?
         UNION ALL SELECT location FROM buyers WHERE id = ? AND location IS NOT NULL LIMIT 1",
    )
    .bind(user_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(loc
        .as_deref()
        .and_then(region_of)
        .unwrap_or("Maharashtra")
        .to_string())
}

/* -------------------------------------------------------------------------- */
/*                                    lots                                    */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Serialize, FromRow)]
pub struct LotView {
    pub id: i64,
    pub farmer_id: i64,
    pub farmer_name: String,
    pub farmer_location: String,
    pub crop_id: i64,
    pub crop_name: String,
    pub perishability_days: i64,
    pub quantity_quintals: f64,
    pub expected_quality: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: Option<String>,
    pub days_listed: f64,
    pub pending_offers: i64,
    pub best_offer: Option<f64>,
    pub cancel_reason: Option<String>,
    pub my_offer_status: Option<String>,
    pub my_offer_price: Option<f64>,
    /// open → offer_received → sold (or withdrawn / cancelled)
    #[sqlx(skip)]
    pub display_status: String,
}

const LOT_SELECT: &str = "SELECT l.id, l.farmer_id, u.name AS farmer_name,
        COALESCE(f.location, '') AS farmer_location, l.crop_id, c.name AS crop_name,
        c.perishability_days, CAST(l.quantity_quintals AS REAL) AS quantity_quintals,
        l.expected_quality, l.status, COALESCE(l.created_at, '') AS created_at, l.updated_at,
        CAST(COALESCE(julianday('now') - julianday(l.created_at), 0) AS REAL) AS days_listed,
        (SELECT COUNT(*) FROM offers o WHERE o.lot_id = l.id AND o.status = 'pending') AS pending_offers,
        (SELECT CAST(MAX(o.price_offered) AS REAL) FROM offers o
          WHERE o.lot_id = l.id AND o.status = 'pending' AND o.created_by_role = 'buyer') AS best_offer,
        l.cancel_reason,
        (SELECT o.status FROM offers o WHERE o.lot_id = l.id AND o.buyer_id = ? ORDER BY o.id DESC LIMIT 1) AS my_offer_status,
        (SELECT CAST(o.price_offered AS REAL) FROM offers o WHERE o.lot_id = l.id AND o.buyer_id = ? ORDER BY o.id DESC LIMIT 1) AS my_offer_price
     FROM lots l
     JOIN users u ON u.id = l.farmer_id
     JOIN crops c ON c.id = l.crop_id
     LEFT JOIN farmers f ON f.id = l.farmer_id";

fn with_display(mut lot: LotView) -> LotView {
    lot.display_status = if lot.status == "open" && lot.pending_offers > 0 {
        "offer_received".into()
    } else {
        lot.status.clone()
    };
    lot
}

async fn load_lot(pool: &SqlitePool, viewer: i64, id: i64) -> Result<LotView, AppError> {
    sqlx::query_as::<_, LotView>(&format!("{LOT_SELECT} WHERE l.id = ?"))
        .bind(viewer)
        .bind(viewer)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .map(with_display)
        .ok_or_else(|| not_found("Lot not found"))
}

/// GET /api/lots — a farmer's own lots, or the open lots a buyer can bid on.
pub async fn list_lots(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Vec<LotView>> {
    require_trader(&user)?;
    let sql = if user.role == "farmer" {
        format!("{LOT_SELECT} WHERE l.farmer_id = ? ORDER BY l.id DESC")
    } else {
        format!(
            "{LOT_SELECT} WHERE l.status = 'open' AND u.status = 'active' AND l.farmer_id != ? ORDER BY l.id DESC"
        )
    };
    let lots = sqlx::query_as::<_, LotView>(&sql)
        .bind(user.user_id)
        .bind(user.user_id)
        .bind(user.user_id)
        .fetch_all(&pool)
        .await?;
    Ok(Json(lots.into_iter().map(with_display).collect()))
}

#[derive(Debug, Serialize, FromRow)]
pub struct OfferView {
    pub id: i64,
    pub lot_id: i64,
    pub buyer_id: i64,
    pub buyer_name: String,
    pub farmer_id: i64,
    pub farmer_name: String,
    pub crop_name: String,
    pub quantity_quintals: f64,
    pub expected_quality: String,
    pub lot_status: String,
    pub price_offered: f64,
    pub status: String,
    pub created_by_role: String,
    pub parent_offer_id: Option<i64>,
    pub created_at: String,
    pub responded_at: Option<String>,
    pub cancel_reason: Option<String>,
}

const OFFER_SELECT: &str = "SELECT o.id, o.lot_id, o.buyer_id, ub.name AS buyer_name,
        l.farmer_id, uf.name AS farmer_name, c.name AS crop_name,
        CAST(l.quantity_quintals AS REAL) AS quantity_quintals, l.expected_quality,
        l.status AS lot_status, CAST(o.price_offered AS REAL) AS price_offered, o.status,
        o.created_by_role, o.parent_offer_id, COALESCE(o.created_at, '') AS created_at,
        o.responded_at, o.cancel_reason
     FROM offers o
     JOIN lots l ON l.id = o.lot_id
     JOIN crops c ON c.id = l.crop_id
     JOIN users ub ON ub.id = o.buyer_id
     JOIN users uf ON uf.id = l.farmer_id";

/// GET /api/offers — every offer on my lots (farmer) or that I am part of (buyer).
pub async fn list_offers(
    State(pool): State<SqlitePool>,
    user: AuthUser,
) -> ApiResult<Vec<OfferView>> {
    require_trader(&user)?;
    let filter = if user.role == "farmer" {
        "l.farmer_id = ?"
    } else {
        "o.buyer_id = ?"
    };
    Ok(Json(
        sqlx::query_as::<_, OfferView>(&format!(
            "{OFFER_SELECT} WHERE {filter} ORDER BY o.id DESC"
        ))
        .bind(user.user_id)
        .fetch_all(&pool)
        .await?,
    ))
}

async fn load_offer(pool: &SqlitePool, id: i64) -> Result<OfferView, AppError> {
    sqlx::query_as::<_, OfferView>(&format!("{OFFER_SELECT} WHERE o.id = ?"))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| not_found("Offer not found"))
}

/// GET /api/lots/:id — the lot and its negotiation history.
async fn lot_detail(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Value> {
    let lot = load_lot(&pool, user.user_id, id).await?;
    let allowed = match user.role.as_str() {
        "admin" => true,
        "farmer" => lot.farmer_id == user.user_id,
        "buyer" => lot.status == "open" || lot.my_offer_status.is_some(),
        _ => false,
    };
    if !allowed {
        return Err(forbidden("You cannot view this lot"));
    }
    // Buyers see only their own negotiation; the farmer sees every buyer's.
    let offers: Vec<OfferView> = if user.role == "buyer" {
        sqlx::query_as(&format!(
            "{OFFER_SELECT} WHERE o.lot_id = ? AND o.buyer_id = ? ORDER BY o.id"
        ))
        .bind(id)
        .bind(user.user_id)
        .fetch_all(&pool)
        .await?
    } else {
        sqlx::query_as(&format!("{OFFER_SELECT} WHERE o.lot_id = ? ORDER BY o.id"))
            .bind(id)
            .fetch_all(&pool)
            .await?
    };
    Ok(Json(json!({ "lot": lot, "offers": offers })))
}

#[derive(Deserialize)]
struct UpdateLot {
    quantity_quintals: Option<f64>,
    expected_quality: Option<String>,
}

/// PATCH /api/lots/:id — the owner edits quantity or quality while the lot is open.
async fn update_lot(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(body): Json<UpdateLot>,
) -> ApiResult<LotView> {
    let lot = load_lot(&pool, user.user_id, id).await?;
    if lot.farmer_id != user.user_id {
        return Err(forbidden("Only the farmer who listed this lot can edit it"));
    }
    if lot.status != "open" {
        return Err(bad(format!(
            "This lot is {} and can no longer be edited",
            lot.status
        )));
    }
    let qty = body.quantity_quintals.unwrap_or(lot.quantity_quintals);
    if !(qty.is_finite() && qty > 0.0 && qty <= 100_000.0) {
        return Err(bad("Quantity must be between 0 and 1,00,000 quintals"));
    }
    let quality = clean(body.expected_quality.as_deref(), "Quality", 40)?
        .unwrap_or_else(|| lot.expected_quality.clone());
    sqlx::query(
        "UPDATE lots SET quantity_quintals = ?, expected_quality = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .bind(qty)
    .bind(&quality)
    .bind(id)
    .execute(&pool)
    .await?;
    // Buyers negotiating on this lot should know the terms changed.
    let buyers: Vec<i64> = sqlx::query_scalar(
        "SELECT DISTINCT buyer_id FROM offers WHERE lot_id = ? AND status = 'pending'",
    )
    .bind(id)
    .fetch_all(&pool)
    .await?;
    for b in buyers {
        notify_typed(
            &pool,
            b,
            "offer",
            &format!("{} lot updated", lot.crop_name),
            &format!(
                "{} changed the lot to {} q, {}. Check your offer.",
                lot.farmer_name, qty, quality
            ),
            Some("/browse-produce"),
        )
        .await?;
    }
    Ok(Json(load_lot(&pool, user.user_id, id).await?))
}

#[derive(Deserialize, Default)]
struct ReasonBody {
    reason: Option<String>,
}

/// POST /api/lots/:id/withdraw — the owner takes an open lot off the market.
async fn withdraw_lot(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    body: Option<Json<ReasonBody>>,
) -> ApiResult<LotView> {
    let lot = load_lot(&pool, user.user_id, id).await?;
    if lot.farmer_id != user.user_id {
        return Err(forbidden(
            "Only the farmer who listed this lot can withdraw it",
        ));
    }
    if lot.status != "open" {
        return Err(bad(format!(
            "This lot is {} and cannot be withdrawn",
            lot.status
        )));
    }
    let reason = clean(body.and_then(|b| b.0.reason).as_deref(), "Reason", 200)?
        .unwrap_or_else(|| "Withdrawn by the farmer".into());
    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE lots SET status = 'withdrawn', cancel_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'",
    )
    .bind(&reason)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    let buyers: Vec<i64> = sqlx::query_scalar(
        "SELECT DISTINCT buyer_id FROM offers WHERE lot_id = ? AND status = 'pending'",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE offers SET status = 'cancelled', responded_at = CURRENT_TIMESTAMP,
                cancel_reason = 'The farmer withdrew this lot'
         WHERE lot_id = ? AND status = 'pending'",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    for b in buyers {
        notify_typed(
            &mut *tx,
            b,
            "rejected",
            &format!("{} lot withdrawn", lot.crop_name),
            &format!("{} withdrew the lot you made an offer on.", lot.farmer_name),
            Some("/browse-produce"),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(Json(load_lot(&pool, user.user_id, id).await?))
}

/// Tells buyers with an open requirement for this crop that a new lot is listed.
pub async fn notify_matching_buyers(pool: &SqlitePool, lot_id: i64) -> Result<(), AppError> {
    let lot = load_lot(pool, 0, lot_id).await?;
    let buyers: Vec<(i64, f64)> = sqlx::query_as(
        "SELECT d.buyer_id, CAST(MAX(d.max_price) AS REAL) FROM buyer_demand d
         JOIN users u ON u.id = d.buyer_id
         WHERE d.crop_id = ? AND d.status = 'open' AND date(d.required_by) >= date('now')
           AND u.status = 'active' AND d.buyer_id != ?
         GROUP BY d.buyer_id",
    )
    .bind(lot.crop_id)
    .bind(lot.farmer_id)
    .fetch_all(pool)
    .await?;
    for (buyer, _) in buyers {
        notify_typed(
            pool,
            buyer,
            "matching_lot",
            &format!("New {} lot matches your requirement", lot.crop_name),
            &format!(
                "{} q of {} ({}) listed by {}{}.",
                lot.quantity_quintals,
                lot.crop_name,
                lot.expected_quality,
                lot.farmer_name,
                if lot.farmer_location.is_empty() {
                    String::new()
                } else {
                    format!(", {}", lot.farmer_location)
                }
            ),
            Some("/browse-produce"),
        )
        .await?;
    }
    Ok(())
}

/* -------------------------------------------------------------------------- */
/*                                   offers                                   */
/* -------------------------------------------------------------------------- */

#[derive(Deserialize)]
pub struct CreateOffer {
    lot_id: i64,
    price_offered: f64,
    buyer_id: Option<i64>,
}

fn offer_links(role_to_notify: &str, lot_id: i64) -> String {
    if role_to_notify == "farmer" {
        format!("/crops?lot={lot_id}")
    } else {
        "/browse-produce".into()
    }
}

/// POST /api/offers — a buyer bids on a lot, or a farmer offers a lot to a buyer.
pub async fn create_offer(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(body): Json<CreateOffer>,
) -> ApiResult<OfferView> {
    require_trader(&user)?;
    if !(body.price_offered.is_finite() && body.price_offered > 0.0) {
        return Err(bad("Enter a price above ₹0 per quintal"));
    }
    let lot = load_lot(&pool, user.user_id, body.lot_id).await?;
    if lot.status != "open" {
        return Err(bad(format!(
            "This lot is {} and is not open for offers",
            lot.status
        )));
    }
    let buyer_id = if user.role == "buyer" {
        crate::admin::require_verified_buyer(&pool, user.user_id).await?;
        if lot.farmer_id == user.user_id {
            return Err(bad("You cannot bid on your own lot"));
        }
        user.user_id
    } else {
        if lot.farmer_id != user.user_id {
            return Err(forbidden(
                "Only the farmer who listed this lot can offer it to a buyer",
            ));
        }
        let b = body
            .buyer_id
            .ok_or_else(|| bad("Choose the buyer to send this offer to"))?;
        let (_, role) = active_user(&pool, b).await?;
        if role != "buyer" {
            return Err(bad("Offers can only be sent to buyer accounts"));
        }
        b
    };
    let open: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM offers WHERE lot_id = ? AND buyer_id = ? AND status = 'pending'",
    )
    .bind(lot.id)
    .bind(buyer_id)
    .fetch_one(&pool)
    .await?;
    if open > 0 {
        return Err(bad(
            "There is already an open offer between you on this lot. Answer it or wait for a reply.",
        ));
    }
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO offers (lot_id, buyer_id, price_offered, status, created_by_role)
         VALUES (?, ?, ?, 'pending', ?) RETURNING id",
    )
    .bind(lot.id)
    .bind(buyer_id)
    .bind(body.price_offered)
    .bind(&user.role)
    .fetch_all(&pool)
    .await
    .and_then(|mut rows| rows.pop().ok_or(sqlx::Error::RowNotFound))?;
    let (to, to_role) = if user.role == "buyer" {
        (lot.farmer_id, "farmer")
    } else {
        (buyer_id, "buyer")
    };
    notify_typed(
        &pool,
        to,
        "offer",
        &format!("New offer on {}", lot.crop_name),
        &format!(
            "{} offered ₹{}/q for {} q of {}.",
            user.name, body.price_offered, lot.quantity_quintals, lot.crop_name
        ),
        Some(&offer_links(to_role, lot.id)),
    )
    .await?;
    Ok(Json(load_offer(&pool, id).await?))
}

/// The role this user plays on the offer, after checking they are a party to it.
fn party_role(offer: &OfferView, user: &AuthUser) -> Result<&'static str, AppError> {
    if user.role == "farmer" && offer.farmer_id == user.user_id {
        Ok("farmer")
    } else if user.role == "buyer" && offer.buyer_id == user.user_id {
        Ok("buyer")
    } else {
        Err(forbidden("You are not part of this offer"))
    }
}

fn other_party(offer: &OfferView, role: &str) -> (i64, &'static str) {
    if role == "farmer" {
        (offer.buyer_id, "buyer")
    } else {
        (offer.farmer_id, "farmer")
    }
}

/// POST /api/offers/:id/accept — the other side accepts; the lot is sold and an order starts.
pub async fn accept_offer(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<OrderRow> {
    let offer = load_offer(&pool, id).await?;
    let role = party_role(&offer, &user)?;
    deals::can_respond(&offer.status, &offer.created_by_role, role).map_err(bad)?;
    if role == "buyer" {
        crate::admin::require_verified_buyer(&pool, user.user_id).await?;
    }
    if offer.lot_status != "open" {
        return Err(bad(format!(
            "This lot is {} and can no longer be sold here",
            offer.lot_status
        )));
    }
    let pickup: Option<String> = sqlx::query_scalar("SELECT location FROM farmers WHERE id = ?")
        .bind(offer.farmer_id)
        .fetch_optional(&pool)
        .await?;
    let delivery: Option<String> = sqlx::query_scalar(
        "SELECT delivery_location FROM buyer_demand d JOIN lots l ON l.crop_id = d.crop_id
         WHERE l.id = ? AND d.buyer_id = ? ORDER BY (d.status = 'open') DESC, d.id DESC LIMIT 1",
    )
    .bind(offer.lot_id)
    .bind(offer.buyer_id)
    .fetch_optional(&pool)
    .await?;
    let delivery = match delivery {
        Some(d) => Some(d),
        None => sqlx::query_scalar("SELECT location FROM buyers WHERE id = ?")
            .bind(offer.buyer_id)
            .fetch_optional(&pool)
            .await?
            .flatten(),
    };

    let mut tx = pool.begin().await?;
    let done = sqlx::query(
        "UPDATE offers SET status = 'accepted', responded_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    if done.rows_affected() == 0 {
        return Err(bad("This offer was already answered"));
    }
    let sold = sqlx::query(
        "UPDATE lots SET status = 'sold', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'",
    )
    .bind(offer.lot_id)
    .execute(&mut *tx)
    .await?;
    if sold.rows_affected() == 0 {
        return Err(bad("This lot was sold or withdrawn a moment ago"));
    }
    let others: Vec<i64> = sqlx::query_scalar(
        "SELECT DISTINCT buyer_id FROM offers WHERE lot_id = ? AND status = 'pending' AND id != ?",
    )
    .bind(offer.lot_id)
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE offers SET status = 'rejected', responded_at = CURRENT_TIMESTAMP,
                cancel_reason = 'The lot was sold to another buyer'
         WHERE lot_id = ? AND status = 'pending' AND id != ?",
    )
    .bind(offer.lot_id)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    let tx_id: i64 = sqlx::query_scalar(
        "INSERT INTO transactions (offer_id, final_price, status, pickup_location, delivery_location)
         VALUES (?, ?, 'accepted', ?, ?) RETURNING id",
    )
    .bind(id)
    .bind(offer.price_offered)
    .bind(&pickup)
    .bind(&delivery)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO order_events (transaction_id, status, note, created_by) VALUES (?, 'accepted', 'Offer accepted', ?)",
    )
    .bind(tx_id)
    .bind(user.user_id)
    .execute(&mut *tx)
    .await?;
    let (to, _) = other_party(&offer, role);
    notify_typed(
        &mut *tx,
        to,
        "accepted",
        &format!("Offer accepted: {}", offer.crop_name),
        &format!(
            "{} accepted ₹{}/q for {} q. Order #{} has started.",
            user.name, offer.price_offered, offer.quantity_quintals, tx_id
        ),
        Some("/orders"),
    )
    .await?;
    for b in others {
        notify_typed(
            &mut *tx,
            b,
            "rejected",
            &format!("{} lot sold", offer.crop_name),
            "The farmer sold this lot to another buyer, so your offer was closed.",
            Some("/browse-produce"),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(Json(load_order(&pool, tx_id).await?))
}

/// POST /api/offers/:id/reject
async fn reject_offer(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    body: Option<Json<ReasonBody>>,
) -> ApiResult<OfferView> {
    let offer = load_offer(&pool, id).await?;
    let role = party_role(&offer, &user)?;
    deals::can_respond(&offer.status, &offer.created_by_role, role).map_err(bad)?;
    let reason = clean(body.and_then(|b| b.0.reason).as_deref(), "Reason", 200)?;
    let done = sqlx::query(
        "UPDATE offers SET status = 'rejected', responded_at = CURRENT_TIMESTAMP, cancel_reason = ?
         WHERE id = ? AND status = 'pending'",
    )
    .bind(&reason)
    .bind(id)
    .execute(&pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(bad("This offer was already answered"));
    }
    let (to, to_role) = other_party(&offer, role);
    notify_typed(
        &pool,
        to,
        "rejected",
        &format!("Offer declined: {}", offer.crop_name),
        &format!(
            "{} declined ₹{}/q{}",
            user.name,
            offer.price_offered,
            reason
                .map(|r| format!(": {r}"))
                .unwrap_or_else(|| ".".into())
        ),
        Some(&offer_links(to_role, offer.lot_id)),
    )
    .await?;
    Ok(Json(load_offer(&pool, id).await?))
}

#[derive(Deserialize)]
struct CounterBody {
    price: f64,
}

/// POST /api/offers/:id/counter — answer with a new price; the old offer is
/// marked countered and the new one points back to it.
async fn counter_offer(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(body): Json<CounterBody>,
) -> ApiResult<OfferView> {
    let offer = load_offer(&pool, id).await?;
    let role = party_role(&offer, &user)?;
    deals::can_respond(&offer.status, &offer.created_by_role, role).map_err(bad)?;
    deals::validate_counter_price(offer.price_offered, body.price).map_err(bad)?;
    if role == "buyer" {
        crate::admin::require_verified_buyer(&pool, user.user_id).await?;
    }
    if offer.lot_status != "open" {
        return Err(bad(format!("This lot is {}", offer.lot_status)));
    }
    let mut tx = pool.begin().await?;
    let done = sqlx::query(
        "UPDATE offers SET status = 'countered', responded_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    if done.rows_affected() == 0 {
        return Err(bad("This offer was already answered"));
    }
    let new_id: i64 = sqlx::query_scalar(
        "INSERT INTO offers (lot_id, buyer_id, price_offered, status, created_by_role, parent_offer_id)
         VALUES (?, ?, ?, 'pending', ?, ?) RETURNING id",
    )
    .bind(offer.lot_id)
    .bind(offer.buyer_id)
    .bind(body.price)
    .bind(role)
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    let (to, to_role) = other_party(&offer, role);
    notify_typed(
        &mut *tx,
        to,
        "counter",
        &format!("Counter offer on {}", offer.crop_name),
        &format!(
            "{} replied with ₹{}/q (your offer was ₹{}/q).",
            user.name, body.price, offer.price_offered
        ),
        Some(&offer_links(to_role, offer.lot_id)),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(load_offer(&pool, new_id).await?))
}

/// POST /api/offers/:id/withdraw — the side that made a pending offer takes it back.
async fn withdraw_offer(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<OfferView> {
    let offer = load_offer(&pool, id).await?;
    let role = party_role(&offer, &user)?;
    if offer.created_by_role != role {
        return Err(forbidden(
            "Only the side that made this offer can withdraw it",
        ));
    }
    let done = sqlx::query(
        "UPDATE offers SET status = 'cancelled', responded_at = CURRENT_TIMESTAMP,
                cancel_reason = 'Withdrawn by the sender'
         WHERE id = ? AND status = 'pending'",
    )
    .bind(id)
    .execute(&pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(bad("Only pending offers can be withdrawn"));
    }
    Ok(Json(load_offer(&pool, id).await?))
}

/* -------------------------------------------------------------------------- */
/*                              orders and payments                           */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Serialize, FromRow)]
pub struct OrderRow {
    pub id: i64,
    pub offer_id: i64,
    pub final_price: f64,
    pub status: String,
    pub completed_at: String,
    pub crop_name: String,
    pub quantity_quintals: f64,
    pub buyer_name: String,
    pub farmer_name: String,
    pub lot_id: i64,
    pub accepted_by_role: String,
    pub buyer_id: i64,
    pub farmer_id: i64,
    pub pickup_location: Option<String>,
    pub delivery_location: Option<String>,
    pub expected_quality: String,
    pub order_status: Option<String>,
    pub paid_confirmed: f64,
    pub paid_awaiting: f64,
    #[sqlx(skip)]
    pub total_amount: f64,
    #[sqlx(skip)]
    pub payment_status: String,
    #[sqlx(skip)]
    pub balance_due: f64,
}

const ORDER_SELECT: &str = "SELECT t.id, t.offer_id, CAST(t.final_price AS REAL) AS final_price,
        t.status, COALESCE(t.completed_at, '') AS completed_at, c.name AS crop_name,
        CAST(l.quantity_quintals AS REAL) AS quantity_quintals, ub.name AS buyer_name,
        uf.name AS farmer_name, l.id AS lot_id,
        CASE WHEN o.created_by_role = 'buyer' THEN 'farmer' ELSE 'buyer' END AS accepted_by_role,
        o.buyer_id, l.farmer_id, t.pickup_location, t.delivery_location, l.expected_quality,
        (SELECT e.status FROM order_events e WHERE e.transaction_id = t.id
          ORDER BY CASE e.status WHEN 'delivered' THEN 3 WHEN 'in_transit' THEN 2
                                 WHEN 'picked_up' THEN 1 ELSE 0 END DESC LIMIT 1) AS order_status,
        CAST((SELECT COALESCE(SUM(p.amount), 0) FROM transaction_payments p
               WHERE p.transaction_id = t.id AND p.status = 'confirmed') AS REAL) AS paid_confirmed,
        CAST((SELECT COALESCE(SUM(p.amount), 0) FROM transaction_payments p
               WHERE p.transaction_id = t.id AND p.status = 'marked_paid') AS REAL) AS paid_awaiting
     FROM transactions t
     JOIN offers o ON o.id = t.offer_id
     JOIN lots l ON l.id = o.lot_id
     JOIN crops c ON c.id = l.crop_id
     JOIN users ub ON ub.id = o.buyer_id
     JOIN users uf ON uf.id = l.farmer_id";

fn finish_order(mut o: OrderRow) -> OrderRow {
    o.total_amount = r2(o.final_price * o.quantity_quintals);
    o.payment_status =
        deals::payment_status(o.total_amount, o.paid_confirmed, o.paid_awaiting).into();
    o.balance_due = r2((o.total_amount - o.paid_confirmed).max(0.0));
    if o.order_status.is_none() {
        o.order_status = Some("accepted".into());
    }
    o
}

async fn load_order(pool: &SqlitePool, id: i64) -> Result<OrderRow, AppError> {
    sqlx::query_as::<_, OrderRow>(&format!("{ORDER_SELECT} WHERE t.id = ?"))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .map(finish_order)
        .ok_or_else(|| not_found("Order not found"))
}

fn order_role(order: &OrderRow, user: &AuthUser) -> Result<&'static str, AppError> {
    if user.role == "farmer" && order.farmer_id == user.user_id {
        Ok("farmer")
    } else if user.role == "buyer" && order.buyer_id == user.user_id {
        Ok("buyer")
    } else if user.role == "admin" {
        Ok("admin")
    } else {
        Err(forbidden("You are not part of this order"))
    }
}

/// GET /api/transactions — my orders with order and payment status.
pub async fn list_orders(
    State(pool): State<SqlitePool>,
    user: AuthUser,
) -> ApiResult<Vec<OrderRow>> {
    require_trader(&user)?;
    let rows = sqlx::query_as::<_, OrderRow>(&format!(
        "{ORDER_SELECT} WHERE o.buyer_id = ? OR l.farmer_id = ? ORDER BY t.id DESC"
    ))
    .bind(user.user_id)
    .bind(user.user_id)
    .fetch_all(&pool)
    .await?;
    Ok(Json(rows.into_iter().map(finish_order).collect()))
}

#[derive(Debug, Serialize, FromRow)]
struct EventRow {
    id: i64,
    status: String,
    note: Option<String>,
    created_by: Option<i64>,
    created_by_name: Option<String>,
    created_at: String,
}

#[derive(Debug, Serialize, FromRow)]
struct PaymentRow {
    id: i64,
    amount: f64,
    method: String,
    reference: Option<String>,
    status: String,
    paid_at: String,
    confirmed_at: Option<String>,
    note: Option<String>,
}

/// GET /api/transactions/:id — order, tracking, payments and net realisation.
async fn order_detail(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Value> {
    let order = load_order(&pool, id).await?;
    let role = order_role(&order, &user)?;
    let events: Vec<EventRow> = sqlx::query_as(
        "SELECT e.id, e.status, e.note, e.created_by, u.name AS created_by_name,
                COALESCE(e.created_at, '') AS created_at
         FROM order_events e LEFT JOIN users u ON u.id = e.created_by
         WHERE e.transaction_id = ? ORDER BY e.created_at, e.id",
    )
    .bind(id)
    .fetch_all(&pool)
    .await?;
    let payments: Vec<PaymentRow> = sqlx::query_as(
        "SELECT id, CAST(amount AS REAL) AS amount, method, reference, status,
                COALESCE(paid_at, '') AS paid_at, confirmed_at, note
         FROM transaction_payments WHERE transaction_id = ? ORDER BY id",
    )
    .bind(id)
    .fetch_all(&pool)
    .await?;
    let freight = freight_per_quintal(
        &pool,
        order.pickup_location.as_deref().unwrap_or(""),
        order.delivery_location.as_deref().unwrap_or(""),
    )
    .await?;
    let net = deals::net_realisation(
        order.final_price,
        order.quantity_quintals,
        freight,
        deals::platform_fee_percent(),
    );
    let counterpart = if role == "buyer" {
        json!({ "id": order.farmer_id, "name": order.farmer_name, "role": "farmer" })
    } else {
        json!({ "id": order.buyer_id, "name": order.buyer_name, "role": "buyer" })
    };
    let steps: Vec<&str> = events.iter().map(|e| e.status.as_str()).collect();
    let current = deals::current_step(steps);
    Ok(Json(json!({
        "order": order,
        "my_role": role,
        "counterpart": counterpart,
        "events": events,
        "steps": deals::ORDER_STEPS,
        "current_step": current,
        "payments": payments,
        "net_realisation": net,
        "freight_note": if freight.is_some() {
            "Freight from the AgriSense route table (pickup state to delivery state)."
        } else {
            "No freight rate is known for this route yet."
        },
    })))
}

#[derive(Deserialize)]
struct EventBody {
    status: String,
    note: Option<String>,
}

/// POST /api/transactions/:id/events — move the order forward.
async fn add_order_event(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(body): Json<EventBody>,
) -> ApiResult<OrderRow> {
    let order = load_order(&pool, id).await?;
    let role = order_role(&order, &user)?;
    let current = order
        .order_status
        .clone()
        .unwrap_or_else(|| "accepted".into());
    deals::can_set_order_status(&current, &body.status, role).map_err(bad)?;
    let note = clean(body.note.as_deref(), "Note", 300)?;
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO order_events (transaction_id, status, note, created_by) VALUES (?, ?, ?, ?)",
    )
    .bind(id)
    .bind(&body.status)
    .bind(&note)
    .bind(user.user_id)
    .execute(&mut *tx)
    .await?;
    let fully_paid = deals::payment_status(order.total_amount, order.paid_confirmed, 0.0) == "paid";
    let new_status = if body.status == "delivered" && fully_paid {
        "completed"
    } else {
        body.status.as_str()
    };
    sqlx::query("UPDATE transactions SET status = ? WHERE id = ?")
        .bind(new_status)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let to = if role == "buyer" {
        order.farmer_id
    } else {
        order.buyer_id
    };
    let label = match body.status.as_str() {
        "picked_up" => "picked up",
        "in_transit" => "on the way",
        "delivered" => "delivered",
        _ => "updated",
    };
    notify_typed(
        &mut *tx,
        to,
        "order",
        &format!("Order #{id} {label}"),
        &format!(
            "{} marked {} q of {} as {}{}",
            user.name,
            order.quantity_quintals,
            order.crop_name,
            label,
            note.map(|n| format!(": {n}")).unwrap_or_else(|| ".".into())
        ),
        Some("/orders"),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(load_order(&pool, id).await?))
}

#[derive(Deserialize)]
struct PaymentBody {
    amount: f64,
    method: Option<String>,
    reference: Option<String>,
    paid_at: Option<String>,
}

/// POST /api/transactions/:id/payments — the buyer records a payment made.
async fn record_payment(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(body): Json<PaymentBody>,
) -> ApiResult<OrderRow> {
    let order = load_order(&pool, id).await?;
    if order_role(&order, &user)? != "buyer" {
        return Err(forbidden("Only the buyer on this order records payments"));
    }
    if !(body.amount.is_finite() && body.amount > 0.0) {
        return Err(bad("Enter an amount above ₹0"));
    }
    let open = order.total_amount - order.paid_confirmed - order.paid_awaiting;
    if body.amount > open + 0.5 {
        return Err(bad(format!(
            "Only {} is still unpaid on this order",
            rupees(open.max(0.0))
        )));
    }
    let method = body.method.as_deref().unwrap_or("bank_transfer");
    if !["upi", "bank_transfer", "cash", "cheque"].contains(&method) {
        return Err(bad(
            "Payment method must be UPI, bank transfer, cash or cheque",
        ));
    }
    let reference = clean(body.reference.as_deref(), "Reference", 60)?;
    let paid_at = clean(body.paid_at.as_deref(), "Payment date", 25)?;
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO transaction_payments (transaction_id, amount, method, reference, paid_at, recorded_by)
         VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)",
    )
    .bind(id)
    .bind(body.amount)
    .bind(method)
    .bind(&reference)
    .bind(&paid_at)
    .bind(user.user_id)
    .execute(&mut *tx)
    .await?;
    notify_typed(
        &mut *tx,
        order.farmer_id,
        "payment",
        &format!("Payment of {} marked as paid", rupees(body.amount)),
        &format!(
            "{} says they paid {} for order #{id}{}. Confirm when it reaches your account.",
            user.name,
            rupees(body.amount),
            reference.map(|r| format!(" (ref {r})")).unwrap_or_default()
        ),
        Some("/payments"),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(load_order(&pool, id).await?))
}

async fn payment_for_farmer(
    pool: &SqlitePool,
    user: &AuthUser,
    payment_id: i64,
) -> Result<(i64, f64, String, OrderRow), AppError> {
    let row: Option<(i64, f64, String)> = sqlx::query_as(
        "SELECT transaction_id, CAST(amount AS REAL), status FROM transaction_payments WHERE id = ?",
    )
    .bind(payment_id)
    .fetch_optional(pool)
    .await?;
    let (tx_id, amount, status) = row.ok_or_else(|| not_found("Payment not found"))?;
    let order = load_order(pool, tx_id).await?;
    if order_role(&order, user)? != "farmer" {
        return Err(forbidden("Only the farmer on this order confirms payments"));
    }
    if status != "marked_paid" {
        return Err(bad(format!(
            "This payment is already {}",
            status.replace('_', " ")
        )));
    }
    Ok((tx_id, amount, status, order))
}

/// POST /api/payments/:id/confirm — the farmer confirms the money arrived.
async fn confirm_payment(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<OrderRow> {
    let (tx_id, amount, _, order) = payment_for_farmer(&pool, &user, id).await?;
    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE transaction_payments SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'marked_paid'",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    let now_paid =
        deals::payment_status(order.total_amount, order.paid_confirmed + amount, 0.0) == "paid";
    if now_paid && order.order_status.as_deref() == Some("delivered") {
        sqlx::query("UPDATE transactions SET status = 'completed' WHERE id = ?")
            .bind(tx_id)
            .execute(&mut *tx)
            .await?;
    }
    notify_typed(
        &mut *tx,
        order.buyer_id,
        "payment",
        &format!("Payment of {} received", rupees(amount)),
        &format!(
            "{} confirmed your payment for order #{tx_id}.{}",
            user.name,
            if now_paid {
                " The order is fully paid."
            } else {
                ""
            }
        ),
        Some("/payments"),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(load_order(&pool, tx_id).await?))
}

/// POST /api/payments/:id/not-received — the farmer says the money has not arrived.
async fn payment_not_received(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    body: Option<Json<ReasonBody>>,
) -> ApiResult<OrderRow> {
    let (tx_id, amount, _, order) = payment_for_farmer(&pool, &user, id).await?;
    let note = clean(body.and_then(|b| b.0.reason).as_deref(), "Note", 200)?;
    sqlx::query("UPDATE transaction_payments SET status = 'not_received', note = ? WHERE id = ?")
        .bind(&note)
        .bind(id)
        .execute(&pool)
        .await?;
    notify_typed(
        &pool,
        order.buyer_id,
        "payment",
        &format!("Payment of {} not received", rupees(amount)),
        &format!(
            "{} has not received this payment for order #{tx_id}{}",
            user.name,
            note.map(|n| format!(": {n}"))
                .unwrap_or_else(|| ". Please check the transfer.".into())
        ),
        Some("/payments"),
    )
    .await?;
    Ok(Json(load_order(&pool, tx_id).await?))
}

/* -------------------------------------------------------------------------- */
/*                         forecast, signals and storage                      */
/* -------------------------------------------------------------------------- */

#[derive(Serialize)]
struct Driver {
    key: &'static str,
    label: String,
    value: String,
    /// "up" (supports higher prices), "down", "risk" or "neutral"
    impact: &'static str,
    detail: String,
}

struct DemandSummary {
    buyers: i64,
    quantity: f64,
    best_price: Option<f64>,
    supply: f64,
}

async fn demand_summary(pool: &SqlitePool, crop_id: i64) -> Result<DemandSummary, AppError> {
    let (buyers, quantity, best_price): (i64, f64, Option<f64>) = sqlx::query_as(
        "SELECT COUNT(DISTINCT buyer_id), CAST(COALESCE(SUM(min_quantity), 0) AS REAL), CAST(MAX(max_price) AS REAL)
         FROM buyer_demand WHERE crop_id = ? AND status = 'open' AND date(required_by) >= date('now')",
    )
    .bind(crop_id)
    .fetch_one(pool)
    .await?;
    let supply: f64 = sqlx::query_scalar(
        "SELECT CAST(COALESCE((SELECT SUM(quantity_quintals) FROM lots WHERE crop_id = ? AND status = 'open'), 0)
              + COALESCE((SELECT SUM(total_quintals - reserved_quintals - sold_quintals) FROM fpo_lots WHERE crop_id = ?), 0) AS REAL)",
    )
    .bind(crop_id)
    .bind(crop_id)
    .fetch_one(pool)
    .await?;
    Ok(DemandSummary {
        buyers,
        quantity,
        best_price,
        supply,
    })
}

fn trend_driver(o: Option<&forecast::Outlook>, days: usize) -> Driver {
    match o {
        Some(o) => Driver {
            key: "trend",
            label: "Mandi price trend".into(),
            value: format!(
                "{} ({:+.1}% in 14 days)",
                o.direction, o.change_14d_percent
            ),
            impact: match o.direction {
                "rising" => "up",
                "falling" => "down",
                _ => "neutral",
            },
            detail: format!(
                "{} days of mandi prices: 7-day average ₹{:.0}/q, 14-day average ₹{:.0}/q, trend {:+.0} ₹/q per day.",
                o.history_days, o.ma7, o.ma14, o.trend_per_day
            ),
        },
        None => Driver {
            key: "trend",
            label: "Mandi price trend".into(),
            value: "not enough history".into(),
            impact: "neutral",
            detail: format!("Only {days} days of prices are stored so far; the trend appears after 3 days."),
        },
    }
}

fn demand_driver(d: &DemandSummary, crop: &str) -> Driver {
    let gap = gap_status(d.supply, d.quantity);
    Driver {
        key: "demand",
        label: "Open buyer demand".into(),
        value: if d.buyers == 0 {
            "no open requirements".into()
        } else {
            format!("{} q from {} buyer(s)", d.quantity, d.buyers)
        },
        impact: match gap {
            "shortage" => "up",
            "oversupply" | "no_demand" => "down",
            _ => "neutral",
        },
        detail: format!(
            "{} q of {crop} is listed on AgriSense against {} q wanted{}.",
            r2(d.supply),
            r2(d.quantity),
            d.best_price
                .map(|p| format!("; best buyer price ₹{p:.0}/q"))
                .unwrap_or_default()
        ),
    }
}

fn perishability_driver(days: i64, age_days: Option<f64>) -> Driver {
    let left = age_days.map(|a| (days as f64 - a).max(0.0));
    Driver {
        key: "perishability",
        label: "Shelf life".into(),
        value: match left {
            Some(l) => format!("about {l:.0} of {days} days left"),
            None => format!("about {days} days"),
        },
        impact: if days <= 10 || left.is_some_and(|l| l < 5.0) {
            "risk"
        } else {
            "neutral"
        },
        detail: if days <= 10 {
            "Perishable: holding for a better price risks spoilage and quality cuts.".into()
        } else if days <= 60 {
            "Semi-perishable: can be held for a few weeks with proper storage.".into()
        } else {
            "Durable: can be stored if prices are expected to rise.".into()
        },
    }
}

#[derive(Deserialize)]
struct ForecastQuery {
    crop: String,
    state: Option<String>,
    horizon: Option<usize>,
}

/// GET /api/forecast?crop=&state= — trend-based price outlook from stored mandi prices.
async fn price_forecast(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Query(q): Query<ForecastQuery>,
) -> ApiResult<Value> {
    let crop_name = q.crop.trim();
    if crop_name.is_empty() {
        return Err(bad("Choose a crop"));
    }
    let state = match q.state.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => s.to_string(),
        None => farmer_state(&pool, user.user_id).await?,
    };
    let horizon = q.horizon.unwrap_or(14).clamp(7, 30);
    let (history, api_ok) = price_history(&pool, crop_name, &state).await?;
    let outlook = forecast::outlook(&history, horizon);
    let crop: Option<(i64, i64)> =
        sqlx::query_as("SELECT id, perishability_days FROM crops WHERE lower(name) = lower(?)")
            .bind(crop_name)
            .fetch_optional(&pool)
            .await?;
    let month: u32 = sqlx::query_scalar::<_, String>("SELECT strftime('%m', 'now')")
        .fetch_one(&pool)
        .await?
        .parse()
        .unwrap_or(1);
    let mut drivers = vec![trend_driver(outlook.as_ref(), history.len())];
    if let Some((crop_id, days)) = crop {
        drivers.push(demand_driver(
            &demand_summary(&pool, crop_id).await?,
            crop_name,
        ));
        drivers.push(perishability_driver(days, None));
    }
    let season = forecast::seasonal_note(crop_name, month);
    if let Some(note) = season {
        drivers.push(Driver {
            key: "season",
            label: "Season".into(),
            value: "harvest calendar".into(),
            impact: "neutral",
            detail: note.into(),
        });
    }
    Ok(Json(json!({
        "crop": crop_name,
        "state": state,
        "horizon_days": horizon,
        "outlook": outlook,
        "history_days": history.len(),
        "seasonal_note": season,
        "drivers": drivers,
        "label": "Trend-based estimate, not a guarantee",
        "source_available": api_ok || !history.is_empty(),
        "basis": format!(
            "Daily median modal price across {state} mandis (Mandi API), saved by AgriSense. \
             Forecast = blend of today's price and the 7-day average, plus the 30-day trend, damped over time."
        ),
    })))
}

/// GET /api/lots/:id/signals — price, demand, shelf-life and freight signals for one lot,
/// plus inputs for the sell/hold calculation.
async fn lot_signals(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Value> {
    let lot = load_lot(&pool, user.user_id, id).await?;
    if lot.farmer_id != user.user_id && user.role != "admin" {
        return Err(forbidden(
            "Only the farmer who listed this lot can see its signals",
        ));
    }
    let state = farmer_state(&pool, lot.farmer_id).await?;
    let (history, _) = price_history(&pool, &lot.crop_name, &state).await?;
    let horizon = ((lot.perishability_days as f64 / 2.0).round() as usize).clamp(7, 30);
    let outlook = forecast::outlook(&history, horizon);
    let live = crate::services::mandi::fetch_prices(Some(&state), Some(&lot.crop_name))
        .await
        .unwrap_or_default();
    let mut modal: Vec<f64> = live
        .iter()
        .map(|p| p.modal_price)
        .filter(|p| *p > 0.0)
        .collect();
    modal.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let live_median = modal.get(modal.len() / 2).copied();
    let current = live_median
        .or(outlook.as_ref().map(|o| o.current))
        .or(lot.best_offer);
    let expected = outlook
        .as_ref()
        .and_then(|o| o.points.iter().rev().find(|p| p.kind == "forecast"))
        .map(|p| p.price)
        .or(current);
    let demand = demand_summary(&pool, lot.crop_id).await?;
    let mut drivers = vec![
        trend_driver(outlook.as_ref(), history.len()),
        demand_driver(&demand, &lot.crop_name),
        perishability_driver(lot.perishability_days, Some(lot.days_listed)),
    ];
    // Freight to where the best-paying buyer wants delivery.
    let best: Option<(String, f64)> = sqlx::query_as(
        "SELECT delivery_location, CAST(max_price AS REAL) FROM buyer_demand
         WHERE crop_id = ? AND status = 'open' AND date(required_by) >= date('now')
         ORDER BY max_price DESC LIMIT 1",
    )
    .bind(lot.crop_id)
    .fetch_optional(&pool)
    .await?;
    if let Some((place, price)) = &best {
        let freight = freight_per_quintal(&pool, &lot.farmer_location, place).await?;
        drivers.push(Driver {
            key: "freight",
            label: "Freight to best buyer".into(),
            value: freight
                .map(|f| format!("₹{f:.0}/q to {place}"))
                .unwrap_or_else(|| format!("route to {place} not priced")),
            impact: match freight {
                Some(f) if f > price * 0.08 => "down",
                Some(_) => "neutral",
                None => "neutral",
            },
            detail: match freight {
                Some(f) => format!(
                    "Best buyer pays ₹{price:.0}/q delivered to {place}; after freight you keep about ₹{:.0}/q.",
                    price - f
                ),
                None => format!(
                    "Best buyer pays ₹{price:.0}/q delivered to {place}. Ask the buyer about pickup or check local transport rates."
                ),
            },
        });
    }
    if lot.pending_offers > 0 {
        drivers.push(Driver {
            key: "offers",
            label: "Offers on this lot".into(),
            value: format!("{} waiting", lot.pending_offers),
            impact: "up",
            detail: lot
                .best_offer
                .map(|b| format!("Best buyer offer is ₹{b:.0}/q."))
                .unwrap_or_else(|| "You sent offers that are waiting for buyers.".into()),
        });
    }
    let storage_per_day: f64 = sqlx::query_scalar(
        "SELECT CAST(COALESCE(AVG(cost_per_quintal_per_day), 2.0) AS REAL) FROM storage_facilities",
    )
    .fetch_one(&pool)
    .await?;
    let urgency: String = sqlx::query_scalar(
        "SELECT COALESCE((SELECT urgency_level FROM farmers WHERE id = ?), 'medium')",
    )
    .bind(lot.farmer_id)
    .fetch_one(&pool)
    .await?;
    Ok(Json(json!({
        "lot": lot,
        "state": state,
        "current_price": current.map(r2),
        "current_price_source": if live_median.is_some() {
            format!("median of {} live {state} mandi prices", modal.len())
        } else if outlook.is_some() {
            "latest stored mandi price".into()
        } else if lot.best_offer.is_some() {
            "best buyer offer".into()
        } else {
            "not available".to_string()
        },
        "expected_price": expected.map(r2),
        "horizon_days": horizon,
        "outlook": outlook,
        "drivers": drivers,
        "smart_sale_inputs": current.zip(expected).map(|(c, e)| json!({
            "crop_id": lot.crop_id,
            "quantity_quintals": lot.quantity_quintals,
            "current_price_per_quintal": r2(c),
            "expected_future_price": r2(e),
            "storage_cost_per_day": r2(storage_per_day),
            "farmer_urgency": urgency,
            "handling_costs": 0.0,
        })),
        "label": "Trend-based estimate, not a guarantee",
    })))
}

/// GET /api/storage-options — real storage rates by market and verified FPO warehouses.
async fn storage_options(State(pool): State<SqlitePool>, _user: AuthUser) -> ApiResult<Value> {
    let rates: Vec<(i64, String, String, f64)> = sqlx::query_as(
        "SELECT m.id, m.name, m.location, CAST(s.cost_per_quintal_per_day AS REAL)
         FROM storage_facilities s JOIN markets m ON m.id = s.market_id ORDER BY m.name",
    )
    .fetch_all(&pool)
    .await?;
    type WarehouseRow = (i64, String, String, f64, f64, String, String, String, i64);
    let warehouses: Vec<WarehouseRow> = sqlx::query_as(
        "SELECT w.id, w.name, w.location, CAST(w.capacity_quintals AS REAL),
                CAST(w.rate_per_quintal_month AS REAL), o.name, o.district, o.state, o.manager_user_id
         FROM fpo_warehouses w JOIN fpo_organizations o ON o.id = w.fpo_id
         WHERE o.verified = 1 ORDER BY o.state, w.name",
    )
    .fetch_all(&pool)
    .await?;
    Ok(Json(json!({
        "rates": rates.into_iter().map(|r| json!({
            "market_id": r.0, "market": r.1, "location": r.2,
            "cost_per_quintal_per_day": r.3, "cost_per_quintal_per_month": r2(r.3 * 30.0),
        })).collect::<Vec<_>>(),
        "warehouses": warehouses.into_iter().map(|w| json!({
            "id": w.0, "name": w.1, "location": w.2, "capacity_quintals": w.3,
            "rate_per_quintal_month": w.4, "fpo_name": w.5, "district": w.6, "state": w.7,
            "fpo_user_id": w.8,
        })).collect::<Vec<_>>(),
    })))
}

/* -------------------------------------------------------------------------- */
/*                                  suppliers                                 */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Serialize, Clone)]
struct Supplier {
    key: String,
    kind: &'static str,
    id: i64,
    /// User to message (the farmer, or the FPO's manager).
    user_id: i64,
    name: String,
    location: String,
    verified: bool,
    fpo_name: Option<String>,
    crops: Vec<String>,
    open_lots: i64,
    open_quantity: f64,
    completed_deals: i64,
    members: Option<i64>,
}

type FarmerSupplierRow = (
    i64,
    String,
    String,
    i64,
    f64,
    Option<String>,
    i64,
    Option<String>,
);
type FpoSupplierRow = (
    i64,
    i64,
    String,
    String,
    String,
    i64,
    i64,
    f64,
    Option<String>,
    i64,
    i64,
);

async fn all_suppliers(pool: &SqlitePool) -> Result<Vec<Supplier>, AppError> {
    let farmers: Vec<FarmerSupplierRow> = sqlx::query_as(
        "SELECT u.id, u.name, COALESCE(f.location, ''), COUNT(l.id),
                CAST(COALESCE(SUM(l.quantity_quintals), 0) AS REAL), GROUP_CONCAT(DISTINCT c.name),
                (SELECT COUNT(*) FROM transactions t JOIN offers o ON o.id = t.offer_id
                  JOIN lots l2 ON l2.id = o.lot_id WHERE l2.farmer_id = u.id),
                (SELECT fo.name FROM fpo_members m JOIN fpo_organizations fo ON fo.id = m.fpo_id
                  WHERE m.user_id = u.id AND m.status = 'active' AND fo.verified = 1 LIMIT 1)
         FROM users u
         JOIN lots l ON l.farmer_id = u.id AND l.status = 'open'
         JOIN crops c ON c.id = l.crop_id
         LEFT JOIN farmers f ON f.id = u.id
         WHERE u.role = 'farmer' AND u.status = 'active'
         GROUP BY u.id",
    )
    .fetch_all(pool)
    .await?;
    let fpos: Vec<FpoSupplierRow> = sqlx::query_as(
        "SELECT o.id, o.manager_user_id, o.name, o.district, o.state, o.verified, COUNT(l.id),
                CAST(COALESCE(SUM(l.total_quintals - l.reserved_quintals - l.sold_quintals), 0) AS REAL),
                GROUP_CONCAT(DISTINCT c.name),
                (SELECT COUNT(*) FROM fpo_sales s WHERE s.fpo_id = o.id),
                (SELECT COUNT(*) FROM fpo_members m WHERE m.fpo_id = o.id AND m.status = 'active')
         FROM fpo_organizations o
         JOIN users u ON u.id = o.manager_user_id AND u.status = 'active'
         JOIN fpo_lots l ON l.fpo_id = o.id AND l.total_quintals - l.reserved_quintals - l.sold_quintals > 0.0001
         JOIN crops c ON c.id = l.crop_id
         WHERE o.verified = 1
         GROUP BY o.id",
    )
    .fetch_all(pool)
    .await?;
    let split = |s: Option<String>| -> Vec<String> {
        s.map(|v| {
            v.split(',')
                .map(|x| x.trim().to_string())
                .filter(|x| !x.is_empty())
                .collect()
        })
        .unwrap_or_default()
    };
    let mut out: Vec<Supplier> = farmers
        .into_iter()
        .map(|r| Supplier {
            key: format!("farmer-{}", r.0),
            kind: "farmer",
            id: r.0,
            user_id: r.0,
            name: r.1,
            location: r.2,
            verified: r.7.is_some(),
            fpo_name: r.7,
            crops: split(r.5),
            open_lots: r.3,
            open_quantity: r2(r.4),
            completed_deals: r.6,
            members: None,
        })
        .collect();
    out.extend(fpos.into_iter().map(|r| {
        Supplier {
            key: format!("fpo-{}", r.0),
            kind: "fpo",
            id: r.0,
            user_id: r.1,
            name: r.2,
            location: [r.3, r.4]
                .into_iter()
                .filter(|s| !s.trim().is_empty())
                .collect::<Vec<_>>()
                .join(", "),
            verified: r.5 == 1,
            fpo_name: None,
            crops: split(r.8),
            open_lots: r.6,
            open_quantity: r2(r.7),
            completed_deals: r.9,
            members: Some(r.10),
        }
    }));
    out.sort_by(|a, b| {
        b.verified.cmp(&a.verified).then(
            b.open_quantity
                .partial_cmp(&a.open_quantity)
                .unwrap_or(std::cmp::Ordering::Equal),
        )
    });
    Ok(out)
}

/// Case-insensitive filters for the supplier list.
fn filter_suppliers(
    list: Vec<Supplier>,
    crop: Option<&str>,
    location: Option<&str>,
    q: Option<&str>,
) -> Vec<Supplier> {
    let norm = |s: Option<&str>| s.map(|v| v.trim().to_lowercase()).filter(|v| !v.is_empty());
    let (crop, location, q) = (norm(crop), norm(location), norm(q));
    list.into_iter()
        .filter(|s| {
            crop.as_ref()
                .is_none_or(|c| s.crops.iter().any(|x| x.to_lowercase().contains(c)))
                && location.as_ref().is_none_or(|l| {
                    let loc = s.location.to_lowercase();
                    loc.contains(l)
                        || region_of(&s.location).is_some_and(|st| st.to_lowercase().contains(l))
                })
                && q.as_ref().is_none_or(|q| {
                    s.name.to_lowercase().contains(q)
                        || s.location.to_lowercase().contains(q)
                        || s.crops.iter().any(|x| x.to_lowercase().contains(q))
                })
        })
        .collect()
}

#[derive(Deserialize)]
struct SupplierQuery {
    crop: Option<String>,
    location: Option<String>,
    q: Option<String>,
}

/// GET /api/suppliers?crop=&location=&q= — farmers and verified FPOs with produce to sell.
async fn list_suppliers(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Query(q): Query<SupplierQuery>,
) -> ApiResult<Vec<Supplier>> {
    if user.role != "buyer" && user.role != "admin" {
        return Err(forbidden("Suppliers are listed for buyers"));
    }
    Ok(Json(filter_suppliers(
        all_suppliers(&pool).await?,
        q.crop.as_deref(),
        q.location.as_deref(),
        q.q.as_deref(),
    )))
}

/// GET /api/suppliers/:kind/:id — a supplier and their open lots.
async fn supplier_detail(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path((kind, id)): Path<(String, i64)>,
) -> ApiResult<Value> {
    if user.role != "buyer" && user.role != "admin" {
        return Err(forbidden("Suppliers are listed for buyers"));
    }
    let key = format!("{kind}-{id}");
    let supplier = all_suppliers(&pool)
        .await?
        .into_iter()
        .find(|s| s.key == key)
        .ok_or_else(|| not_found("This supplier has no produce listed right now"))?;
    let lots: Vec<Value> = if kind == "farmer" {
        sqlx::query_as::<_, LotView>(&format!(
            "{LOT_SELECT} WHERE l.farmer_id = ? AND l.status = 'open' ORDER BY l.id DESC"
        ))
        .bind(user.user_id)
        .bind(user.user_id)
        .bind(id)
        .fetch_all(&pool)
        .await?
        .into_iter()
        .map(|l| {
            let l = with_display(l);
            json!({
                "kind": "farmer", "id": l.id, "code": format!("LOT-{}", l.id), "crop": l.crop_name,
                "quantity_quintals": l.quantity_quintals, "quality": l.expected_quality,
                "best_offer": l.best_offer, "my_offer_status": l.my_offer_status,
                "listed_at": l.created_at,
            })
        })
        .collect()
    } else {
        type FpoLotRow = (i64, Option<String>, String, f64, Option<String>, String);
        sqlx::query_as::<_, FpoLotRow>(
            "SELECT l.id, l.lot_code, c.name,
                    CAST(l.total_quintals - l.reserved_quintals - l.sold_quintals AS REAL),
                    l.grade, COALESCE(l.created_at, '')
             FROM fpo_lots l JOIN crops c ON c.id = l.crop_id
             WHERE l.fpo_id = ? AND l.total_quintals - l.reserved_quintals - l.sold_quintals > 0.0001
             ORDER BY l.id DESC",
        )
        .bind(id)
        .fetch_all(&pool)
        .await?
        .into_iter()
        .map(|l| {
            json!({
                "kind": "fpo", "id": l.0, "code": l.1, "crop": l.2, "quantity_quintals": r2(l.3),
                "quality": l.4.map(|g| format!("Grade {g}")).unwrap_or_else(|| "Not graded".into()),
                "listed_at": l.5,
            })
        })
        .collect()
    };
    Ok(Json(json!({ "supplier": supplier, "lots": lots })))
}

/* -------------------------------------------------------------------------- */
/*                              buyer requirements                            */
/* -------------------------------------------------------------------------- */

#[derive(Deserialize)]
struct UpdateDemand {
    min_quantity: Option<f64>,
    max_price: Option<f64>,
    required_quality: Option<String>,
    delivery_location: Option<String>,
    required_by: Option<String>,
}

async fn own_demand(pool: &SqlitePool, user: &AuthUser, id: i64) -> Result<String, AppError> {
    if user.role != "buyer" {
        return Err(forbidden("Requirements belong to buyer accounts"));
    }
    let row: Option<(i64, String)> =
        sqlx::query_as("SELECT buyer_id, status FROM buyer_demand WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    match row {
        Some((b, status)) if b == user.user_id => Ok(status),
        Some(_) => Err(forbidden("This requirement belongs to another buyer")),
        None => Err(not_found("Requirement not found")),
    }
}

/// PATCH /api/buyer-demands/:id — edit an open requirement.
async fn update_demand(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<UpdateDemand>,
) -> ApiResult<Value> {
    if own_demand(&pool, &user, id).await? != "open" {
        return Err(bad("Only open requirements can be edited"));
    }
    for (v, name) in [(b.min_quantity, "Quantity"), (b.max_price, "Price")] {
        if let Some(v) = v {
            if !(v.is_finite() && v > 0.0) {
                return Err(bad(format!("{name} must be above 0")));
            }
        }
    }
    let quality = clean(b.required_quality.as_deref(), "Quality", 40)?;
    let place = clean(b.delivery_location.as_deref(), "Delivery location", 100)?;
    let by = clean(b.required_by.as_deref(), "Needed by", 25)?;
    if let Some(d) = &by {
        let ok: i64 = sqlx::query_scalar("SELECT date(?) >= date('now')")
            .bind(d)
            .fetch_one(&pool)
            .await
            .unwrap_or(0);
        if ok != 1 {
            return Err(bad("The needed-by date must be today or later"));
        }
    }
    sqlx::query(
        "UPDATE buyer_demand SET min_quantity = COALESCE(?, min_quantity), max_price = COALESCE(?, max_price),
                required_quality = COALESCE(?, required_quality),
                delivery_location = COALESCE(?, delivery_location), required_by = COALESCE(?, required_by)
         WHERE id = ?",
    )
    .bind(b.min_quantity)
    .bind(b.max_price)
    .bind(quality)
    .bind(place)
    .bind(by)
    .bind(id)
    .execute(&pool)
    .await?;
    Ok(Json(json!({ "ok": true })))
}

/// POST /api/buyer-demands/:id/fulfil — the buyer has what they needed.
async fn fulfil_demand(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Value> {
    if own_demand(&pool, &user, id).await? != "open" {
        return Err(bad("Only open requirements can be marked fulfilled"));
    }
    sqlx::query("UPDATE buyer_demand SET status = 'fulfilled' WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

/// DELETE /api/buyer-demands/:id
async fn delete_demand(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    own_demand(&pool, &user, id).await?;
    sqlx::query("DELETE FROM buyer_demand WHERE id = ? AND buyer_id = ?")
        .bind(id)
        .bind(user.user_id)
        .execute(&pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// GET /api/buyer-demands/:id/matches — open lots that fit this requirement.
async fn demand_matches(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Vec<Value>> {
    own_demand(&pool, &user, id).await?;
    let (crop_id, min_qty, quality, place): (i64, f64, String, String) = sqlx::query_as(
        "SELECT crop_id, CAST(min_quantity AS REAL), required_quality, delivery_location FROM buyer_demand WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&pool)
    .await?;
    let lots = sqlx::query_as::<_, LotView>(&format!(
        "{LOT_SELECT} WHERE l.crop_id = ? AND l.status = 'open' AND u.status = 'active' ORDER BY l.quantity_quintals DESC"
    ))
    .bind(user.user_id)
    .bind(user.user_id)
    .bind(crop_id)
    .fetch_all(&pool)
    .await?;
    let need = crate::services::matcher::grade_rank(&quality);
    let mut out = vec![];
    for l in lots.into_iter().map(with_display) {
        let have = crate::services::matcher::grade_rank(&l.expected_quality);
        let freight = freight_per_quintal(&pool, &l.farmer_location, &place).await?;
        out.push(json!({
            "lot": l,
            "quantity_ok": l.quantity_quintals + 1e-9 >= min_qty,
            "quality_ok": match (have, need) { (Some(h), Some(n)) => h >= n, _ => true },
            "freight_per_quintal": freight,
        }));
    }
    Ok(Json(out))
}

/// Number of open lots per requirement (crop match), for the requirements list.
pub async fn matching_lot_counts(
    pool: &SqlitePool,
    buyer_id: i64,
) -> Result<std::collections::HashMap<i64, i64>, AppError> {
    let rows: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT d.id, (SELECT COUNT(*) FROM lots l JOIN users u ON u.id = l.farmer_id
                       WHERE l.crop_id = d.crop_id AND l.status = 'open' AND u.status = 'active')
         FROM buyer_demand d WHERE d.buyer_id = ?",
    )
    .bind(buyer_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().collect())
}

/* -------------------------------------------------------------------------- */
/*                                  messages                                  */
/* -------------------------------------------------------------------------- */

/// GET /api/conversations — people I have messaged, newest first.
async fn list_conversations(
    State(pool): State<SqlitePool>,
    user: AuthUser,
) -> ApiResult<Vec<Value>> {
    type ConvRow = (i64, String, String, String, String, i64, i64);
    let rows: Vec<ConvRow> = sqlx::query_as(
        "WITH mine AS (
           SELECT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS other, id
           FROM messages WHERE sender_id = ? OR receiver_id = ?
         ), last AS (SELECT other, MAX(id) AS last_id FROM mine GROUP BY other)
         SELECT u.id, u.name, u.role, m.body, COALESCE(m.created_at, ''),
                (m.sender_id = ?) AS from_me,
                (SELECT COUNT(*) FROM messages x WHERE x.sender_id = u.id AND x.receiver_id = ? AND x.read_at IS NULL)
         FROM last JOIN messages m ON m.id = last.last_id JOIN users u ON u.id = last.other
         ORDER BY m.id DESC",
    )
    .bind(user.user_id)
    .bind(user.user_id)
    .bind(user.user_id)
    .bind(user.user_id)
    .bind(user.user_id)
    .fetch_all(&pool)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| {
                json!({
                    "user_id": r.0, "name": r.1, "role": r.2, "last_body": r.3,
                    "last_at": r.4, "last_from_me": r.5 == 1, "unread": r.6,
                })
            })
            .collect(),
    ))
}

async fn can_message(
    pool: &SqlitePool,
    user: &AuthUser,
    other: i64,
) -> Result<(String, String), AppError> {
    if !["farmer", "buyer", "fpo"].contains(&user.role.as_str()) {
        return Err(forbidden("Messages are for farmers, buyers and FPOs"));
    }
    if other == user.user_id {
        return Err(bad("You cannot message yourself"));
    }
    let (name, role) = active_user(pool, other).await?;
    if !["farmer", "buyer", "fpo"].contains(&role.as_str()) {
        return Err(bad("You can message farmers, buyers and FPOs only"));
    }
    Ok((name, role))
}

#[derive(Debug, Serialize, FromRow)]
struct MessageRow {
    id: i64,
    sender_id: i64,
    receiver_id: i64,
    lot_id: Option<i64>,
    transaction_id: Option<i64>,
    body: String,
    created_at: String,
    read_at: Option<String>,
}

/// GET /api/conversations/:user_id/messages — the thread (marks incoming messages read).
async fn conversation_messages(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(other): Path<i64>,
) -> ApiResult<Value> {
    let (name, role) = can_message(&pool, &user, other).await?;
    let messages: Vec<MessageRow> = sqlx::query_as(
        "SELECT * FROM (
           SELECT id, sender_id, receiver_id, lot_id, transaction_id, body,
                  COALESCE(created_at, '') AS created_at, read_at
           FROM messages
           WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
           ORDER BY id DESC LIMIT 200
         ) ORDER BY id",
    )
    .bind(user.user_id)
    .bind(other)
    .bind(other)
    .bind(user.user_id)
    .fetch_all(&pool)
    .await?;
    sqlx::query(
        "UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL",
    )
    .bind(other)
    .bind(user.user_id)
    .execute(&pool)
    .await?;
    // The "new message" alerts for this thread are now seen too.
    sqlx::query(
        "UPDATE user_notifications SET read_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND type = 'message' AND link = ? AND read_at IS NULL",
    )
    .bind(user.user_id)
    .bind(format!("/messages?with={other}"))
    .execute(&pool)
    .await?;
    Ok(Json(json!({
        "partner": { "id": other, "name": name, "role": role },
        "messages": messages,
    })))
}

#[derive(Deserialize)]
struct SendBody {
    body: String,
    lot_id: Option<i64>,
    transaction_id: Option<i64>,
}

/// POST /api/conversations/:user_id/messages
async fn send_message(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(other): Path<i64>,
    Json(b): Json<SendBody>,
) -> ApiResult<MessageRow> {
    can_message(&pool, &user, other).await?;
    let body = b.body.trim();
    if body.is_empty() || body.chars().count() > 2000 {
        return Err(bad("Write a message of up to 2000 characters"));
    }
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO messages (sender_id, receiver_id, lot_id, transaction_id, body) VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(user.user_id)
    .bind(other)
    .bind(b.lot_id)
    .bind(b.transaction_id)
    .bind(body)
    .fetch_all(&pool)
    .await
    .and_then(|mut rows| rows.pop().ok_or(sqlx::Error::RowNotFound))?;
    // One unread alert per conversation is enough.
    let link = format!("/messages?with={}", user.user_id);
    let pending: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_notifications WHERE user_id = ? AND type = 'message' AND link = ? AND read_at IS NULL",
    )
    .bind(other)
    .bind(&link)
    .fetch_one(&pool)
    .await?;
    if pending == 0 {
        let preview: String = body.chars().take(80).collect();
        notify_typed(
            &pool,
            other,
            "message",
            &format!("New message from {}", user.name),
            &preview,
            Some(&link),
        )
        .await?;
    }
    Ok(Json(
        sqlx::query_as::<_, MessageRow>(
            "SELECT id, sender_id, receiver_id, lot_id, transaction_id, body,
                    COALESCE(created_at, '') AS created_at, read_at FROM messages WHERE id = ?",
        )
        .bind(id)
        .fetch_one(&pool)
        .await?,
    ))
}

/* -------------------------------------------------------------------------- */
/*                                   profile                                  */
/* -------------------------------------------------------------------------- */

const LANGUAGES: [&str; 6] = ["en", "hi", "mr", "pa", "gu", "ur"];

/// GET /api/me — profile fields and simple stats.
async fn get_profile(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Value> {
    type ProfileRow = (i64, String, String, String, String, String, Option<String>);
    let u: ProfileRow = sqlx::query_as(
        "SELECT id, name, role, phone_number, status, COALESCE(created_at, ''), preferred_language FROM users WHERE id = ?",
    )
    .bind(user.user_id)
    .fetch_one(&pool)
    .await?;
    let (location, urgency): (Option<String>, Option<String>) = match user.role.as_str() {
        "farmer" => sqlx::query_as("SELECT location, urgency_level FROM farmers WHERE id = ?")
            .bind(user.user_id)
            .fetch_optional(&pool)
            .await?
            .unwrap_or((None, None)),
        "buyer" => (
            sqlx::query_scalar("SELECT location FROM buyers WHERE id = ?")
                .bind(user.user_id)
                .fetch_optional(&pool)
                .await?
                .flatten(),
            None,
        ),
        _ => (None, None),
    };
    let buyer: Option<(i64, f64)> =
        sqlx::query_as("SELECT is_verified, CAST(trust_score AS REAL) FROM buyers WHERE id = ?")
            .bind(user.user_id)
            .fetch_optional(&pool)
            .await?;
    let (lots, open_lots): (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), COALESCE(SUM(status = 'open'), 0) FROM lots WHERE farmer_id = ?",
    )
    .bind(user.user_id)
    .fetch_one(&pool)
    .await?;
    let (deals, value): (i64, f64) = sqlx::query_as(
        "SELECT COUNT(*), CAST(COALESCE(SUM(t.final_price * l.quantity_quintals), 0) AS REAL)
         FROM transactions t JOIN offers o ON o.id = t.offer_id JOIN lots l ON l.id = o.lot_id
         WHERE o.buyer_id = ? OR l.farmer_id = ?",
    )
    .bind(user.user_id)
    .bind(user.user_id)
    .fetch_one(&pool)
    .await?;
    let requirements: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM buyer_demand WHERE buyer_id = ? AND status = 'open'",
    )
    .bind(user.user_id)
    .fetch_one(&pool)
    .await?;
    Ok(Json(json!({
        "id": u.0, "name": u.1, "role": u.2, "phone": u.3, "status": u.4, "member_since": u.5,
        "preferred_language": u.6, "location": location, "state": location.as_deref().and_then(region_of),
        "needs_district": user.role == "farmer" && crate::admin::location_needs_district(location.as_deref()),
        "urgency_level": urgency,
        "verified": buyer.map(|b| b.0 == 1), "trust_score": buyer.map(|b| b.1),
        "stats": {
            "lots": lots, "open_lots": open_lots, "deals": deals, "deal_value": r2(value),
            "open_requirements": requirements,
        },
    })))
}

#[derive(Deserialize)]
struct ProfileBody {
    name: Option<String>,
    location: Option<String>,
    district: Option<String>,
    state: Option<String>,
    urgency_level: Option<String>,
    preferred_language: Option<String>,
}

/// PATCH /api/me — save name, location, urgency and language.
async fn update_profile(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<ProfileBody>,
) -> ApiResult<Value> {
    let name = clean(b.name.as_deref(), "Name", 100)?;
    if name.as_ref().is_some_and(|n| n.chars().count() < 2) {
        return Err(bad("Name must be at least 2 characters"));
    }
    let location = if b.district.is_some() || b.state.is_some() {
        Some(crate::admin::farmer_location(
            b.district.as_deref(),
            b.state.as_deref(),
        )?)
    } else {
        clean(b.location.as_deref(), "Location", 100)?
    };
    let urgency = clean(b.urgency_level.as_deref(), "Urgency", 10)?;
    if urgency
        .as_deref()
        .is_some_and(|u| !["high", "medium", "low"].contains(&u))
    {
        return Err(bad("Urgency must be high, medium or low"));
    }
    let lang = clean(b.preferred_language.as_deref(), "Language", 5)?;
    if lang.as_deref().is_some_and(|l| !LANGUAGES.contains(&l)) {
        return Err(bad("Unsupported language"));
    }
    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE users SET name = COALESCE(?, name), preferred_language = COALESCE(?, preferred_language) WHERE id = ?",
    )
    .bind(&name)
    .bind(&lang)
    .bind(user.user_id)
    .execute(&mut *tx)
    .await?;
    match user.role.as_str() {
        "farmer" => {
            sqlx::query(
                "INSERT INTO farmers (id, location, urgency_level) VALUES (?, COALESCE(?, 'Maharashtra'), COALESCE(?, 'medium'))
                 ON CONFLICT(id) DO UPDATE SET location = COALESCE(?, location), urgency_level = COALESCE(?, urgency_level)",
            )
            .bind(user.user_id)
            .bind(&location)
            .bind(&urgency)
            .bind(&location)
            .bind(&urgency)
            .execute(&mut *tx)
            .await?;
        }
        "buyer" if location.is_some() => {
            sqlx::query("UPDATE buyers SET location = ? WHERE id = ?")
                .bind(&location)
                .bind(user.user_id)
                .execute(&mut *tx)
                .await?;
        }
        _ => {}
    }
    tx.commit().await?;
    get_profile(State(pool), user).await
}

/* -------------------------------------------------------------------------- */
/*                                notifications                               */
/* -------------------------------------------------------------------------- */

/// GET /api/notifications — my latest 100 notifications.
async fn list_notifications(
    State(pool): State<SqlitePool>,
    user: AuthUser,
) -> ApiResult<Vec<Value>> {
    type NoteRow = (
        i64,
        String,
        String,
        String,
        Option<String>,
        String,
        Option<String>,
    );
    let rows: Vec<NoteRow> = sqlx::query_as(
        "SELECT id, type, title, body, link, COALESCE(created_at, ''), read_at
         FROM user_notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100",
    )
    .bind(user.user_id)
    .fetch_all(&pool)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| {
                json!({
                    "id": r.0, "type": r.1, "title": r.2, "body": r.3, "link": r.4,
                    "created_at": r.5, "read": r.6.is_some(),
                })
            })
            .collect(),
    ))
}

/// POST /api/notifications/:id/read
async fn read_notification(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Value> {
    let done = sqlx::query(
        "UPDATE user_notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = ? AND user_id = ?",
    )
    .bind(id)
    .bind(user.user_id)
    .execute(&pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(not_found("Notification not found"));
    }
    Ok(Json(json!({ "ok": true })))
}

/// POST /api/notifications/read-all
async fn read_all_notifications(
    State(pool): State<SqlitePool>,
    user: AuthUser,
) -> ApiResult<Value> {
    let done = sqlx::query(
        "UPDATE user_notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL",
    )
    .bind(user.user_id)
    .execute(&pool)
    .await?;
    Ok(Json(json!({ "ok": true, "marked": done.rows_affected() })))
}

/* -------------------------------------------------------------------------- */
/*                                    tests                                   */
/* -------------------------------------------------------------------------- */

#[cfg(test)]
// Handler results are checked where it matters; the rest just need to succeed.
#[allow(unused_must_use)]
mod tests {
    use super::*;

    #[test]
    fn rupee_grouping() {
        assert_eq!(rupees(0.0), "₹0");
        assert_eq!(rupees(999.0), "₹999");
        assert_eq!(rupees(48_300.0), "₹48,300");
        assert_eq!(rupees(1_234_567.0), "₹12,34,567");
    }

    fn sup(name: &str, location: &str, crops: &[&str]) -> Supplier {
        Supplier {
            key: format!("farmer-{name}"),
            kind: "farmer",
            id: 1,
            user_id: 1,
            name: name.into(),
            location: location.into(),
            verified: false,
            fpo_name: None,
            crops: crops.iter().map(|c| c.to_string()).collect(),
            open_lots: 1,
            open_quantity: 10.0,
            completed_deals: 0,
            members: None,
        }
    }

    #[test]
    fn supplier_filters() {
        let list = vec![
            sup("Ramesh", "Ludhiana", &["Wheat", "Paddy"]),
            sup("Sita", "Nashik", &["Onion"]),
        ];
        let by_crop = filter_suppliers(list.clone(), Some("onion"), None, None);
        assert_eq!(by_crop.len(), 1);
        assert_eq!(by_crop[0].name, "Sita");
        // A city matches its state.
        let by_state = filter_suppliers(list.clone(), None, Some("Punjab"), None);
        assert_eq!(by_state.len(), 1);
        assert_eq!(by_state[0].name, "Ramesh");
        let by_text = filter_suppliers(list.clone(), None, None, Some("pad"));
        assert_eq!(by_text.len(), 1);
        assert_eq!(filter_suppliers(list, Some(""), Some(" "), None).len(), 2);
    }

    /* ----------------------- database-backed flows ----------------------- */

    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;

    /// Fresh in-memory database with every migration applied, one farmer
    /// (Punjab), two buyers and a Wheat lot of 20 q.
    async fn setup() -> (SqlitePool, AuthUser, AuthUser, AuthUser, i64) {
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
        for (name, role, phone) in [
            ("Test Farmer", "farmer", "9000000101"),
            ("Test Buyer", "buyer", "9000000102"),
            ("Other Buyer", "buyer", "9000000103"),
        ] {
            let id: i64 = sqlx::query_scalar(
                "INSERT INTO users (name, role, phone_number, status) VALUES (?, ?, ?, 'active') RETURNING id",
            )
            .bind(name)
            .bind(role)
            .bind(phone)
            .fetch_one(&pool)
            .await
            .unwrap();
            if role == "farmer" {
                sqlx::query("INSERT INTO farmers (id, location, urgency_level) VALUES (?, 'Ludhiana', 'medium')")
                    .bind(id)
                    .execute(&pool)
                    .await
                    .unwrap();
            } else {
                sqlx::query("INSERT INTO buyers (id, trust_score, is_verified, location) VALUES (?, 4.5, 1, 'Delhi')")
                    .bind(id)
                    .execute(&pool)
                    .await
                    .unwrap();
            }
            ids.push(AuthUser {
                user_id: id,
                role: role.into(),
                status: "active".into(),
                name: name.into(),
            });
        }
        let lot: i64 = sqlx::query_scalar(
            "INSERT INTO lots (farmer_id, crop_id, quantity_quintals, expected_quality, status)
             VALUES (?, 2, 20, 'Grade A', 'open') RETURNING id",
        )
        .bind(ids[0].user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let other = ids.pop().unwrap();
        let buyer = ids.pop().unwrap();
        let farmer = ids.pop().unwrap();
        (pool, farmer, buyer, other, lot)
    }

    fn me(u: &AuthUser) -> AuthUser {
        AuthUser {
            user_id: u.user_id,
            role: u.role.clone(),
            status: u.status.clone(),
            name: u.name.clone(),
        }
    }

    async fn offer(
        pool: &SqlitePool,
        by: &AuthUser,
        lot: i64,
        price: f64,
        buyer: Option<i64>,
    ) -> OfferView {
        create_offer(
            State(pool.clone()),
            me(by),
            Json(CreateOffer {
                lot_id: lot,
                price_offered: price,
                buyer_id: buyer,
            }),
        )
        .await
        .map(|j| j.0)
        .unwrap_or_else(|e| panic!("offer failed: {:?}", e.into_response().status()))
    }

    async fn notes(pool: &SqlitePool, user: &AuthUser, kind: &str) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM user_notifications WHERE user_id = ? AND type = ?")
            .bind(user.user_id)
            .bind(kind)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    use axum::response::IntoResponse;

    fn status_of<T>(r: Result<T, AppError>) -> u16 {
        match r {
            Ok(_) => 200,
            Err(e) => e.into_response().status().as_u16(),
        }
    }

    #[tokio::test]
    async fn unverified_buyer_cannot_offer_or_accept() {
        let (pool, farmer, _buyer, other, lot) = setup().await;
        sqlx::query("UPDATE buyers SET is_verified = 0 WHERE id = ?")
            .bind(other.user_id)
            .execute(&pool)
            .await
            .unwrap();
        // Bidding is refused with 403.
        let bid = create_offer(
            State(pool.clone()),
            me(&other),
            Json(CreateOffer {
                lot_id: lot,
                price_offered: 2100.0,
                buyer_id: None,
            }),
        )
        .await;
        assert_eq!(status_of(bid), 403);
        // A farmer may still offer the lot, but the buyer cannot accept it.
        let o = offer(&pool, &farmer, lot, 2200.0, Some(other.user_id)).await;
        assert_eq!(
            status_of(accept_offer(State(pool.clone()), me(&other), Path(o.id)).await),
            403
        );
        // Once an admin verifies the buyer, accepting works.
        sqlx::query("UPDATE buyers SET is_verified = 1 WHERE id = ?")
            .bind(other.user_id)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            status_of(accept_offer(State(pool.clone()), me(&other), Path(o.id)).await),
            200
        );
    }

    #[tokio::test]
    async fn farmer_registration_stores_district_and_state() {
        let (pool, ..) = setup().await;
        let place = |d: &'static str, s: &'static str| crate::db::FpoSignup {
            district: Some(d),
            state: Some(s),
            ..Default::default()
        };
        let u = crate::db::register_farmer(
            &pool,
            "Gurpreet Singh",
            "9000000199",
            "1234",
            "farmer",
            place("Ludhiana", "punjab"),
        )
        .await
        .unwrap();
        let loc: String = sqlx::query_scalar("SELECT location FROM farmers WHERE id = ?")
            .bind(u.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(loc, "Ludhiana, Punjab");
        assert_eq!(region_of(&loc), Some("Punjab"));
        assert!(!crate::admin::location_needs_district(Some(&loc)));
        assert!(crate::admin::location_needs_district(Some("Maharashtra")));
        // District and state are required for farmers.
        let missing = crate::db::register_farmer(
            &pool,
            "No Place",
            "9000000198",
            "1234",
            "farmer",
            crate::db::FpoSignup::default(),
        )
        .await;
        assert_eq!(status_of(missing), 400);
        let bad_state = crate::db::register_farmer(
            &pool,
            "Bad State",
            "9000000197",
            "1234",
            "farmer",
            place("Ludhiana", "Atlantis"),
        )
        .await;
        assert_eq!(status_of(bad_state), 400);
    }

    #[tokio::test]
    async fn counter_offer_negotiation_ends_in_an_order() {
        let (pool, farmer, buyer, other, lot) = setup().await;
        let first = offer(&pool, &buyer, lot, 2000.0, None).await;
        assert_eq!(notes(&pool, &farmer, "offer").await, 1);
        // The lot now shows "offer received".
        assert_eq!(
            load_lot(&pool, farmer.user_id, lot)
                .await
                .unwrap()
                .display_status,
            "offer_received"
        );
        // A second open offer from the same buyer is refused.
        assert_eq!(
            status_of(
                create_offer(
                    State(pool.clone()),
                    me(&buyer),
                    Json(CreateOffer {
                        lot_id: lot,
                        price_offered: 2100.0,
                        buyer_id: None
                    })
                )
                .await
            ),
            400
        );
        // The buyer cannot answer their own offer; another buyer cannot either.
        assert_eq!(
            status_of(
                counter_offer(
                    State(pool.clone()),
                    me(&buyer),
                    Path(first.id),
                    Json(CounterBody { price: 2100.0 })
                )
                .await
            ),
            400
        );
        assert_eq!(
            status_of(reject_offer(State(pool.clone()), me(&other), Path(first.id), None).await),
            403
        );

        // Farmer counters at 2300.
        let counter = counter_offer(
            State(pool.clone()),
            me(&farmer),
            Path(first.id),
            Json(CounterBody { price: 2300.0 }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(counter.parent_offer_id, Some(first.id));
        assert_eq!(counter.created_by_role, "farmer");
        assert_eq!(
            load_offer(&pool, first.id).await.unwrap().status,
            "countered"
        );
        assert_eq!(notes(&pool, &buyer, "counter").await, 1);
        // Same price as before is not a counter; the farmer cannot accept their own counter.
        assert_eq!(
            status_of(
                counter_offer(
                    State(pool.clone()),
                    me(&buyer),
                    Path(counter.id),
                    Json(CounterBody { price: 2300.0 })
                )
                .await
            ),
            400
        );
        assert_eq!(
            status_of(accept_offer(State(pool.clone()), me(&farmer), Path(counter.id)).await),
            400
        );

        // A rival bid is closed automatically when the buyer accepts the counter.
        let rival = offer(&pool, &other, lot, 2250.0, None).await;
        let order = accept_offer(State(pool.clone()), me(&buyer), Path(counter.id))
            .await
            .unwrap()
            .0;
        assert_eq!(order.final_price, 2300.0);
        assert_eq!(order.total_amount, 46_000.0);
        assert_eq!(order.order_status.as_deref(), Some("accepted"));
        assert_eq!(order.payment_status, "pending");
        assert_eq!(order.pickup_location.as_deref(), Some("Ludhiana"));
        assert_eq!(order.delivery_location.as_deref(), Some("Delhi"));
        assert_eq!(
            load_lot(&pool, farmer.user_id, lot).await.unwrap().status,
            "sold"
        );
        assert_eq!(
            load_offer(&pool, rival.id).await.unwrap().status,
            "rejected"
        );
        assert_eq!(notes(&pool, &farmer, "accepted").await, 1);
        assert_eq!(notes(&pool, &other, "rejected").await, 1);

        // History on the lot shows both steps, linked.
        let detail = lot_detail(State(pool.clone()), me(&farmer), Path(lot))
            .await
            .unwrap()
            .0;
        let offers = detail["offers"].as_array().unwrap();
        assert_eq!(offers.len(), 3);
        assert_eq!(offers[1]["parent_offer_id"], first.id);
        // The rival buyer sees only their own negotiation.
        let seen = lot_detail(State(pool.clone()), me(&other), Path(lot))
            .await
            .unwrap()
            .0;
        assert_eq!(seen["offers"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn new_lot_alerts_buyers_with_a_matching_requirement() {
        let (pool, farmer, buyer, other, _lot) = setup().await;
        sqlx::query(
            "INSERT INTO buyer_demand (buyer_id, crop_id, min_quantity, max_price, required_quality, delivery_location, required_by)
             VALUES (?, 2, 10, 2600, 'Grade A', 'Delhi', date('now', '+30 days'))",
        )
        .bind(buyer.user_id)
        .execute(&pool)
        .await
        .unwrap();
        let lot: i64 = sqlx::query_scalar(
            "INSERT INTO lots (farmer_id, crop_id, quantity_quintals, expected_quality, status)
             VALUES (?, 2, 12, 'Grade A', 'open') RETURNING id",
        )
        .bind(farmer.user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        notify_matching_buyers(&pool, lot).await.unwrap();
        assert_eq!(notes(&pool, &buyer, "matching_lot").await, 1);
        assert_eq!(notes(&pool, &other, "matching_lot").await, 0);
    }

    #[tokio::test]
    async fn rejecting_and_withdrawing() {
        let (pool, farmer, buyer, _other, lot) = setup().await;
        let o = offer(&pool, &buyer, lot, 1800.0, None).await;
        let r = reject_offer(
            State(pool.clone()),
            me(&farmer),
            Path(o.id),
            Some(Json(ReasonBody {
                reason: Some("Too low".into()),
            })),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(r.status, "rejected");
        assert_eq!(r.cancel_reason.as_deref(), Some("Too low"));
        assert_eq!(notes(&pool, &buyer, "rejected").await, 1);
        // Farmer offers the lot to the buyer, then withdraws the lot: the offer is cancelled.
        let f = offer(&pool, &farmer, lot, 2400.0, Some(buyer.user_id)).await;
        assert_eq!(f.created_by_role, "farmer");
        let lot_after = withdraw_lot(State(pool.clone()), me(&farmer), Path(lot), None)
            .await
            .unwrap()
            .0;
        assert_eq!(lot_after.status, "withdrawn");
        assert_eq!(load_offer(&pool, f.id).await.unwrap().status, "cancelled");
        // A withdrawn lot cannot be edited or bid on.
        assert_eq!(
            status_of(
                update_lot(
                    State(pool.clone()),
                    me(&farmer),
                    Path(lot),
                    Json(UpdateLot {
                        quantity_quintals: Some(5.0),
                        expected_quality: None
                    })
                )
                .await
            ),
            400
        );
        assert_eq!(
            status_of(
                create_offer(
                    State(pool.clone()),
                    me(&buyer),
                    Json(CreateOffer {
                        lot_id: lot,
                        price_offered: 2000.0,
                        buyer_id: None
                    })
                )
                .await
            ),
            400
        );
    }

    #[tokio::test]
    async fn payment_status_moves_from_pending_to_paid() {
        let (pool, farmer, buyer, other, lot) = setup().await;
        let o = offer(&pool, &buyer, lot, 2500.0, None).await;
        let order = accept_offer(State(pool.clone()), me(&farmer), Path(o.id))
            .await
            .unwrap()
            .0;
        let id = order.id;
        assert_eq!(order.total_amount, 50_000.0);
        let pay = |amount: f64| PaymentBody {
            amount,
            method: Some("upi".into()),
            reference: Some("UTR1".into()),
            paid_at: None,
        };

        // Only the buyer records payments; no overpaying.
        assert_eq!(
            status_of(
                record_payment(State(pool.clone()), me(&farmer), Path(id), Json(pay(100.0))).await
            ),
            403
        );
        assert_eq!(
            status_of(
                record_payment(State(pool.clone()), me(&other), Path(id), Json(pay(100.0))).await
            ),
            403
        );
        assert_eq!(
            status_of(
                record_payment(
                    State(pool.clone()),
                    me(&buyer),
                    Path(id),
                    Json(pay(60_000.0))
                )
                .await
            ),
            400
        );

        let o1 = record_payment(
            State(pool.clone()),
            me(&buyer),
            Path(id),
            Json(pay(20_000.0)),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(o1.payment_status, "awaiting_confirmation");
        assert_eq!(notes(&pool, &farmer, "payment").await, 1);
        let p1: i64 = sqlx::query_scalar("SELECT MAX(id) FROM transaction_payments")
            .fetch_one(&pool)
            .await
            .unwrap();
        // The buyer cannot confirm their own payment.
        assert_eq!(
            status_of(confirm_payment(State(pool.clone()), me(&buyer), Path(p1)).await),
            403
        );
        let o2 = confirm_payment(State(pool.clone()), me(&farmer), Path(p1))
            .await
            .unwrap()
            .0;
        assert_eq!(o2.payment_status, "partially_paid");
        assert_eq!(o2.balance_due, 30_000.0);
        assert_eq!(
            status_of(confirm_payment(State(pool.clone()), me(&farmer), Path(p1)).await),
            400
        );

        // Remaining 30,000 marked paid, farmer says it did not arrive, buyer pays again.
        record_payment(
            State(pool.clone()),
            me(&buyer),
            Path(id),
            Json(pay(30_000.0)),
        )
        .await
        .unwrap();
        let p2: i64 = sqlx::query_scalar("SELECT MAX(id) FROM transaction_payments")
            .fetch_one(&pool)
            .await
            .unwrap();
        let o3 = payment_not_received(State(pool.clone()), me(&farmer), Path(p2), None)
            .await
            .unwrap()
            .0;
        assert_eq!(o3.payment_status, "partially_paid");
        record_payment(
            State(pool.clone()),
            me(&buyer),
            Path(id),
            Json(pay(30_000.0)),
        )
        .await
        .unwrap();
        let p3: i64 = sqlx::query_scalar("SELECT MAX(id) FROM transaction_payments")
            .fetch_one(&pool)
            .await
            .unwrap();

        // Delivery: buyer cannot mark pickup; farmer moves it forward; no going back.
        let ev = |s: &str| EventBody {
            status: s.into(),
            note: None,
        };
        assert_eq!(
            status_of(
                add_order_event(
                    State(pool.clone()),
                    me(&buyer),
                    Path(id),
                    Json(ev("picked_up"))
                )
                .await
            ),
            400
        );
        add_order_event(
            State(pool.clone()),
            me(&farmer),
            Path(id),
            Json(ev("in_transit")),
        )
        .await
        .unwrap();
        assert_eq!(
            status_of(
                add_order_event(
                    State(pool.clone()),
                    me(&farmer),
                    Path(id),
                    Json(ev("picked_up"))
                )
                .await
            ),
            400
        );
        let delivered = add_order_event(
            State(pool.clone()),
            me(&buyer),
            Path(id),
            Json(ev("delivered")),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(delivered.order_status.as_deref(), Some("delivered"));
        assert_eq!(delivered.status, "delivered");
        assert_eq!(notes(&pool, &farmer, "order").await, 1);

        // Last confirmation makes it paid, and a delivered + paid order is completed.
        let done = confirm_payment(State(pool.clone()), me(&farmer), Path(p3))
            .await
            .unwrap()
            .0;
        assert_eq!(done.payment_status, "paid");
        assert_eq!(done.balance_due, 0.0);
        assert_eq!(done.status, "completed");

        // Net realisation and access to the order detail.
        let detail = order_detail(State(pool.clone()), me(&farmer), Path(id))
            .await
            .unwrap()
            .0;
        assert_eq!(detail["net_realisation"]["gross"], 50_000.0);
        assert_eq!(detail["payments"].as_array().unwrap().len(), 3);
        assert_eq!(
            status_of(order_detail(State(pool.clone()), me(&other), Path(id)).await),
            403
        );
    }

    #[tokio::test]
    async fn suppliers_list_open_produce_for_buyers_only() {
        let (pool, farmer, buyer, _other, _lot) = setup().await;
        let all = list_suppliers(
            State(pool.clone()),
            me(&buyer),
            Query(SupplierQuery {
                crop: None,
                location: None,
                q: None,
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "Test Farmer");
        assert_eq!(all[0].crops, vec!["Wheat".to_string()]);
        assert_eq!(all[0].open_quantity, 20.0);
        let none = list_suppliers(
            State(pool.clone()),
            me(&buyer),
            Query(SupplierQuery {
                crop: Some("Onion".into()),
                location: None,
                q: None,
            }),
        )
        .await
        .unwrap()
        .0;
        assert!(none.is_empty());
        let punjab = list_suppliers(
            State(pool.clone()),
            me(&buyer),
            Query(SupplierQuery {
                crop: None,
                location: Some("punjab".into()),
                q: None,
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(punjab.len(), 1);
        let detail = supplier_detail(
            State(pool.clone()),
            me(&buyer),
            Path(("farmer".into(), farmer.user_id)),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(detail["lots"].as_array().unwrap().len(), 1);
        assert_eq!(
            status_of(
                list_suppliers(
                    State(pool.clone()),
                    me(&farmer),
                    Query(SupplierQuery {
                        crop: None,
                        location: None,
                        q: None
                    })
                )
                .await
            ),
            403
        );
    }

    #[tokio::test]
    async fn messages_and_notifications() {
        let (pool, farmer, buyer, _other, _lot) = setup().await;
        let body = |t: &str| SendBody {
            body: t.into(),
            lot_id: None,
            transaction_id: None,
        };
        send_message(
            State(pool.clone()),
            me(&buyer),
            Path(farmer.user_id),
            Json(body("Is the wheat dry?")),
        )
        .await
        .unwrap();
        send_message(
            State(pool.clone()),
            me(&buyer),
            Path(farmer.user_id),
            Json(body("Can you deliver?")),
        )
        .await
        .unwrap();
        // One unread alert per conversation.
        assert_eq!(notes(&pool, &farmer, "message").await, 1);
        let convs = list_conversations(State(pool.clone()), me(&farmer))
            .await
            .unwrap()
            .0;
        assert_eq!(convs[0]["unread"], 2);
        let thread = conversation_messages(State(pool.clone()), me(&farmer), Path(buyer.user_id))
            .await
            .unwrap()
            .0;
        assert_eq!(thread["messages"].as_array().unwrap().len(), 2);
        let convs = list_conversations(State(pool.clone()), me(&farmer))
            .await
            .unwrap()
            .0;
        assert_eq!(convs[0]["unread"], 0);
        assert_eq!(
            status_of(
                send_message(
                    State(pool.clone()),
                    me(&buyer),
                    Path(buyer.user_id),
                    Json(body("me"))
                )
                .await
            ),
            400
        );
        assert_eq!(
            status_of(
                send_message(
                    State(pool.clone()),
                    me(&buyer),
                    Path(farmer.user_id),
                    Json(body("   "))
                )
                .await
            ),
            400
        );

        let list = list_notifications(State(pool.clone()), me(&farmer))
            .await
            .unwrap()
            .0;
        assert!(
            list.iter().all(|n| n["read"] == true),
            "opening the thread marks its alert read"
        );
        offer(&pool, &buyer, _lot, 2000.0, None).await;
        let list = list_notifications(State(pool.clone()), me(&farmer))
            .await
            .unwrap()
            .0;
        let id = list[0]["id"].as_i64().unwrap();
        assert_eq!(list[0]["type"], "offer");
        assert_eq!(
            status_of(read_notification(State(pool.clone()), me(&buyer), Path(id)).await),
            404
        );
        read_notification(State(pool.clone()), me(&farmer), Path(id))
            .await
            .unwrap();
        read_all_notifications(State(pool.clone()), me(&farmer))
            .await
            .unwrap();
        let unread: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM user_notifications WHERE user_id = ? AND read_at IS NULL",
        )
        .bind(farmer.user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(unread, 0);
    }
}
