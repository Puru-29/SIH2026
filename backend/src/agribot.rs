//! AgriBot answers with AI: any question about farming, prices or how
//! AgriSense works, plus the signed-in user's own lots, offers, orders and FPO.
//!
//! Provider: Google Gemini (free tier, `GEMINI_API_KEY`) or Claude (`ANTHROPIC_API_KEY`).
//! Keys stay on the server. Without a key the endpoint returns 503 and the app
//! falls back to AgriBot's built-in answers.

use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::SqlitePool;

use crate::{auth::AuthUser, errors::AppError};

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2026-10-21";
const DEFAULT_MODEL: &str = "claude-haiku-5-5";
/// Free-tier Gemini model (fastest, lowest cost). Override with GEMINI_MODEL.
const DEFAULT_GEMINI_MODEL: &str = "gemini-3.5-flash-lite";
/// Other free Flash models tried when the main one is busy. Override with GEMINI_FALLBACK_MODELS.
const DEFAULT_GEMINI_FALLBACKS: &str = "gemini-3.6-flash,gemini-3.8-flash";
const MAX_HISTORY: usize = 10;
const MAX_QUESTION_CHARS: usize = 2000;

pub fn routes() -> Router<SqlitePool> {
    Router::new()
        .route("/api/agribot/ask", post(ask))
        .route("/api/agribot/messages", post(save_builtin))
        .route("/api/agribot/tts", post(tts))
        .route("/api/agribot/conversations", get(list_conversations))
        .route(
            "/api/agribot/conversations/:id",
            get(get_conversation).delete(delete_conversation),
        )
}

/// Stable instructions (cached by the API across questions).
const GUIDE: &str = r#"You are AgriBot, the assistant inside AgriSense, an Indian agri-marketplace that connects farmers, FPOs (Farmer Producer Organisations) and buyers.

Answer any question the user asks: farming, crops, mandi prices, selling, storage, payments, government schemes, and how to use AgriSense. Be practical, warm and short (usually 2-6 sentences or a short list). Farmers may have little formal education: use simple words, ₹ and quintals/kg, no jargon. For price questions, use the "Live mandi prices" section when it is given: state the typical price per quintal and per kg, the range, the best mandis and the date. If no live price is given, still help: give a rough typical range from your general knowledge, clearly labelled as an approximate estimate, and suggest the Markets page for today's exact rate. If a crop photo is attached, look at it carefully: name the crop, describe its visible quality (size, colour, uniformity, damage, rot, disease or pest signs), give a likely grade A, B or C with the reason, and practical advice; say it is an estimate from a photo. When a "Weather" section is given, use it: describe today and the next days simply, and add practical farm advice (e.g. spraying, irrigation, harvesting, covering stored crop before rain). Never invent scheme amounts or dates you are unsure of. For crop disease, pesticide doses or legal/financial decisions, give general guidance and suggest confirming with the local Krishi Vigyan Kendra or an expert.

How AgriSense works (use this to guide users to the right page):
- Farmer portal: My Crops (list a lot with 1-3 live camera photos and a grade), Markets (live mandi prices for their state), AI Decision (sell now or hold), Price Forecast, Buyers (matching buyer requirements; send offers), Orders and Logistics (track Accepted -> Picked up -> In transit -> Delivered, buyer's phone and WhatsApp after acceptance), Settlements (payments; confirm money received), My FPO (join an FPO, pledge crop to pools, see payouts), Messages, Notifications, Profile (district/state, phone OTP).
- Buyer portal: Browse Produce (farmer lots with photos, farmer rating and "grade as listed" record; FPO bulk lots), My Requirements, Suppliers, Orders, Logistics, Payments, Verification (Level 0 can only browse; Level 1 "ID Verified" = phone OTP + ID proof + business details, offers up to ₹2,00,000 per order; Level 2 "Verified Business" = business proof + bank proof + live shop photo, no limit; "Trusted Buyer" is earned automatically). On arrival the buyer checks the grade; a lower grade opens a dispute. After delivery the buyer rates the farmer.
- FPO portal (FPO managers): members and join requests, pools (collect crop, record intake weight and grade), bulk lots, offers with buyers, sales, payments, automatic farmer payouts by quantity and grade, logistics, grievances, reports.
- Offers: a buyer offers a price per quintal; the farmer can accept, reject or counter. An accepted offer becomes an order.
- Prices on AgriSense are per quintal (100 kg) unless shown per kg.

Use the "About this user" data below to answer questions about their own lots, offers, orders, payments or FPO. Only use that data; never claim to see other users' data, and never reveal phone numbers. If the data does not contain the answer, say so and point to the right page.

Language: reply in the language and script requested in "Reply language". For Hinglish, write Hindi in Roman letters. For Hindi and Marathi use Devanagari, Punjabi Gurmukhi, Gujarati Gujarati script. Keep numbers as digits. Do not use Markdown headings or tables; plain sentences or simple "-" bullets only, because replies may be read aloud."#;

#[derive(Deserialize)]
struct Turn {
    role: String,
    text: String,
}

#[derive(Deserialize)]
struct AskBody {
    question: String,
    /// "auto" or en | hi | mr | pa | gu | hinglish
    reply_lang: Option<String>,
    #[serde(default)]
    history: Vec<Turn>,
    /// Saved chat to continue (its messages become the AI's context). None = new chat.
    conversation_id: Option<i64>,
    /// Detected language of the question, stored with the message.
    question_lang: Option<String>,
    /// Optional crop photo from the in-app camera (JPEG data URL).
    image: Option<String>,
}

fn lang_instruction(code: &str) -> &'static str {
    match code {
        "en" => "English",
        "hi" => "Hindi (Devanagari script)",
        "mr" => "Marathi (Devanagari script)",
        "pa" => "Punjabi (Gurmukhi script)",
        "gu" => "Gujarati (Gujarati script)",
        "hinglish" => "Hinglish (Hindi in Roman letters)",
        _ => "the same language and script as the user's latest question",
    }
}

fn hourly_limit() -> i64 {
    std::env::var("AGRIBOT_HOURLY_LIMIT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(30)
}

/// A short, factual summary of only this user's own data.
async fn user_context(pool: &SqlitePool, user: &AuthUser) -> Result<String, AppError> {
    let mut out = vec![format!("Name: {} · Role: {}", user.name, user.role)];
    let place: Option<String> = sqlx::query_scalar(
        "SELECT COALESCE((SELECT location FROM farmers WHERE id = ?1), (SELECT location FROM buyers WHERE id = ?1))",
    )
    .bind(user.user_id)
    .fetch_one(pool)
    .await?;
    if let Some(p) = place.filter(|p| !p.is_empty()) {
        out.push(format!("Location: {p}"));
    }
    let today: String = sqlx::query_scalar("SELECT date('now')")
        .fetch_one(pool)
        .await?;
    out.push(format!("Today: {today}"));

    let order_stage = "(SELECT e.status FROM order_events e WHERE e.transaction_id = t.id
        ORDER BY CASE e.status WHEN 'delivered' THEN 3 WHEN 'in_transit' THEN 2 WHEN 'picked_up' THEN 1 ELSE 0 END DESC LIMIT 1)";
    let paid = "CAST((SELECT COALESCE(SUM(p.amount), 0) FROM transaction_payments p WHERE p.transaction_id = t.id AND p.status = 'confirmed') AS REAL)";

    match user.role.as_str() {
        "farmer" => {
            type Lot = (i64, String, f64, String, String, i64, Option<f64>);
            let lots: Vec<Lot> = sqlx::query_as(
                "SELECT l.id, c.name, CAST(l.quantity_quintals AS REAL), l.expected_quality, l.status,
                    (SELECT COUNT(*) FROM offers o WHERE o.lot_id = l.id AND o.status = 'pending'),
                    (SELECT CAST(MAX(o.price_offered) AS REAL) FROM offers o WHERE o.lot_id = l.id AND o.status = 'pending')
                 FROM lots l JOIN crops c ON c.id = l.crop_id WHERE l.farmer_id = ? ORDER BY l.id DESC LIMIT 10",
            )
            .bind(user.user_id)
            .fetch_all(pool)
            .await?;
            out.push(if lots.is_empty() {
                "Lots: none listed".into()
            } else {
                format!(
                    "Lots (newest first): {}",
                    lots.iter()
                        .map(|l| format!(
                            "LOT-{} {} {} q {} [{}]{}",
                            l.0,
                            l.1,
                            l.2,
                            l.3,
                            l.4,
                            if l.5 > 0 {
                                format!(", {} offers waiting, best ₹{}/q", l.5, l.6.unwrap_or(0.0))
                            } else {
                                String::new()
                            }
                        ))
                        .collect::<Vec<_>>()
                        .join("; ")
                )
            });
            let orders: Vec<OrderLine> = sqlx::query_as(&format!(
                "SELECT t.id, c.name, CAST(l.quantity_quintals AS REAL), CAST(t.final_price AS REAL), u.name, {order_stage}, {paid}
                 FROM transactions t JOIN offers o ON o.id = t.offer_id JOIN lots l ON l.id = o.lot_id
                 JOIN crops c ON c.id = l.crop_id JOIN users u ON u.id = o.buyer_id
                 WHERE l.farmer_id = ? ORDER BY t.id DESC LIMIT 8"
            ))
            .bind(user.user_id)
            .fetch_all(pool)
            .await?;
            push_orders(&mut out, &orders, "buyer");
            type Pay = (String, String, f64, String, Option<String>);
            let payouts: Vec<Pay> = sqlx::query_as(
                "SELECT o.name, c.name, CAST(p.net AS REAL), p.status, p.paid_on
                 FROM fpo_payouts p JOIN fpo_members m ON m.id = p.member_id
                 JOIN fpo_organizations o ON o.id = m.fpo_id
                 JOIN fpo_sales s ON s.id = p.sale_id JOIN fpo_lots fl ON fl.id = s.lot_id JOIN crops c ON c.id = fl.crop_id
                 WHERE m.user_id = ? ORDER BY p.id DESC LIMIT 5",
            )
            .bind(user.user_id)
            .fetch_all(pool)
            .await?;
            let fpos: Vec<String> = sqlx::query_scalar(
                "SELECT o.name FROM fpo_members m JOIN fpo_organizations o ON o.id = m.fpo_id
                 WHERE m.user_id = ? AND m.status = 'active'",
            )
            .bind(user.user_id)
            .fetch_all(pool)
            .await?;
            out.push(if fpos.is_empty() {
                "FPO: not a member of any FPO".into()
            } else {
                format!("FPO member of: {}", fpos.join(", "))
            });
            if !payouts.is_empty() {
                out.push(format!(
                    "FPO payouts: {}",
                    payouts
                        .iter()
                        .map(|p| format!(
                            "{} {} ₹{:.0} {}",
                            p.0,
                            p.1,
                            p.2,
                            if p.3 == "paid" {
                                format!("paid on {}", p.4.clone().unwrap_or_default())
                            } else {
                                "due (paid after the buyer pays the FPO in full)".into()
                            }
                        ))
                        .collect::<Vec<_>>()
                        .join("; ")
                ));
            }
        }
        "buyer" => {
            let badge = crate::verification::buyer_badge(pool, user.user_id).await?;
            out.push(format!(
                "Verification: {} (level {})",
                badge["label"].as_str().unwrap_or(""),
                badge["level"]
            ));
            type Req = (String, f64, f64, String);
            let reqs: Vec<Req> = sqlx::query_as(
                "SELECT c.name, CAST(d.min_quantity AS REAL), CAST(d.max_price AS REAL), d.required_by
                 FROM buyer_demand d JOIN crops c ON c.id = d.crop_id
                 WHERE d.buyer_id = ? AND d.status = 'open' ORDER BY d.id DESC LIMIT 8",
            )
            .bind(user.user_id)
            .fetch_all(pool)
            .await?;
            if !reqs.is_empty() {
                out.push(format!(
                    "Open requirements: {}",
                    reqs.iter()
                        .map(|r| format!("{} {} q up to ₹{}/q by {}", r.0, r.1, r.2, r.3))
                        .collect::<Vec<_>>()
                        .join("; ")
                ));
            }
            type Off = (i64, String, f64, String);
            let offers: Vec<Off> = sqlx::query_as(
                "SELECT o.lot_id, c.name, CAST(o.price_offered AS REAL), o.status FROM offers o
                 JOIN lots l ON l.id = o.lot_id JOIN crops c ON c.id = l.crop_id
                 WHERE o.buyer_id = ? ORDER BY o.id DESC LIMIT 8",
            )
            .bind(user.user_id)
            .fetch_all(pool)
            .await?;
            if !offers.is_empty() {
                out.push(format!(
                    "Recent offers: {}",
                    offers
                        .iter()
                        .map(|o| format!("LOT-{} {} ₹{}/q [{}]", o.0, o.1, o.2, o.3))
                        .collect::<Vec<_>>()
                        .join("; ")
                ));
            }
            let orders: Vec<OrderLine> = sqlx::query_as(&format!(
                "SELECT t.id, c.name, CAST(l.quantity_quintals AS REAL), CAST(t.final_price AS REAL), u.name, {order_stage}, {paid}
                 FROM transactions t JOIN offers o ON o.id = t.offer_id JOIN lots l ON l.id = o.lot_id
                 JOIN crops c ON c.id = l.crop_id JOIN users u ON u.id = l.farmer_id
                 WHERE o.buyer_id = ? ORDER BY t.id DESC LIMIT 8"
            ))
            .bind(user.user_id)
            .fetch_all(pool)
            .await?;
            push_orders(&mut out, &orders, "farmer");
        }
        "fpo" => {
            let org: Option<(i64, String, i64)> = sqlx::query_as(
                "SELECT id, name, verified FROM fpo_organizations WHERE manager_user_id = ?",
            )
            .bind(user.user_id)
            .fetch_optional(pool)
            .await?;
            if let Some((id, name, verified)) = org {
                let (members, pools, open_offers): (i64, i64, i64) = sqlx::query_as(
                    "SELECT (SELECT COUNT(*) FROM fpo_members WHERE fpo_id = ?1 AND status = 'active'),
                            (SELECT COUNT(*) FROM fpo_pools WHERE fpo_id = ?1 AND status IN ('collecting', 'locked')),
                            (SELECT COUNT(*) FROM fpo_offers WHERE fpo_id = ?1 AND status = 'open')",
                )
                .bind(id)
                .fetch_one(pool)
                .await?;
                out.push(format!(
                    "FPO: {name} ({}), {members} active members, {pools} open pools, {open_offers} open buyer offers",
                    if verified == 1 { "verified" } else { "waiting for admin verification" }
                ));
            }
        }
        _ => {}
    }
    Ok(out.join("\n"))
}

/// (id, crop, quintals, price per quintal, other party, tracking step, paid)
type OrderLine = (i64, String, f64, f64, String, Option<String>, f64);

fn push_orders(out: &mut Vec<String>, orders: &[OrderLine], other: &str) {
    if orders.is_empty() {
        out.push("Orders: none yet".into());
        return;
    }
    out.push(format!(
        "Orders (newest first): {}",
        orders
            .iter()
            .map(|o| {
                let total = o.2 * o.3;
                format!(
                    "#{} {} {} q at ₹{}/q = ₹{:.0} with {other} {} — tracking: {}, paid ₹{:.0} of ₹{:.0}",
                    o.0,
                    o.1,
                    o.2,
                    o.3,
                    total,
                    o.4,
                    o.5.as_deref().unwrap_or("accepted"),
                    o.6,
                    total
                )
            })
            .collect::<Vec<_>>()
            .join("; ")
    ));
}

/// Local names for common crops (Hindi, Marathi, Hinglish) → mandi commodity name.
const CROP_ALIASES: &[(&str, &str)] = &[
    // Stems: also match inflected forms (कांद्याचा, बटाट्याचे, टोमॅटोचा …).
    ("कांद", "Onion"),
    ("बटाट", "Potato"),
    ("टोमॅट", "Tomato"),
    ("टमाट", "Tomato"),
    ("गहू", "Wheat"),
    ("ਆਲੂ", "Potato"),
    ("ਟਮਾਟਰ", "Tomato"),
    ("બટાટ", "Potato"),
    ("ટામેટ", "Tomato"),
    ("ઘઉં", "Wheat"),
    ("aloo", "Potato"),
    ("alu", "Potato"),
    ("आलू", "Potato"),
    ("बटाटा", "Potato"),
    ("batata", "Potato"),
    ("pyaj", "Onion"),
    ("pyaz", "Onion"),
    ("pyaaz", "Onion"),
    ("kanda", "Onion"),
    ("प्याज", "Onion"),
    ("कांदा", "Onion"),
    ("ਪਿਆਜ਼", "Onion"),
    ("ડુંગળી", "Onion"),
    ("tamatar", "Tomato"),
    ("टमाटर", "Tomato"),
    ("टोमॅटो", "Tomato"),
    ("ટામેટા", "Tomato"),
    ("gehu", "Wheat"),
    ("gehun", "Wheat"),
    ("गेहूं", "Wheat"),
    ("गेहूँ", "Wheat"),
    ("ਕਣਕ", "Wheat"),
    ("dhan", "Paddy"),
    ("धान", "Paddy"),
    ("chawal", "Rice"),
    ("soyabean", "Soybean"),
    ("सोयाबीन", "Soybean"),
    ("kapas", "Cotton"),
    ("कपास", "Cotton"),
    ("lehsun", "Garlic"),
    ("lahsun", "Garlic"),
    ("लहसुन", "Garlic"),
    ("makka", "Maize"),
    ("मक्का", "Maize"),
];

/// Crops named in the question (max 2), matched against the crop list and local names.
async fn crops_in(pool: &SqlitePool, question: &str) -> Result<Vec<String>, AppError> {
    let q = question.to_lowercase();
    let words: Vec<&str> = q
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();
    let mut found: Vec<String> = vec![];
    let mut add = |name: &str| {
        if !found.iter().any(|f| f.eq_ignore_ascii_case(name)) && found.len() < 2 {
            found.push(name.to_string());
        }
    };
    for (alias, crop) in CROP_ALIASES {
        if words.iter().any(|w| w == alias) || (!alias.is_ascii() && q.contains(alias)) {
            add(crop);
        }
    }
    let names: Vec<String> = sqlx::query_scalar("SELECT name FROM crops")
        .fetch_all(pool)
        .await?;
    for name in names {
        let base = name
            .split(['(', ' '])
            .next()
            .unwrap_or(&name)
            .to_lowercase();
        if base.len() >= 3
            && words.iter().any(|w| {
                *w == base
                    || w.strip_suffix('s') == Some(&base)
                    || w.strip_suffix("es") == Some(&base)
            })
        {
            add(name.split(" (").next().unwrap_or(&name));
        }
    }
    Ok(found)
}

/// Today's mandi prices for crops named in the question, in the state the question
/// names (or the user's own state). Empty when no crop is mentioned.
/// Text for the AI plus one price card per crop for the chat screen.
async fn price_context(
    pool: &SqlitePool,
    user_id: i64,
    question: &str,
    user_state: Option<&str>,
) -> (String, Vec<Value>) {
    let Ok(crops) = crops_in(pool, question).await else {
        return (String::new(), vec![]);
    };
    if crops.is_empty() {
        return (String::new(), vec![]);
    }
    let mut cards: Vec<Value> = vec![];
    let state = crate::admin::region_of(question).or(user_state);
    let mut lines = vec![];
    for crop in crops {
        let fetch = |st: Option<&str>| {
            let st = st.map(str::to_string);
            let crop = crop.clone();
            async move {
                tokio::time::timeout(
                    std::time::Duration::from_secs(10),
                    crate::services::mandi::fetch_prices(st.as_deref(), Some(&crop)),
                )
                .await
                .ok()
                .and_then(Result::ok)
                .unwrap_or_default()
            }
        };
        let mut prices = fetch(state).await;
        let mut scope = state.map(str::to_string).unwrap_or_else(|| "India".into());
        let mut card_state = state.map(str::to_string);
        if prices.is_empty() && state.is_some() {
            prices = fetch(None).await;
            scope = format!("India (no {} data today)", state.unwrap_or(""));
            card_state = None;
        }
        if prices.is_empty() {
            lines.push(format!("{crop}: no live mandi price available right now."));
            continue;
        }
        crate::market::record_prices(pool, &prices).await;
        let mut modal: Vec<f64> = prices
            .iter()
            .map(|p| p.modal_price)
            .filter(|p| *p > 0.0)
            .collect();
        modal.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let median = modal.get(modal.len() / 2).copied().unwrap_or(0.0);
        // Range from typical (modal) prices, ignoring the extreme 10% at each end:
        // single mandi reports of ₹0 or ₹45,000 would otherwise distort it.
        let pct = |f: f64| {
            modal
                .get(((modal.len() as f64 - 1.0) * f).round() as usize)
                .copied()
                .unwrap_or(0.0)
        };
        let (low, high) = (pct(0.1), pct(0.9));
        let date = prices.iter().map(|p| p.date.as_str()).max().unwrap_or("");
        let mut top = prices.clone();
        top.sort_by(|a, b| {
            b.modal_price
                .partial_cmp(&a.modal_price)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let best = top
            .iter()
            .take(3)
            .map(|p| {
                format!(
                    "{} ({}) ₹{:.0}",
                    p.market,
                    p.district.as_deref().unwrap_or(&p.state),
                    p.modal_price
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!(
            "{crop} in {scope}, {n} mandi reports, latest {date}: typical (median modal) ₹{median:.0}/quintal (≈ ₹{kg:.1}/kg), usual range ₹{low:.0}–₹{high:.0}/quintal. Highest: {best}.",
            n = prices.len(),
            kg = median / 100.0,
        ));

        // Card for the chat screen: trend from saved daily prices, and the user's own lot.
        let mut history: Vec<(String, f64)> = match &card_state {
            Some(st) => sqlx::query_as(
                "SELECT arrival_date, CAST(modal_price AS REAL) FROM mandi_price_history
                 WHERE lower(commodity) = lower(?) AND state = ? ORDER BY arrival_date DESC LIMIT 10",
            )
            .bind(&crop)
            .bind(st)
            .fetch_all(pool)
            .await
            .unwrap_or_default(),
            None => vec![],
        };
        history.reverse();
        let change_pct = match history.as_slice() {
            [.., a, b] if a.1 > 0.0 => Some(((b.1 - a.1) / a.1 * 1000.0).round() / 10.0),
            _ => None,
        };
        let my_quintals: f64 = sqlx::query_scalar(
            "SELECT CAST(COALESCE(SUM(l.quantity_quintals), 0) AS REAL) FROM lots l JOIN crops c ON c.id = l.crop_id
             WHERE l.farmer_id = ? AND l.status = 'open' AND lower(c.name) = lower(?)",
        )
        .bind(user_id)
        .bind(&crop)
        .fetch_one(pool)
        .await
        .unwrap_or(0.0);
        cards.push(json!({
            "type": "price",
            "crop": crop,
            "place": scope,
            "modal": median.round(),
            "per_kg": (median / 10.0).round() / 10.0,
            "min": low.round(),
            "max": high.round(),
            "date": date,
            "reports": prices.len(),
            "change_pct": change_pct,
            "history": history.iter().map(|(d, v)| json!({ "date": d, "price": v })).collect::<Vec<_>>(),
            "best": top.iter().take(3).map(|p| json!({
                "market": p.market, "district": p.district.as_deref().unwrap_or(&p.state), "price": p.modal_price,
            })).collect::<Vec<_>>(),
            "my_quintals": if my_quintals > 0.0 { Some(my_quintals) } else { None },
            "sell_value": if my_quintals > 0.0 { Some((my_quintals * median).round()) } else { None },
        }));
    }
    (
        format!(
            "Live mandi prices (Agmarknet, government data; use these for price questions and say the date):\n{}",
            lines.join("\n")
        ),
        cards,
    )
}

/// Words that mean the user is asking about weather (English, Hindi, Marathi, Punjabi, Gujarati, Hinglish).
const WEATHER_WORDS: &[&str] = &[
    "weather",
    "rain",
    "raining",
    "rainfall",
    "temperature",
    "forecast",
    "humidity",
    "wind",
    "storm",
    "hot",
    "cold",
    "monsoon",
    "mausam",
    "barish",
    "baarish",
    "baarish",
    "tapman",
    "garmi",
    "thand",
    "मौसम",
    "बारिश",
    "वर्षा",
    "तापमान",
    "पाऊस",
    "हवामान",
    "ਮੌਸਮ",
    "ਮੀਂਹ",
    "હવામાન",
    "વરસાદ",
    "તાપમાન",
];

fn asks_weather(question: &str) -> bool {
    let q = question.to_lowercase();
    let words: Vec<&str> = q
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();
    WEATHER_WORDS
        .iter()
        .any(|w| words.contains(w) || (!w.is_ascii() && q.contains(w)))
}

/// WMO weather code → short description.
fn weather_text(code: i64) -> &'static str {
    match code {
        0 => "clear sky",
        1 | 2 => "partly cloudy",
        3 => "overcast",
        45 | 48 => "fog",
        51..=57 => "drizzle",
        61 | 63 | 80 | 81 => "rain",
        65 | 82 => "heavy rain",
        66 | 67 => "freezing rain",
        71..=77 | 85 | 86 => "snow",
        95 => "thunderstorm",
        96 | 99 => "thunderstorm with hail",
        _ => "mixed weather",
    }
}

/// Current weather and a 3-day forecast from Open-Meteo (free, no key), for the
/// user's district. Only the place name is sent. Empty when unavailable.
async fn weather_context(place: Option<&str>) -> String {
    let Some(place) = place.map(str::trim).filter(|p| !p.is_empty()) else {
        return "Weather: the user's location is not set, so no forecast is available. Ask them to set their district in Profile.".into();
    };
    let Ok(client) = http() else {
        return String::new();
    };
    let district = place.split(',').next().unwrap_or(place).trim();
    let geo: Value = match client
        .get("https://geocoding-api.open-meteo.com/v1/search")
        .query(&[
            ("name", district),
            ("count", "1"),
            ("countryCode", "IN"),
            ("language", "en"),
        ])
        .send()
        .await
    {
        Ok(r) => r.json().await.unwrap_or(Value::Null),
        Err(_) => Value::Null,
    };
    let (Some(lat), Some(lon)) = (
        geo["results"][0]["latitude"].as_f64(),
        geo["results"][0]["longitude"].as_f64(),
    ) else {
        return format!(
            "Weather: could not find \"{district}\" on the map, so no forecast is available."
        );
    };
    let name = geo["results"][0]["name"]
        .as_str()
        .unwrap_or(district)
        .to_string();
    let w: Value = match client
        .get("https://api.open-meteo.com/v1/forecast")
        .query(&[
            ("latitude", lat.to_string()),
            ("longitude", lon.to_string()),
            ("current", "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m".into()),
            ("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max".into()),
            ("timezone", "Asia/Kolkata".into()),
            ("forecast_days", "3".into()),
        ])
        .send()
        .await
    {
        Ok(r) => r.json().await.unwrap_or(Value::Null),
        Err(_) => Value::Null,
    };
    let c = &w["current"];
    if c.is_null() {
        return "Weather: the weather service is not reachable right now.".into();
    }
    let mut out = vec![format!(
        "Weather for {name} (Open-Meteo, now {}): {}, {}°C, humidity {}%, rain {} mm, wind {} km/h.",
        c["time"].as_str().unwrap_or(""),
        weather_text(c["weather_code"].as_i64().unwrap_or(-1)),
        c["temperature_2m"],
        c["relative_humidity_2m"],
        c["precipitation"],
        c["wind_speed_10m"],
    )];
    let d = &w["daily"];
    if let Some(days) = d["time"].as_array() {
        for (i, day) in days.iter().enumerate() {
            out.push(format!(
                "{}: {}, {}–{}°C, rain {} mm (chance {}%)",
                day.as_str().unwrap_or(""),
                weather_text(d["weather_code"][i].as_i64().unwrap_or(-1)),
                d["temperature_2m_min"][i],
                d["temperature_2m_max"][i],
                d["precipitation_sum"][i],
                d["precipitation_probability_max"][i],
            ));
        }
    }
    out.join("\n")
}

/* -------------------------------------------------------------------------- */
/*                          saved conversations                               */
/* -------------------------------------------------------------------------- */

async fn own_conversation(pool: &SqlitePool, user_id: i64, id: i64) -> Result<(), AppError> {
    let n: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM agribot_conversations WHERE id = ? AND user_id = ?",
    )
    .bind(id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    if n == 0 {
        return Err(AppError::NotFound("Conversation not found".into()));
    }
    Ok(())
}

/// One question and its answer, as saved in a chat.
#[derive(Default)]
struct Exchange<'a> {
    question: &'a str,
    question_lang: Option<&'a str>,
    answer: &'a str,
    answer_lang: Option<&'a str>,
    source: &'a str,
    /// Extra data for the chat screen, e.g. `{"photo": true}` or `{"cards": [...]}`.
    question_meta: Option<Value>,
    answer_meta: Option<Value>,
}

/// Saves one question and its answer; creates the conversation on the first message.
async fn save_exchange(
    pool: &SqlitePool,
    user_id: i64,
    conversation_id: Option<i64>,
    e: Exchange<'_>,
) -> Result<i64, AppError> {
    let Exchange {
        question,
        question_lang,
        answer,
        answer_lang,
        source,
        question_meta,
        answer_meta,
    } = e;
    let mut tx = pool.begin().await?;
    let id = match conversation_id {
        Some(id) => {
            let n: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM agribot_conversations WHERE id = ? AND user_id = ?",
            )
            .bind(id)
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await?;
            if n == 0 {
                return Err(AppError::NotFound("Conversation not found".into()));
            }
            sqlx::query(
                "UPDATE agribot_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            )
            .bind(id)
            .execute(&mut *tx)
            .await?;
            id
        }
        None => {
            let mut title: String = question.trim().chars().take(60).collect();
            if question.trim().chars().count() > 60 {
                title.push('…');
            }
            sqlx::query_scalar::<_, i64>(
                "INSERT INTO agribot_conversations (user_id, title) VALUES (?, ?) RETURNING id",
            )
            .bind(user_id)
            .bind(&title)
            .fetch_one(&mut *tx)
            .await?
        }
    };
    for (role, text, lang, src, meta) in [
        ("user", question, question_lang, None, question_meta),
        ("bot", answer, answer_lang, Some(source), answer_meta),
    ] {
        sqlx::query(
            "INSERT INTO agribot_messages (conversation_id, role, text, lang, source, meta) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(role)
        .bind(text)
        .bind(lang)
        .bind(src)
        .bind(meta.map(|m| m.to_string()))
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(id)
}

/// The last turns of a saved conversation, oldest first, for the AI's context.
async fn saved_turns(pool: &SqlitePool, id: i64) -> Result<Vec<(String, String)>, AppError> {
    let mut rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT role, text FROM agribot_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?",
    )
    .bind(id)
    .bind(MAX_HISTORY as i64)
    .fetch_all(pool)
    .await?;
    rows.reverse();
    Ok(rows)
}

/// GET /api/agribot/conversations — my chats, newest first.
async fn list_conversations(
    State(pool): State<SqlitePool>,
    user: AuthUser,
) -> Result<Json<Value>, AppError> {
    let rows: Vec<(i64, String, String, i64)> = sqlx::query_as(
        "SELECT c.id, c.title, COALESCE(c.updated_at, ''),
            (SELECT COUNT(*) FROM agribot_messages m WHERE m.conversation_id = c.id)
         FROM agribot_conversations c WHERE c.user_id = ? ORDER BY c.updated_at DESC, c.id DESC LIMIT 100",
    )
    .bind(user.user_id)
    .fetch_all(&pool)
    .await?;
    Ok(Json(json!(rows
        .into_iter()
        .map(|r| json!({ "id": r.0, "title": r.1, "updated_at": r.2, "messages": r.3 }))
        .collect::<Vec<_>>())))
}

/// GET /api/agribot/conversations/:id — all messages of one of my chats.
async fn get_conversation(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    own_conversation(&pool, user.user_id, id).await?;
    type Row = (
        i64,
        String,
        String,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
    );
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT id, role, text, lang, source, COALESCE(created_at, ''), meta FROM agribot_messages
         WHERE conversation_id = ? ORDER BY id",
    )
    .bind(id)
    .fetch_all(&pool)
    .await?;
    Ok(Json(json!({
        "id": id,
        "messages": rows.into_iter().map(|r| json!({
            "id": r.0, "role": r.1, "text": r.2, "lang": r.3, "source": r.4, "created_at": r.5,
            "meta": r.6.and_then(|m| serde_json::from_str::<Value>(&m).ok()),
        })).collect::<Vec<_>>(),
    })))
}

/// DELETE /api/agribot/conversations/:id
async fn delete_conversation(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    own_conversation(&pool, user.user_id, id).await?;
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM agribot_messages WHERE conversation_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM agribot_conversations WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct SaveBody {
    conversation_id: Option<i64>,
    question: String,
    question_lang: Option<String>,
    answer: String,
    answer_lang: Option<String>,
}

/// POST /api/agribot/messages — save an exchange answered offline (built-in answers).
async fn save_builtin(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<SaveBody>,
) -> Result<Json<Value>, AppError> {
    if b.question.trim().is_empty() || b.answer.trim().is_empty() {
        return Err(AppError::BadRequest("Nothing to save".into()));
    }
    let q: String = b.question.chars().take(MAX_QUESTION_CHARS).collect();
    let a: String = b.answer.chars().take(4000).collect();
    let id = save_exchange(
        &pool,
        user.user_id,
        b.conversation_id,
        Exchange {
            question: &q,
            question_lang: b.question_lang.as_deref(),
            answer: &a,
            answer_lang: b.answer_lang.as_deref(),
            source: "builtin",
            ..Default::default()
        },
    )
    .await?;
    Ok(Json(json!({ "conversation_id": id })))
}

/* -------------------------------------------------------------------------- */
/*                         read aloud (text to speech)                        */
/* -------------------------------------------------------------------------- */

/// Free-tier Gemini speech model (speaks Hindi and English). Override with GEMINI_TTS_MODEL.
const DEFAULT_TTS_MODEL: &str = "gemini-3.8-flash-lite-tts";
const MAX_TTS_CHARS: usize = 1500;

#[derive(Deserialize)]
struct TtsBody {
    text: String,
}

/// POST /api/agribot/tts `{ text }` → `{ mime_type, data }` (base64 WAV).
/// Used when the browser has no voice for the reply's language (e.g. Hindi in Brave).
async fn tts(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<TtsBody>,
) -> Result<Json<Value>, AppError> {
    let Some(key) = env_key("GEMINI_API_KEY") else {
        return Err(unavailable(
            "Read aloud in Hindi needs GEMINI_API_KEY on the server.",
        ));
    };
    // Plain text only: no Markdown symbols read out loud.
    let text: String = b
        .text
        .replace(['*', '#', '_', '`'], "")
        .trim()
        .chars()
        .take(MAX_TTS_CHARS)
        .collect();
    if text.is_empty() {
        return Err(AppError::BadRequest("Nothing to read".into()));
    }
    let used: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM agribot_log WHERE user_id = ? AND model LIKE '%tts%'
           AND created_at > datetime('now', '-1 hour')",
    )
    .bind(user.user_id)
    .fetch_one(&pool)
    .await?;
    if used >= hourly_limit() * 2 {
        return Err(AppError::TooManyRequests(
            "Read aloud limit reached for this hour. Please try again later.".into(),
        ));
    }
    let model = std::env::var("GEMINI_TTS_MODEL").unwrap_or_else(|_| DEFAULT_TTS_MODEL.into());
    let voice = std::env::var("GEMINI_TTS_VOICE").unwrap_or_else(|_| "Kore".into());
    let body = json!({
        "model": model,
        "input": text,
        "response_format": { "type": "audio" },
        "generation_config": { "speech_config": [{ "voice": voice }] },
    });
    let client = http()?;
    let mut last = 0u16;
    for attempt in 0..3u64 {
        let res = client
            .post("https://generativelanguage.googleapis.com/v1beta/interactions")
            .header("x-goog-api-key", &key)
            .json(&body)
            .send()
            .await;
        let Ok(res) = res else {
            continue;
        };
        let status = res.status();
        let data: Value = res.json().await.unwrap_or(Value::Null);
        if status.is_success() {
            let audio = data["steps"]
                .as_array()
                .into_iter()
                .flatten()
                .flat_map(|s| s["content"].as_array().cloned().unwrap_or_default())
                .find(|c| c["type"] == "audio");
            let Some(audio) = audio else {
                break;
            };
            let _ = sqlx::query(
                "INSERT INTO agribot_log (user_id, model, input_tokens, output_tokens, ok) VALUES (?, ?, ?, ?, 1)",
            )
            .bind(user.user_id)
            .bind(&model)
            .bind(data["usage"]["total_input_tokens"].as_i64().unwrap_or(0))
            .bind(data["usage"]["total_output_tokens"].as_i64().unwrap_or(0))
            .execute(&pool)
            .await;
            return Ok(Json(json!({
                "mime_type": audio["mime_type"].as_str().unwrap_or("audio/wav"),
                "data": audio["data"],
            })));
        }
        last = status.as_u16();
        tracing::warn!("Gemini TTS error {status}: {}", data["error"]["message"]);
        if !matches!(last, 429 | 500 | 502 | 503 | 504) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(800 * (attempt + 1))).await;
    }
    Err(unavailable(if last == 429 {
        "Free read-aloud limit reached for now. Please try again later."
    } else {
        "Read aloud is busy right now. Please try again in a minute."
    }))
}

/// Which AI answers: Gemini (free tier) if `GEMINI_API_KEY` is set, else Claude if
/// `ANTHROPIC_API_KEY` is set. `AGRIBOT_PROVIDER=gemini|claude` forces one.
enum Provider {
    Gemini(String),
    Claude(String),
}

fn env_key(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
}

fn provider() -> Option<Provider> {
    let gemini = env_key("GEMINI_API_KEY").map(Provider::Gemini);
    let claude = env_key("ANTHROPIC_API_KEY").map(Provider::Claude);
    match std::env::var("AGRIBOT_PROVIDER")
        .unwrap_or_default()
        .as_str()
    {
        "claude" => claude,
        "gemini" => gemini,
        _ => gemini.or(claude),
    }
}

/// Text answer plus token counts.
struct Reply {
    answer: String,
    model: String,
    input_tokens: i64,
    output_tokens: i64,
    refused: bool,
}

fn unavailable(msg: &str) -> AppError {
    AppError::ServiceUnavailable(msg.into())
}

fn http() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| AppError::InternalServerError(e.into()))
}

/// Google Gemini generateContent (free tier). Thinking kept minimal for speed.
async fn ask_gemini(
    key: &str,
    system: &str,
    turns: &[(&str, String)],
    image: Option<&str>,
) -> Result<Reply, AppError> {
    let model = std::env::var("GEMINI_MODEL").unwrap_or_else(|_| DEFAULT_GEMINI_MODEL.to_string());
    // Gemini wants alternating user/model turns: merge neighbours with the same role.
    let mut contents: Vec<Value> = vec![];
    for (role, text) in turns {
        let role = if *role == "user" { "user" } else { "model" };
        match contents.last_mut() {
            Some(last) if last["role"] == role => {
                let prev = last["parts"][0]["text"].as_str().unwrap_or("").to_string();
                last["parts"][0]["text"] = json!(format!("{prev}\n{text}"));
            }
            _ => contents.push(json!({ "role": role, "parts": [{ "text": text }] })),
        }
    }
    if let (Some(b64), Some(last)) = (image, contents.last_mut()) {
        if let Some(parts) = last["parts"].as_array_mut() {
            parts.insert(
                0,
                json!({ "inlineData": { "mimeType": "image/jpeg", "data": b64 } }),
            );
        }
    }
    let body = json!({
        "systemInstruction": { "parts": [{ "text": system }] },
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": 2000,
            "thinkingConfig": { "thinkingLevel": "minimal" },
        },
    });
    // Google's free models are sometimes briefly overloaded (503) or rate-limited (429):
    // retry, then fall back to the other free Flash models before giving up.
    let fallbacks = std::env::var("GEMINI_FALLBACK_MODELS")
        .unwrap_or_else(|_| DEFAULT_GEMINI_FALLBACKS.to_string());
    let mut models: Vec<String> = vec![model.clone()];
    for m in fallbacks
        .split(',')
        .map(str::trim)
        .filter(|m| !m.is_empty())
    {
        if !models.iter().any(|x| x == m) {
            models.push(m.to_string());
        }
    }
    let client = http()?;
    let mut last_status = 0u16;
    let mut found: Option<(String, Value)> = None;
    'models: for m in &models {
        for attempt in 0..2u64 {
            let res = client
                .post(format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent"
                ))
                .header("x-goog-api-key", key)
                .json(&body)
                .send()
                .await;
            let res = match res {
                Ok(r) => r,
                Err(e) => {
                    tracing::warn!("Gemini request to {m} failed: {e}");
                    last_status = 0;
                    continue;
                }
            };
            let status = res.status();
            let data: Value = res.json().await.unwrap_or(Value::Null);
            if status.is_success() {
                found = Some((m.clone(), data));
                break 'models;
            }
            last_status = status.as_u16();
            tracing::warn!("Gemini {m} error {status}: {}", data["error"]["message"]);
            match last_status {
                // Busy or rate-limited: wait a moment and retry, then try the next model.
                429 | 500 | 502 | 503 | 504 => {
                    tokio::time::sleep(std::time::Duration::from_millis(700 * (attempt + 1))).await
                }
                // Model not found / not allowed: try the next model straight away.
                400 | 403 | 404 => continue 'models,
                _ => break 'models,
            }
        }
    }
    let Some((model, data)) = found else {
        return Err(unavailable(match last_status {
            429 => "AgriBot's free AI limit is used up for now. Showing a built-in answer instead.",
            500..=504 => "Google's free AI is very busy right now. Showing a built-in answer — please try again in a minute.",
            0 => "AgriBot AI could not be reached. Showing a built-in answer instead.",
            _ => "AgriBot AI is not configured correctly. Showing a built-in answer instead.",
        }));
    };
    let usage = &data["usageMetadata"];
    let candidate = &data["candidates"][0];
    let blocked = !data["promptFeedback"]["blockReason"].is_null()
        || matches!(
            candidate["finishReason"].as_str(),
            Some("SAFETY" | "PROHIBITED_CONTENT" | "BLOCKLIST" | "SPII")
        );
    let answer = candidate["content"]["parts"]
        .as_array()
        .map(|parts| {
            parts
                .iter()
                // Skip thought summaries; keep the visible answer.
                .filter(|p| p["thought"] != true)
                .filter_map(|p| p["text"].as_str())
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    Ok(Reply {
        answer,
        model,
        input_tokens: usage["promptTokenCount"].as_i64().unwrap_or(0),
        output_tokens: usage["candidatesTokenCount"].as_i64().unwrap_or(0)
            + usage["thoughtsTokenCount"].as_i64().unwrap_or(0),
        refused: blocked,
    })
}

/// Anthropic Messages API (paid). Rust has no official SDK, so this is plain HTTP.
async fn ask_claude(
    key: &str,
    guide: &str,
    user_part: &str,
    turns: &[(&str, String)],
    image: Option<&str>,
) -> Result<Reply, AppError> {
    let model = std::env::var("AGRIBOT_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.into());
    let last = turns.len().saturating_sub(1);
    let messages: Vec<Value> = turns
        .iter()
        .enumerate()
        .map(|(i, (role, text))| match image {
            Some(b64) if i == last => json!({ "role": role, "content": [
                { "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": b64 } },
                { "type": "text", "text": text },
            ]}),
            _ => json!({ "role": role, "content": text }),
        })
        .collect();
    let mut body = json!({
        "model": model,
        "max_tokens": 2000,
        // Chat replies: low effort keeps them fast and cheap.
        "output_config": { "effort": "low" },
        "system": [
            { "type": "text", "text": guide, "cache_control": { "type": "ephemeral" } },
            { "type": "text", "text": user_part },
        ],
        "messages": messages,
    });
    // Server-side fallback if a safety classifier declines (not available on Haiku).
    let fallback = !model.starts_with("claude-haiku");
    if fallback {
        body["fallbacks"] = json!("default");
    }
    let mut req = http()?
        .post(API_URL)
        .header("x-api-key", key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json");
    if fallback {
        req = req.header("anthropic-beta", "server-side-fallback-2026-07-01");
    }
    let res = req.json(&body).send().await.map_err(|e| {
        tracing::warn!("Claude request failed: {e}");
        unavailable("AgriBot AI could not be reached. Showing a built-in answer instead.")
    })?;
    let status = res.status();
    let data: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        tracing::warn!("Claude API error {status}: {}", data["error"]["message"]);
        return Err(unavailable(
            "AgriBot AI is busy or not configured correctly. Showing a built-in answer instead.",
        ));
    }
    let usage = &data["usage"];
    let answer = data["content"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter(|b| b["type"] == "text")
                .filter_map(|b| b["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    Ok(Reply {
        answer,
        model,
        input_tokens: usage["input_tokens"].as_i64().unwrap_or(0)
            + usage["cache_read_input_tokens"].as_i64().unwrap_or(0)
            + usage["cache_creation_input_tokens"].as_i64().unwrap_or(0),
        output_tokens: usage["output_tokens"].as_i64().unwrap_or(0),
        refused: data["stop_reason"] == "refusal",
    })
}

/// POST /api/agribot/ask `{ question, reply_lang?, history? }` → `{ answer, source: "ai" }`
async fn ask(
    State(pool): State<SqlitePool>,
    user: AuthUser,
    Json(b): Json<AskBody>,
) -> Result<Json<Value>, AppError> {
    let Some(provider) = provider() else {
        return Err(unavailable(
            "AgriBot AI is not set up on this server (no GEMINI_API_KEY or ANTHROPIC_API_KEY).",
        ));
    };
    let question = b.question.trim();
    if question.is_empty() {
        return Err(AppError::BadRequest("Ask a question".into()));
    }
    if question.chars().count() > MAX_QUESTION_CHARS {
        return Err(AppError::BadRequest(format!(
            "Please keep the question under {MAX_QUESTION_CHARS} characters"
        )));
    }
    // A crop photo must be a camera JPEG of sensible size; the AI gets plain base64.
    let image: Option<String> = match b.image.as_deref() {
        Some(data) if !data.trim().is_empty() => {
            crate::quality::check_photo(&crate::quality::PhotoIn {
                data_base64: data.to_string(),
                latitude: None,
                longitude: None,
            })?;
            Some(
                data.split_once("base64,")
                    .map(|(_, b)| b)
                    .unwrap_or(data)
                    .to_string(),
            )
        }
        _ => None,
    };
    let used: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM agribot_log WHERE user_id = ? AND created_at > datetime('now', '-1 hour')",
    )
    .bind(user.user_id)
    .fetch_one(&pool)
    .await?;
    if used >= hourly_limit() {
        return Err(AppError::TooManyRequests(
            "You have asked AgriBot many questions in the last hour. Please try again a little later.".into(),
        ));
    }

    // Conversation: from the saved chat if given, else what the page sent.
    if let Some(id) = b.conversation_id {
        own_conversation(&pool, user.user_id, id).await?;
    }
    let saved: Vec<Turn> = match b.conversation_id {
        Some(id) => saved_turns(&pool, id)
            .await?
            .into_iter()
            .map(|(role, text)| Turn { role, text })
            .collect(),
        None => b.history,
    };
    let mut turns: Vec<(&str, String)> = vec![];
    let start = saved.len().saturating_sub(MAX_HISTORY);
    for t in &saved[start..] {
        let role = if t.role == "user" {
            "user"
        } else {
            "assistant"
        };
        let text: String = t.text.chars().take(MAX_QUESTION_CHARS).collect();
        if text.trim().is_empty() || (turns.is_empty() && role == "assistant") {
            continue;
        }
        turns.push((role, text));
    }
    turns.push(("user", question.to_string()));

    let reply_lang = lang_instruction(b.reply_lang.as_deref().unwrap_or("auto"));
    let context = user_context(&pool, &user).await?;
    let user_place: Option<String> = sqlx::query_scalar(
        "SELECT COALESCE((SELECT location FROM farmers WHERE id = ?1), (SELECT location FROM buyers WHERE id = ?1))",
    )
    .bind(user.user_id)
    .fetch_one(&pool)
    .await?;
    let user_state = user_place
        .as_deref()
        .and_then(crate::admin::region_of)
        .map(str::to_string);
    let (mut prices, cards) =
        price_context(&pool, user.user_id, question, user_state.as_deref()).await;
    if asks_weather(question) {
        prices.push_str("\n\n");
        prices.push_str(&weather_context(user_place.as_deref()).await);
    }
    let user_part = format!(
        "Reply language: {reply_lang}\n\nAbout this user (their own data only):\n{context}\n\n{prices}"
    );

    let result = match &provider {
        Provider::Gemini(key) => {
            ask_gemini(
                key,
                &format!("{GUIDE}\n\n{user_part}"),
                &turns,
                image.as_deref(),
            )
            .await
        }
        Provider::Claude(key) => ask_claude(key, GUIDE, &user_part, &turns, image.as_deref()).await,
    };
    let (model, input, output, ok) = match &result {
        Ok(r) => (r.model.clone(), r.input_tokens, r.output_tokens, true),
        Err(_) => (
            match provider {
                Provider::Gemini(_) => "gemini".to_string(),
                Provider::Claude(_) => "claude".to_string(),
            },
            0,
            0,
            false,
        ),
    };
    let _ = sqlx::query(
        "INSERT INTO agribot_log (user_id, model, input_tokens, output_tokens, ok) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(user.user_id)
    .bind(&model)
    .bind(input)
    .bind(output)
    .bind(ok)
    .execute(&pool)
    .await;
    let reply = result?;

    let answer_lang = b.reply_lang.as_deref().filter(|l| *l != "auto");
    if reply.refused {
        let answer =
            "Sorry, I can't help with that. Please ask about farming, prices, or using AgriSense.";
        let conversation_id = save_exchange(
            &pool,
            user.user_id,
            b.conversation_id,
            Exchange {
                question,
                question_lang: b.question_lang.as_deref(),
                answer,
                answer_lang,
                source: "ai",
                question_meta: image.as_ref().map(|_| json!({ "photo": true })),
                answer_meta: None,
            },
        )
        .await?;
        return Ok(Json(json!({
            "answer": answer,
            "source": "ai",
            "conversation_id": conversation_id,
        })));
    }
    if reply.answer.trim().is_empty() {
        return Err(unavailable(
            "AgriBot AI gave an empty answer. Showing a built-in answer instead.",
        ));
    }
    let conversation_id = save_exchange(
        &pool,
        user.user_id,
        b.conversation_id,
        Exchange {
            question,
            question_lang: b.question_lang.as_deref(),
            answer: reply.answer.trim(),
            answer_lang,
            source: "ai",
            question_meta: image.as_ref().map(|_| json!({ "photo": true })),
            answer_meta: if cards.is_empty() {
                None
            } else {
                Some(json!({ "cards": cards }))
            },
        },
    )
    .await?;
    Ok(Json(json!({
        "answer": reply.answer.trim(),
        "source": "ai",
        "conversation_id": conversation_id,
        "cards": cards,
        "model": reply.model,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn finds_crops_in_any_language() {
        use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
        use std::str::FromStr;
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::from_str("sqlite::memory:").unwrap())
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        for (q, want) in [
            (
                "what is the price of the potato in punjab rn",
                vec!["Potato"],
            ),
            ("TELL ME THE PRICE OF POTATOES", vec!["Potato"]),
            ("aaj pyaj ka rate kya hai", vec!["Onion"]),
            ("आलू का भाव क्या है", vec!["Potato"]),
            ("कांद्याचा आजचा भाव काय आहे?", vec!["Onion"]),
            ("ટામેટાનો ભાવ", vec!["Tomato"]),
            ("wheat and onion prices", vec!["Onion", "Wheat"]),
            ("how do I join an FPO", vec![]),
        ] {
            let mut got = crops_in(&pool, q).await.unwrap();
            got.sort();
            assert_eq!(got, want, "{q}");
        }
        assert_eq!(
            crate::admin::region_of("price in punjab rn"),
            Some("Punjab")
        );
    }

    #[tokio::test]
    async fn chats_are_saved_and_private() {
        use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
        use std::str::FromStr;
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::from_str("sqlite::memory:").unwrap())
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let mut ids = vec![];
        for phone in ["9000000601", "9000000602"] {
            ids.push(
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO users (name, role, phone_number, status) VALUES ('U', 'farmer', ?, 'active') RETURNING id",
                )
                .bind(phone)
                .fetch_one(&pool)
                .await
                .unwrap(),
            );
        }
        let ex = |q: &'static str| Exchange {
            question: q,
            question_lang: Some("en"),
            answer: "answer",
            answer_lang: Some("en"),
            source: "ai",
            ..Default::default()
        };
        let id = save_exchange(&pool, ids[0], None, ex("potato price in punjab"))
            .await
            .unwrap();
        let again = save_exchange(&pool, ids[0], Some(id), ex("and onion?"))
            .await
            .unwrap();
        assert_eq!(id, again);
        let turns = saved_turns(&pool, id).await.unwrap();
        assert_eq!(turns.len(), 4);
        assert_eq!(
            turns[0],
            ("user".to_string(), "potato price in punjab".to_string())
        );
        let title: String =
            sqlx::query_scalar("SELECT title FROM agribot_conversations WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(title, "potato price in punjab");
        // Another user can neither open nor add to it.
        assert!(own_conversation(&pool, ids[1], id).await.is_err());
        assert!(save_exchange(&pool, ids[1], Some(id), ex("hi"))
            .await
            .is_err());
    }

    #[test]
    fn spots_weather_questions() {
        assert!(asks_weather("what is weather on my location?"));
        assert!(asks_weather("kal barish hogi kya"));
        assert!(asks_weather("आज मौसम कैसा है"));
        assert!(asks_weather("પાક માટે વરસાદ ક્યારે"));
        assert!(!asks_weather("price of potato in punjab"));
        assert_eq!(weather_text(63), "rain");
    }

    #[test]
    fn languages_map_to_scripts() {
        assert!(lang_instruction("gu").contains("Gujarati script"));
        assert!(lang_instruction("hinglish").contains("Roman"));
        assert!(lang_instruction("auto").contains("same language"));
    }
}
