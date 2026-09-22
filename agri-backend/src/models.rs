use serde::{Deserialize, Serialize};
use validator::Validate;

// DB row types — FromRow lets sqlx map columns straight into these.

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: i64,
    pub name: String,
    pub role: String,
    pub phone_number: String,
    pub created_at: String,
    pub pin_hash: Option<String>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct RegisterFarmerRequest {
    #[validate(length(min = 2, max = 100))]
    pub name: String,
    #[validate(regex(path = *PHONE_REGEX))]
    pub phone: String,
    #[validate(regex(path = *PIN_REGEX))]
    pub pin: String,
    pub role: String,
}

#[derive(Debug, Deserialize, Validate)]
pub struct LoginRequest {
    #[validate(regex(path = *PHONE_REGEX))]
    pub phone: String,
    #[validate(regex(path = *PIN_REGEX))]
    pub pin: String,
    pub role: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub user_id: i64,
    pub role: String,
    pub name: String,
}

static PHONE_REGEX: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| regex::Regex::new(r"^[0-9]{10}$").expect("valid phone regex"));
static PIN_REGEX: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| regex::Regex::new(r"^[0-9]{4}$").expect("valid PIN regex"));

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Farmer {
    pub id: i64,
    pub location: String,
    pub urgency_level: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Buyer {
    pub id: i64,
    pub trust_score: f64,
    // SQLite booleans are 0/1 integers.
    pub is_verified: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Crop {
    pub id: i64,
    pub name: String,
    pub perishability_days: i64,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Market {
    pub id: i64,
    pub name: String,
    pub location: String,
}

#[derive(Debug, Serialize)]
pub struct LiveMandiPrice {
    pub id: String,
    pub crop_name: String,
    pub state: String,
    pub district: Option<String>,
    pub market: String,
    pub variety: Option<String>,
    pub grade: Option<String>,
    pub min_price: f64,
    pub max_price: f64,
    pub modal_price: f64,
    pub price_per_kg: f64,
    pub date: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct BuyerDemand {
    pub id: i64,
    pub buyer_id: i64,
    pub crop_id: i64,
    pub min_quantity: f64,
    pub max_price: f64,
    pub required_quality: String,
    pub delivery_location: String,
    pub required_by: String,
}

#[derive(Debug, Deserialize, Validate)]
pub struct CreateBuyerDemandRequest {
    #[validate(range(min = 1))]
    pub crop_id: i64,
    #[validate(range(min = 0.01))]
    pub min_quantity: f64,
    #[validate(range(min = 0.01))]
    pub max_price: f64,
    #[validate(length(min = 1))]
    pub required_quality: String,
    #[validate(length(min = 1))]
    pub delivery_location: String,
    #[validate(length(min = 1))]
    pub required_by: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct BuyerPrice {
    pub id: i64,
    pub buyer_id: i64,
    pub buyer_name: String,
    pub crop_id: i64,
    pub crop_name: String,
    pub price_per_quintal: f64,
    pub price_per_kg: f64,
    pub min_quantity_quintals: f64,
    pub quality: String,
    pub delivery_location: String,
    pub required_by: String,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Lot {
    pub id: i64,
    pub farmer_id: i64,
    pub crop_id: i64,
    pub quantity_quintals: f64,
    pub expected_quality: String,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Offer {
    pub id: i64,
    pub lot_id: i64,
    pub buyer_id: i64,
    pub price_offered: f64,
    pub status: String,
    pub created_by_role: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Transaction {
    pub id: i64,
    pub offer_id: i64,
    pub final_price: f64,
    pub status: String,
    pub completed_at: String,
    pub crop_name: String,
    pub quantity_quintals: f64,
    pub buyer_name: String,
    pub farmer_name: String,
}

// API request/response types

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UrgencyLevel {
    High,
    Medium,
    Low,
}

#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct NetRealisationRequest {
    #[validate(range(min = 1))]
    pub crop_id: i64,
    #[validate(range(min = 1))]
    pub market_id: i64,
    #[validate(range(min = 0.01))]
    pub quantity_quintals: f64,
    #[validate(length(min = 1))]
    pub farmer_location: String,
    #[validate(range(min = 0.0))]
    pub handling_costs: f64,
    #[validate(range(min = 0.0))]
    pub expected_deductions: f64,
    #[validate(range(min = 0.0))]
    pub expected_storage_days: f64,
}

#[derive(Debug, Serialize)]
pub struct NetRealisationResponse {
    pub sale_price_total: f64,
    pub transport_cost_total: f64,
    pub storage_cost_total: f64,
    pub handling_costs: f64,
    pub expected_deductions: f64,
    pub net_realisation: f64,
}

#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct SmartSaleRequest {
    #[validate(range(min = 1))]
    pub crop_id: i64,
    #[validate(range(min = 0.01))]
    pub quantity_quintals: f64,
    #[validate(range(min = 0.01))]
    pub current_price_per_quintal: f64,
    #[validate(range(min = 0.01))]
    pub expected_future_price: f64,
    #[validate(range(min = 0.0))]
    pub storage_cost_per_day: f64,
    pub farmer_urgency: UrgencyLevel,
    #[validate(range(min = 0.0))]
    pub handling_costs: f64,
}

#[derive(Debug, Serialize, PartialEq)]
pub enum SmartSaleStrategy {
    #[serde(rename = "SELL_NOW")]
    SellNow,
    #[serde(rename = "WAIT")]
    Wait,
    #[serde(rename = "PARTIAL_SELL")]
    PartialSell,
}

#[derive(Debug, Serialize)]
pub struct SmartSaleResponse {
    pub strategy: SmartSaleStrategy,
    pub reason: String,
    pub immediate_net_realisation: f64,
    pub future_net_realisation: f64,
    // Share to sell now: 1.0 = all, 0.0 = none, 0.5 = half.
    pub suggested_sell_ratio: f64,
}

#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct CreateLotRequest {
    #[validate(range(min = 1))]
    pub crop_id: i64,
    #[validate(range(min = 0.01))]
    pub quantity_quintals: f64,
    #[validate(length(min = 1))]
    pub expected_quality: String,
}

#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct CreateOfferRequest {
    #[validate(range(min = 1))]
    pub lot_id: i64,
    #[validate(range(min = 0.01))]
    pub price_offered: f64,
    pub buyer_id: Option<i64>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct LiveMandiPricesQuery {
    pub state: Option<String>,
    pub commodity: Option<String>,
}
