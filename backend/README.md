# AgriSense backend

Rust API for the AgriSense farmer, buyer, FPO and admin portals. The React frontend is in [`frontend/`](../frontend/); see the [root README](../README.md) for the product overview, local sample accounts and how to run both.

## Architecture

```text
src/
├── main.rs            # configuration, CORS, startup (migrations → seeds), route table
├── auth.rs            # Argon2 PINs, session tokens, the AuthUser extractor
├── handlers.rs        # auth, crops, lot creation, mandi, calculator, advisor, matching buyers
├── market.rs          # farmer/buyer deals: lots, offers, orders, payments, forecast,
│                      #   suppliers, messages, profile, requirements, notifications, storage
├── fpo.rs             # FPO portal: members, contributions, bulk lots, quality, offers,
│   └── fpo_pools.rs   #   sales, payouts, logistics, grievances; pools, joins, announcements
├── admin.rs           # admin console, disputes, audit log, notify helpers
├── db.rs, models.rs   # shared queries and request/response types
├── seed.rs            # master data, admin from env, sample accounts
├── seed_demo.rs       # idempotent sample data for every portal
├── migrate_fix.rs     # tolerate CRLF/LF changes in migration files
└── services/
    ├── mandi.rs       # Mandi API client (prices cached 15 min, lists 6 h, history)
    ├── matcher.rs     # ranks buyer requirements for a lot
    ├── deals.rs       # offer, order-step and payment-status rules, net realisation
    ├── forecast.rs    # moving averages, trend and outlook from daily prices
    ├── advisor.rs     # sell now / wait / split rule engine
    └── calculator.rs  # net realisation for the mandi calculator
```

Pure business rules live in `services/` and are unit-tested without a database. `market.rs` also has database tests that run every migration against in-memory SQLite.

## Configuration

Copy `.env.example` to `.env`. Every variable the backend reads:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `sqlite:agri_prototype.db` | SQLite file, created on first start |
| `PORT` | `8080` | API port (the frontend dev proxy expects `3001`) |
| `FRONTEND_URL` | `http://localhost:5173` | Allowed CORS origin |
| `ADMIN_PHONE`, `ADMIN_PIN` | none | Creates or updates the admin account; no admin exists without them |
| `DEMO_PIN` | `1234` | PIN for seeded sample accounts that have none |
| `MANDI_API_BASE_URL` | `https://mandi-api.onrender.com/v1` | Mandi price API (no key) |
| `MANDI_API_STATE` | `Maharashtra` | Default state for price requests without one |
| `PLATFORM_FEE_PERCENT` | `0` | Fee on direct deals, shown in net realisation |
| `RUST_LOG` | `agri_backend=debug,info` | Log filter |

## Authentication and roles

- Sign in with phone, 4-digit PIN and role. PINs are stored with Argon2; old SHA-256 hashes are upgraded on the next login.
- Login returns an opaque token. Send it as `Authorization: Bearer <token>`. Only its SHA-256 hash is stored (`sessions` table); sessions last 30 days, and `POST /api/auth/logout` ends one.
- Roles: `farmer`, `buyer`, `fpo`, `admin`. Account status: `active`, `pending` (new FPOs until the admin approves) or `suspended` (blocked with 403).
- Wrong role → **403**; missing or expired token → **401**. Every record is checked against its owner: a buyer sees only their own negotiation on a lot, an FPO only its own pools and members, and only the two parties (or the admin) can open an order.

## Deal rules

- **Lot status:** `open` → `sold`, or `withdrawn` (by the farmer) or `cancelled` (by the admin). "Offer received" is worked out from pending offers, so it can never go stale.
- **Offers:** `pending` → `accepted`, `rejected`, `countered` or `cancelled`. Only the side that did not make an offer can accept, reject or counter it. A counter is a new offer whose `parent_offer_id` points to the one it answers. Accepting closes the lot and rejects the other pending offers on it (with a notification).
- **Orders:** start as `accepted`, then `picked_up` → `in_transit` → `delivered` (stored in `order_events`; steps can be skipped but never undone). The farmer records pickup and transit; either side can record delivery.
- **Payments:** the buyer records each payment (`marked_paid`); the farmer confirms it (`confirmed`) or reports it `not_received`. Order payment status is `pending`, `awaiting_confirmation`, `partially_paid` or `paid`. A delivered and fully paid order becomes `completed`.
- **Net realisation:** price × quantity − freight (route table, pickup state → delivery state) − platform fee.
- **Buyer ranking** (`services/matcher.rs`): price 30%, trust 20%, freight 15%, quality 15%, quantity 10%, deadline 10%, with plain reasons for each buyer.
- **FPO payouts:** each member's share = sale amount × (quantity × grade factor) / total, grade factors A 1.0, B 0.95, C 0.85; freight, storage and handling are shared by quantity; commission is a % of the share.

## Forecast

`GET /api/forecast` and `GET /api/lots/:id/signals` use daily mandi prices stored in `mandi_price_history`. Prices are saved whenever live prices are fetched and topped up from the Mandi API history at most every 6 hours, so the history keeps growing. The outlook blends today's price with the 7-day average, adds the 30-day least-squares trend (damped, and capped at ±2% a day), and shows a widening range. It needs at least 3 days of prices. Signals also include open buyer demand vs supply, shelf life, freight to the best-paying buyer and pending offers. Everything is labelled "Trend-based estimate, not a guarantee".

## Notifications

Created by the backend in `user_notifications` with a `type`: `offer`, `counter`, `accepted`, `rejected`, `matching_lot` (a new lot matches a buyer's requirement), `order`, `payment`, `message` (at most one unread per conversation), `dispute`, `admin`, `general`.

Every portal (farmer, buyer, FPO, admin) reads them from `GET /api/notifications`; the header bell shows the unread count. Each one has a `link` to the page to open. FPO actions notify:

- **Farmer:** join request approved or declined; pledge received (weighed quintals and grade) or rejected; pool listed, cancelled or sold; payout calculated; payout paid (amount and reference); FPO announcement.
- **FPO manager:** new join request; farmer pledge; buyer offer, counter, accept or reject on an FPO lot; buyer dispute or farmer complaint; admin approval or send-back.
- **Buyer:** FPO offer, accept, reject or counter; new FPO lot matching an open requirement.

`GET /api/fpo/notifications` is not a notification feed: it is the FPO's live "needs attention" checklist (pending intakes, unpaid sales, ungraded lots), shown below the bell list.

## Rules worth knowing

- **Buyer verification:** a new buyer can browse and post requirements, but making, countering or accepting an offer (farmer or FPO) returns `403` until an admin approves the buyer. Seeded sample buyers are verified.
- **Farmer location:** sign-up requires district and state; it is stored as `"District, State"` (for example `"Ludhiana, Punjab"`). `GET /api/me` returns `needs_district: true` for older farmers saved with only a state; the dashboard asks them once and saves it with `PATCH /api/me { district, state }`.
- **Crops are master data:** only admins add crops (`POST /api/crops` or the Master data page). Farmers, buyers and FPOs pick from the list; a name not in the list is refused, and `POST /api/crop-requests` asks the admin to add it.

## API reference

All paths are under the backend origin. "Auth" means a Bearer token is required; the role column lists who may call it.

### Accounts and profile

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/health` | public | Health and version |
| POST | `/api/auth/register` | public | Register a farmer, buyer or FPO. Farmers and FPOs send `district` and `state` (required). FPOs start `pending`, buyers unverified |
| POST | `/api/auth/login` | public | Sign in; returns a token |
| POST | `/api/auth/logout` | any | End this session |
| GET | `/api/auth/me` | any | Current user, role and status |
| GET, PATCH | `/api/me` | any | Profile: name, location (farmers: `district` + `state`), urgency, preferred language, `verified` (buyers), `needs_district` (farmers), stats |

### Crops, prices and advice

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET, POST | `/api/crops` | GET public, POST admin | List crops; add a crop (admin only, audited) |
| POST | `/api/crop-requests` | farmer, buyer, fpo | Ask the admin to add a missing crop `{ crop_name, note? }` |
| GET | `/api/mandi/prices?state=&commodity=` | public | Live mandi prices (also saved to price history) |
| GET | `/api/mandi/states`, `/api/mandi/commodities?state=` | public | Mandi API lists |
| GET | `/api/forecast?crop=&state=&horizon=` | auth | Trend-based price outlook and drivers |
| GET | `/api/storage-options` | auth | Mandi storage rates and verified FPO warehouses |
| POST | `/api/calculator/net-realisation` | public | Net realisation at a mandi |
| POST | `/api/advisor/smart-sale` | public | Sell now / wait / split |
| GET | `/api/buyers/prices` | public | Open buyer requirements |

### Lots and offers

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/lots` | farmer, buyer | Farmer: own lots. Buyer: open lots to bid on |
| POST | `/api/lots` | farmer, fpo | Create a lot (tells buyers with a matching requirement) |
| GET | `/api/lots/:id` | owner, buyer, admin | Lot and negotiation history |
| PATCH | `/api/lots/:id` | owner | Edit quantity or quality while open |
| POST | `/api/lots/:id/withdraw` | owner | Take the lot off the market; closes pending offers |
| GET | `/api/lots/:id/matching-buyers` | owner, admin | Ranked buyer requirements with freight and reasons |
| GET | `/api/lots/:id/signals` | owner, admin | Price, demand, shelf-life and freight signals plus advisor inputs |
| GET | `/api/offers` | farmer, buyer | Offers on my lots / that I am part of |
| POST | `/api/offers` | buyer, farmer | Bid on a lot, or offer a lot to a buyer (`buyer_id`) |
| POST | `/api/offers/:id/accept` | other side | Accept; creates an order |
| POST | `/api/offers/:id/reject` | other side | Decline, optional `reason` |
| POST | `/api/offers/:id/counter` | other side | Counter with `{ price }` |
| POST | `/api/offers/:id/withdraw` | offer's sender | Withdraw a pending offer |

### Orders, tracking and payments

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/transactions` | farmer, buyer | My orders with order and payment status |
| GET | `/api/transactions/:id` | parties, admin | Order, events, payments, net realisation, counterpart |
| POST | `/api/transactions/:id/events` | parties | Next step: `picked_up`, `in_transit`, `delivered` |
| POST | `/api/transactions/:id/payments` | buyer | Record a payment `{ amount, method, reference }` |
| POST | `/api/payments/:id/confirm` | farmer | Payment received |
| POST | `/api/payments/:id/not-received` | farmer | Payment did not arrive |
| POST | `/api/disputes` | parties | Raise a dispute on an order |
| GET | `/api/disputes/mine` | any | My disputes |

### Buyer requirements and suppliers

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET, POST | `/api/buyer-demands` | buyer | My requirements (with matching-lot counts); create one |
| PATCH, DELETE | `/api/buyer-demands/:id` | owner | Edit an open requirement; delete it |
| POST | `/api/buyer-demands/:id/fulfil` | owner | Mark fulfilled |
| GET | `/api/buyer-demands/:id/matches` | owner | Open lots that fit, with quantity/quality checks and freight |
| GET | `/api/suppliers?crop=&location=&q=` | buyer, admin | Farmers and verified FPOs with open produce |
| GET | `/api/suppliers/:kind/:id` | buyer, admin | One supplier (`farmer` or `fpo`) and their open lots |

### Crop quality: photos, grade checks and reviews

New lots need 1–3 photos taken with the in-app camera (the app has no gallery or file upload). The server accepts only JPEG/WebP of 5 KB–1.5 MB and refuses an image already used on any lot. The buyer records the grade that arrived; a lower grade than listed opens a dispute automatically. After delivery the buyer leaves one 1–5 star review. Lots carry the farmer's rating and "grade as listed" record.

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/api/lots` | farmer, fpo | Now requires `photos: [{ data_base64, latitude?, longitude? }]` (1–3) |
| GET, POST | `/api/lots/:id/photos` | any / lot owner | List photos (data URLs) / add one more (max 3, open lots) |
| DELETE | `/api/lot-photos/:id` | lot owner | Remove a photo (an open lot keeps at least one) |
| POST | `/api/transactions/:id/grade-check` | buyer of the order | `{ received_grade, note?, photo? }` once in transit or delivered; lower grade needs a note or photo and opens a dispute |
| POST | `/api/transactions/:id/review` | buyer of the order | `{ rating 1–5, comment?, received_grade? }` once delivered (grade needed if not checked on arrival) |
| GET | `/api/transactions/:id/quality` | buyer, farmer, admin | This order's grade check and review |
| GET | `/api/farmers/:id/reviews` | any | Rating, grade record and latest reviews |

### Messages and notifications

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/conversations` | farmer, buyer, fpo | Conversations with last message and unread count |
| GET, POST | `/api/conversations/:user_id/messages` | farmer, buyer, fpo | Read a thread (marks it read) / send `{ body, lot_id?, transaction_id? }` |
| GET | `/api/notifications` | any | Latest 100 notifications |
| POST | `/api/notifications/:id/read`, `/api/notifications/read-all` | any | Mark read |
| GET | `/api/announcements` | any | FPO and admin announcements for me |

### FPO portal (`fpo` role, verified FPO; data limited to the caller's FPO)

| Method | Path | Purpose |
|---|---|---|
| GET, PUT | `/api/fpo/org` | Organisation profile |
| GET | `/api/fpo/dashboard`, `/api/fpo/notifications` | Dashboard and the "needs attention" checklist (notifications themselves: `/api/notifications`) |
| GET, POST / GET, PUT | `/api/fpo/members`, `/api/fpo/members/:id` | Members (optional farmer login) |
| GET, POST / POST | `/api/fpo/contributions`, `/api/fpo/contributions/:id/:action` | Direct contributions, approve or reject |
| GET, POST / GET, POST | `/api/fpo/pools`, `/api/fpo/pools/:id` (+ `/contributions`, `/contributions/:cid/intake`, `/action/:action`) | Crop pools: pledge, intake by grade, open, lock, list, cancel |
| GET, POST / GET | `/api/fpo/lots`, `/api/fpo/lots/:id` (+ `/warehouse`, `/quality`, `/matches`, `/advice`) | Bulk lots, storage, grading, buyer matches, sell advice |
| GET | `/api/fpo/quality`, `/api/fpo/buyers`, `/api/fpo/demand` | Quality records, buyers, demand forecast |
| GET, POST / POST | `/api/fpo/offers`, `/api/fpo/offers/:id/respond` | Negotiate with buyers |
| GET / POST, PUT | `/api/fpo/sales/:id` (+ `/payments`, `/expenses`, `/distribution`) | Sales, payments, expenses, payout split |
| POST | `/api/fpo/payouts/:id/pay` | Mark a member payout paid |
| GET, POST | `/api/fpo/warehouses`, `/api/fpo/transporters`, `/api/fpo/shipments` (+ `/:id/status`) | Logistics |
| GET, POST | `/api/fpo/grievances` (+ `/:id/status`, `/:id/documents`), `/api/fpo/documents/:id` | Grievances and files |
| GET | `/api/fpo/reports/:kind`, `/api/fpo/audit` | Reports (CSV) and activity log |
| GET / POST | `/api/fpo/join-requests`, `/api/fpo/join-requests/:id/:action` | Farmers asking to join |
| GET, POST | `/api/fpo/announcements` | Announcements to members |

Farmer side of FPOs: `GET /api/fpos` (find FPOs), `POST /api/fpos/:id/join-requests`, `GET /api/fpo/my`, `GET /api/fpo/my/pools`, `POST /api/fpo/my/pools/:id/pledge`, `POST /api/fpo/my/grievances`.
Buyer side: `GET /api/fpo-market/lots`, `GET, POST /api/fpo-market/offers`, `POST /api/fpo-market/offers/:id/respond` (offering, countering and accepting need a verified buyer), `POST /api/fpo-market/sales/:id/disputes` (raise a dispute on an FPO sale; notifies the FPO and holds farmer payouts until resolved).

### Admin (`admin` role; every change is written to the audit log)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/overview` | Platform metrics and charts |
| GET | `/api/admin/verifications` | FPOs and buyers waiting |
| POST | `/api/admin/fpos/:id/decision`, `/api/admin/buyers/:id/decision` | Approve, or send back / decline with a reason |
| POST | `/api/admin/buyers/:id/trust` | Set a buyer's trust score |
| GET / GET / POST | `/api/admin/users`, `/api/admin/users/:id`, `/api/admin/users/:id/status` | Users, detail, suspend or reactivate |
| GET | `/api/admin/market/{lots,offers,demands,transactions,flags}` | Marketplace monitoring and suspicious activity |
| POST | `/api/admin/lots/:id/cancel`, `/api/admin/offers/:id/cancel`, `/api/admin/fpo-offers/:id/cancel` | Cancel with a reason |
| GET / GET / POST | `/api/admin/disputes`, `/api/admin/disputes/:id`, `/api/admin/disputes/:id/status` | Disputes |
| GET | `/api/admin/intel/supply-demand`, `/api/admin/intel/prices` | Market intelligence |
| GET, POST / PUT, DELETE | `/api/admin/master/:table`, `/api/admin/master/:table/:id` | Crops, markets, transport and storage rates |
| GET, POST | `/api/admin/announcements` | Advisories |
| GET / POST | `/api/admin/crop-requests`, `/api/admin/crop-requests/:id/:action` | Crop requests: `add` (optionally with a corrected `name`) or `dismiss`; the requester is notified |
| GET | `/api/admin/fpos`, `/api/admin/buyers` | FPO and buyer summaries (read-only) |
| GET | `/api/admin/audit` | Audit log |

Lists in the admin API are paginated: `{ items, total, page, limit, pages }`.

## Database and sample data

- Migrations in `migrations/` run on start. **Never edit an applied migration**; see [docs/database/migrations.md](../docs/database/migrations.md).
- `seed.rs` loads master data, the admin (from env) and sample accounts. `seed_demo.rs` adds sample data for every portal (buyer requirements, the Punjab Kisan FPO with members, pools, a settled sale and payouts, a pending FPO and buyer, a delivered farmer order with a payment waiting for confirmation, a message thread, a dispute and audit entries). Both only add what is missing, so restarting never duplicates or overwrites data.
- Delete the database file to start over.

## Tests

```sh
cargo test                  # rules, ranking, forecast, payouts, and database flows
cargo clippy --all-targets  # expected: no warnings
```

The database tests in `market.rs` cover counter-offers ending in an order, rejecting and withdrawing, payment status from pending to paid, supplier listing and filters, messages, notifications, unverified buyers being blocked from offering and accepting, and farmer sign-up storing district and state. `fpo_pools.rs` tests that receiving a pledge notifies the farmer.

Removed: `POST /api/admin/fpos/:id/verify`, `POST /api/admin/buyers/:id/verify` (use `/decision`), and `GET /api/notifications/mine` + `POST /api/notifications/mine/read` (use `/api/notifications`).
