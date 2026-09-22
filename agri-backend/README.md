# AgriSense Insights Hub

AgriSense is an agricultural market intelligence and transaction platform built to help farmers, FPOs, and buyers make better selling and procurement decisions using market data, buyer demand, and AI-assisted recommendations.

This repository contains both the backend API and the frontend application for the product. The backend is written in Rust with Axum and SQLite, while the frontend is a Vite + React app built for dashboards, crop tracking, market intelligence, and decision support.

---

## Overview

The platform helps users answer a practical question:

> What is the best way to sell or buy agri produce at the highest value while reducing transport, storage, and quality risks?

### Key capabilities

- Farmer dashboard with crop lots, buyer opportunities, and portfolio summaries
- AI-inspired sale recommendations and net realisation calculations
- Market and mandi price visibility for different crops and locations
- Buyer discovery and offer workflows
- Transaction tracking for accepted deals
- Demo-ready SQLite database with migrations and seeded data

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend language | Rust |
| API framework | Axum |
| Async runtime | Tokio |
| Database | SQLite |
| Database access | SQLx |
| Frontend | React 19 |
| Frontend tooling | Vite |
| Routing | TanStack Router |
| State/data fetching | TanStack Query |
| Styling | Tailwind CSS |
| UI primitives | Radix UI + custom components |
| Logging | Tracing |

---

## Repository structure

```text
agri-backend/
├── Cargo.toml
├── Cargo.lock
├── .env
├── README.md
├── MANDI-API-SPEC.md
├── migrations/
│   ├── 20260905000000_init.sql
│   ├── 20260914000000_remove_local_market_prices.sql
│   ├── 20260915000000_add_buyer_offers.sql
│   ├── ...
│   └── 20260915070000_add_buyer_demand_status.sql
├── src/
│   ├── auth.rs
│   ├── db.rs
│   ├── errors.rs
│   ├── handlers.rs
│   ├── main.rs
│   ├── models.rs
│   ├── seed.rs
│   └── services/
│       ├── advisor.rs
│       ├── calculator.rs
│       ├── matcher.rs
│       └── mod.rs
├── smart-agri-mind-main/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   ├── public/
│   └── src/
├── agri_prototype.db
├── target/
├── target-live/
└── .gitignore
```

---

## Features

### Backend

- REST API for farmers, buyers, crops, lots, offers, and transactions
- SQLite database with migration-based schema setup
- Seeded demo data for local product development
- Net realisation calculation engine
- Smart sale advisor logic for price decision support
- Mandi and buyer discovery endpoints
- Accept-offer flow that creates completed transaction records

### Frontend

- Agritech landing and portal experience
- Farmer dashboard with crop lots and opportunity summaries
- Buyer dashboard and offer-related screens
- Crop and market intelligence views
- Responsive dark/light friendly agritech design system

---

## Prerequisites

You need:

- Rust and Cargo
- Node.js 18+ and npm

### Install Rust

On Windows PowerShell:

```powershell
winget install Rustlang.Rustup
```

Or install from: https://rustup.rs/

Verify:

```bash
rustc --version
cargo --version
```

### Install Node.js

Install from: https://nodejs.org/

Verify:

```bash
node --version
npm --version
```

---

## Environment setup

The backend reads environment variables from the root `.env` file. A typical configuration looks like:

```env
DATABASE_URL=sqlite:agri_prototype.db
RUST_LOG=info,agri_backend=debug
PORT=8080
```

If needed, update this file before running the server.

---

## Run the backend

From the project root:

```bash
cargo run
```

The API will run on:

```text
http://127.0.0.1:8080
```

On the first run, the backend will:

1. create the SQLite database if it does not exist
2. run all SQL migrations in `migrations/`
3. seed demo data for users, crops, markets, lots, and buyers
4. start the Axum server

---

## Run the frontend

From the repository root:

```bash
cd smart-agri-mind-main
npm install
npm run dev
```

The frontend is typically served at:

```text
http://localhost:5173
```

---

## Main backend endpoints

Key API routes exposed by the Rust server include:

- `GET /health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/crops`
- `GET /api/lots`
- `POST /api/lots`
- `GET /api/offers`
- `POST /api/offers`
- `GET /api/buyer-demands`
- `POST /api/buyer-demands`
- `GET /api/mandi/prices`
- `GET /api/mandi/states`
- `GET /api/mandi/commodities`
- `GET /api/buyers/prices`
- `POST /api/calculator/net-realisation`
- `POST /api/advisor/smart-sale`
- `GET /api/lots/:id/matching-buyers`
- `POST /api/offers/:id/accept`
- `GET /api/transactions`
- `GET /api/transactions/:id`

### Example: health check

```bash
curl http://localhost:8080/health
```

### Example: net realisation calculation

```bash
curl -X POST http://localhost:8080/api/calculator/net-realisation \
  -H "Content-Type: application/json" \
  -d '{
    "crop_id": 1,
    "market_id": 1,
    "quantity_quintals": 15.0,
    "farmer_location": "Haryana",
    "handling_costs": 300.0,
    "expected_deductions": 100.0,
    "expected_storage_days": 2.0
  }'
```

### Example: smart sale advisor

```bash
curl -X POST http://localhost:8080/api/advisor/smart-sale \
  -H "Content-Type: application/json" \
  -d '{
    "crop_id": 1,
    "quantity_quintals": 15.0,
    "current_price_per_quintal": 2500.0,
    "expected_future_price": 2800.0,
    "storage_cost_per_day": 2.5,
    "farmer_urgency": "medium",
    "handling_costs": 300.0
  }'
```

---

## Demo workflow

A typical end-to-end flow looks like this:

1. Farmer opens the dashboard and reviews crop lot information
2. Market prices and buyer demand are compared
3. Net realisation and smart sale strategy are calculated
4. Matching buyers are identified for the lot
5. Buyer creates an offer
6. Farmer accepts the offer
7. A transaction record is created and tracked

Example curl flow:

```bash
# 1. Check mandi/prices
curl "http://localhost:8080/api/markets/prices?crop_id=1"

# 2. Calculate net realisation
curl -X POST http://localhost:8080/api/calculator/net-realisation \
  -H "Content-Type: application/json" \
  -d '{"crop_id":1,"market_id":1,"quantity_quintals":15,"farmer_location":"Haryana","handling_costs":300,"expected_deductions":100,"expected_storage_days":2}'

# 3. Get smart sale recommendation
curl -X POST http://localhost:8080/api/advisor/smart-sale \
  -H "Content-Type: application/json" \
  -d '{"crop_id":1,"quantity_quintals":15,"current_price_per_quintal":2500,"expected_future_price":2800,"storage_cost_per_day":2.5,"farmer_urgency":"medium","handling_costs":300}'

# 4. Find matching buyers for lot 1
curl http://localhost:8080/api/lots/1/matching-buyers

# 5. Buyer creates offer
curl -X POST http://localhost:8080/api/offers \
  -H "Content-Type: application/json" \
  -H "X-User-Id: 2" \
  -d '{"lot_id":1,"price_offered":35000}'

# 6. Farmer accepts the offer
curl -X POST http://localhost:8080/api/offers/1/accept \
  -H "X-User-Id: 1"

# 7. Check transaction
curl http://localhost:8080/api/transactions/1
```

---

## Development notes

- The backend uses SQL migrations to keep the database schema consistent
- Demo seed data is designed for local product validation and testing
- CORS is intentionally permissive for local development so the frontend can connect to the API
- The app is structured to support extension with live mandi data, production auth, and more advanced matching logic

---

## Testing

Run backend tests:

```bash
cargo test
```

Run a quick compile validation:

```bash
cargo check
```

Run frontend build validation:

```bash
cd smart-agri-mind-main
npm run build
```

---

## Troubleshooting

| Issue | Fix |
|---|---|
| `cargo: command not found` | Install Rust from https://rustup.rs/ and reopen the terminal |
| `Failed to create database pool` | Check `.env` and ensure the database directory is writable |
| `401 Unauthorized` or auth issues | Include the required `X-User-Id` header for the route |
| `400 Bad Request` | Verify the request body and validation rules, especially for quantity and urgency values |
| DB schema mismatch | Delete `agri_prototype.db` and rerun `cargo run` so migrations and seed data recreate it |

---

## Clear next steps

- Replace demo header-based auth with JWT-based authentication
- Move from SQLite to a production database in deployment
- Add live mandi price integrations
- Improve buyer matching and recommendation algorithms
- Add stronger validation and better error messaging on the frontend

---

## License

This project is intended for prototype and internal product work. Add an appropriate open-source or commercial license if you plan to distribute it externally.

---

## Summary

AgriSense combines agricultural market intelligence with practical decision support. It helps farmers maximise returns, enables buyers to discover trusted suppliers, and turns fragmented market information into actionable decisions.
