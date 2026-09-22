mod auth;
mod db;
mod errors;
mod handlers;
mod models;
mod seed;
mod services;

use axum::response::Redirect;
use axum::{
    http::{header, HeaderValue, Method},
    routing::{delete, get, post},
    Router,
};
use dotenvy::dotenv;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use std::net::SocketAddr;
use std::str::FromStr;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() {
    dotenv().ok();

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "agri_backend=debug,info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let db_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite:agri_prototype.db".to_string());

    tracing::info!("Connecting to configured database");

    // WAL for concurrent reads; FK enforcement isn't on by default in SQLite.
    let connect_options = SqliteConnectOptions::from_str(&db_url)
        .expect("Invalid DATABASE_URL — expected format: sqlite:<filename>.db")
        .journal_mode(SqliteJournalMode::Wal)
        .pragma("foreign_keys", "ON")
        .create_if_missing(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(connect_options)
        .await
        .expect("Failed to create database pool. Check DATABASE_URL and file permissions.");

    tracing::info!("Running database migrations...");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Failed to run migrations. Ensure migrations/ directory exists.");

    tracing::info!("Seeding database...");
    if let Err(e) = seed::seed_database(&pool).await {
        tracing::error!("Failed to seed database: {}", e);
    }

    let frontend_url =
        std::env::var("FRONTEND_URL").unwrap_or_else(|_| "http://localhost:5173".to_string());
    let frontend_origin = HeaderValue::from_str(&frontend_url)
        .expect("FRONTEND_URL must be a valid origin, for example https://app.example.com");

    let cors = CorsLayer::new()
        .allow_origin(frontend_origin)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::HeaderName::from_static("x-user-id"),
        ]);

    let app = Router::new()
        .route(
            "/",
            get(|| async move { Redirect::temporary(&frontend_url) }),
        )
        .route("/health", get(handlers::get_health))
        .route("/api/auth/register", post(handlers::register_farmer))
        .route("/api/auth/login", post(handlers::login_farmer))
        .route("/api/crops", get(handlers::get_crops))
        .route(
            "/api/lots",
            get(handlers::get_lots).post(handlers::create_lot),
        )
        .route(
            "/api/offers",
            get(handlers::get_offers).post(handlers::create_offer),
        )
        .route(
            "/api/buyer-demands",
            get(handlers::get_buyer_demands).post(handlers::create_buyer_demand),
        )
        .route(
            "/api/buyer-demands/:id",
            delete(handlers::delete_buyer_demand),
        )
        .route("/api/mandi/prices", get(handlers::get_live_mandi_prices))
        .route("/api/mandi/states", get(handlers::get_mandi_states))
        .route(
            "/api/mandi/commodities",
            get(handlers::get_mandi_commodities),
        )
        .route("/api/buyers/prices", get(handlers::get_buyer_prices))
        .route(
            "/api/calculator/net-realisation",
            post(handlers::calculate_net_realisation_handler),
        )
        .route(
            "/api/advisor/smart-sale",
            post(handlers::evaluate_smart_sale_handler),
        )
        .route(
            "/api/lots/:id/matching-buyers",
            get(handlers::get_matching_buyers),
        )
        .route("/api/offers/:id/accept", post(handlers::accept_offer))
        .route("/api/transactions/:id", get(handlers::get_transaction))
        .route("/api/transactions", get(handlers::get_transactions))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(pool);

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse()
        .expect("PORT env var must be a valid port number (1–65535)");

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|_| panic!("Failed to bind to port {port}. Is it already in use?"));

    axum::serve(listener, app).await.unwrap();
}
