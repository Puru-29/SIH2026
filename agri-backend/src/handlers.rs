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
        AuthResponse, CreateBuyerDemandRequest, CreateLotRequest, CreateOfferRequest,
        LiveMandiPricesQuery, LoginRequest, NetRealisationRequest, NetRealisationResponse,
        RegisterFarmerRequest, SmartSaleRequest, SmartSaleResponse, Transaction,
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
        Err(AppError::Unauthorized(format!(
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
    let user = db::register_farmer(
        &pool,
        &payload.name,
        &payload.phone,
        &payload.pin,
        &payload.role,
    )
    .await?;
    Ok(Json(AuthResponse {
        user_id: user.id,
        role: user.role,
        name: user.name,
    }))
}

pub async fn login_farmer(
    State(pool): State<SqlitePool>,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    payload.validate()?;
    let user = db::authenticate_farmer(&pool, &payload.phone, &payload.pin, &payload.role).await?;
    Ok(Json(AuthResponse {
        user_id: user.id,
        role: user.role,
        name: user.name,
    }))
}

pub async fn get_crops(
    State(pool): State<SqlitePool>,
) -> Result<Json<Vec<crate::models::Crop>>, AppError> {
    Ok(Json(db::get_crops(&pool).await?))
}

pub async fn get_lots(
    State(pool): State<SqlitePool>,
    auth_user: AuthUser,
) -> Result<Json<Vec<crate::models::Lot>>, AppError> {
    require_role(&pool, auth_user.user_id, &["farmer", "buyer"]).await?;
    let role = db::get_user_role(&pool, auth_user.user_id)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".into()))?;
    Ok(Json(
        db::get_lots_for_user(&pool, auth_user.user_id, &role).await?,
    ))
}

pub async fn get_offers(
    State(pool): State<SqlitePool>,
    auth_user: AuthUser,
) -> Result<Json<Vec<crate::models::Offer>>, AppError> {
    require_role(&pool, auth_user.user_id, &["farmer", "buyer"]).await?;
    let role = db::get_user_role(&pool, auth_user.user_id)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".into()))?;
    Ok(Json(
        db::get_offers_for_user(&pool, auth_user.user_id, &role).await?,
    ))
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
    Ok(Json(
        db::get_buyer_demands_for_user(&pool, auth_user.user_id).await?,
    ))
}

pub async fn delete_buyer_demand(
    State(pool): State<SqlitePool>,
    auth_user: AuthUser,
    Path(demand_id): Path<i64>,
) -> Result<StatusCode, AppError> {
    require_role(&pool, auth_user.user_id, &["buyer"]).await?;
    db::delete_buyer_demand(&pool, auth_user.user_id, demand_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_live_mandi_prices(
    Query(params): Query<LiveMandiPricesQuery>,
) -> Result<Json<Vec<crate::models::LiveMandiPrice>>, AppError> {
    params.validate()?;
    let prices =
        crate::services::mandi::fetch_prices(params.state.as_deref(), params.commodity.as_deref())
            .await?;
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
    let lot = db::create_lot(&pool, auth_user.user_id, &payload).await?;
    Ok(Json(lot))
}

pub async fn get_matching_buyers(
    State(pool): State<SqlitePool>,
    Path(lot_id): Path<i64>,
) -> Result<Json<Vec<crate::models::BuyerDemand>>, AppError> {
    let lot = db::get_lot(&pool, lot_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Lot not found: id={lot_id}")))?;

    let demands = db::get_matching_demands(&pool, &lot).await?;
    Ok(Json(demands))
}

pub async fn create_offer(
    State(pool): State<SqlitePool>,
    auth_user: AuthUser,
    Json(payload): Json<CreateOfferRequest>,
) -> Result<Json<crate::models::Offer>, AppError> {
    payload.validate()?;
    let role = db::get_user_role(&pool, auth_user.user_id)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".into()))?;
    require_role(&pool, auth_user.user_id, &["buyer", "farmer"]).await?;
    let offer = db::create_offer(&pool, auth_user.user_id, &role, &payload).await?;
    Ok(Json(offer))
}

pub async fn accept_offer(
    State(pool): State<SqlitePool>,
    auth_user: AuthUser,
    Path(offer_id): Path<i64>,
) -> Result<Json<Transaction>, AppError> {
    let role = db::get_user_role(&pool, auth_user.user_id)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".into()))?;
    require_role(&pool, auth_user.user_id, &["farmer", "buyer"]).await?;
    let transaction = db::accept_offer(&pool, offer_id, auth_user.user_id, &role).await?;
    Ok(Json(transaction))
}

pub async fn get_transaction(
    State(pool): State<SqlitePool>,
    Path(transaction_id): Path<i64>,
) -> Result<Json<Transaction>, AppError> {
    let tx = db::get_transaction(&pool, transaction_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Transaction not found: id={transaction_id}")))?;
    Ok(Json(tx))
}

pub async fn get_transactions(
    State(pool): State<SqlitePool>,
    auth_user: AuthUser,
) -> Result<Json<Vec<Transaction>>, AppError> {
    require_role(&pool, auth_user.user_id, &["farmer", "buyer"]).await?;
    Ok(Json(
        db::get_transactions_for_user(&pool, auth_user.user_id).await?,
    ))
}
