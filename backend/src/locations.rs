//! Where AgriSense works: the states and districts that have mandi price data.
//! Generated from the mandi API's market list (`GET /v1/markets?state=…`).
//! Sign-up and profile only accept places in this list.

use axum::{routing::get, Json, Router};
use serde_json::{json, Value};
use sqlx::SqlitePool;

/// (state, districts), alphabetical.
pub const SERVICE_AREA: &[(&str, &[&str])] = &[
    (
        "Karnataka",
        &[
            "Bellary",
            "Bengaluru",
            "Bengaluru Rural",
            "Bengaluru South",
            "Chamarajanagar",
            "Chikkamagaluru",
            "Chitradurga",
            "Dakshina Kannada",
            "Davangere",
            "Dharwad",
            "Gadag",
            "Hassan",
            "Haveri",
            "Kalaburagi",
            "Kodagu",
            "Kolar",
            "Mandya",
            "Mysuru",
            "Raichur",
            "Shivamogga",
            "Tumakuru",
            "Udupi",
            "Uttara Kannada",
            "Yadgir",
        ],
    ),
    (
        "Madhya Pradesh",
        &[
            "Alirajpur",
            "Badwani",
            "Bhind",
            "Bhopal",
            "Burhanpur",
            "Chhatarpur",
            "Chhindwara",
            "Datia",
            "Dhar",
            "Dindori",
            "Guna",
            "Gwalior",
            "Harda",
            "Hoshangabad",
            "Indore",
            "Katni",
            "Mandsaur",
            "Morena",
            "Narmadapuram",
            "Narsinghpur",
            "Neemuch",
            "Rajgarh",
            "Ratlam",
            "Rewa",
            "Sagar",
            "Satna",
            "Sehore",
            "Seoni",
            "Shajapur",
            "Shehdol",
            "Sheopur",
            "Shivpuri",
            "Singroli",
            "Ujjain",
            "Umariya",
        ],
    ),
    (
        "Maharashtra",
        &[
            "Ahilyanagar",
            "Akola",
            "Amarawati",
            "Beed",
            "Buldhana",
            "Chandrapur",
            "Chattrapati Sambhajinagar",
            "Dharashiv",
            "Dhule",
            "Jalgaon",
            "Jalna",
            "Kolhapur",
            "Mumbai",
            "Nagpur",
            "Nandurbar",
            "Nashik",
            "Palghar",
            "Parbhani",
            "Pune",
            "Sangli",
            "Satara",
            "Solapur",
            "Thane",
            "Washim",
            "Yavatmal",
        ],
    ),
    (
        "Punjab",
        &[
            "Amritsar",
            "Bhatinda",
            "Faridkot",
            "Fatehgarh",
            "Fazilka",
            "Ferozpur",
            "Gurdaspur",
            "Hoshiarpur",
            "Jalandhar",
            "Ludhiana",
            "Mansa",
            "Moga",
            "Mohali",
            "Muktsar",
            "Nawanshahr",
            "Pathankot",
            "Patiala",
            "Ropar (Rupnagar)",
            "Sangrur",
            "Tarntaran",
        ],
    ),
    (
        "Uttar Pradesh",
        &[
            "Agra",
            "Aligarh",
            "Ambedkarnagar",
            "Amroha",
            "Auraiya",
            "Badaun",
            "Bahraich",
            "Balrampur",
            "Barabanki",
            "Bareilly",
            "Bijnor",
            "Bulandshahar",
            "Chitrakut",
            "Etah",
            "Etawah",
            "Farukhabad",
            "Firozabad",
            "Gautam Budh Nagar",
            "Ghaziabad",
            "Gorakhpur",
            "Hathras",
            "Jhansi",
            "Kannuj",
            "Kanpur",
            "Kasganj",
            "Lucknow",
            "Mainpuri",
            "Mathura",
            "Mau(Maunathbhanjan)",
            "Meerut",
            "Mirzapur",
            "Muzaffarnagar",
            "Prayagraj",
            "Rampur",
            "Saharanpur",
            "Sambhal",
            "Shahjahanpur",
            "Shamli",
            "Siddharth Nagar",
            "Sitapur",
            "Unnao",
            "Varanasi",
        ],
    ),
];

pub fn routes() -> Router<SqlitePool> {
    Router::new().route("/api/locations", get(list))
}

/// GET /api/locations — states and districts where AgriSense works (public).
async fn list() -> Json<Value> {
    Json(json!({
        "states": SERVICE_AREA
            .iter()
            .map(|(s, d)| json!({ "state": s, "districts": d }))
            .collect::<Vec<_>>(),
    }))
}

fn norm(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

/// The official spelling of a state and district, if AgriSense works there.
pub fn canonical(state: &str, district: &str) -> Option<(&'static str, &'static str)> {
    let (st, districts) = SERVICE_AREA.iter().find(|(s, _)| norm(s) == norm(state))?;
    let want = norm(district);
    let d = districts.iter().find(|d| {
        let n = norm(d);
        // "Ropar (Rupnagar)" also matches "Ropar" or "Rupnagar".
        n == want || (want.len() >= 4 && d.split(['(', ')']).any(|p| norm(p) == want))
    })?;
    Some((st, d))
}

/// Error text listing where AgriSense is available.
pub fn not_served_message() -> String {
    format!(
        "AgriSense is available only in {}. Choose your state and district from the list.",
        SERVICE_AREA
            .iter()
            .map(|(s, _)| *s)
            .collect::<Vec<_>>()
            .join(", ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_served_places_are_accepted() {
        assert_eq!(
            canonical("punjab", "ludhiana"),
            Some(("Punjab", "Ludhiana"))
        );
        assert_eq!(
            canonical("Maharashtra", "pune"),
            Some(("Maharashtra", "Pune"))
        );
        assert_eq!(
            canonical("Punjab", "Rupnagar"),
            Some(("Punjab", "Ropar (Rupnagar)"))
        );
        assert_eq!(canonical("Gujarat", "Surat"), None);
        assert_eq!(canonical("Punjab", "Pune"), None);
    }
}
