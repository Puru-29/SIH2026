use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use sqlx::SqlitePool;
use validator::Validate;

use crate::{
    auth::AuthUser,
    db,
    errors::AppError,
    models::{
        AuthResponse, CreateBuyerDemandRequest, CreateCropRequest, CreateLotRequest,
        LiveMandiPricesQuery, LoginRequest, NetRealisationRequest, NetRealisationResponse,
        RegisterFarmerRequest, SmartSaleRequest, SmartSaleResponse,
    },
    services::{advisor::evaluate_smart_sale, calculator::calculate_net_realisation},
};

async fn require_role(pool: &SqlitePool, user_id: i64, allowed: &[&str]) -> Result<(), AppError> {
    let role = db::get_user_role(pool, user_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("User not found: id={user_id}")))?;

    if allowed.contains(&role.as_str()) {
        Ok(())
    } else {
        Err(AppError::Forbidden(format!(
            "This action requires role {allowed:?}; user {user_id} has role '{role}'"
        )))
    }
}

pub async fn get_health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

pub async fn register_farmer(
    State(pool): State<SqlitePool>,
    Json(payload): Json<RegisterFarmerRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    payload.validate()?;
    if payload.role == "fpo"
        && payload
            .registration_no
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
    {
        return Err(AppError::BadRequest(
            "FPO registration number is required".into(),
        ));
    }
    let user = db::register_farmer(
        &pool,
        &payload.name,
        &payload.phone,
        &payload.pin,
        &payload.role,
        db::FpoSignup {
            registration_no: payload.registration_no.as_deref(),
            district: payload.district.as_deref(),
            state: payload.state.as_deref(),
            primary_crops: payload.primary_crops.as_deref(),
        },
    )
    .await?;
    let token = crate::auth::create_session(&pool, user.id).await?;
    Ok(Json(AuthResponse {
        user_id: user.id,
        role: user.role,
        name: user.name,
        status: user.status,
        token: Some(token),
    }))
}

pub async fn login_farmer(
    State(pool): State<SqlitePool>,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    payload.validate()?;
    let user = db::authenticate_farmer(&pool, &payload.phone, &payload.pin, &payload.role).await?;
    let token = crate::auth::create_session(&pool, user.id).await?;
    Ok(Json(AuthResponse {
        user_id: user.id,
        role: user.role,
        name: user.name,
        status: user.status,
        token: Some(token),
    }))
}

/// Ends the current session.
pub async fn logout(
    State(pool): State<SqlitePool>,
    headers: axum::http::HeaderMap,
) -> Result<StatusCode, AppError> {
    let token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
        .unwrap_or("");
    if !token.is_empty() {
        crate::auth::delete_session(&pool, token).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

/// The signed-in user, with role and status from the database.
pub async fn me(auth_user: AuthUser) -> Json<AuthResponse> {
    Json(AuthResponse {
        user_id: auth_user.user_id,
        role: auth_user.role,
        name: auth_user.name,
        status: auth_user.status,
        token: None,
    })
}

pub async fn get_crops(
    State(pool): State<SqlitePool>,
) -> Result<Json<Vec<crate::models::Crop>>, AppError> {
    Ok(Json(db::get_crops(&pool).await?))
}

/// Adds a crop (typically a Mandi API commodity) to the catalogue, or returns
/// the existing one with the same name.
pub async fn create_crop(
    State(pool): State<SqlitePool>,
    auth_user: AuthUser,
    Json(payload): Json<CreateCropRequest>,
) -> Result<Json<crate::models::Crop>, AppError> {
    payload.validate()?;
    if payload.name.trim().is_empty() {
        return Err(AppError::BadRequest("Crop name is required".into()));
    }
    // Crops are master data: only admins add them (others send a crop request).
    require_role(&pool, auth_user.user_id, &["admin"]).await?;
    let crop = db::find_or_create_crop(&pool, &payload.name).await?;
    crate::admin::log(
        &pool,
        auth_user.user_id,
        "crops.create",
        "crops",
        Some(crop.id),
        serde_json::json!({ "name": crop.name }),
    )
    .await?;
    Ok(Json(crop))
}

pub async fn create_buyer_demand(
    State(pool): State<SqlitePool>,
    auth_user: AuthUser,
    Json(payload): Json<CreateBuyerDemandRequest>,
) -> Result<Json<crate::models::BuyerDemand>, AppError> {
    payload.validate()?;
    require_role(&pool, auth_user.user_id, &["buyer"]).await?;
    Ok(Json(
        db::create_buyer_demand(&pool, auth_user.user_id, &payload).await?,
    ))
}

pub async fn get_buyer_demands(
    State(pool): State<SqlitePool>,
    auth_user: AuthUser,
) -> Result<Json<Vec<crate::models::BuyerPrice>>, AppError> {
    require_role(&pool, auth_user.user_id, &["buyer"]).await?;
    let counts = crate::market::matching_lot_counts(&pool, auth_user.user_id).await?;
    let mut list = db::get_buyer_demands_for_user(&pool, auth_user.user_id).await?;
    for d in &mut list {
        d.matching_lots = counts.get(&d.id).copied().unwrap_or(0);
    }
    Ok(Json(list))
}

pub async fn get_live_mandi_prices(
    State(pool): State<SqlitePool>,
    Query(params): Query<LiveMandiPricesQuery>,
) -> Result<Json<Vec<crate::models::LiveMandiPrice>>, AppError> {
    params.validate()?;
    let prices =
        crate::services::mandi::fetch_prices(params.state.as_deref(), params.commodity.as_deref())
            .await?;
    // Save the day's prices so the forecast builds up its own history.
    crate::market::record_prices(&pool, &prices).await;
    Ok(Json(prices))
}

pub async fn get_mandi_states() -> Result<Json<Vec<String>>, AppError> {
    Ok(Json(crate::services::mandi::fetch_states().await?))
}

pub async fn get_mandi_commodities(
    Query(params): Query<LiveMandiPricesQuery>,
) -> Result<Json<Vec<String>>, AppError> {
    Ok(Json(
        crate::services::mandi::fetch_commodities(params.state.as_deref()).await?,
    ))
}

pub async fn get_buyer_prices(
    State(pool): State<SqlitePool>,
) -> Result<Json<Vec<crate::models::BuyerPrice>>, AppError> {
    Ok(Json(db::get_buyer_prices(&pool).await?))
}

pub async fn calculate_net_realisation_handler(
    State(pool): State<SqlitePool>,
    Json(payload): Json<NetRealisationRequest>,
) -> Result<Json<NetRealisationResponse>, AppError> {
    payload.validate()?;

    let crop = db::get_crop(&pool, payload.crop_id).await?;
    let current_price = crate::services::mandi::fetch_prices(None, Some(&crop.name))
        .await?
        .first()
        .map(|price| price.modal_price)
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "No live Mandi price found for crop '{}'",
                crop.name
            ))
        })?;

    let market = db::get_market(&pool, payload.market_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Market not found: id={}", payload.market_id)))?;

    let transport_cost =
        db::get_transport_cost(&pool, &payload.farmer_location, &market.location).await?;
    let storage_cost = db::get_storage_cost(&pool, payload.market_id).await?;

    let res = calculate_net_realisation(&payload, current_price, transport_cost, storage_cost);
    Ok(Json(res))
}

pub async fn evaluate_smart_sale_handler(
    State(pool): State<SqlitePool>,
    Json(payload): Json<SmartSaleRequest>,
) -> Result<Json<SmartSaleResponse>, AppError> {
    payload.validate()?;
    let crop = db::get_crop(&pool, payload.crop_id).await?;
    let res = evaluate_smart_sale(&payload, &crop);
    Ok(Json(res))
}

pub async fn create_lot(
    State(pool): State<SqlitePool>,
    auth_user: AuthUser,
    Json(payload): Json<CreateLotRequest>,
) -> Result<Json<crate::models::Lot>, AppError> {
    payload.validate()?;
    require_role(&pool, auth_user.user_id, &["farmer", "fpo"]).await?;
    // Buyers judge quality from live camera photos, so every new lot needs 1–3.
    if payload.photos.is_empty() {
        return Err(AppError::BadRequest(
            "Take at least one photo of the crop with the camera before listing the lot".into(),
        ));
    }
    if payload.photos.len() > crate::quality::MAX_PHOTOS_PER_LOT {
        return Err(AppError::BadRequest(format!(
            "A lot can have at most {} photos",
            crate::quality::MAX_PHOTOS_PER_LOT
        )));
    }
    let photos = payload
        .photos
        .iter()
        .map(crate::quality::check_photo)
        .collect::<Result<Vec<_>, _>>()?;
    let mut tx = pool.begin().await?;
    let lot = db::create_lot(&mut *tx, auth_user.user_id, &payload).await?;
    for p in &photos {
        crate::quality::insert_photo(&mut *tx, lot.id, auth_user.user_id, p).await?;
    }
    tx.commit().await?;
    if let Err(e) = crate::market::notify_matching_buyers(&pool, lot.id).await {
        tracing::warn!("could not notify buyers about lot {}: {e:?}", lot.id);
    }
    Ok(Json(lot))
}

/// Buyer requirements for a lot, best match first (see `services::matcher`).
/// Only the farmer who listed the lot (or an admin) can see them.
pub async fn get_matching_buyers(
    State(pool): State<SqlitePool>,
    auth_user: AuthUser,
    Path(lot_id): Path<i64>,
) -> Result<Json<Vec<crate::services::matcher::Ranked>>, AppError> {
    let lot = db::get_lot(&pool, lot_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Lot not found: id={lot_id}")))?;
    if lot.farmer_id != auth_user.user_id && auth_user.role != "admin" {
        return Err(AppError::Forbidden(
            "Only the farmer who listed this lot can see matching buyers".into(),
        ));
    }
    let mut candidates = db::get_matching_demands(&pool, &lot).await?;
    let origin: String =
        sqlx::query_scalar("SELECT COALESCE((SELECT location FROM farmers WHERE id = ?), '')")
            .bind(lot.farmer_id)
            .fetch_one(&pool)
            .await?;
    for c in &mut candidates {
        c.freight_per_quintal =
            crate::market::freight_per_quintal(&pool, &origin, &c.delivery_location).await?;
    }
    Ok(Json(crate::services::matcher::rank(
        lot.quantity_quintals,
        &lot.expected_quality,
        &candidates,
    )))
}
