use sqlx::SqlitePool;

// Loads demo data on first run. IDs 1–4 are fixed so README curl examples keep working.
pub async fn seed_database(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM farmers")
        .fetch_one(pool)
        .await?;

    if count > 0 {
        tracing::info!("Database already contains data — skipping seed.");
        return Ok(());
    }

    tracing::info!("Seeding database with demo data...");
    let mut tx = pool.begin().await?;

    // crops
    sqlx::query(
        "INSERT OR IGNORE INTO crops (id, name, perishability_days) VALUES
         (1, 'Tomato', 5),
         (2, 'Wheat',  180),
         (3, 'Onion',  45)",
    )
    .execute(&mut *tx)
    .await?;

    // markets
    sqlx::query(
        "INSERT INTO markets (id, name, location) VALUES
         (1, 'Azadpur Mandi',  'Delhi'),
         (2, 'Lasalgaon Mandi','Maharashtra'),
         (3, 'Khanna Mandi',   'Punjab')",
    )
    .execute(&mut *tx)
    .await?;

    // Ramesh — farmer
    sqlx::query(
        "INSERT OR IGNORE INTO users (id, name, role, phone_number) VALUES
         (1, 'Ramesh Kumar', 'farmer', '9876543210')",
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO farmers (id, location, urgency_level) VALUES (1, 'Haryana', 'medium')",
    )
    .execute(&mut *tx)
    .await?;

    // Punjab Kisan FPO (uses farmers table for location/urgency too)
    sqlx::query(
        "INSERT OR IGNORE INTO users (id, name, role, phone_number) VALUES
         (3, 'Punjab Kisan FPO', 'fpo', '9988776655')",
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO farmers (id, location, urgency_level) VALUES (3, 'Punjab', 'low')")
        .execute(&mut *tx)
        .await?;

    // FreshFarm — verified buyer
    sqlx::query(
        "INSERT OR IGNORE INTO users (id, name, role, phone_number) VALUES
         (2, 'FreshFarm Retail', 'buyer', '1234567890')",
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO buyers (id, trust_score, is_verified) VALUES (2, 4.8, 1)")
        .execute(&mut *tx)
        .await?;

    // Delhi Wholesale — unverified buyer
    sqlx::query(
        "INSERT OR IGNORE INTO users (id, name, role, phone_number) VALUES
         (4, 'Delhi Wholesale Co.', 'buyer', '9871234560')",
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO buyers (id, trust_score, is_verified) VALUES (4, 3.5, 0)")
        .execute(&mut *tx)
        .await?;

    sqlx::query(
        "INSERT OR IGNORE INTO users (id, name, role, phone_number) VALUES
         (5, 'Sahyadri Foods', 'buyer', '9123456701'),
         (6, 'Annapurna Retail', 'buyer', '9123456702'),
         (7, 'GreenLeaf Exports', 'buyer', '9123456703'),
         (8, 'Mumbai Fresh Co.', 'buyer', '9123456704')",
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT OR IGNORE INTO buyers (id, trust_score, is_verified) VALUES
         (5, 4.7, 1),
         (6, 4.5, 1),
         (7, 4.2, 1),
         (8, 4.0, 1)",
    )
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO transport_costs (from_location, to_location, cost_per_quintal) VALUES
         ('Haryana',     'Delhi',         50.0),
         ('Punjab',      'Delhi',         80.0),
         ('Maharashtra', 'Delhi',        300.0),
         ('Haryana',     'Maharashtra',  350.0),
         ('Punjab',      'Maharashtra',  400.0),
         ('Delhi',       'Maharashtra',  280.0)",
    )
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO storage_facilities (market_id, cost_per_quintal_per_day) VALUES
         (1, 2.5),
         (2, 1.5),
         (3, 2.0)",
    )
    .execute(&mut *tx)
    .await?;

    // open lot for the demo flow
    sqlx::query(
        "INSERT INTO lots (id, farmer_id, crop_id, quantity_quintals, expected_quality, status)
         VALUES (1, 1, 1, 15.0, 'Grade A', 'open')",
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    tracing::info!("Seeding completed successfully. Demo data is ready.");
    Ok(())
}
