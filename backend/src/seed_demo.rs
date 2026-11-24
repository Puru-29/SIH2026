//! Sample data so every portal has something real to show on first run.
//!
//! Runs after migrations on every start. Each block checks whether its data is
//! already there and only fills in what is missing, so it is safe to run again
//! and never touches data created by real users.
//!
//! Sample account logins (PIN = SEED_PIN, default 1234):
//! - Farmer: 9876543210 (Ramesh Kumar), also a member of the sample FPO
//! - Buyer: 1234567890 (FreshFarm Retail)
//! - FPO: 9988776655 (Punjab Kisan FPO), plus member farmers 9876500001–06
//! - Pending FPO: 9988776600 (Malwa Growers FPO), waiting for admin approval
//! - Admin: ADMIN_PHONE / ADMIN_PIN from .env

use serde_json::json;
use sqlx::{Sqlite, SqlitePool, Transaction};

use crate::{
    auth::hash_pin,
    fpo::pools::{split_sale, SaleTerms, ShareIn},
};

const DEMO_FPO_MANAGER: i64 = 3;

fn demo_pin() -> String {
    std::env::var("SEED_PIN")
        .or_else(|_| std::env::var("DEMO_PIN"))
        .ok()
        .filter(|p| p.len() == 4 && p.chars().all(|c| c.is_ascii_digit()))
        .unwrap_or_else(|| "1234".into())
}

async fn crop_id(
    tx: &mut Transaction<'_, Sqlite>,
    name: &str,
    days: i64,
) -> Result<i64, sqlx::Error> {
    sqlx::query("INSERT OR IGNORE INTO crops (name, perishability_days) VALUES (?, ?)")
        .bind(name)
        .bind(days)
        .execute(&mut **tx)
        .await?;
    sqlx::query_scalar("SELECT id FROM crops WHERE name = ?")
        .bind(name)
        .fetch_one(&mut **tx)
        .await
}

/// A farmer account (with PIN) and its farmers row; returns the user id.
async fn farmer_user(
    tx: &mut Transaction<'_, Sqlite>,
    name: &str,
    phone: &str,
    location: &str,
    pin_hash: &str,
) -> Result<i64, sqlx::Error> {
    if let Some(id) = sqlx::query_scalar::<_, i64>("SELECT id FROM users WHERE phone_number = ?")
        .bind(phone)
        .fetch_optional(&mut **tx)
        .await?
    {
        return Ok(id);
    }
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO users (name, role, phone_number, pin_hash, status) VALUES (?, 'farmer', ?, ?, 'active') RETURNING id",
    )
    .bind(name)
    .bind(phone)
    .bind(pin_hash)
    .fetch_one(&mut **tx)
    .await?;
    sqlx::query(
        "INSERT OR IGNORE INTO farmers (id, location, urgency_level) VALUES (?, ?, 'medium')",
    )
    .bind(id)
    .bind(location)
    .execute(&mut **tx)
    .await?;
    Ok(id)
}

pub async fn ensure_demo_data(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    // The original seed creates users 1–8; skip on databases that never had it.
    let has_seed: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE id IN (1, 2, 3) ")
        .fetch_one(pool)
        .await?;
    if has_seed < 3 {
        return Ok(());
    }
    buyer_demand(pool).await?;
    demo_fpo(pool).await?;
    fpo_stock(pool).await?;
    pending_accounts(pool).await?;
    farmer_buyer_activity(pool).await?;
    deal_followups(pool).await?;
    admin_activity(pool).await?;
    Ok(())
}

/// Open buyer requirements with future deadlines (feeds matching and the admin heatmap).
async fn buyer_demand(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let open: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM buyer_demand WHERE buyer_id IN (2, 5, 6, 7, 8) AND status = 'open' AND required_by >= datetime('now')",
    )
    .fetch_one(pool)
    .await?;
    if open > 0 {
        return Ok(());
    }
    let mut tx = pool.begin().await?;
    let wheat = crop_id(&mut tx, "Wheat", 180).await?;
    let onion = crop_id(&mut tx, "Onion", 45).await?;
    let tomato = crop_id(&mut tx, "Tomato", 5).await?;
    let paddy = crop_id(&mut tx, "Paddy", 240).await?;
    let rows: [(i64, i64, f64, f64, &str, &str, i64); 9] = [
        (2, wheat, 60.0, 2450.0, "Grade A", "Azadpur, Delhi", 15),
        (5, wheat, 120.0, 2380.0, "Grade B", "Pune", 25),
        (8, wheat, 200.0, 2420.0, "Grade A", "Navi Mumbai", 30),
        (6, onion, 40.0, 2150.0, "Grade A", "Mumbai", 10),
        (7, onion, 25.0, 2300.0, "Export Grade", "Nashik", 18),
        (5, tomato, 20.0, 1800.0, "Grade A", "Pune", 4),
        (2, tomato, 15.0, 1750.0, "Grade B", "Azadpur, Delhi", 6),
        (7, paddy, 150.0, 2250.0, "Grade B", "Ludhiana, Punjab", 21),
        (8, paddy, 80.0, 2200.0, "Grade C", "Khanna", 35),
    ];
    for (buyer, crop, qty, price, quality, place, days) in rows {
        sqlx::query(
            "INSERT INTO buyer_demand (buyer_id, crop_id, min_quantity, max_price, required_quality, delivery_location, required_by, status, is_demo)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?), 'open', 0)",
        )
        .bind(buyer)
        .bind(crop)
        .bind(qty)
        .bind(price)
        .bind(quality)
        .bind(place)
        .bind(format!("+{days} days"))
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await
}

/// Punjab Kisan FPO: members, a collecting wheat pool, a sold and settled paddy pool.
async fn demo_fpo(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let Some(org) =
        sqlx::query_scalar::<_, i64>("SELECT id FROM fpo_organizations WHERE manager_user_id = ?")
            .bind(DEMO_FPO_MANAGER)
            .fetch_optional(pool)
            .await?
    else {
        return Ok(());
    };
    let members: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fpo_members WHERE fpo_id = ?")
        .bind(org)
        .fetch_one(pool)
        .await?;
    if members > 0 {
        return Ok(());
    }
    let pin = hash_pin(&demo_pin());
    let mut tx = pool.begin().await?;
    let wheat = crop_id(&mut tx, "Wheat", 180).await?;
    let paddy = crop_id(&mut tx, "Paddy", 240).await?;

    // Members (all can sign in as farmers), plus the sample farmer Ramesh.
    let people = [
        (
            "Gurpreet Singh",
            "9876500001",
            "Khanna",
            8.0,
            "Wheat, Paddy",
        ),
        ("Harjit Kaur", "9876500002", "Samrala", 5.5, "Wheat, Paddy"),
        (
            "Baldev Sandhu",
            "9876500003",
            "Doraha",
            12.0,
            "Paddy, Potato",
        ),
        ("Manpreet Gill", "9876500004", "Payal", 4.0, "Wheat"),
        (
            "Sukhwinder Brar",
            "9876500005",
            "Machhiwara",
            6.5,
            "Wheat, Paddy",
        ),
        ("Jaspal Dhillon", "9876500006", "Khanna", 3.0, "Paddy"),
    ];
    let mut ids = vec![];
    for (name, phone, village, acres, crops) in people {
        let uid = farmer_user(&mut tx, name, phone, "Punjab", &pin).await?;
        let mid = sqlx::query_scalar::<_, i64>(
            "INSERT INTO fpo_members (fpo_id, user_id, name, phone, village, land_acres, crops, joined_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '-120 days')) RETURNING id",
        )
        .bind(org)
        .bind(uid)
        .bind(name)
        .bind(phone)
        .bind(village)
        .bind(acres)
        .bind(crops)
        .fetch_one(&mut *tx)
        .await?;
        ids.push((mid, name));
    }
    let ramesh = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_members (fpo_id, user_id, name, phone, village, land_acres, crops, joined_at)
         SELECT ?, u.id, u.name, u.phone_number, 'Khanna', 7.0, 'Wheat, Tomato', datetime('now', '-60 days')
         FROM users u WHERE u.id = 1 RETURNING id",
    )
    .bind(org)
    .fetch_one(&mut *tx)
    .await?;
    ids.push((ramesh, "Ramesh Kumar"));

    let warehouse = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_warehouses (fpo_id, name, location, capacity_quintals, rate_per_quintal_month)
         VALUES (?, 'Khanna WDRA warehouse', 'Khanna, Ludhiana', 2000, 30) RETURNING id",
    )
    .bind(org)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO fpo_transporters (fpo_id, name, phone, vehicle_number, capacity_quintals, rate_per_km)
         VALUES (?, 'Gill Roadways', '9876511111', 'PB10 GT 4521', 100, 42)",
    )
    .bind(org)
    .execute(&mut *tx)
    .await?;

    // Pool 1: wheat, collecting. Three received and graded, two still pledged.
    let wheat_pool = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_pools (fpo_id, crop_id, target_grade, target_quantity_quintals, collection_center, collection_deadline, status)
         VALUES (?, ?, 'A', 300, 'Khanna mandi yard', date('now', '+12 days'), 'collecting') RETURNING id",
    )
    .bind(org)
    .bind(wheat)
    .fetch_one(&mut *tx)
    .await?;
    // (member index, pledged q, received (q, grade) if weighed)
    type WheatRow<'a> = (usize, f64, Option<(f64, &'a str)>);
    let wheat_rows: [WheatRow; 5] = [
        (0, 45.0, Some((44.5, "A"))),
        (1, 60.0, Some((60.0, "A"))),
        (3, 38.0, Some((37.0, "B"))),
        (4, 50.0, None),
        (6, 40.0, None),
    ];
    for (m, pledged, received) in wheat_rows {
        let (status, qty, rq, grade) = match received {
            Some((r, g)) => ("approved", r, Some(r), Some(g)),
            None => ("pending", pledged, None, None),
        };
        sqlx::query(
            "INSERT INTO fpo_contributions (fpo_id, member_id, crop_id, variety, quantity_quintals, pledged_quintals,
                received_quintals, assessed_grade, harvest_date, status, pool_id, pledged_by, received_at)
             VALUES (?, ?, ?, 'HD-2967', ?, ?, ?, ?, date('now', '-6 days'), ?, ?, 'farmer',
                CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', '-2 days') END)",
        )
        .bind(org)
        .bind(ids[m].0)
        .bind(wheat)
        .bind(qty)
        .bind(pledged)
        .bind(rq)
        .bind(grade)
        .bind(status)
        .bind(wheat_pool)
        .bind(rq)
        .execute(&mut *tx)
        .await?;
    }

    // Pool 2: paddy, listed, sold to FreshFarm, delivered, paid and settled.
    let paddy_pool = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_pools (fpo_id, crop_id, target_grade, target_quantity_quintals, collection_center, collection_deadline, status, created_at)
         VALUES (?, ?, 'B', 150, 'Samrala collection centre', date('now', '-20 days'), 'listed', datetime('now', '-40 days')) RETURNING id",
    )
    .bind(org)
    .bind(paddy)
    .fetch_one(&mut *tx)
    .await?;
    let paddy_rows: [(usize, f64, &str); 4] = [
        (0, 40.0, "A"),
        (1, 55.0, "A"),
        (2, 35.0, "B"),
        (5, 30.0, "C"),
    ];
    let total: f64 = paddy_rows.iter().map(|r| r.1).sum();
    let lot = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_lots (fpo_id, crop_id, variety, total_quintals, sold_quintals, grade, warehouse_id, created_at)
         VALUES (?, ?, 'PR-126', ?, ?, 'C', ?, datetime('now', '-19 days')) RETURNING id",
    )
    .bind(org)
    .bind(paddy)
    .bind(total)
    .bind(total)
    .bind(warehouse)
    .fetch_one(&mut *tx)
    .await?;
    let day: String = sqlx::query_scalar("SELECT strftime('%Y%m%d', 'now', '-19 days')")
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query("UPDATE fpo_lots SET lot_code = ? WHERE id = ?")
        .bind(format!("FPO{org}-PAD-{day}-{lot:04}"))
        .bind(lot)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE fpo_pools SET lot_id = ? WHERE id = ?")
        .bind(lot)
        .bind(paddy_pool)
        .execute(&mut *tx)
        .await?;
    let mut shares = vec![];
    for (m, q, g) in paddy_rows {
        let cid = sqlx::query_scalar::<_, i64>(
            "INSERT INTO fpo_contributions (fpo_id, member_id, crop_id, variety, quantity_quintals, pledged_quintals,
                received_quintals, assessed_grade, harvest_date, status, lot_id, pool_id, pledged_by, received_at)
             VALUES (?, ?, ?, 'PR-126', ?, ?, ?, ?, date('now', '-45 days'), 'pooled', ?, ?, 'farmer', datetime('now', '-22 days'))
             RETURNING id",
        )
        .bind(org)
        .bind(ids[m].0)
        .bind(paddy)
        .bind(q)
        .bind(q)
        .bind(q)
        .bind(g)
        .bind(lot)
        .bind(paddy_pool)
        .fetch_one(&mut *tx)
        .await?;
        shares.push(ShareIn {
            contribution_id: cid,
            member_id: ids[m].0,
            member_name: ids[m].1.to_string(),
            quantity: q,
            grade: Some(g.to_string()),
        });
    }
    sqlx::query(
        "INSERT INTO fpo_quality_records (lot_id, inspector_name, inspected_on, moisture_pct, foreign_matter_pct, damaged_pct, grain_quality, grade)
         VALUES (?, 'S. Grewal (PAU-trained grader)', date('now', '-19 days'), 14.5, 1.8, 3.0, 'Mixed bold and broken grains', 'C')",
    )
    .bind(lot)
    .execute(&mut *tx)
    .await?;
    let (price, amount) = (2300.0, 2300.0 * total);
    let offer = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_offers (fpo_id, lot_id, buyer_id, quantity_quintals, price_per_quintal, payment_terms, status, awaiting, round, created_by_role, created_at, updated_at)
         VALUES (?, ?, 2, ?, ?, '30% advance, balance on delivery', 'accepted', 'fpo', 2, 'buyer', datetime('now', '-17 days'), datetime('now', '-16 days'))
         RETURNING id",
    )
    .bind(org)
    .bind(lot)
    .bind(total)
    .bind(price)
    .fetch_one(&mut *tx)
    .await?;
    for (role, action, p, ago) in [
        ("buyer", "offered", 2200.0, 17),
        ("fpo", "countered", 2350.0, 17),
        ("buyer", "countered", 2300.0, 16),
        ("fpo", "accepted", 2300.0, 16),
    ] {
        sqlx::query(
            "INSERT INTO fpo_offer_events (offer_id, actor_role, action, quantity_quintals, price_per_quintal, created_at)
             VALUES (?, ?, ?, ?, ?, datetime('now', ?))",
        )
        .bind(offer)
        .bind(role)
        .bind(action)
        .bind(total)
        .bind(p)
        .bind(format!("-{ago} days"))
        .execute(&mut *tx)
        .await?;
    }
    let (transport, storage, handling, commission) = (2520.0, 1440.0, 800.0, 2.0);
    let sale = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_sales (fpo_id, lot_id, offer_id, buyer_id, quantity_quintals, price_per_quintal, amount, payment_terms,
            transport_cost, storage_cost, handling_cost, commission_pct, delivery_status, created_at)
         VALUES (?, ?, ?, 2, ?, ?, ?, '30% advance, balance on delivery', ?, ?, ?, ?, 'delivered', datetime('now', '-16 days'))
         RETURNING id",
    )
    .bind(org)
    .bind(lot)
    .bind(offer)
    .bind(total)
    .bind(price)
    .bind(amount)
    .bind(transport)
    .bind(storage)
    .bind(handling)
    .bind(commission)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO fpo_shipments (fpo_id, sale_id, transporter_id, pickup_location, delivery_address, distance_km, estimated_cost, expected_date, status, created_at, updated_at)
         SELECT ?, ?, id, 'Khanna WDRA warehouse', 'FreshFarm Retail DC, Azadpur, Delhi', 30, ?, date('now', '-13 days'), 'delivered', datetime('now', '-15 days'), datetime('now', '-13 days')
         FROM fpo_transporters WHERE fpo_id = ? LIMIT 1",
    )
    .bind(org)
    .bind(sale)
    .bind(transport)
    .bind(org)
    .execute(&mut *tx)
    .await?;
    for (kind, share, reference, ago) in [
        ("advance", 0.3, "UTR HDFC0042871", 16),
        ("final", 0.7, "UTR HDFC0043390", 11),
    ] {
        sqlx::query(
            "INSERT INTO fpo_payments (sale_id, amount, kind, method, reference, paid_on, recorded_by)
             VALUES (?, ?, ?, 'neft', ?, date('now', ?), ?)",
        )
        .bind(sale)
        .bind(((amount * share) * 100.0).round() / 100.0)
        .bind(kind)
        .bind(reference)
        .bind(format!("-{ago} days"))
        .bind(DEMO_FPO_MANAGER)
        .execute(&mut *tx)
        .await?;
    }
    let split = split_sale(
        &shares,
        &SaleTerms {
            quantity: total,
            amount,
            transport,
            storage,
            handling,
            commission_pct: commission,
        },
    );
    for (i, s) in split.iter().enumerate() {
        sqlx::query(
            "INSERT INTO fpo_payouts (sale_id, member_id, contribution_id, quantity_quintals, gross, deductions, net, status, reference, paid_on)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?, date('now', '-10 days'))",
        )
        .bind(sale)
        .bind(s.member_id)
        .bind(s.contribution_id)
        .bind(s.quantity_quintals)
        .bind(s.gross)
        .bind(s.deductions)
        .bind(s.net)
        .bind(format!("UPI PKFPO-{:04}", 7100 + i))
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "INSERT INTO announcements (author_id, audience, fpo_id, title, body) VALUES
         (?, 'fpo_members', ?, 'Wheat collection at Khanna', 'Bring your wheat to Khanna mandi yard between 8 and 11 AM. Moisture above 12% will be graded B.')",
    )
    .bind(DEMO_FPO_MANAGER)
    .bind(org)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO fpo_audit_log (fpo_id, actor_id, action, entity, entity_id, detail) VALUES
         (?, ?, 'pool listed', 'pool', ?, 'Sample data: paddy pool sold and settled')",
    )
    .bind(org)
    .bind(DEMO_FPO_MANAGER)
    .bind(paddy_pool)
    .execute(&mut *tx)
    .await?;
    tx.commit().await
}

/// A graded mustard lot with stock, so buyers can find the sample FPO on the
/// Suppliers page and in the FPO marketplace.
async fn fpo_stock(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let Some(org) =
        sqlx::query_scalar::<_, i64>("SELECT id FROM fpo_organizations WHERE manager_user_id = ?")
            .bind(DEMO_FPO_MANAGER)
            .fetch_optional(pool)
            .await?
    else {
        return Ok(());
    };
    let already: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM fpo_contributions WHERE fpo_id = ? AND variety = 'RH-725'",
    )
    .bind(org)
    .fetch_one(pool)
    .await?;
    let members: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM fpo_members WHERE fpo_id = ? AND phone IN ('9876500004', '9876500005', '9876500006') ORDER BY phone",
    )
    .bind(org)
    .fetch_all(pool)
    .await?;
    if already > 0 || members.len() < 3 {
        return Ok(());
    }
    let warehouse: Option<i64> =
        sqlx::query_scalar("SELECT id FROM fpo_warehouses WHERE fpo_id = ? ORDER BY id LIMIT 1")
            .bind(org)
            .fetch_optional(pool)
            .await?;
    let mut tx = pool.begin().await?;
    let mustard = crop_id(&mut tx, "Mustard", 180).await?;
    let rows = [(members[0], 18.0), (members[1], 22.0), (members[2], 20.0)];
    let total: f64 = rows.iter().map(|r| r.1).sum();
    let lot = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fpo_lots (fpo_id, crop_id, variety, total_quintals, grade, warehouse_id, created_at)
         VALUES (?, ?, 'RH-725', ?, 'A', ?, datetime('now', '-3 days')) RETURNING id",
    )
    .bind(org)
    .bind(mustard)
    .bind(total)
    .bind(warehouse)
    .fetch_one(&mut *tx)
    .await?;
    let day: String = sqlx::query_scalar("SELECT strftime('%Y%m%d', 'now', '-3 days')")
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query("UPDATE fpo_lots SET lot_code = ? WHERE id = ?")
        .bind(format!("FPO{org}-MUS-{day}-{lot:04}"))
        .bind(lot)
        .execute(&mut *tx)
        .await?;
    for (member, q) in rows {
        sqlx::query(
            "INSERT INTO fpo_contributions (fpo_id, member_id, crop_id, variety, quantity_quintals, received_quintals,
                assessed_grade, harvest_date, status, lot_id, pledged_by, received_at)
             VALUES (?, ?, ?, 'RH-725', ?, ?, 'A', date('now', '-12 days'), 'pooled', ?, 'fpo', datetime('now', '-4 days'))",
        )
        .bind(org)
        .bind(member)
        .bind(mustard)
        .bind(q)
        .bind(q)
        .bind(lot)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "INSERT INTO fpo_quality_records (lot_id, inspector_name, inspected_on, moisture_pct, foreign_matter_pct, damaged_pct, grain_quality, grade)
         VALUES (?, 'S. Grewal (PAU-trained grader)', date('now', '-3 days'), 7.5, 1.2, 0.8, 'Bold, bright seed; oil content tested at 41%', 'A')",
    )
    .bind(lot)
    .execute(&mut *tx)
    .await?;
    tx.commit().await
}

/// One FPO waiting for approval and one unverified buyer, for the admin queue.
async fn pending_accounts(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let pin = hash_pin(&demo_pin());
    let mut tx = pool.begin().await?;
    let exists: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE phone_number = '9988776600'")
            .fetch_one(&mut *tx)
            .await?;
    if exists == 0 {
        let uid = sqlx::query_scalar::<_, i64>(
            "INSERT INTO users (name, role, phone_number, pin_hash, status) VALUES ('Malwa Growers FPO', 'fpo', '9988776600', ?, 'pending') RETURNING id",
        )
        .bind(&pin)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO fpo_organizations (manager_user_id, name, contact_phone, registration_no, district, state, primary_crops)
             VALUES (?, 'Malwa Growers FPO', '9988776600', 'U01100PB2024PTC061234', 'Bathinda', 'Punjab', 'Cotton, Wheat')",
        )
        .bind(uid)
        .execute(&mut *tx)
        .await?;
    }
    let buyer: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE phone_number = '9123456799'")
            .fetch_one(&mut *tx)
            .await?;
    if buyer == 0 {
        let uid = sqlx::query_scalar::<_, i64>(
            "INSERT INTO users (name, role, phone_number, pin_hash, status) VALUES ('Agro Bazaar Traders', 'buyer', '9123456799', ?, 'active') RETURNING id",
        )
        .bind(&pin)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query("INSERT INTO buyers (id, trust_score, is_verified) VALUES (?, 5.0, 0)")
            .bind(uid)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await
}

/// A completed farmer–buyer deal with an open dispute, and a pending offer.
async fn farmer_buyer_activity(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let deals: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM transactions")
        .fetch_one(pool)
        .await?;
    if deals > 0 {
        return Ok(());
    }
    let mut tx = pool.begin().await?;
    let wheat = crop_id(&mut tx, "Wheat", 180).await?;
    let lot = sqlx::query_scalar::<_, i64>(
        "INSERT INTO lots (farmer_id, crop_id, quantity_quintals, expected_quality, status, created_at)
         VALUES (1, ?, 30, 'Grade A', 'sold', datetime('now', '-9 days')) RETURNING id",
    )
    .bind(wheat)
    .fetch_one(&mut *tx)
    .await?;
    let offer = sqlx::query_scalar::<_, i64>(
        "INSERT INTO offers (lot_id, buyer_id, price_offered, status, created_by_role, created_at)
         VALUES (?, 2, 2400, 'accepted', 'buyer', datetime('now', '-8 days')) RETURNING id",
    )
    .bind(lot)
    .fetch_one(&mut *tx)
    .await?;
    let txn = sqlx::query_scalar::<_, i64>(
        "INSERT INTO transactions (offer_id, final_price, status, completed_at) VALUES (?, 2400, 'completed', datetime('now', '-7 days')) RETURNING id",
    )
    .bind(offer)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO disputes (transaction_id, raised_by, reason, created_at)
         VALUES (?, 2, 'Weighbridge at our Azadpur DC shows 28.4 q, not the 30 q invoiced. Requesting adjustment for 1.6 q.', datetime('now', '-5 days'))",
    )
    .bind(txn)
    .execute(&mut *tx)
    .await?;
    // Seed lot 1 (tomato) gets a pending offer if it is still open.
    sqlx::query(
        "INSERT INTO offers (lot_id, buyer_id, price_offered, status, created_by_role)
         SELECT 1, 6, 1700, 'pending', 'buyer' WHERE EXISTS (SELECT 1 FROM lots WHERE id = 1 AND status = 'open')",
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await
}

/// Tracking, payments and messages for deals, so the orders, payments and
/// messages pages have something to show on a fresh database.
async fn deal_followups(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    // Pickup = farmer's location; delivery = the buyer's requirement for that crop, else the buyer's location.
    sqlx::query(
        "UPDATE transactions SET
           pickup_location = (SELECT f.location FROM offers o JOIN lots l ON l.id = o.lot_id
                              JOIN farmers f ON f.id = l.farmer_id WHERE o.id = transactions.offer_id),
           delivery_location = COALESCE(
             (SELECT d.delivery_location FROM offers o JOIN lots l ON l.id = o.lot_id
                JOIN buyer_demand d ON d.buyer_id = o.buyer_id AND d.crop_id = l.crop_id
              WHERE o.id = transactions.offer_id ORDER BY d.id DESC LIMIT 1),
             (SELECT b.location FROM offers o JOIN buyers b ON b.id = o.buyer_id WHERE o.id = transactions.offer_id))
         WHERE pickup_location IS NULL",
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT OR IGNORE INTO order_events (transaction_id, status, note, created_at)
         SELECT id, 'accepted', 'Offer accepted', completed_at FROM transactions",
    )
    .execute(&mut *tx)
    .await?;

    // The seeded wheat deal (Ramesh → buyer 2, 30 q at ₹2,400): delivered,
    // part paid and confirmed, the rest marked paid and waiting for Ramesh.
    let demo: Option<i64> = sqlx::query_scalar(
        "SELECT t.id FROM transactions t JOIN offers o ON o.id = t.offer_id JOIN lots l ON l.id = o.lot_id
         WHERE l.farmer_id = 1 AND o.buyer_id = 2 AND t.final_price = 2400 AND l.quantity_quintals = 30
           AND NOT EXISTS (SELECT 1 FROM transaction_payments p WHERE p.transaction_id = t.id)
           AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.transaction_id = t.id AND e.status != 'accepted')
         ORDER BY t.id LIMIT 1",
    )
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(id) = demo {
        for (status, note, by, ago) in [
            (
                "picked_up",
                "Loaded at Karnal mandi yard, truck HR05 GT 4471",
                1,
                "-7 days",
            ),
            ("in_transit", "On NH44 to Delhi", 1, "-6 days"),
            ("delivered", "Received at Azadpur DC", 2, "-5 days"),
        ] {
            sqlx::query(
                "INSERT OR IGNORE INTO order_events (transaction_id, status, note, created_by, created_at)
                 VALUES (?, ?, ?, ?, datetime('now', ?))",
            )
            .bind(id)
            .bind(status)
            .bind(note)
            .bind(by)
            .bind(ago)
            .execute(&mut *tx)
            .await?;
        }
        sqlx::query("UPDATE transactions SET status = 'delivered' WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "INSERT INTO transaction_payments (transaction_id, amount, method, reference, status, paid_at, recorded_by, confirmed_at)
             VALUES (?, 50000, 'bank_transfer', 'UTR HDFC0042871', 'confirmed', datetime('now', '-6 days'), 2, datetime('now', '-6 days')),
                    (?, 18160, 'upi', 'UPI 6184 2207 5531', 'marked_paid', datetime('now', '-1 days'), 2, NULL)",
        )
        .bind(id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }

    let messages: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages")
        .fetch_one(&mut *tx)
        .await?;
    if messages == 0 {
        if let Some(id) = demo {
            for (from, to, body, ago) in [
                (2, 1, "Ramesh ji, the truck reached Azadpur. Our weighbridge shows 28.4 q, not 30 q.", "-5 days"),
                (1, 2, "It was 30 q at Karnal mandi. Some moisture loss on the way is possible. Please share the slip.", "-5 days"),
                (2, 1, "Shared with the AgriSense team. I have paid for 28.4 q for now; the rest after they decide.", "-1 days"),
            ] {
                sqlx::query(
                    "INSERT INTO messages (sender_id, receiver_id, transaction_id, body, created_at, read_at)
                     VALUES (?, ?, ?, ?, datetime('now', ?), CASE WHEN ? = 1 THEN datetime('now', ?) END)",
                )
                .bind(from)
                .bind(to)
                .bind(id)
                .bind(body)
                .bind(ago)
                .bind(from)
                .bind(ago)
                .execute(&mut *tx)
                .await?;
            }
            sqlx::query(
                "INSERT INTO user_notifications (user_id, type, title, body, link, created_at) VALUES
                 (1, 'payment', 'Payment of ₹18,160 marked as paid', 'Buyer says they paid ₹18,160 for this order. Confirm when it reaches your account.', '/payments', datetime('now', '-1 days')),
                 (1, 'message', 'New message', 'I have paid for 28.4 q for now; the rest after they decide.', '/messages?with=2', datetime('now', '-1 days'))",
            )
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await
}

/// An advisory and a few audit rows, attributed to the configured admin.
async fn admin_activity(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let Some(admin) = sqlx::query_scalar::<_, i64>(
        "SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1",
    )
    .fetch_optional(pool)
    .await?
    else {
        return Ok(());
    };
    let logged: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_logs")
        .fetch_one(pool)
        .await?;
    if logged > 0 {
        return Ok(());
    }
    let mut tx = pool.begin().await?;
    let demo_org: Option<i64> =
        sqlx::query_scalar("SELECT id FROM fpo_organizations WHERE manager_user_id = ?")
            .bind(DEMO_FPO_MANAGER)
            .fetch_optional(&mut *tx)
            .await?;
    sqlx::query(
        "UPDATE fpo_organizations SET verified_by = ? WHERE manager_user_id = ? AND verified = 1",
    )
    .bind(admin)
    .bind(DEMO_FPO_MANAGER)
    .execute(&mut *tx)
    .await?;
    let ann = sqlx::query_scalar::<_, i64>(
        "INSERT INTO announcements (author_id, audience, title, body) VALUES
         (?, 'all_farmers', 'Rain advisory for Punjab and Haryana', 'Light to moderate rain is expected over the next 3 days. Keep harvested paddy and wheat covered and delay drying in the open.')
         RETURNING id",
    )
    .bind(admin)
    .fetch_one(&mut *tx)
    .await?;
    let entries = [
        (
            "fpo.approve",
            "fpo",
            demo_org,
            json!({ "name": "Punjab Kisan FPO", "note": "sample data" }),
        ),
        (
            "buyer.approve",
            "user",
            Some(2),
            json!({ "name": "FreshFarm Retail", "note": "sample data" }),
        ),
        (
            "buyer.trust_score",
            "user",
            Some(4),
            json!({ "from": 5.0, "to": 3.5, "reason": "Two delayed payments reported (sample data)" }),
        ),
        (
            "announcement.post",
            "announcement",
            Some(ann),
            json!({ "audience": "all_farmers", "title": "Rain advisory for Punjab and Haryana" }),
        ),
    ];
    for (action, entity, id, details) in entries {
        sqlx::query("INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, details_json) VALUES (?, ?, ?, ?, ?)")
            .bind(admin)
            .bind(action)
            .bind(entity)
            .bind(id)
            .bind(details.to_string())
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await
}
