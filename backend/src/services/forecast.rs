//! A simple, explainable price outlook from daily mandi prices:
//! 7- and 14-day moving averages, a least-squares trend over the last 30 days,
//! and a damped projection with a widening range. It is a trend-based estimate,
//! not a guarantee, and says so.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Point {
    pub date: String,
    pub price: f64,
    /// "actual" or "forecast"
    pub kind: &'static str,
    pub low: Option<f64>,
    pub high: Option<f64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Outlook {
    pub current: f64,
    pub ma7: f64,
    pub ma14: f64,
    pub trend_per_day: f64,
    /// "rising", "falling" or "steady"
    pub direction: &'static str,
    pub change_14d_percent: f64,
    pub expected_7d: f64,
    pub expected_14d: f64,
    pub volatility_percent: f64,
    pub points: Vec<Point>,
    pub history_days: usize,
}

fn r2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0 + 0.0
}

pub fn moving_average(series: &[f64], n: usize) -> f64 {
    let take = n.min(series.len());
    if take == 0 {
        return 0.0;
    }
    series[series.len() - take..].iter().sum::<f64>() / take as f64
}

/// Least-squares slope (price change per step).
pub fn slope(series: &[f64]) -> f64 {
    let n = series.len() as f64;
    if n < 2.0 {
        return 0.0;
    }
    let mean_x = (n - 1.0) / 2.0;
    let mean_y = series.iter().sum::<f64>() / n;
    let (mut num, mut den) = (0.0, 0.0);
    for (i, y) in series.iter().enumerate() {
        let dx = i as f64 - mean_x;
        num += dx * (y - mean_y);
        den += dx * dx;
    }
    if den == 0.0 {
        0.0
    } else {
        num / den
    }
}

fn std_dev(series: &[f64]) -> f64 {
    let n = series.len() as f64;
    if n < 2.0 {
        return 0.0;
    }
    let m = series.iter().sum::<f64>() / n;
    (series.iter().map(|x| (x - m).powi(2)).sum::<f64>() / (n - 1.0)).sqrt()
}

/// Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// "YYYY-MM-DD" plus `days`; unparseable dates come back as "+Nd".
pub fn add_days(date: &str, days: i64) -> String {
    let parts: Vec<i64> = date
        .get(..10)
        .unwrap_or("")
        .split('-')
        .filter_map(|p| p.parse().ok())
        .collect();
    match parts.as_slice() {
        [y, m, d] if (1..=12).contains(m) && (1..=31).contains(d) => {
            let (y, m, d) = civil_from_days(days_from_civil(*y, *m, *d) + days);
            format!("{y:04}-{m:02}-{d:02}")
        }
        _ => format!("+{days}d"),
    }
}

/// Builds the outlook from (date, modal price) pairs sorted by date.
/// Needs at least 3 days of history; returns None otherwise.
pub fn outlook(history: &[(String, f64)], horizon_days: usize) -> Option<Outlook> {
    let recent: Vec<&(String, f64)> = history.iter().rev().take(30).rev().collect();
    if recent.len() < 3 {
        return None;
    }
    let series: Vec<f64> = recent.iter().map(|(_, p)| *p).collect();
    let current = *series.last()?;
    let ma7 = moving_average(&series, 7);
    let ma14 = moving_average(&series, 14);
    // Trend: slope over the window, damped so a few noisy days cannot swing it.
    let raw = slope(&series);
    let trend = raw.clamp(-0.02 * current, 0.02 * current);
    // Start from a blend of today's price and the 7-day average to smooth spikes.
    let base = 0.5 * current + 0.5 * ma7;
    let vol = std_dev(&series);
    let rel = if current > 0.0 { trend / current } else { 0.0 };
    let direction = if rel > 0.002 {
        "rising"
    } else if rel < -0.002 {
        "falling"
    } else {
        "steady"
    };
    let first14 = series[series.len().saturating_sub(14)];
    let change_14d = if first14 > 0.0 {
        (current - first14) / first14 * 100.0
    } else {
        0.0
    };
    let project = |d: usize| {
        let damp = 0.85_f64.powf(d as f64 / 7.0);
        (base + trend * d as f64 * damp).clamp(current * 0.7, current * 1.3)
    };
    let last_date = recent.last()?.0.clone();
    let mut points: Vec<Point> = recent
        .iter()
        .map(|(d, p)| Point {
            date: d.clone(),
            price: r2(*p),
            kind: "actual",
            low: None,
            high: None,
        })
        .collect();
    for d in 1..=horizon_days {
        let p = project(d);
        let spread = vol.max(current * 0.01) * (d as f64).sqrt() * 0.5;
        points.push(Point {
            date: add_days(&last_date, d as i64),
            price: r2(p),
            kind: "forecast",
            low: Some(r2((p - spread).max(0.0))),
            high: Some(r2(p + spread)),
        });
    }
    Some(Outlook {
        current: r2(current),
        ma7: r2(ma7),
        ma14: r2(ma14),
        trend_per_day: r2(trend),
        direction,
        change_14d_percent: r2(change_14d),
        expected_7d: r2(project(7)),
        expected_14d: r2(project(14)),
        volatility_percent: if current > 0.0 {
            r2(vol / current * 100.0)
        } else {
            0.0
        },
        points,
        history_days: recent.len(),
    })
}

/// A short seasonal note for common crops (month 1–12), from the usual
/// harvest calendar in north and west India. None when there is nothing useful to say.
pub fn seasonal_note(crop: &str, month: u32) -> Option<&'static str> {
    let c = crop.to_lowercase();
    let has = |k: &str| c.contains(k);
    if has("wheat") {
        return Some(match month {
            3..=5 => "Rabi harvest: arrivals peak in April and prices are usually at their lowest.",
            6..=9 => "After harvest, arrivals fall and prices usually firm up slowly.",
            _ => "Lean season before the next harvest: prices are usually firm.",
        });
    }
    if has("paddy") || has("rice") {
        return Some(match month {
            10..=12 => "Kharif harvest: heavy arrivals and government procurement at MSP.",
            1..=3 => "Post-harvest: arrivals ease and prices tend to steady.",
            _ => "Off season: arrivals are low.",
        });
    }
    if has("onion") {
        return Some(match month {
            3..=5 => "Rabi onion harvest: arrivals are high and prices usually soften.",
            8..=11 => "Lean months before the kharif crop: prices often rise sharply.",
            _ => {
                "Prices depend heavily on stored rabi stock and rain in Maharashtra and Karnataka."
            }
        });
    }
    if has("tomato") {
        return Some(match month {
            6..=8 => "Monsoon months: supply disruptions often push tomato prices up.",
            12 | 1..=3 => "Winter crop: arrivals are high and prices are usually low.",
            _ => "Highly perishable: prices can swing within days.",
        });
    }
    if has("potato") {
        return Some(match month {
            1..=3 => "Harvest season: arrivals peak and prices are usually lowest.",
            _ => "Cold-store release season: prices follow stored stock.",
        });
    }
    if has("soyabean") || has("soybean") {
        return Some(match month {
            10..=12 => "Kharif harvest: arrivals peak in October–November.",
            _ => "Off season: prices follow stocks and oil prices.",
        });
    }
    if has("cotton") {
        return Some(match month {
            10..=12 | 1 => "Cotton picking season: arrivals are high.",
            _ => "Off season: prices follow export demand.",
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hist(prices: &[f64]) -> Vec<(String, f64)> {
        prices
            .iter()
            .enumerate()
            .map(|(i, p)| (add_days("2026-10-01", i as i64), *p))
            .collect()
    }

    #[test]
    fn averages_and_slope() {
        assert_eq!(moving_average(&[1.0, 2.0, 3.0, 4.0], 2), 3.5);
        assert_eq!(moving_average(&[5.0], 7), 5.0);
        assert!((slope(&[10.0, 12.0, 14.0, 16.0]) - 2.0).abs() < 1e-9);
        assert_eq!(slope(&[3.0]), 0.0);
    }

    #[test]
    fn rising_prices_project_upward_within_bounds() {
        let h = hist(
            &(0..20)
                .map(|i| 2000.0 + 10.0 * i as f64)
                .collect::<Vec<_>>(),
        );
        let o = outlook(&h, 14).unwrap();
        assert_eq!(o.direction, "rising");
        assert!(o.expected_14d > o.current - 100.0);
        assert!(o.expected_14d <= o.current * 1.3);
        assert_eq!(o.points.iter().filter(|p| p.kind == "forecast").count(), 14);
        assert_eq!(o.points.last().unwrap().date, "2026-11-03");
        let f = o.points.last().unwrap();
        assert!(f.low.unwrap() < f.price && f.price < f.high.unwrap());
    }

    #[test]
    fn flat_prices_are_steady_and_short_history_gives_none() {
        let o = outlook(&hist(&[2500.0; 10]), 7).unwrap();
        assert_eq!(o.direction, "steady");
        assert_eq!(o.expected_7d, 2500.0);
        assert!(outlook(&hist(&[2500.0, 2510.0]), 7).is_none());
    }

    #[test]
    fn dates_roll_over_months_and_years() {
        assert_eq!(add_days("2026-10-31", 1), "2026-11-01");
        assert_eq!(add_days("2026-12-25", 10), "2027-01-04");
        assert_eq!(add_days("2028-02-28", 1), "2028-02-29");
        assert_eq!(add_days("bad", 3), "+3d");
    }

    #[test]
    fn seasonal_notes() {
        assert!(seasonal_note("Wheat", 4).unwrap().contains("harvest"));
        assert!(seasonal_note("Onion", 9).unwrap().contains("rise"));
        assert!(seasonal_note("Dragon fruit", 5).is_none());
    }
}
