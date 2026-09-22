use anyhow::{anyhow, Context};
use serde::Deserialize;

use crate::models::LiveMandiPrice;

const DEFAULT_BASE_URL: &str = "https://mandi-api.onrender.com/v1";
const DEFAULT_STATE: &str = "Maharashtra";

#[derive(Debug, Deserialize)]
struct MandiEnvelope {
    success: bool,
    data: Vec<MandiRecord>,
}

#[derive(Debug, Deserialize)]
struct StringListEnvelope {
    success: bool,
    data: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct MandiRecord {
    state: Option<String>,
    district: Option<String>,
    market: String,
    commodity: Option<String>,
    variety: Option<String>,
    grade: Option<String>,
    arrival_date: Option<String>,
    min_price: f64,
    max_price: f64,
    modal_price: f64,
}

pub async fn fetch_prices(
    state: Option<&str>,
    commodity: Option<&str>,
) -> anyhow::Result<Vec<LiveMandiPrice>> {
    let base_url =
        std::env::var("MANDI_API_BASE_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string());
    let state = state
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .or_else(|| std::env::var("MANDI_API_STATE").ok())
        .unwrap_or_else(|| DEFAULT_STATE.to_string());

    let mut request = reqwest::Client::new()
        .get(format!("{base_url}/prices"))
        .query(&[("state", state.as_str())]);
    if let Some(commodity) = commodity.filter(|value| !value.trim().is_empty()) {
        request = request.query(&[("commodity", commodity)]);
    }

    let response = request
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .context("request to Mandi API failed")?;

    let status = response.status();
    let envelope: MandiEnvelope = response
        .json()
        .await
        .with_context(|| format!("invalid Mandi API response ({status})"))?;

    if !status.is_success() {
        return Err(anyhow!("Mandi API returned HTTP {status}"));
    }
    if !envelope.success {
        return Err(anyhow!("Mandi API returned success=false"));
    }

    Ok(envelope
        .data
        .into_iter()
        .enumerate()
        .map(|(index, record)| {
            let modal_price = if record.modal_price > 0.0 {
                record.modal_price
            } else {
                (record.min_price + record.max_price) / 2.0
            };

            LiveMandiPrice {
                id: format!(
                    "{}-{}-{}-{index}",
                    record.arrival_date.as_deref().unwrap_or("unknown"),
                    record.market,
                    record.commodity.as_deref().unwrap_or("unknown")
                ),
                crop_name: record.commodity.unwrap_or_else(|| "Unknown".to_string()),
                state: record.state.unwrap_or_else(|| state.clone()),
                district: record.district,
                market: record.market,
                variety: record.variety,
                grade: record.grade,
                min_price: record.min_price,
                max_price: record.max_price,
                modal_price,
                price_per_kg: modal_price / 100.0,
                date: record.arrival_date.unwrap_or_else(|| "Unknown".to_string()),
            }
        })
        .collect())
}

pub async fn fetch_states() -> anyhow::Result<Vec<String>> {
    fetch_string_list("/states", &[]).await
}

pub async fn fetch_commodities(state: Option<&str>) -> anyhow::Result<Vec<String>> {
    let query = state
        .filter(|value| !value.trim().is_empty())
        .map(|value| vec![("state", value)]);
    fetch_string_list("/commodities", query.as_deref().unwrap_or(&[])).await
}

async fn fetch_string_list(path: &str, query: &[(&str, &str)]) -> anyhow::Result<Vec<String>> {
    let base_url =
        std::env::var("MANDI_API_BASE_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string());
    let response = reqwest::Client::new()
        .get(format!("{base_url}{path}"))
        .query(query)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .context("request to Mandi API failed")?;
    let status = response.status();
    let envelope: StringListEnvelope = response
        .json()
        .await
        .with_context(|| format!("invalid Mandi API response ({status})"))?;
    if !status.is_success() || !envelope.success {
        return Err(anyhow!("Mandi API returned HTTP {status}"));
    }
    Ok(envelope.data)
}
