use crate::errors::AppError;
use crate::models::{BuyerDemand, CreateLotRequest, Crop, Lot, Market};
use sqlx::SqlitePool;

// Runtime sqlx queries instead of query! macros — avoids needing a live DB at compile time.

/// Details collected at registration: district/state for farmers and FPOs, the rest for FPOs.
#[derive(Default)]
pub struct FpoSignup<'a> {
    pub registration_no: Option<&'a str>,
    pub district: Option<&'a str>,
    pub state: Option<&'a str>,
    pub primary_crops: Option<&'a str>,
}

pub async fn register_farmer(
    pool: &SqlitePool,
    name: &str,
    phone: &str,
    pin: &str,
    role: &str,
    fpo: FpoSignup<'_>,
) -> Result<crate::models::User, AppError> {
    // Admins are never self-registered; they are created from ADMIN_PHONE/ADMIN_PIN.
    if !matches!(role, "farmer" | "buyer" | "fpo") {
        return Err(AppError::BadRequest(
            "Only farmer, buyer and FPO accounts can be created".into(),
        ));
    }
    // Farmers must say where they farm: it drives FPO search, freight and mandi prices.
    let farmer_location = if role == "farmer" {
        Some(crate::admin::farmer_location(fpo.district, fpo.state)?)
    } else {
        None
    };
    // FPOs wait for admin verification before they can use the portal.
    let status = if role == "fpo" { "pending" } else { "active" };
    let pin_hash = crate::auth::hash_pin(pin);
    let mut tx = pool.begin().await?;
    let user = sqlx::query_as::<_, crate::models::User>(
        "INSERT INTO users (name, role, phone_number, pin_hash, status)
         VALUES (?, ?, ?, ?, ?)
         RETURNING id, name, role, phone_number, created_at, pin_hash, status",
    )
    .bind(name.trim())
    .bind(role)
    .bind(phone)
    .bind(pin_hash)
    .bind(status)
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| match error {
        sqlx::Error::Database(db_error) if db_error.message().contains("UNIQUE") => {
            AppError::BadRequest("An account already exists for this phone number".into())
        }
        other => AppError::from(other),
    })?;

    if role == "farmer" {
        sqlx::query("INSERT INTO farmers (id, location, urgency_level) VALUES (?, ?, 'medium')")
            .bind(user.id)
            .bind(&farmer_location)
            .execute(&mut *tx)
            .await?;
    } else if role == "fpo" {
        crate::fpo::create_org_for_manager(&mut *tx, user.id, &user.name, &user.phone_number, &fpo)
            .await?;
    } else {
        sqlx::query("INSERT INTO buyers (id, trust_score, is_verified) VALUES (?, 5.0, 0)")
            .bind(user.id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(user)
}

pub async fn authenticate_farmer(
    pool: &SqlitePool,
    phone: &str,
    pin: &str,
    role: &str,
) -> Result<crate::models::User, AppError> {
    let wrong = || {
        AppError::Unauthorized("No account was found for this role, phone number, or PIN".into())
    };
    let user = sqlx::query_as::<_, crate::models::User>(
        "SELECT id, name, role, phone_number, created_at, pin_hash, status
         FROM users WHERE phone_number = ? AND role = ?",
    )
    .bind(phone)
    .bind(role)
    .fetch_optional(pool)
    .await?
    .ok_or_else(wrong)?;
    let stored = user.pin_hash.as_deref().ok_or_else(wrong)?;
    let (ok, needs_rehash) = crate::auth::verify_pin(pin, stored);
    if !ok {
        return Err(wrong());
    }
    if user.status == "suspended" {
        return Err(AppError::Forbidden(
            "This account is suspended. Contact the AgriSense administrator.".into(),
        ));
    }
    // Upgrade old unsalted SHA-256 hashes to argon2 on successful sign-in.
    if needs_rehash {
        sqlx::query("UPDATE users SET pin_hash = ? WHERE id = ?")
            .bind(crate::auth::hash_pin(pin))
            .bind(user.id)
            .execute(pool)
            .await?;
    }
    Ok(user)
}

pub async fn get_market(pool: &SqlitePool, market_id: i64) -> Result<Option<Market>, sqlx::Error> {
    sqlx::query_as::<_, Market>("SELECT id, name, location FROM markets WHERE id = ?")
        .bind(market_id)
        .fetch_optional(pool)
        .await
}

pub async fn create_buyer_demand(
    pool: &SqlitePool,
    buyer_id: i64,
    req: &crate::models::CreateBuyerDemandRequest,
) -> Result<BuyerDemand, sqlx::Error> {
    sqlx::query_as::<_, BuyerDemand>(
        "INSERT INTO buyer_demand
         (buyer_id, crop_id, min_quantity, max_price, required_quality, delivery_location, required_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING id, buyer_id, crop_id, min_quantity, max_price, required_quality, delivery_location, required_by",
    )
    .bind(buyer_id)
    .bind(req.crop_id)
    .bind(req.min_quantity)
    .bind(req.max_price)
    .bind(&req.required_quality)
    .bind(&req.delivery_location)
    .bind(&req.required_by)
    .fetch_all(pool)
    .await
    .and_then(|mut rows| rows.pop().ok_or(sqlx::Error::RowNotFound))
}

// Default 50/qtl if the route isn't in the table.
pub async fn get_transport_cost(
    pool: &SqlitePool,
    from: &str,
    to: &str,
) -> Result<f64, sqlx::Error> {
    let row = sqlx::query_as::<_, (f64,)>(
        "SELECT cost_per_quintal FROM transport_costs
         WHERE from_location = ? AND to_location = ?",
    )
    .bind(from)
    .bind(to)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(c,)| c).unwrap_or(50.0))
}

// Default 2/qtl/day if nothing's configured for this mandi.
pub async fn get_storage_cost(pool: &SqlitePool, market_id: i64) -> Result<f64, sqlx::Error> {
    let row = sqlx::query_as::<_, (f64,)>(
        "SELECT cost_per_quintal_per_day FROM storage_facilities WHERE market_id = ?",
    )
    .bind(market_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(c,)| c).unwrap_or(2.0))
}

pub async fn get_user_role(pool: &SqlitePool, user_id: i64) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query_as::<_, (String,)>("SELECT role FROM users WHERE id = ?")
        .bind(user_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|(role,)| role))
}

pub async fn get_crop(pool: &SqlitePool, crop_id: i64) -> Result<Crop, sqlx::Error> {
    sqlx::query_as::<_, Crop>("SELECT id, name, perishability_days FROM crops WHERE id = ?")
        .bind(crop_id)
        .fetch_one(pool)
        .await
}

pub async fn get_crops(pool: &SqlitePool) -> Result<Vec<Crop>, sqlx::Error> {
    sqlx::query_as::<_, Crop>("SELECT id, name, perishability_days FROM crops ORDER BY name")
        .fetch_all(pool)
        .await
}

/// Rough shelf life (days) for a commodity name, used when a farmer adds a crop
/// from the Mandi catalogue that is not yet in our table.
fn estimate_perishability_days(name: &str) -> i64 {
    let n = name.to_lowercase();
    let has = |keys: &[&str]| keys.iter().any(|k| n.contains(k));
    if has(&[
        "leaf",
        "coriander",
        "methi",
        "spinach",
        "palak",
        "mint",
        "flower",
        "mushroom",
        "fish",
        "milk",
        "curry",
    ]) {
        2
    } else if has(&[
        "tomato",
        "brinjal",
        "okra",
        "bhindi",
        "ladies",
        "gourd",
        "cucumber",
        "capsicum",
        "chilli green",
        "green chilli",
        "beans",
        "peas",
        "cauliflower",
        "cabbage",
        "banana",
        "grapes",
        "papaya",
        "mango",
        "guava",
        "strawberry",
        "lemon",
        "drumstick",
        "tinda",
        "pumpkin",
        "radish",
        "carrot",
        "beetroot",
    ]) {
        7
    } else if has(&[
        "apple",
        "orange",
        "pomegranate",
        "mosambi",
        "pineapple",
        "sweet lime",
        "water melon",
        "watermelon",
        "musk",
    ]) {
        21
    } else if has(&[
        "onion",
        "potato",
        "garlic",
        "ginger",
        "sweet potato",
        "yam",
        "colacasia",
        "tapioca",
    ]) {
        45
    } else {
        // Grains, pulses, oilseeds, spices, fibre and other dry produce.
        180
    }
}

/// Returns an existing crop by name (case-insensitive). Only admins add crops.
pub async fn find_crop(pool: &SqlitePool, name: &str) -> Result<Crop, AppError> {
    sqlx::query_as::<_, Crop>(
        "SELECT id, name, perishability_days FROM crops WHERE lower(name) = lower(?)",
    )
    .bind(name.trim())
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        AppError::BadRequest(format!(
            "{} is not in the crop list. Pick a crop from the list, or use \"Request a crop\" to ask the admin to add it.",
            name.trim()
        ))
    })
}

/// Admin-only: find-or-create inside an open transaction.
pub async fn find_or_create_crop_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    name: &str,
) -> Result<Crop, sqlx::Error> {
    let name = name.trim();
    sqlx::query_as::<_, Crop>(
        "INSERT INTO crops (name, perishability_days) VALUES (?, ?)
         ON CONFLICT(name) DO UPDATE SET name = name
         RETURNING id, name, perishability_days",
    )
    .bind(name)
    .bind(estimate_perishability_days(name))
    .fetch_one(&mut **tx)
    .await
}

/// Returns the crop with this name (case-insensitive), creating it if needed. Admin only.
pub async fn find_or_create_crop(pool: &SqlitePool, name: &str) -> Result<Crop, sqlx::Error> {
    let name = name.trim();
    if let Some(crop) = sqlx::query_as::<_, Crop>(
        "SELECT id, name, perishability_days FROM crops WHERE lower(name) = lower(?)",
    )
    .bind(name)
    .fetch_optional(pool)
    .await?
    {
        return Ok(crop);
    }
    sqlx::query_as::<_, Crop>(
        "INSERT INTO crops (name, perishability_days) VALUES (?, ?)
         ON CONFLICT(name) DO UPDATE SET name = excluded.name
         RETURNING id, name, perishability_days",
    )
    .bind(name)
    .bind(estimate_perishability_days(name))
    .fetch_all(pool)
    .await
    .and_then(|mut rows| rows.pop().ok_or(sqlx::Error::RowNotFound))
}

pub async fn get_lot(pool: &SqlitePool, lot_id: i64) -> Result<Option<Lot>, sqlx::Error> {
    sqlx::query_as::<_, Lot>(
        "SELECT id, farmer_id, crop_id, quantity_quintals, expected_quality, status
         FROM lots WHERE id = ?",
    )
    .bind(lot_id)
    .fetch_optional(pool)
    .await
}

pub async fn create_lot(
    pool: &SqlitePool,
    farmer_id: i64,
    req: &CreateLotRequest,
) -> Result<Lot, sqlx::Error> {
    sqlx::query_as::<_, Lot>(
        "INSERT INTO lots (farmer_id, crop_id, quantity_quintals, expected_quality, status)
         VALUES (?, ?, ?, ?, 'open')
         RETURNING id, farmer_id, crop_id, quantity_quintals, expected_quality, status",
    )
    .bind(farmer_id)
    .bind(req.crop_id)
    .bind(req.quantity_quintals)
    .bind(&req.expected_quality)
    // fetch_all steps the statement to completion so the insert is committed
    // before the next query (fetch_one can leave it open on another connection).
    .fetch_all(pool)
    .await?
    .pop()
    .ok_or(sqlx::Error::RowNotFound)
}

/// Candidate buyer requirements for a lot: same crop, open, deadline not passed,
/// buyer account active. Ranking happens in `services::matcher`.
pub async fn get_matching_demands(
    pool: &SqlitePool,
    lot: &Lot,
) -> Result<Vec<crate::services::matcher::Candidate>, sqlx::Error> {
    type Row = (
        i64,
        i64,
        String,
        i64,
        f64,
        f64,
        String,
        String,
        String,
        i64,
        f64,
        f64,
    );
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT d.id, d.buyer_id, u.name, d.crop_id, d.min_quantity, d.max_price,
                d.required_quality, d.delivery_location, d.required_by,
                COALESCE(b.is_verified, 0), CAST(COALESCE(b.trust_score, 0) AS REAL),
                CAST(julianday(d.required_by) - julianday('now') AS REAL)
         FROM buyer_demand d
         JOIN users u ON u.id = d.buyer_id
         LEFT JOIN buyers b ON b.id = d.buyer_id
         WHERE d.crop_id = ? AND d.status = 'open'
           AND d.required_by >= datetime('now') AND u.status = 'active'",
    )
    .bind(lot.crop_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| crate::services::matcher::Candidate {
            demand_id: r.0,
            buyer_id: r.1,
            buyer_name: r.2,
            crop_id: r.3,
            min_quantity: r.4,
            max_price: r.5,
            required_quality: r.6,
            delivery_location: r.7,
            required_by: r.8,
            verified: r.9 == 1,
            trust_score: r.10,
            freight_per_quintal: None,
            days_left: r.11,
        })
        .collect())
}

pub async fn get_buyer_prices(
    pool: &SqlitePool,
) -> Result<Vec<crate::models::BuyerPrice>, sqlx::Error> {
    sqlx::query_as::<_, crate::models::BuyerPrice>(
        "SELECT d.id,
                d.buyer_id,
                u.name AS buyer_name,
                d.crop_id,
                c.name AS crop_name,
                d.max_price AS price_per_quintal,
                d.max_price / 100.0 AS price_per_kg,
                d.min_quantity AS min_quantity_quintals,
                d.required_quality AS quality,
                d.delivery_location,
                d.required_by,
                d.status
         FROM buyer_demand d
         JOIN users u ON u.id = d.buyer_id
         JOIN crops c ON c.id = d.crop_id
         WHERE d.is_demo = 0 AND d.status = 'open'
         ORDER BY d.max_price DESC, d.required_by ASC",
    )
    .fetch_all(pool)
    .await
}

pub async fn get_buyer_demands_for_user(
    pool: &SqlitePool,
    buyer_id: i64,
) -> Result<Vec<crate::models::BuyerPrice>, sqlx::Error> {
    sqlx::query_as::<_, crate::models::BuyerPrice>(
        "SELECT d.id, d.buyer_id, u.name AS buyer_name, d.crop_id, c.name AS crop_name,
                d.max_price AS price_per_quintal, d.max_price / 100.0 AS price_per_kg,
                d.min_quantity AS min_quantity_quintals, d.required_quality AS quality,
                d.delivery_location, d.required_by, d.status
         FROM buyer_demand d
         JOIN users u ON u.id = d.buyer_id
         JOIN crops c ON c.id = d.crop_id
         WHERE d.buyer_id = ?
         ORDER BY d.id DESC",
    )
    .bind(buyer_id)
    .fetch_all(pool)
    .await
}
