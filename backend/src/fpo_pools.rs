//! FPO pools (collection drives), farmer pledges, join requests and announcements.
//! A child module of `fpo`, so it reuses that module's helpers and access checks.
//!
//! Pool lifecycle (stored): draft → collecting ⇄ locked → listed, or → cancelled.
//! "sold" and "settled" are derived from the listed lot's stock and payouts.

use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, Sqlite, SqlitePool};

use super::{
    audit, bad, contributions_where, crop_code, fetch_lot, fetch_member, forbidden, manager_org,
    not_found, offers_where, payouts_where, positive, r2, require, sales_where, text, ApiResult,
    EPS,
};
use crate::{auth::AuthUser, db, errors::AppError};

pub fn routes() -> Router<SqlitePool> {
    Router::new()
        .route("/api/fpo/pools", get(list_pools).post(create_pool))
        .route("/api/fpo/pools/:id", get(pool_detail))
        .route("/api/fpo/pools/:id/contributions", post(fpo_add_pledge))
        .route(
            "/api/fpo/pools/:id/contributions/:cid/intake",
            post(record_intake),
        )
        .route("/api/fpo/pools/:id/action/:action", post(pool_action))
        .route("/api/fpo/join-requests", get(list_join_requests))
        .route(
            "/api/fpo/join-requests/:id/:action",
            post(decide_join_request),
        )
        .route(
            "/api/fpo/announcements",
            get(fpo_announcements).post(post_fpo_announcement),
        )
        .route("/api/announcements", get(my_announcements))
        .route("/api/fpos", get(find_fpos))
        .route("/api/fpos/:id/join-requests", post(request_to_join))
        .route("/api/fpo/my/pools", get(farmer_pools))
        .route("/api/fpo/my/pools/:id/pledge", post(farmer_pledge))
}

/* -------------------------------------------------------------------------- */
/*                         pure rules (unit-tested)                           */
/* -------------------------------------------------------------------------- */

/// Next stored status for a pool action, or a plain-language reason it is not allowed.
pub(crate) fn next_pool_status(current: &str, action: &str) -> Result<&'static str, String> {
    match (current, action) {
        ("draft", "open") => Ok("collecting"),
        ("collecting", "lock") => Ok("locked"),
        ("locked", "reopen") => Ok("collecting"),
        ("locked", "list") => Ok("listed"),
        ("draft" | "collecting" | "locked", "cancel") => Ok("cancelled"),
        ("draft", _) => Err("Start collecting before doing that.".into()),
        ("collecting", "list") => Err("Lock the pool before listing it for sale.".into()),
        ("listed", _) => Err("This pool is already listed for sale.".into()),
        ("cancelled", _) => Err("This pool is cancelled.".into()),
        _ => Err(format!(
            "A {current} pool cannot be changed with '{action}'."
        )),
    }
}

/// Price factor by assessed grade. Grade A earns the full sale price; lower
/// grades earn proportionally less of the same sale.
pub(crate) fn grade_factor(grade: Option<&str>) -> f64 {
    match grade {
        Some("B") => 0.95,
        Some("C") => 0.85,
        _ => 1.0,
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ShareIn {
    pub contribution_id: i64,
    pub member_id: i64,
    pub member_name: String,
    pub quantity: f64,
    pub grade: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub(crate) struct ShareOut {
    pub contribution_id: i64,
    pub member_id: i64,
    pub member_name: String,
    pub contributed_quintals: f64,
    pub grade: Option<String>,
    pub grade_factor: f64,
    pub share_pct: f64,
    pub quantity_quintals: f64,
    pub gross: f64,
    pub freight_share: f64,
    pub storage_handling_share: f64,
    pub commission: f64,
    pub deductions: f64,
    pub net: f64,
}

pub(crate) struct SaleTerms {
    pub quantity: f64,
    pub amount: f64,
    pub transport: f64,
    pub storage: f64,
    pub handling: f64,
    pub commission_pct: f64,
}

/// Splits one sale between the lot's contributors.
/// - Gross: the sale amount shared by quantity × grade factor (sums exactly to the amount).
/// - Freight, storage and handling: shared by quantity.
/// - FPO commission: `commission_pct` of each farmer's gross.
pub(crate) fn split_sale(rows: &[ShareIn], sale: &SaleTerms) -> Vec<ShareOut> {
    let total_q: f64 = rows.iter().map(|r| r.quantity).sum();
    let total_w: f64 = rows
        .iter()
        .map(|r| r.quantity * grade_factor(r.grade.as_deref()))
        .sum();
    if total_q <= 0.0 || total_w <= 0.0 {
        return vec![];
    }
    let sold_fraction = (sale.quantity / total_q).min(1.0);
    let mut out: Vec<ShareOut> = rows
        .iter()
        .map(|r| {
            let factor = grade_factor(r.grade.as_deref());
            let q_share = r.quantity / total_q;
            let gross = r2(sale.amount * r.quantity * factor / total_w);
            let freight = r2(sale.transport * q_share);
            let other = r2((sale.storage + sale.handling) * q_share);
            let commission = r2(gross * sale.commission_pct / 100.0);
            ShareOut {
                contribution_id: r.contribution_id,
                member_id: r.member_id,
                member_name: r.member_name.clone(),
                contributed_quintals: r.quantity,
                grade: r.grade.clone(),
                grade_factor: factor,
                share_pct: r2(q_share * 100.0),
                quantity_quintals: r2(r.quantity * sold_fraction),
                gross,
                freight_share: freight,
                storage_handling_share: other,
                commission,
                deductions: 0.0,
                net: 0.0,
            }
        })
        .collect();
    // Put any rounding remainder on the largest share so gross adds up exactly.
    let diff = r2(sale.amount - out.iter().map(|o| o.gross).sum::<f64>());
    if diff != 0.0 {
        if let Some(big) = out.iter_mut().max_by(|a, b| {
            a.gross
                .partial_cmp(&b.gross)
                .unwrap_or(std::cmp::Ordering::Equal)
        }) {
            big.gross = r2(big.gross + diff);
            big.commission = r2(big.gross * sale.commission_pct / 100.0);
        }
    }
    for o in &mut out {
        o.deductions = r2(o.freight_share + o.storage_handling_share + o.commission);
        o.net = r2(o.gross - o.deductions);
    }
    out
}

/* -------------------------------------------------------------------------- */
/*                                   pools                                    */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Serialize, FromRow)]
pub(crate) struct Pool {
    id: i64,
    fpo_id: i64,
    fpo_name: String,
    crop_id: i64,
    crop_name: String,
    target_grade: Option<String>,
    target_quantity_quintals: f64,
    collection_center: String,
    collection_deadline: String,
    status: String,
    effective_status: String,
    lot_id: Option<i64>,
    lot_code: Option<String>,
    pledged_quintals: f64,
    received_quintals: f64,
    contributors: i64,
    pending_pledges: i64,
    rejected: i64,
    created_at: Option<String>,
}

const POOL_SELECT: &str = "SELECT p.id, p.fpo_id, o.name AS fpo_name, p.crop_id, c.name AS crop_name,
    p.target_grade, p.target_quantity_quintals, p.collection_center, p.collection_deadline, p.status,
    CASE
      WHEN p.status = 'listed' AND l.id IS NOT NULL AND l.sold_quintals >= l.total_quintals - 0.0001
           AND NOT EXISTS (SELECT 1 FROM fpo_sales s WHERE s.lot_id = l.id
                           AND (SELECT COUNT(*) FROM fpo_payouts po WHERE po.sale_id = s.id) = 0)
           AND NOT EXISTS (SELECT 1 FROM fpo_payouts po JOIN fpo_sales s ON s.id = po.sale_id
                           WHERE s.lot_id = l.id AND po.status = 'due')
        THEN 'settled'
      WHEN p.status = 'listed' AND l.id IS NOT NULL
           AND l.sold_quintals + l.reserved_quintals >= l.total_quintals - 0.0001
        THEN 'sold'
      ELSE p.status END AS effective_status,
    p.lot_id, l.lot_code,
    CAST(COALESCE((SELECT SUM(COALESCE(x.pledged_quintals, x.quantity_quintals)) FROM fpo_contributions x
        WHERE x.pool_id = p.id AND x.status <> 'rejected'), 0) AS REAL) AS pledged_quintals,
    CAST(COALESCE((SELECT SUM(x.received_quintals) FROM fpo_contributions x
        WHERE x.pool_id = p.id AND x.status IN ('approved', 'pooled')), 0) AS REAL) AS received_quintals,
    (SELECT COUNT(DISTINCT x.member_id) FROM fpo_contributions x WHERE x.pool_id = p.id AND x.status <> 'rejected') AS contributors,
    (SELECT COUNT(*) FROM fpo_contributions x WHERE x.pool_id = p.id AND x.status = 'pending') AS pending_pledges,
    (SELECT COUNT(*) FROM fpo_contributions x WHERE x.pool_id = p.id AND x.status = 'rejected') AS rejected,
    p.created_at
    FROM fpo_pools p
    JOIN crops c ON c.id = p.crop_id
    JOIN fpo_organizations o ON o.id = p.fpo_id
    LEFT JOIN fpo_lots l ON l.id = p.lot_id";

pub(crate) async fn pools_where(
    pool: &SqlitePool,
    filter: &str,
    binds: &[i64],
) -> Result<Vec<Pool>, AppError> {
    let sql = format!("{POOL_SELECT} WHERE {filter} ORDER BY p.status IN ('cancelled', 'listed'), p.collection_deadline, p.id DESC");
    let mut q = sqlx::query_as::<_, Pool>(&sql);
    for b in binds {
        q = q.bind(*b);
    }
    Ok(q.fetch_all(pool).await?)
}

async fn fetch_pool(pool: &SqlitePool, fpo_id: i64, id: i64) -> Result<Pool, AppError> {
    pools_where(pool, "p.fpo_id = ? AND p.id = ?", &[fpo_id, id])
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| not_found("Pool not found in your FPO"))
}

async fn list_pools(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Vec<Pool>> {
    let org = manager_org(&pool, &user).await?;
    Ok(Json(pools_where(&pool, "p.fpo_id = ?", &[org.id]).await?))
}

#[derive(Deserialize)]
struct PoolBody {
    crop_name: String,
    target_grade: Option<String>,
    target_quantity_quintals: f64,
    collection_center: String,
    collection_deadline: String,
    start_collecting: Option<bool>,
}

async fn today(pool: &SqlitePool) -> Result<String, AppError> {
    Ok(sqlx::query_scalar("SELECT date('now')")
        .fetch_one(pool)
        .await?)
}

async fn create_pool(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<PoolBody>,
) -> ApiResult<Pool> {
    let org = manager_org(&pool, &user).await?;
    let crop = db::find_or_create_crop(&pool, &text(&b.crop_name, "Crop", 1, 80)?).await?;
    let grade = match b.target_grade.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(g @ ("A" | "B" | "C")) => Some(g.to_string()),
        Some(_) => return Err(bad("Target grade must be A, B or C")),
    };
    let target = positive(b.target_quantity_quintals, "Target quantity (quintals)")?;
    let center = text(&b.collection_center, "Collection centre", 2, 150)?;
    let deadline = super::date(&b.collection_deadline, "Collection deadline")?;
    if deadline < today(&pool).await? {
        return Err(bad("The collection deadline is in the past"));
    }
    let status = if b.start_collecting.unwrap_or(true) {
        "collecting"
    } else {
        "draft"
    };
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_pools (fpo_id, crop_id, target_grade, target_quantity_quintals, collection_center, collection_deadline, status)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org.id)
    .bind(crop.id)
    .bind(&grade)
    .bind(target)
    .bind(&center)
    .bind(&deadline)
    .bind(status)
    .fetch_all(&pool)
    .await
    .and_then(|mut rows| rows.pop().ok_or(sqlx::Error::RowNotFound))?;
    audit(
        &pool,
        org.id,
        user.user_id,
        "created",
        "pool",
        Some(id),
        format!(
            "{} q {} at {center} by {deadline} ({status})",
            target, crop.name
        ),
    )
    .await?;
    fetch_pool(&pool, org.id, id).await.map(Json)
}

async fn pool_detail(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let p = fetch_pool(&pool, org.id, id).await?;
    let contributions =
        contributions_where(&pool, "c.fpo_id = ? AND c.pool_id = ?", &[org.id, id]).await?;
    let mut grades: std::collections::BTreeMap<String, f64> = Default::default();
    for c in contributions
        .iter()
        .filter(|c| matches!(c.status.as_str(), "approved" | "pooled"))
    {
        *grades
            .entry(
                c.assessed_grade
                    .clone()
                    .unwrap_or_else(|| "Not graded".into()),
            )
            .or_default() += c.received_quintals.unwrap_or(c.quantity_quintals);
    }
    let (lot, offers, sales, payouts) = match p.lot_id {
        Some(lot_id) => (
            Some(fetch_lot(&pool, org.id, lot_id).await?),
            offers_where(&pool, "f.fpo_id = ? AND f.lot_id = ?", &[org.id, lot_id]).await?,
            sales_where(&pool, "s.fpo_id = ? AND s.lot_id = ?", &[org.id, lot_id]).await?,
            payouts_where(&pool, "s.fpo_id = ? AND s.lot_id = ?", &[org.id, lot_id]).await?,
        ),
        None => (None, vec![], vec![], vec![]),
    };
    Ok(Json(json!({
        "pool": p,
        "contributions": contributions,
        "grade_breakdown": grades.iter().map(|(g, q)| json!({"grade": g, "quintals": r2(*q)})).collect::<Vec<_>>(),
        "lot": lot,
        "offers": offers,
        "sales": sales,
        "payouts": payouts,
    })))
}

#[derive(Deserialize)]
struct PledgeBody {
    member_id: Option<i64>,
    quantity_quintals: f64,
    source_lot_id: Option<i64>,
}

/// Inserts a pledge into a collecting pool. Shared by the FPO and farmer endpoints.
#[allow(clippy::too_many_arguments)]
async fn insert_pledge(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    p: &Pool,
    member_id: i64,
    quantity: f64,
    source_lot_id: Option<i64>,
    pledged_by: &str,
    today: &str,
) -> Result<i64, AppError> {
    if p.status != "collecting" {
        return Err(bad("This pool is not collecting pledges right now"));
    }
    if p.collection_deadline.as_str() < today {
        return Err(bad("The collection deadline for this pool has passed"));
    }
    let existing: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM fpo_contributions WHERE pool_id = ? AND member_id = ? AND status = 'pending'",
    )
    .bind(p.id)
    .bind(member_id)
    .fetch_one(&mut **tx)
    .await?;
    if existing > 0 {
        return Err(bad(
            "This farmer already has a pledge waiting in this pool. Record its intake first.",
        ));
    }
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_contributions (fpo_id, member_id, crop_id, variety, quantity_quintals, pledged_quintals,
            harvest_date, quality_note, status, pool_id, source_lot_id, pledged_by)
         VALUES (?, ?, ?, '', ?, ?, ?, '', 'pending', ?, ?, ?) RETURNING id",
    )
    .bind(p.fpo_id)
    .bind(member_id)
    .bind(p.crop_id)
    .bind(quantity)
    .bind(quantity)
    .bind(today)
    .bind(p.id)
    .bind(source_lot_id)
    .bind(pledged_by)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(d) if d.message().contains("UNIQUE") => {
            bad("This lot is already pledged to a pool")
        }
        other => AppError::from(other),
    })?;
    Ok(id)
}

async fn fpo_add_pledge(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<PledgeBody>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let p = fetch_pool(&pool, org.id, id).await?;
    let member_id = b.member_id.ok_or_else(|| bad("Choose a farmer"))?;
    let member = fetch_member(&pool, org.id, member_id).await?;
    if member.status != "active" {
        return Err(bad("This farmer's membership is inactive"));
    }
    let qty = positive(b.quantity_quintals, "Quantity (quintals)")?;
    let day = today(&pool).await?;
    let mut tx = pool.begin().await?;
    let cid = insert_pledge(&mut tx, &p, member_id, qty, None, "fpo", &day).await?;
    audit(
        &mut *tx,
        org.id,
        user.user_id,
        "pledge recorded",
        "pool",
        Some(id),
        format!("{qty} q from {}", member.name),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": cid })))
}

#[derive(Deserialize)]
struct IntakeBody {
    action: String,
    received_quintals: Option<f64>,
    assessed_grade: Option<String>,
    note: Option<String>,
}

/// Puts a farmer's own lot back on the open market (pledge rejected or pool cancelled).
async fn release_source_lots<'c, E>(ex: E, filter_sql: &str, id: i64) -> Result<(), AppError>
where
    E: sqlx::Executor<'c, Database = Sqlite>,
{
    sqlx::query(&format!(
        "UPDATE lots SET status = 'open' WHERE status = 'pooled'
         AND id IN (SELECT source_lot_id FROM fpo_contributions WHERE source_lot_id IS NOT NULL AND {filter_sql})"
    ))
    .bind(id)
    .execute(ex)
    .await?;
    Ok(())
}

async fn record_intake(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path((id, cid)): Path<(i64, i64)>,
    Json(b): Json<IntakeBody>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let p = fetch_pool(&pool, org.id, id).await?;
    if p.status != "collecting" {
        return Err(bad(
            "Intake can only be recorded while the pool is collecting. Reopen it first.",
        ));
    }
    let (status, member_name): (String, String) = sqlx::query_as(
        "SELECT c.status, m.name FROM fpo_contributions c JOIN fpo_members m ON m.id = c.member_id
         WHERE c.id = ? AND c.pool_id = ? AND c.fpo_id = ?",
    )
    .bind(cid)
    .bind(id)
    .bind(org.id)
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| not_found("Pledge not found in this pool"))?;
    let note = text(b.note.as_deref().unwrap_or(""), "Note", 0, 300)?;
    let mut tx = pool.begin().await?;
    match b.action.as_str() {
        "receive" => {
            if status != "pending" {
                return Err(bad(format!("This pledge is already {status}")));
            }
            let qty = positive(
                b.received_quintals.unwrap_or(0.0),
                "Weighed quantity (quintals)",
            )?;
            let grade = match b.assessed_grade.as_deref() {
                Some(g @ ("A" | "B" | "C")) => g,
                _ => return Err(bad("Choose the assessed grade (A, B or C)")),
            };
            sqlx::query(
                "UPDATE fpo_contributions SET status = 'approved', received_quintals = ?, quantity_quintals = ?,
                    assessed_grade = ?, received_at = CURRENT_TIMESTAMP, quality_note = ?
                 WHERE id = ? AND status = 'pending'",
            )
            .bind(qty)
            .bind(qty)
            .bind(grade)
            .bind(&note)
            .bind(cid)
            .execute(&mut *tx)
            .await?;
            audit(
                &mut *tx,
                org.id,
                user.user_id,
                "intake received",
                "pool",
                Some(id),
                format!("{member_name}: {qty} q, grade {grade}"),
            )
            .await?;
        }
        "reject" => {
            if !matches!(status.as_str(), "pending" | "approved") {
                return Err(bad(format!("This pledge is already {status}")));
            }
            if note.len() < 3 {
                return Err(bad("Write a short reason for rejecting"));
            }
            sqlx::query(
                "UPDATE fpo_contributions SET status = 'rejected', rejection_note = ? WHERE id = ?",
            )
            .bind(&note)
            .bind(cid)
            .execute(&mut *tx)
            .await?;
            release_source_lots(&mut *tx, "id = ?", cid).await?;
            audit(
                &mut *tx,
                org.id,
                user.user_id,
                "intake rejected",
                "pool",
                Some(id),
                format!("{member_name}: {note}"),
            )
            .await?;
        }
        _ => return Err(bad("Action must be receive or reject")),
    }
    tx.commit().await?;
    Ok(Json(json!({ "id": cid })))
}

async fn pool_action(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path((id, action)): Path<(i64, String)>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let p = fetch_pool(&pool, org.id, id).await?;
    let next = next_pool_status(&p.status, &action).map_err(bad)?;
    let mut tx = pool.begin().await?;
    let mut detail = String::new();
    match action.as_str() {
        "list" => {
            // Every received contribution goes into one bulk lot; undelivered pledges are closed.
            let received: Vec<(i64, f64, Option<String>)> = sqlx::query_as(
                "SELECT id, quantity_quintals, assessed_grade FROM fpo_contributions
                 WHERE pool_id = ? AND status = 'approved' AND lot_id IS NULL",
            )
            .bind(id)
            .fetch_all(&mut *tx)
            .await?;
            if received.is_empty() {
                return Err(bad(
                    "Receive at least one contribution before listing the pool",
                ));
            }
            let total: f64 = received.iter().map(|r| r.1).sum();
            // The lot is sold at the lowest grade it contains.
            let grade = received
                .iter()
                .filter_map(|r| r.2.clone())
                .max()
                .unwrap_or_else(|| "A".into());
            let lot_id = sqlx::query_scalar::<_, i64>(
                "INSERT INTO fpo_lots (fpo_id, crop_id, variety, total_quintals, grade) VALUES (?, ?, '', ?, ?) RETURNING id",
            )
            .bind(org.id)
            .bind(p.crop_id)
            .bind(total)
            .bind(&grade)
            .fetch_one(&mut *tx)
            .await?;
            let day: String = sqlx::query_scalar("SELECT strftime('%Y%m%d', 'now')")
                .fetch_one(&mut *tx)
                .await?;
            let code = format!(
                "FPO{}-{}-{}-{:04}",
                org.id,
                crop_code(&p.crop_name),
                day,
                lot_id
            );
            sqlx::query("UPDATE fpo_lots SET lot_code = ? WHERE id = ?")
                .bind(&code)
                .bind(lot_id)
                .execute(&mut *tx)
                .await?;
            let moved = sqlx::query(
                "UPDATE fpo_contributions SET status = 'pooled', lot_id = ?
                 WHERE pool_id = ? AND status = 'approved' AND lot_id IS NULL",
            )
            .bind(lot_id)
            .bind(id)
            .execute(&mut *tx)
            .await?;
            if moved.rows_affected() as usize != received.len() {
                return Err(bad(
                    "The pool changed while listing. Refresh and try again.",
                ));
            }
            release_source_lots(&mut *tx, "pool_id = ? AND status = 'pending'", id).await?;
            sqlx::query(
                "UPDATE fpo_contributions SET status = 'rejected', rejection_note = 'Not delivered before the pool was listed'
                 WHERE pool_id = ? AND status = 'pending'",
            )
            .bind(id)
            .execute(&mut *tx)
            .await?;
            sqlx::query("UPDATE fpo_pools SET lot_id = ? WHERE id = ?")
                .bind(lot_id)
                .bind(id)
                .execute(&mut *tx)
                .await?;
            detail = format!("{code}: {total} q, grade {grade}");
        }
        "cancel" => {
            release_source_lots(
                &mut *tx,
                "pool_id = ? AND status IN ('pending', 'approved')",
                id,
            )
            .await?;
            sqlx::query(
                "UPDATE fpo_contributions SET status = 'rejected', rejection_note = 'Pool cancelled'
                 WHERE pool_id = ? AND status IN ('pending', 'approved')",
            )
            .bind(id)
            .execute(&mut *tx)
            .await?;
        }
        _ => {}
    }
    let changed = sqlx::query(
        "UPDATE fpo_pools SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = ?",
    )
    .bind(next)
    .bind(id)
    .bind(&p.status)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() == 0 {
        return Err(bad("The pool changed while saving. Refresh and try again."));
    }
    audit(
        &mut *tx,
        org.id,
        user.user_id,
        &format!("pool {next}"),
        "pool",
        Some(id),
        detail,
    )
    .await?;
    tx.commit().await?;
    fetch_pool(&pool, org.id, id).await.map(|p| Json(json!(p)))
}

/* -------------------------------------------------------------------------- */
/*                         farmer: find FPOs, join, pledge                    */
/* -------------------------------------------------------------------------- */

#[derive(Deserialize)]
struct FindQuery {
    q: Option<String>,
    district: Option<String>,
}

async fn find_fpos(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Query(f): Query<FindQuery>,
) -> ApiResult<Vec<Value>> {
    require(&pool, &user, &["farmer"]).await?;
    let q = format!("%{}%", f.q.unwrap_or_default().trim().to_lowercase());
    let district = format!("%{}%", f.district.unwrap_or_default().trim().to_lowercase());
    type Row719 = (
        i64,
        String,
        String,
        String,
        String,
        i64,
        Option<String>,
        i64,
    );
    let rows: Vec<Row719> = sqlx::query_as(
        "SELECT o.id, o.name, o.district, o.state, o.primary_crops,
            (SELECT COUNT(*) FROM fpo_members m WHERE m.fpo_id = o.id AND m.status = 'active'),
            (SELECT r.status FROM fpo_join_requests r WHERE r.fpo_id = o.id AND r.farmer_user_id = ? ORDER BY r.id DESC LIMIT 1),
            (SELECT COUNT(*) FROM fpo_members m WHERE m.fpo_id = o.id AND m.user_id = ? AND m.status = 'active')
         FROM fpo_organizations o JOIN users u ON u.id = o.manager_user_id
         WHERE o.verified = 1 AND u.status = 'active'
           AND (lower(o.name) LIKE ? OR lower(o.primary_crops) LIKE ?)
           AND (lower(o.district) LIKE ? OR lower(o.state) LIKE ?)
         ORDER BY o.state, o.district, o.name LIMIT 100",
    )
    .bind(user.user_id)
    .bind(user.user_id)
    .bind(&q)
    .bind(&q)
    .bind(&district)
    .bind(&district)
    .fetch_all(&pool)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| {
                json!({
                    "id": r.0, "name": r.1, "district": r.2, "state": r.3, "primary_crops": r.4,
                    "members": r.5, "request_status": r.6, "is_member": r.7 > 0,
                })
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
struct JoinBody {
    message: Option<String>,
}

async fn request_to_join(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(fpo_id): Path<i64>,
    Json(b): Json<JoinBody>,
) -> ApiResult<Value> {
    require(&pool, &user, &["farmer"]).await?;
    let ok: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM fpo_organizations o JOIN users u ON u.id = o.manager_user_id
         WHERE o.id = ? AND o.verified = 1 AND u.status = 'active'",
    )
    .bind(fpo_id)
    .fetch_one(&pool)
    .await?;
    if ok == 0 {
        return Err(not_found("FPO not found"));
    }
    let member: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM fpo_members m JOIN users u ON u.id = ?
         WHERE m.fpo_id = ? AND m.status = 'active' AND (m.user_id = u.id OR m.phone = u.phone_number)",
    )
    .bind(user.user_id)
    .bind(fpo_id)
    .fetch_one(&pool)
    .await?;
    if member > 0 {
        return Err(bad("You are already a member of this FPO"));
    }
    let message = text(b.message.as_deref().unwrap_or(""), "Message", 0, 500)?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_join_requests (fpo_id, farmer_user_id, message) VALUES (?, ?, ?) RETURNING id",
    )
    .bind(fpo_id)
    .bind(user.user_id)
    .bind(&message)
    .fetch_all(&pool)
    .await
    .and_then(|mut rows| rows.pop().ok_or(sqlx::Error::RowNotFound))
    .map_err(|e| match e {
        sqlx::Error::Database(d) if d.message().contains("UNIQUE") => {
            bad("Your request to join this FPO is already waiting")
        }
        other => AppError::from(other),
    })?;
    audit(
        &pool,
        fpo_id,
        user.user_id,
        "join requested",
        "join_request",
        Some(id),
        message,
    )
    .await?;
    Ok(Json(json!({ "id": id })))
}

async fn list_join_requests(
    State(pool): State<SqlitePool>,
    user: AuthUser,
) -> ApiResult<Vec<Value>> {
    let org = manager_org(&pool, &user).await?;
    type Row816 = (
        i64,
        i64,
        String,
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
    );
    let rows: Vec<Row816> = sqlx::query_as(
        "SELECT r.id, u.id, u.name, u.phone_number, COALESCE(f.location, ''), r.message, r.status,
                r.created_at, r.decided_at
             FROM fpo_join_requests r JOIN users u ON u.id = r.farmer_user_id
             LEFT JOIN farmers f ON f.id = u.id
             WHERE r.fpo_id = ? ORDER BY r.status = 'pending' DESC, r.id DESC LIMIT 200",
    )
    .bind(org.id)
    .fetch_all(&pool)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| {
                json!({
                    "id": r.0, "farmer_user_id": r.1, "name": r.2, "phone": r.3, "location": r.4,
                    "message": r.5, "status": r.6, "created_at": r.7, "decided_at": r.8,
                })
            })
            .collect(),
    ))
}

async fn decide_join_request(
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
    let (farmer_id, name, phone_number, location): (i64, String, String, String) = sqlx::query_as(
        "SELECT u.id, u.name, u.phone_number, COALESCE(f.location, '')
         FROM fpo_join_requests r JOIN users u ON u.id = r.farmer_user_id LEFT JOIN farmers f ON f.id = u.id
         WHERE r.id = ? AND r.fpo_id = ? AND r.status = 'pending'",
    )
    .bind(id)
    .bind(org.id)
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| bad("This request was already decided or does not exist"))?;
    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE fpo_join_requests SET status = ?, decided_at = CURRENT_TIMESTAMP, decided_by = ? WHERE id = ?",
    )
    .bind(next)
    .bind(user.user_id)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    if next == "approved" {
        // Reactivate a past membership with the same phone, or add a new member.
        let reactivated = sqlx::query(
            "UPDATE fpo_members SET status = 'active', user_id = ? WHERE fpo_id = ? AND phone = ?",
        )
        .bind(farmer_id)
        .bind(org.id)
        .bind(&phone_number)
        .execute(&mut *tx)
        .await?;
        if reactivated.rows_affected() == 0 {
            sqlx::query(
                "INSERT INTO fpo_members (fpo_id, user_id, name, phone, village) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(org.id)
            .bind(farmer_id)
            .bind(&name)
            .bind(&phone_number)
            .bind(&location)
            .execute(&mut *tx)
            .await?;
        }
    }
    audit(
        &mut *tx,
        org.id,
        user.user_id,
        &format!("join {next}"),
        "join_request",
        Some(id),
        name,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": id, "status": next })))
}

async fn farmer_pools(State(pool): State<SqlitePool>, user: AuthUser) -> ApiResult<Value> {
    require(&pool, &user, &["farmer"]).await?;
    let pools = pools_where(
        &pool,
        "p.status = 'collecting' AND p.collection_deadline >= date('now') AND p.fpo_id IN
            (SELECT fpo_id FROM fpo_members WHERE user_id = ? AND status = 'active')",
        &[user.user_id],
    )
    .await?;
    let lots: Vec<(i64, i64, String, f64, String)> = sqlx::query_as(
        "SELECT l.id, l.crop_id, c.name, l.quantity_quintals, l.expected_quality
         FROM lots l JOIN crops c ON c.id = l.crop_id WHERE l.farmer_id = ? AND l.status = 'open' ORDER BY l.id DESC",
    )
    .bind(user.user_id)
    .fetch_all(&pool)
    .await?;
    Ok(Json(json!({
        "pools": pools,
        "open_lots": lots.iter().map(|l| json!({"id": l.0, "crop_id": l.1, "crop_name": l.2, "quantity_quintals": l.3, "quality": l.4})).collect::<Vec<_>>(),
    })))
}

async fn farmer_pledge(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(b): Json<PledgeBody>,
) -> ApiResult<Value> {
    require(&pool, &user, &["farmer"]).await?;
    let fpo_id: i64 = sqlx::query_scalar("SELECT fpo_id FROM fpo_pools WHERE id = ?")
        .bind(id)
        .fetch_optional(&pool)
        .await?
        .ok_or_else(|| not_found("Pool not found"))?;
    let member_id: i64 = sqlx::query_scalar(
        "SELECT id FROM fpo_members WHERE fpo_id = ? AND user_id = ? AND status = 'active'",
    )
    .bind(fpo_id)
    .bind(user.user_id)
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| forbidden("Join this FPO before pledging to its pools"))?;
    let p = fetch_pool(&pool, fpo_id, id).await?;
    let mut qty = positive(b.quantity_quintals, "Quantity (quintals)")?;
    let day = today(&pool).await?;
    let mut tx = pool.begin().await?;
    if let Some(lot_id) = b.source_lot_id {
        let (owner, crop_id, lot_qty, status): (i64, i64, f64, String) = sqlx::query_as(
            "SELECT farmer_id, crop_id, quantity_quintals, status FROM lots WHERE id = ?",
        )
        .bind(lot_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| not_found("Lot not found"))?;
        if owner != user.user_id {
            return Err(forbidden("You can only pledge your own lots"));
        }
        if crop_id != p.crop_id {
            return Err(bad(format!("This pool collects {} only", p.crop_name)));
        }
        if status != "open" {
            return Err(bad(format!("This lot is {status} and cannot be pledged")));
        }
        // A pledged lot leaves the open market as a whole.
        qty = lot_qty;
        sqlx::query("UPDATE lots SET status = 'pooled' WHERE id = ? AND status = 'open'")
            .bind(lot_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "UPDATE offers SET status = 'rejected' WHERE lot_id = ? AND status = 'pending'",
        )
        .bind(lot_id)
        .execute(&mut *tx)
        .await?;
    }
    let cid = insert_pledge(&mut tx, &p, member_id, qty, b.source_lot_id, "farmer", &day).await?;
    audit(
        &mut *tx,
        fpo_id,
        user.user_id,
        "pledge recorded",
        "pool",
        Some(id),
        format!(
            "farmer pledged {qty} q{}",
            b.source_lot_id
                .map(|l| format!(" from lot #{l}"))
                .unwrap_or_default()
        ),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": cid, "quantity_quintals": qty })))
}

/* -------------------------------------------------------------------------- */
/*                               announcements                                */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Serialize, FromRow)]
pub(crate) struct Announcement {
    id: i64,
    author_name: String,
    audience: String,
    fpo_id: Option<i64>,
    fpo_name: Option<String>,
    district: Option<String>,
    title: String,
    body: String,
    created_at: Option<String>,
}

const ANNOUNCEMENT_SELECT: &str =
    "SELECT a.id, u.name AS author_name, a.audience, a.fpo_id, o.name AS fpo_name,
    a.district, a.title, a.body, a.created_at
    FROM announcements a JOIN users u ON u.id = a.author_id
    LEFT JOIN fpo_organizations o ON o.id = a.fpo_id";

async fn fpo_announcements(
    State(pool): State<SqlitePool>,
    user: AuthUser,
) -> ApiResult<Vec<Announcement>> {
    let org = manager_org(&pool, &user).await?;
    let sql = format!("{ANNOUNCEMENT_SELECT} WHERE a.fpo_id = ? ORDER BY a.id DESC LIMIT 100");
    Ok(Json(
        sqlx::query_as::<_, Announcement>(&sql)
            .bind(org.id)
            .fetch_all(&pool)
            .await?,
    ))
}

#[derive(Deserialize)]
struct AnnouncementBody {
    title: String,
    body: String,
}

async fn post_fpo_announcement(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<AnnouncementBody>,
) -> ApiResult<Value> {
    let org = manager_org(&pool, &user).await?;
    let title = text(&b.title, "Title", 3, 120)?;
    let body = text(&b.body, "Message", 3, 2000)?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO announcements (author_id, audience, fpo_id, title, body) VALUES (?, 'fpo_members', ?, ?, ?) RETURNING id",
    )
    .bind(user.user_id)
    .bind(org.id)
    .bind(&title)
    .bind(&body)
    .fetch_all(&pool)
    .await
    .and_then(|mut rows| rows.pop().ok_or(sqlx::Error::RowNotFound))?;
    audit(
        &pool,
        org.id,
        user.user_id,
        "announcement posted",
        "announcement",
        Some(id),
        title,
    )
    .await?;
    Ok(Json(json!({ "id": id })))
}

/// Announcements for the signed-in user, by role, FPO membership and district.
async fn my_announcements(
    State(pool): State<SqlitePool>,
    user: AuthUser,
) -> ApiResult<Vec<Announcement>> {
    let filter = match user.role.as_str() {
        "farmer" => "(a.audience IN ('all', 'all_farmers')
                AND (a.district IS NULL OR lower(a.district) = lower(COALESCE((SELECT location FROM farmers WHERE id = ?1), ''))))
             OR (a.audience = 'fpo_members' AND a.fpo_id IN
                (SELECT fpo_id FROM fpo_members WHERE user_id = ?1 AND status = 'active'))",
        "buyer" => "a.audience IN ('all', 'all_buyers') AND ?1 = ?1",
        "fpo" => "(a.audience IN ('all', 'all_fpos') AND (a.district IS NULL OR lower(a.district) =
                lower(COALESCE((SELECT district FROM fpo_organizations WHERE manager_user_id = ?1), ''))))
             OR a.fpo_id = (SELECT id FROM fpo_organizations WHERE manager_user_id = ?1)",
        _ => "?1 = ?1",
    };
    let sql = format!("{ANNOUNCEMENT_SELECT} WHERE {filter} ORDER BY a.id DESC LIMIT 50");
    Ok(Json(
        sqlx::query_as::<_, Announcement>(&sql)
            .bind(user.user_id)
            .fetch_all(&pool)
            .await?,
    ))
}

/* -------------------------------------------------------------------------- */
/*                       dashboard: buyer demand highlights                   */
/* -------------------------------------------------------------------------- */

/// Open buyer requirements for crops this FPO pools or stocks, with what the FPO can supply.
pub(crate) async fn demand_highlights(
    pool: &SqlitePool,
    fpo_id: i64,
) -> Result<Vec<Value>, AppError> {
    type Row1118 = (String, String, f64, f64, String, String, String, f64, f64);
    let rows: Vec<Row1118> = sqlx::query_as(
        "SELECT u.name, c.name, d.min_quantity, d.max_price, d.required_quality, d.delivery_location, d.required_by,
            CAST(COALESCE((SELECT SUM(x.quantity_quintals) FROM fpo_contributions x JOIN fpo_pools p ON p.id = x.pool_id
                WHERE p.fpo_id = ?1 AND p.crop_id = d.crop_id AND p.status IN ('collecting', 'locked')
                AND x.status IN ('pending', 'approved')), 0) AS REAL),
            CAST(COALESCE((SELECT SUM(l.total_quintals - l.reserved_quintals - l.sold_quintals) FROM fpo_lots l
                WHERE l.fpo_id = ?1 AND l.crop_id = d.crop_id), 0) AS REAL)
         FROM buyer_demand d JOIN users u ON u.id = d.buyer_id JOIN crops c ON c.id = d.crop_id
         WHERE d.status = 'open' AND date(d.required_by) >= date('now')
           AND (d.crop_id IN (SELECT crop_id FROM fpo_pools WHERE fpo_id = ?1 AND status <> 'cancelled')
                OR d.crop_id IN (SELECT crop_id FROM fpo_lots WHERE fpo_id = ?1)
                OR instr(lower((SELECT primary_crops FROM fpo_organizations WHERE id = ?1)), lower(c.name)) > 0)
         ORDER BY d.required_by LIMIT 5",
    )
    .bind(fpo_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| json!({
        "buyer": r.0, "crop": r.1, "quantity_quintals": r.2, "max_price": r.3, "quality": r.4,
        "location": r.5, "required_by": r.6, "pledged_quintals": r2(r.7), "in_stock_quintals": r2(r.8),
        "can_cover": r.7 + r.8 + EPS >= r.2,
    })).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pool_transitions() {
        assert_eq!(next_pool_status("draft", "open"), Ok("collecting"));
        assert_eq!(next_pool_status("collecting", "lock"), Ok("locked"));
        assert_eq!(next_pool_status("locked", "reopen"), Ok("collecting"));
        assert_eq!(next_pool_status("locked", "list"), Ok("listed"));
        assert_eq!(next_pool_status("collecting", "cancel"), Ok("cancelled"));
        // Not allowed
        assert!(next_pool_status("draft", "list").is_err());
        assert!(next_pool_status("collecting", "list").is_err());
        assert!(next_pool_status("listed", "cancel").is_err());
        assert!(next_pool_status("listed", "lock").is_err());
        assert!(next_pool_status("cancelled", "open").is_err());
    }

    fn row(id: i64, q: f64, g: Option<&str>) -> ShareIn {
        ShareIn {
            contribution_id: id,
            member_id: id,
            member_name: format!("F{id}"),
            quantity: q,
            grade: g.map(str::to_string),
        }
    }

    #[test]
    fn equal_grades_split_by_quantity() {
        let out = split_sale(
            &[
                row(1, 20.0, Some("A")),
                row(2, 30.0, Some("A")),
                row(3, 50.0, Some("A")),
            ],
            &SaleTerms {
                quantity: 100.0,
                amount: 250_000.0,
                transport: 4_000.0,
                storage: 1_000.0,
                handling: 1_000.0,
                commission_pct: 2.0,
            },
        );
        assert_eq!(out[0].gross, 50_000.0);
        assert_eq!(out[0].freight_share, 800.0);
        assert_eq!(out[0].storage_handling_share, 400.0);
        assert_eq!(out[0].commission, 1_000.0);
        assert_eq!(out[0].net, 47_800.0);
        assert_eq!(out.iter().map(|o| o.gross).sum::<f64>(), 250_000.0);
    }

    #[test]
    fn lower_grades_earn_less_and_total_is_exact() {
        let out = split_sale(
            &[row(1, 50.0, Some("A")), row(2, 50.0, Some("C"))],
            &SaleTerms {
                quantity: 100.0,
                amount: 100_000.0,
                transport: 0.0,
                storage: 0.0,
                handling: 0.0,
                commission_pct: 0.0,
            },
        );
        // Weights 50 and 42.5 → A gets 100000 × 50/92.5
        assert!(out[0].gross > out[1].gross);
        assert!((out[0].gross - 54_054.05).abs() < 0.02);
        assert_eq!(r2(out[0].gross + out[1].gross), 100_000.0);
        // Freight is shared by quantity, not grade.
        let with_freight = split_sale(
            &[row(1, 50.0, Some("A")), row(2, 50.0, Some("C"))],
            &SaleTerms {
                quantity: 100.0,
                amount: 100_000.0,
                transport: 1_000.0,
                storage: 0.0,
                handling: 0.0,
                commission_pct: 0.0,
            },
        );
        assert_eq!(with_freight[0].freight_share, with_freight[1].freight_share);
    }

    #[test]
    fn partial_sale_reports_sold_quantity() {
        let out = split_sale(
            &[row(1, 40.0, None), row(2, 60.0, None)],
            &SaleTerms {
                quantity: 50.0,
                amount: 125_000.0,
                transport: 0.0,
                storage: 0.0,
                handling: 0.0,
                commission_pct: 0.0,
            },
        );
        assert_eq!(out[0].quantity_quintals, 20.0);
        assert_eq!(out[1].quantity_quintals, 30.0);
        assert_eq!(out[0].gross, 50_000.0);
    }

    #[test]
    fn empty_lot_gives_no_rows() {
        assert!(split_sale(
            &[],
            &SaleTerms {
                quantity: 1.0,
                amount: 1.0,
                transport: 0.0,
                storage: 0.0,
                handling: 0.0,
                commission_pct: 0.0
            }
        )
        .is_empty());
    }
}
