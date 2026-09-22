use crate::errors::AppError;
use crate::models::{
    BuyerDemand, CreateLotRequest, CreateOfferRequest, Crop, Lot, Market, Offer, Transaction,
};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

// Runtime sqlx queries instead of query! macros — avoids needing a live DB at compile time.

fn hash_pin(pin: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(pin.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub async fn register_farmer(
    pool: &SqlitePool,
    name: &str,
    phone: &str,
    pin: &str,
    role: &str,
) -> Result<crate::models::User, AppError> {
    if !matches!(role, "farmer" | "buyer") {
        return Err(AppError::BadRequest(
            "Only farmer and buyer accounts can be created".into(),
        ));
    }
    let pin_hash = hash_pin(pin);
    let mut tx = pool.begin().await?;
    let user = sqlx::query_as::<_, crate::models::User>(
        "INSERT INTO users (name, role, phone_number, pin_hash)
         VALUES (?, ?, ?, ?)
         RETURNING id, name, role, phone_number, created_at, pin_hash",
    )
    .bind(name.trim())
    .bind(role)
    .bind(phone)
    .bind(pin_hash)
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| match error {
        sqlx::Error::Database(db_error) if db_error.message().contains("UNIQUE") => {
            AppError::BadRequest("An account already exists for this phone number".into())
        }
        other => AppError::from(other),
    })?;

    if role == "farmer" {
        sqlx::query(
            "INSERT INTO farmers (id, location, urgency_level) VALUES (?, 'Maharashtra', 'medium')",
        )
        .bind(user.id)
        .execute(&mut *tx)
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
    let user = sqlx::query_as::<_, crate::models::User>(
        "SELECT id, name, role, phone_number, created_at, pin_hash
         FROM users WHERE phone_number = ? AND role = ?
         AND pin_hash = ?",
    )
    .bind(phone)
    .bind(role)
    .bind(hash_pin(pin))
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        AppError::Unauthorized("No account was found for this role, phone number, or PIN".into())
    })?;
    Ok(user)
}

pub async fn get_market(pool: &SqlitePool, market_id: i64) -> Result<Option<Market>, sqlx::Error> {
    sqlx::query_as::<_, Market>("SELECT id, name, location FROM markets WHERE id = ?")
        .bind(market_id)
        .fetch_optional(pool)
        .await
}

pub async fn get_lots_for_user(
    pool: &SqlitePool,
    user_id: i64,
    role: &str,
) -> Result<Vec<Lot>, sqlx::Error> {
    let query = if role == "farmer" {
        "SELECT id, farmer_id, crop_id, quantity_quintals, expected_quality, status FROM lots WHERE farmer_id = ? ORDER BY created_at DESC"
    } else {
        "SELECT id, farmer_id, crop_id, quantity_quintals, expected_quality, status FROM lots WHERE status = 'open' ORDER BY created_at DESC"
    };
    sqlx::query_as::<_, Lot>(query)
        .bind(user_id)
        .fetch_all(pool)
        .await
}

pub async fn get_offers_for_user(
    pool: &SqlitePool,
    user_id: i64,
    role: &str,
) -> Result<Vec<Offer>, sqlx::Error> {
    let query = if role == "buyer" {
        "SELECT o.id, o.lot_id, o.buyer_id, o.price_offered, o.status, o.created_by_role FROM offers o WHERE o.buyer_id = ? ORDER BY o.id DESC"
    } else {
        "SELECT o.id, o.lot_id, o.buyer_id, o.price_offered, o.status, o.created_by_role
         FROM offers o
         JOIN lots l ON l.id = o.lot_id
         WHERE l.farmer_id = ? AND o.created_by_role = 'buyer'
         ORDER BY o.id DESC"
    };
    sqlx::query_as::<_, Offer>(query)
        .bind(user_id)
        .fetch_all(pool)
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
    .fetch_one(pool)
    .await
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
    .fetch_one(pool)
    .await
}

// Match on crop, quantity, quality, and deadline; best buyers first.
pub async fn get_matching_demands(
    pool: &SqlitePool,
    lot: &Lot,
) -> Result<Vec<BuyerDemand>, sqlx::Error> {
    sqlx::query_as::<_, BuyerDemand>(
        "SELECT d.id, d.buyer_id, d.crop_id, d.min_quantity, d.max_price,
                d.required_quality, d.delivery_location, d.required_by
         FROM buyer_demand d
         JOIN buyers b ON d.buyer_id = b.id
         WHERE d.crop_id = ?
           AND d.min_quantity <= ?
           AND d.required_quality = ?
           AND d.required_by >= datetime('now')
         ORDER BY b.trust_score DESC, d.max_price DESC",
    )
    .bind(lot.crop_id)
    .bind(lot.quantity_quintals)
    .bind(&lot.expected_quality)
    .fetch_all(pool)
    .await
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

pub async fn delete_buyer_demand(
    pool: &SqlitePool,
    buyer_id: i64,
    demand_id: i64,
) -> Result<(), AppError> {
    let result = sqlx::query("DELETE FROM buyer_demand WHERE id = ? AND buyer_id = ?")
        .bind(demand_id)
        .bind(buyer_id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Requirement not found".into()));
    }
    Ok(())
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

pub async fn create_offer(
    pool: &SqlitePool,
    actor_id: i64,
    actor_role: &str,
    req: &CreateOfferRequest,
) -> Result<Offer, AppError> {
    let lot = sqlx::query_as::<_, Lot>(
        "SELECT id, farmer_id, crop_id, quantity_quintals, expected_quality, status
         FROM lots WHERE id = ?",
    )
    .bind(req.lot_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Lot not found".into()))?;
    let buyer_id = if actor_role == "buyer" {
        actor_id
    } else {
        if lot.farmer_id != actor_id {
            return Err(AppError::Unauthorized(
                "Only the lot owner can send a farmer offer".into(),
            ));
        }
        req.buyer_id
            .ok_or_else(|| AppError::BadRequest("buyer_id is required for a farmer offer".into()))?
    };
    sqlx::query_as::<_, Offer>(
        "INSERT INTO offers (lot_id, buyer_id, price_offered, status, created_by_role)
         VALUES (?, ?, ?, 'pending', ?)
         RETURNING id, lot_id, buyer_id, price_offered, status, created_by_role",
    )
    .bind(req.lot_id)
    .bind(buyer_id)
    .bind(req.price_offered)
    .bind(actor_role)
    .fetch_one(pool)
    .await
    .map_err(AppError::from)
}

// Accepts a pending offer, closes the lot, creates the transaction.
pub async fn accept_offer(
    pool: &SqlitePool,
    offer_id: i64,
    actor_id: i64,
    actor_role: &str,
) -> Result<Transaction, AppError> {
    let mut tx = pool.begin().await?;

    let offer = sqlx::query_as::<_, Offer>(
        "SELECT id, lot_id, buyer_id, price_offered, status, created_by_role FROM offers WHERE id = ?",
    )
    .bind(offer_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Offer not found".to_string()))?;

    if offer.status != "pending" {
        return Err(AppError::BadRequest(format!(
            "Offer is already '{}' — only pending offers can be accepted",
            offer.status
        )));
    }

    let lot = sqlx::query_as::<_, Lot>(
        "SELECT id, farmer_id, crop_id, quantity_quintals, expected_quality, status
         FROM lots WHERE id = ?",
    )
    .bind(offer.lot_id)
    .fetch_one(&mut *tx)
    .await?;

    if actor_role == "farmer" && lot.farmer_id != actor_id {
        return Err(AppError::Unauthorized(
            "Only the farmer who owns this lot can accept offers".to_string(),
        ));
    }
    if actor_role == "buyer" && offer.buyer_id != actor_id {
        return Err(AppError::Unauthorized(
            "Only the buyer who received this offer can accept it".to_string(),
        ));
    }
    let expected_acceptor = if offer.created_by_role == "buyer" {
        "farmer"
    } else {
        "buyer"
    };
    if actor_role != expected_acceptor {
        return Err(AppError::Unauthorized(format!(
            "This offer was created by the {0}; only the {1} can accept it",
            offer.created_by_role, expected_acceptor
        )));
    }

    let update_result =
        sqlx::query("UPDATE offers SET status = 'accepted' WHERE id = ? AND status = 'pending'")
            .bind(offer_id)
            .execute(&mut *tx)
            .await?;

    // Catch races where two requests accept the same offer.
    if update_result.rows_affected() == 0 {
        return Err(AppError::BadRequest(
            "Offer already processed — only pending offers can be accepted".to_string(),
        ));
    }

    sqlx::query("UPDATE lots SET status = 'sold' WHERE id = ?")
        .bind(lot.id)
        .execute(&mut *tx)
        .await?;

    let transaction_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO transactions (offer_id, final_price, status)
         VALUES (?, ?, 'completed')
         RETURNING id",
    )
    .bind(offer_id)
    .bind(offer.price_offered)
    .fetch_one(&mut *tx)
    .await?;

    let transaction = sqlx::query_as::<_, Transaction>(
        "SELECT t.id, t.offer_id, t.final_price, t.status, t.completed_at,
                c.name AS crop_name, l.quantity_quintals,
                buyer.name AS buyer_name, farmer.name AS farmer_name
         FROM transactions t
         JOIN offers o ON o.id = t.offer_id
         JOIN lots l ON l.id = o.lot_id
         JOIN crops c ON c.id = l.crop_id
         JOIN users buyer ON buyer.id = o.buyer_id
         JOIN users farmer ON farmer.id = l.farmer_id
         WHERE t.id = ?",
    )
    .bind(transaction_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(transaction)
}

pub async fn get_transaction(
    pool: &SqlitePool,
    transaction_id: i64,
) -> Result<Option<Transaction>, sqlx::Error> {
    sqlx::query_as::<_, Transaction>(
        "SELECT t.id, t.offer_id, t.final_price, t.status, t.completed_at,
                c.name AS crop_name, l.quantity_quintals,
                buyer.name AS buyer_name, farmer.name AS farmer_name
         FROM transactions t
         JOIN offers o ON o.id = t.offer_id
         JOIN lots l ON l.id = o.lot_id
         JOIN crops c ON c.id = l.crop_id
         JOIN users buyer ON buyer.id = o.buyer_id
         JOIN users farmer ON farmer.id = l.farmer_id
         WHERE t.id = ?",
    )
    .bind(transaction_id)
    .fetch_optional(pool)
    .await
}

pub async fn get_transactions_for_user(
    pool: &SqlitePool,
    user_id: i64,
) -> Result<Vec<Transaction>, sqlx::Error> {
    sqlx::query_as::<_, Transaction>(
        "SELECT t.id, t.offer_id, t.final_price, t.status, t.completed_at,
                c.name AS crop_name, l.quantity_quintals,
                buyer.name AS buyer_name, farmer.name AS farmer_name
         FROM transactions t
         JOIN offers o ON o.id = t.offer_id
         JOIN lots l ON l.id = o.lot_id
         JOIN crops c ON c.id = l.crop_id
         JOIN users buyer ON buyer.id = o.buyer_id
         JOIN users farmer ON farmer.id = l.farmer_id
         WHERE o.buyer_id = ? OR l.farmer_id = ?
         ORDER BY t.id DESC",
    )
    .bind(user_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
}
