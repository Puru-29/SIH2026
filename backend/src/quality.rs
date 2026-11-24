//! Crop quality trust: live camera photos on lots, the buyer's grade check on
//! arrival, and buyer reviews of farmers after delivery.
//!
//! * Lot photos are taken with the in-app camera (the frontend never offers a
//!   file picker). The server accepts only JPEG/WebP images of a sensible size
//!   and refuses an image that was already attached anywhere (same sha256), so
//!   one good photo cannot be reused for every lot.
//! * A grade check records the grade the buyer actually received. A lower grade
//!   than listed opens a dispute for the admin automatically.
//! * A review (1–5 stars) can be left once per delivered order by its buyer.

use axum::{
    extract::{Path, State},
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Sqlite, SqlitePool};

use crate::{admin::notify_typed, auth::AuthUser, errors::AppError};

type ApiResult<T> = Result<Json<T>, AppError>;

pub const MAX_PHOTOS_PER_LOT: usize = 3;
const MAX_PHOTO_BYTES: usize = 1_500_000;
const MIN_PHOTO_BYTES: usize = 5_000;

pub fn routes() -> Router<SqlitePool> {
    Router::new()
        .route("/api/lots/:id/photos", get(lot_photos).post(add_lot_photo))
        .route("/api/lot-photos/:id", delete(delete_lot_photo))
        .route("/api/transactions/:id/grade-check", post(grade_check))
        .route("/api/transactions/:id/review", post(review))
        .route("/api/transactions/:id/quality", get(order_quality))
        .route("/api/farmers/:id/reviews", get(farmer_reviews))
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

/* -------------------------------------------------------------------------- */
/*                                   photos                                   */
/* -------------------------------------------------------------------------- */

/// A photo from the in-app camera, as a data URL or plain base64.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PhotoIn {
    #[serde(skip_serializing)]
    pub data_base64: String,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

pub struct CheckedPhoto {
    mime: &'static str,
    bytes: Vec<u8>,
    sha256: String,
    latitude: Option<f64>,
    longitude: Option<f64>,
}

/// Checks a camera photo: JPEG or WebP, 5 KB – 1.5 MB.
pub fn check_photo(p: &PhotoIn) -> Result<CheckedPhoto, AppError> {
    let bytes = crate::fpo::decode_base64(&p.data_base64)
        .ok_or_else(|| bad("The photo could not be read. Please take it again."))?;
    let mime = if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        return Err(bad("Photos must be taken with the in-app camera (JPEG)."));
    };
    if bytes.len() < MIN_PHOTO_BYTES {
        return Err(bad(
            "This photo is too small or blank. Please take it again.",
        ));
    }
    if bytes.len() > MAX_PHOTO_BYTES {
        return Err(bad("This photo is too large. Please take it again."));
    }
    let coord = |v: Option<f64>, max: f64| v.filter(|x| x.is_finite() && x.abs() <= max);
    Ok(CheckedPhoto {
        mime,
        sha256: format!("{:x}", Sha256::digest(&bytes)),
        bytes,
        latitude: coord(p.latitude, 90.0),
        longitude: coord(p.longitude, 180.0),
    })
}

/// Saves a checked photo on a lot. Refuses an image already used anywhere.
pub async fn insert_photo<'c, E>(
    ex: E,
    lot_id: i64,
    user_id: i64,
    p: &CheckedPhoto,
) -> Result<i64, AppError>
where
    E: sqlx::Executor<'c, Database = Sqlite>,
{
    sqlx::query_scalar::<_, i64>(
        "INSERT INTO lot_photos (lot_id, uploaded_by, mime_type, data, sha256, latitude, longitude)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(lot_id)
    .bind(user_id)
    .bind(p.mime)
    .bind(&p.bytes)
    .bind(&p.sha256)
    .bind(p.latitude)
    .bind(p.longitude)
    .fetch_one(ex)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(d) if d.message().contains("UNIQUE") => {
            bad("This exact photo was already used. Take a fresh photo of this lot's crop.")
        }
        other => AppError::from(other),
    })
}

/// Test helper shared with other modules.
#[cfg(test)]
pub fn tests_b64(bytes: &[u8]) -> String {
    base64_encode(bytes)
}

fn base64_encode(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", base64_encode(bytes))
}

/// GET /api/lots/:id/photos — the lot's camera photos (any signed-in user).
async fn lot_photos(
    State(pool): State<SqlitePool>,
    _user: AuthUser,
    Path(lot_id): Path<i64>,
) -> ApiResult<Vec<Value>> {
    type Row = (i64, String, Vec<u8>, String, Option<f64>);
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT id, mime_type, data, COALESCE(captured_at, ''), latitude FROM lot_photos
         WHERE lot_id = ? ORDER BY id",
    )
    .bind(lot_id)
    .fetch_all(&pool)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| {
                json!({
                    "id": r.0, "data_url": data_url(&r.1, &r.2), "captured_at": r.3,
                    "has_location": r.4.is_some(), "source": "camera",
                })
            })
            .collect(),
    ))
}

async fn own_open_lot(pool: &SqlitePool, user: &AuthUser, lot_id: i64) -> Result<(), AppError> {
    let (owner, status): (i64, String) =
        sqlx::query_as("SELECT farmer_id, status FROM lots WHERE id = ?")
            .bind(lot_id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| not_found("Lot not found"))?;
    if owner != user.user_id {
        return Err(forbidden(
            "Only the farmer who listed this lot can change its photos",
        ));
    }
    if status != "open" {
        return Err(bad(format!(
            "This lot is {status}; its photos can no longer change"
        )));
    }
    Ok(())
}

/// POST /api/lots/:id/photos — add one more camera photo (max 3).
async fn add_lot_photo(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(lot_id): Path<i64>,
    Json(b): Json<PhotoIn>,
) -> ApiResult<Value> {
    own_open_lot(&pool, &user, lot_id).await?;
    let photo = check_photo(&b)?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM lot_photos WHERE lot_id = ?")
        .bind(lot_id)
        .fetch_one(&pool)
        .await?;
    if count as usize >= MAX_PHOTOS_PER_LOT {
        return Err(bad(format!(
            "A lot can have at most {MAX_PHOTOS_PER_LOT} photos"
        )));
    }
    let id = insert_photo(&pool, lot_id, user.user_id, &photo).await?;
    Ok(Json(json!({ "id": id })))
}

/// DELETE /api/lot-photos/:id — remove a photo; an open lot keeps at least one.
async fn delete_lot_photo(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Value> {
    let lot_id: i64 = sqlx::query_scalar("SELECT lot_id FROM lot_photos WHERE id = ?")
        .bind(id)
        .fetch_optional(&pool)
        .await?
        .ok_or_else(|| not_found("Photo not found"))?;
    own_open_lot(&pool, &user, lot_id).await?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM lot_photos WHERE lot_id = ?")
        .bind(lot_id)
        .fetch_one(&pool)
        .await?;
    if count <= 1 {
        return Err(bad(
            "A lot needs at least one photo. Add a new one before removing this.",
        ));
    }
    sqlx::query("DELETE FROM lot_photos WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

/* -------------------------------------------------------------------------- */
/*                          grade checks and reviews                          */
/* -------------------------------------------------------------------------- */

struct OrderFacts {
    buyer_id: i64,
    farmer_id: i64,
    claimed: String,
    crop: String,
    /// Latest tracking step: picked_up, in_transit, delivered (None = not moved yet).
    stage: Option<String>,
    legacy_completed: bool,
}

impl OrderFacts {
    fn delivered(&self) -> bool {
        self.legacy_completed || self.stage.as_deref() == Some("delivered")
    }
    fn arrived(&self) -> bool {
        self.delivered() || self.stage.as_deref() == Some("in_transit")
    }
}

async fn order_facts(pool: &SqlitePool, tx_id: i64) -> Result<OrderFacts, AppError> {
    type Row = (i64, i64, String, String, String, Option<String>);
    let r: Row = sqlx::query_as(
        "SELECT o.buyer_id, l.farmer_id, l.expected_quality, c.name, t.status,
            (SELECT e.status FROM order_events e WHERE e.transaction_id = t.id
              ORDER BY CASE e.status WHEN 'delivered' THEN 3 WHEN 'in_transit' THEN 2
                                     WHEN 'picked_up' THEN 1 ELSE 0 END DESC LIMIT 1)
         FROM transactions t JOIN offers o ON o.id = t.offer_id JOIN lots l ON l.id = o.lot_id
         JOIN crops c ON c.id = l.crop_id WHERE t.id = ?",
    )
    .bind(tx_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| not_found("Order not found"))?;
    Ok(OrderFacts {
        buyer_id: r.0,
        farmer_id: r.1,
        claimed: r.2,
        crop: r.3,
        legacy_completed: r.4 == "completed" && r.5.is_none(),
        stage: r.5,
    })
}

/// Normalises "A" / "grade b" / "Grade C" to "Grade A/B/C".
fn normal_grade(s: &str) -> Option<&'static str> {
    match crate::fpo::grade_rank(s)? {
        3 => Some("Grade A"),
        2 => Some("Grade B"),
        _ => Some("Grade C"),
    }
}

/// True when the received grade is at least the listed one.
pub fn grade_matches(claimed: &str, received: &str) -> bool {
    match (
        crate::fpo::grade_rank(claimed),
        crate::fpo::grade_rank(received),
    ) {
        (Some(c), Some(r)) => r >= c,
        // A listing without a known grade can't be "missed".
        (None, _) => true,
        (_, None) => false,
    }
}

#[derive(Deserialize)]
struct GradeCheckBody {
    received_grade: String,
    note: Option<String>,
    /// Optional camera photo of what arrived.
    photo: Option<PhotoIn>,
}

/// Saves the grade check and, on a mismatch, opens a dispute. Returns (check id, dispute id).
async fn record_grade_check(
    pool: &SqlitePool,
    tx_id: i64,
    o: &OrderFacts,
    received: &'static str,
    note: &str,
    photo: Option<CheckedPhoto>,
) -> Result<(i64, Option<i64>, bool), AppError> {
    let matched = grade_matches(&o.claimed, received);
    let mut tx = pool.begin().await?;
    let dispute_id = if matched {
        None
    } else {
        let reason = format!(
            "Grade mismatch reported on arrival: listed as {}, received {received}.{}",
            o.claimed,
            if note.is_empty() {
                String::new()
            } else {
                format!(" Buyer's note: {note}")
            }
        );
        // An open dispute by this buyer already covers it.
        let existing: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM disputes WHERE transaction_id = ? AND raised_by = ? AND status IN ('open', 'investigating')",
        )
        .bind(tx_id)
        .bind(o.buyer_id)
        .fetch_optional(&mut *tx)
        .await?;
        match existing {
            Some(id) => Some(id),
            None => Some(
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO disputes (transaction_id, raised_by, reason) VALUES (?, ?, ?) RETURNING id",
                )
                .bind(tx_id)
                .bind(o.buyer_id)
                .bind(&reason)
                .fetch_one(&mut *tx)
                .await?,
            ),
        }
    };
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO grade_checks (transaction_id, buyer_id, farmer_id, claimed_grade, received_grade,
            matched, note, photo_mime, photo, dispute_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(tx_id)
    .bind(o.buyer_id)
    .bind(o.farmer_id)
    .bind(&o.claimed)
    .bind(received)
    .bind(matched as i64)
    .bind(note)
    .bind(photo.as_ref().map(|p| p.mime))
    .bind(photo.as_ref().map(|p| p.bytes.clone()))
    .bind(dispute_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(d) if d.message().contains("UNIQUE") => {
            bad("The grade for this order was already checked")
        }
        other => AppError::from(other),
    })?;
    if matched {
        notify_typed(
            &mut *tx,
            o.farmer_id,
            "order",
            &format!("{} arrived as listed", o.crop),
            &format!("The buyer confirmed {received}. This counts towards your grade record."),
            Some("/orders"),
        )
        .await?;
    } else {
        notify_typed(
            &mut *tx,
            o.farmer_id,
            "dispute",
            &format!("Grade mismatch on your {} order", o.crop),
            &format!(
                "Listed as {}, the buyer received {received}. An admin will review the dispute.",
                o.claimed
            ),
            Some("/orders"),
        )
        .await?;
    }
    tx.commit().await?;
    Ok((id, dispute_id, matched))
}

/// POST /api/transactions/:id/grade-check — buyer: the grade that actually arrived.
async fn grade_check(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(tx_id): Path<i64>,
    Json(b): Json<GradeCheckBody>,
) -> ApiResult<Value> {
    let o = order_facts(&pool, tx_id).await?;
    if user.role != "buyer" || o.buyer_id != user.user_id {
        return Err(forbidden(
            "Only the buyer of this order can check its grade",
        ));
    }
    if !o.arrived() {
        return Err(bad(
            "Check the grade when the crop arrives (once the order is in transit or delivered)",
        ));
    }
    let received = normal_grade(&b.received_grade).ok_or_else(|| bad("Choose Grade A, B or C"))?;
    let note = b.note.as_deref().unwrap_or("").trim().to_string();
    if note.chars().count() > 500 {
        return Err(bad("Note must be at most 500 characters"));
    }
    let photo = b.photo.as_ref().map(check_photo).transpose()?;
    if !grade_matches(&o.claimed, received) && note.chars().count() < 5 && photo.is_none() {
        return Err(bad(
            "For a lower grade, add a photo of what arrived or a short note so the admin can check",
        ));
    }
    let (id, dispute_id, matched) =
        record_grade_check(&pool, tx_id, &o, received, &note, photo).await?;
    Ok(Json(
        json!({ "id": id, "matched": matched, "dispute_id": dispute_id, "received_grade": received }),
    ))
}

#[derive(Deserialize)]
struct ReviewBody {
    rating: i64,
    comment: Option<String>,
    /// Needed only if the grade was not checked on arrival.
    received_grade: Option<String>,
}

/// POST /api/transactions/:id/review — buyer: 1–5 stars once the order is delivered.
async fn review(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(tx_id): Path<i64>,
    Json(b): Json<ReviewBody>,
) -> ApiResult<Value> {
    let o = order_facts(&pool, tx_id).await?;
    if user.role != "buyer" || o.buyer_id != user.user_id {
        return Err(forbidden(
            "Only the buyer of this order can review the farmer",
        ));
    }
    if !o.delivered() {
        return Err(bad("You can review the farmer once the order is delivered"));
    }
    if !(1..=5).contains(&b.rating) {
        return Err(bad("Choose a rating from 1 to 5 stars"));
    }
    let comment = b.comment.as_deref().unwrap_or("").trim().to_string();
    if comment.chars().count() > 1000 {
        return Err(bad("Review must be at most 1000 characters"));
    }
    let checked: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM grade_checks WHERE transaction_id = ?")
            .bind(tx_id)
            .fetch_one(&pool)
            .await?;
    let reviewed: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM farmer_reviews WHERE transaction_id = ?")
            .bind(tx_id)
            .fetch_one(&pool)
            .await?;
    if reviewed > 0 {
        return Err(bad("You already reviewed this order"));
    }
    // Every review also records the grade received, so the grade record is complete.
    if checked == 0 {
        let received = b
            .received_grade
            .as_deref()
            .and_then(normal_grade)
            .ok_or_else(|| bad("Choose the grade you received (A, B or C)"))?;
        record_grade_check(&pool, tx_id, &o, received, &comment, None).await?;
    }
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO farmer_reviews (transaction_id, buyer_id, farmer_id, rating, comment)
         VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(tx_id)
    .bind(o.buyer_id)
    .bind(o.farmer_id)
    .bind(b.rating)
    .bind(&comment)
    .fetch_one(&pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(d) if d.message().contains("UNIQUE") => {
            bad("You already reviewed this order")
        }
        other => AppError::from(other),
    })?;
    notify_typed(
        &pool,
        o.farmer_id,
        "general",
        &format!("New {}-star review", b.rating),
        &if comment.is_empty() {
            format!("A buyer rated your {} order.", o.crop)
        } else {
            format!(
                "\u{201c}{}\u{201d}",
                comment.chars().take(160).collect::<String>()
            )
        },
        Some("/profile"),
    )
    .await?;
    Ok(Json(json!({ "id": id })))
}

/// GET /api/transactions/:id/quality — this order's grade check and review, if any.
async fn order_quality(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(tx_id): Path<i64>,
) -> ApiResult<Value> {
    let o = order_facts(&pool, tx_id).await?;
    if user.user_id != o.buyer_id && user.user_id != o.farmer_id && user.role != "admin" {
        return Err(forbidden("You are not part of this order"));
    }
    type Check = (
        String,
        String,
        i64,
        String,
        Option<i64>,
        Option<String>,
        Option<Vec<u8>>,
    );
    let check: Option<Check> = sqlx::query_as(
        "SELECT claimed_grade, received_grade, matched, note, dispute_id, photo_mime, photo
         FROM grade_checks WHERE transaction_id = ?",
    )
    .bind(tx_id)
    .fetch_optional(&pool)
    .await?;
    let review: Option<(i64, String, String)> = sqlx::query_as(
        "SELECT rating, comment, COALESCE(created_at, '') FROM farmer_reviews WHERE transaction_id = ?",
    )
    .bind(tx_id)
    .fetch_optional(&pool)
    .await?;
    Ok(Json(json!({
        "claimed_grade": o.claimed,
        "can_check_grade": user.user_id == o.buyer_id && o.arrived() && check.is_none(),
        "can_review": user.user_id == o.buyer_id && o.delivered() && review.is_none(),
        "grade_check": check.map(|c| json!({
            "claimed_grade": c.0, "received_grade": c.1, "matched": c.2 == 1, "note": c.3,
            "dispute_id": c.4,
            "photo_url": c.5.zip(c.6).map(|(m, b)| data_url(&m, &b)),
        })),
        "review": review.map(|r| json!({ "rating": r.0, "comment": r.1, "created_at": r.2 })),
    })))
}

/// Rating and grade record of a farmer.
pub async fn farmer_summary(pool: &SqlitePool, farmer_id: i64) -> Result<Value, AppError> {
    let (count, avg): (i64, Option<f64>) = sqlx::query_as(
        "SELECT COUNT(*), CAST(AVG(rating) AS REAL) FROM farmer_reviews WHERE farmer_id = ?",
    )
    .bind(farmer_id)
    .fetch_one(pool)
    .await?;
    let (checks, matched): (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), COALESCE(SUM(matched), 0) FROM grade_checks WHERE farmer_id = ?",
    )
    .bind(farmer_id)
    .fetch_one(pool)
    .await?;
    Ok(json!({
        "rating": avg.map(|a| (a * 10.0).round() / 10.0),
        "review_count": count,
        "grade_checks": checks,
        "grade_matched": matched,
        "grade_match_pct": if checks > 0 { Some((matched as f64 * 100.0 / checks as f64).round()) } else { None },
    }))
}

/// GET /api/farmers/:id/reviews — rating, grade record and latest reviews.
async fn farmer_reviews(
    State(pool): State<SqlitePool>,
    _user: AuthUser,
    Path(farmer_id): Path<i64>,
) -> ApiResult<Value> {
    let name: String =
        sqlx::query_scalar("SELECT name FROM users WHERE id = ? AND role = 'farmer'")
            .bind(farmer_id)
            .fetch_optional(&pool)
            .await?
            .ok_or_else(|| not_found("Farmer not found"))?;
    type Row = (
        i64,
        String,
        String,
        String,
        String,
        Option<String>,
        Option<i64>,
    );
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT r.rating, r.comment, COALESCE(r.created_at, ''), ub.name, c.name,
                g.received_grade, g.matched
         FROM farmer_reviews r
         JOIN users ub ON ub.id = r.buyer_id
         JOIN transactions t ON t.id = r.transaction_id
         JOIN offers o ON o.id = t.offer_id JOIN lots l ON l.id = o.lot_id
         JOIN crops c ON c.id = l.crop_id
         LEFT JOIN grade_checks g ON g.transaction_id = r.transaction_id
         WHERE r.farmer_id = ? ORDER BY r.id DESC LIMIT 50",
    )
    .bind(farmer_id)
    .fetch_all(&pool)
    .await?;
    let mut summary = farmer_summary(&pool, farmer_id).await?;
    summary["farmer_id"] = json!(farmer_id);
    summary["farmer_name"] = json!(name);
    summary["reviews"] = json!(rows
        .into_iter()
        .map(|r| json!({
            "rating": r.0, "comment": r.1, "created_at": r.2, "buyer_name": r.3, "crop_name": r.4,
            "received_grade": r.5, "grade_matched": r.6.map(|m| m == 1),
        }))
        .collect::<Vec<_>>());
    Ok(Json(summary))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;

    fn jpeg(seed: u8) -> PhotoIn {
        let mut bytes = vec![0xFF, 0xD8, 0xFF, 0xE0];
        bytes.resize(20_000, seed);
        PhotoIn {
            data_base64: base64_encode(&bytes),
            latitude: None,
            longitude: None,
        }
    }

    fn status<T>(r: Result<T, AppError>) -> u16 {
        match r {
            Ok(_) => 200,
            Err(e) => e.into_response().status().as_u16(),
        }
    }

    #[tokio::test]
    async fn grade_mismatch_opens_a_dispute_and_review_needs_delivery() {
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
        for (name, role, phone) in [("F", "farmer", "9000000401"), ("B", "buyer", "9000000402")] {
            ids.push(
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO users (name, role, phone_number, status) VALUES (?, ?, ?, 'active') RETURNING id",
                )
                .bind(name)
                .bind(role)
                .bind(phone)
                .fetch_one(&pool)
                .await
                .unwrap(),
            );
        }
        let (farmer, buyer) = (ids[0], ids[1]);
        sqlx::query("INSERT INTO farmers (id, location, urgency_level) VALUES (?, 'Ludhiana, Punjab', 'medium')")
            .bind(farmer)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO buyers (id, trust_score, is_verified) VALUES (?, 5, 1)")
            .bind(buyer)
            .execute(&pool)
            .await
            .unwrap();
        let lot: i64 = sqlx::query_scalar(
            "INSERT INTO lots (farmer_id, crop_id, quantity_quintals, expected_quality, status)
             VALUES (?, 1, 10, 'Grade A', 'sold') RETURNING id",
        )
        .bind(farmer)
        .fetch_one(&pool)
        .await
        .unwrap();
        // The same image can't be attached twice.
        let first = check_photo(&jpeg(1)).unwrap();
        insert_photo(&pool, lot, farmer, &first).await.unwrap();
        assert_eq!(status(insert_photo(&pool, lot, farmer, &first).await), 400);

        let offer: i64 = sqlx::query_scalar(
            "INSERT INTO offers (lot_id, buyer_id, price_offered, status) VALUES (?, ?, 2000, 'accepted') RETURNING id",
        )
        .bind(lot)
        .bind(buyer)
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
        let me = AuthUser {
            user_id: buyer,
            role: "buyer".into(),
            status: "active".into(),
            name: "B".into(),
        };
        let me2 = || AuthUser {
            user_id: me.user_id,
            role: me.role.clone(),
            status: me.status.clone(),
            name: me.name.clone(),
        };
        let check = |grade: &str, note: &str| GradeCheckBody {
            received_grade: grade.into(),
            note: Some(note.into()),
            photo: None,
        };
        // Not arrived yet.
        assert_eq!(
            status(
                grade_check(
                    State(pool.clone()),
                    me2(),
                    Path(tx),
                    Json(check("C", "mostly C grade"))
                )
                .await
            ),
            400
        );
        sqlx::query("INSERT INTO order_events (transaction_id, status) VALUES (?, 'in_transit')")
            .bind(tx)
            .execute(&pool)
            .await
            .unwrap();
        // A lower grade needs evidence.
        assert_eq!(
            status(grade_check(State(pool.clone()), me2(), Path(tx), Json(check("C", ""))).await),
            400
        );
        let res = grade_check(
            State(pool.clone()),
            me2(),
            Path(tx),
            Json(check("C", "mostly C grade")),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(res["matched"], false);
        let reason: String = sqlx::query_scalar("SELECT reason FROM disputes WHERE id = ?")
            .bind(res["dispute_id"].as_i64().unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(
            reason.contains("listed as Grade A, received Grade C"),
            "{reason}"
        );
        // Review only after delivery.
        let rv = || ReviewBody {
            rating: 2,
            comment: Some("Grade was lower than listed".into()),
            received_grade: None,
        };
        assert_eq!(
            status(review(State(pool.clone()), me2(), Path(tx), Json(rv())).await),
            400
        );
        sqlx::query("INSERT INTO order_events (transaction_id, status) VALUES (?, 'delivered')")
            .bind(tx)
            .execute(&pool)
            .await
            .unwrap();
        let _ = review(State(pool.clone()), me2(), Path(tx), Json(rv()))
            .await
            .unwrap();
        assert_eq!(
            status(review(State(pool.clone()), me2(), Path(tx), Json(rv())).await),
            400
        );
        let s = farmer_summary(&pool, farmer).await.unwrap();
        assert_eq!(s["rating"], 2.0);
        assert_eq!(s["review_count"], 1);
        assert_eq!(s["grade_checks"], 1);
        assert_eq!(s["grade_match_pct"], 0.0);
    }

    #[test]
    fn grades_compare_by_rank() {
        assert!(grade_matches("Grade A", "Grade A"));
        assert!(grade_matches("Grade B", "Grade A"));
        assert!(!grade_matches("Grade A", "Grade C"));
        assert!(!grade_matches("Grade A", "Grade B"));
        assert_eq!(normal_grade("b"), Some("Grade B"));
        assert_eq!(normal_grade("nonsense"), None);
    }

    #[test]
    fn base64_round_trip() {
        for s in [&b""[..], b"a", b"ab", b"abc", b"hello world"] {
            let enc = base64_encode(s);
            assert_eq!(crate::fpo::decode_base64(&enc).unwrap(), s);
        }
    }

    #[test]
    fn photo_must_be_a_real_jpeg() {
        let png = PhotoIn {
            data_base64: base64_encode(&[0x89, b'P', b'N', b'G', 0, 0, 0, 0]),
            latitude: None,
            longitude: None,
        };
        assert!(check_photo(&png).is_err());
        let mut jpeg = vec![0xFF, 0xD8, 0xFF, 0xE0];
        jpeg.resize(20_000, 7);
        let ok = check_photo(&PhotoIn {
            data_base64: format!("data:image/jpeg;base64,{}", base64_encode(&jpeg)),
            latitude: Some(30.9),
            longitude: Some(500.0),
        })
        .unwrap();
        assert_eq!(ok.mime, "image/jpeg");
        assert_eq!(ok.latitude, Some(30.9));
        assert_eq!(ok.longitude, None);
    }
}
