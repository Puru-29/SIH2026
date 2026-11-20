//! Ranks buyer requirements for a farmer's lot.
//!
//! The database supplies candidates (same crop, still open, deadline not passed);
//! this module scores them so the farmer sees the best practical buyer first.
//!
//! Score (0–100) = weighted sum of:
//! - price 30%: the buyer's max price vs the best price among candidates
//! - trust 20%: verified badge + trust score
//! - freight 15%: freight from the farmer's location to the delivery state, as a share of price
//! - quality 15%: lot grade vs the grade the buyer asked for
//! - quantity 10%: whether the lot covers the buyer's minimum quantity
//! - deadline 10%: very short deadlines are harder to meet

use serde::Serialize;

#[derive(Debug, Clone)]
pub struct Candidate {
    pub demand_id: i64,
    pub buyer_id: i64,
    pub buyer_name: String,
    pub crop_id: i64,
    pub min_quantity: f64,
    pub max_price: f64,
    pub required_quality: String,
    pub delivery_location: String,
    pub required_by: String,
    pub verified: bool,
    pub trust_score: f64,
    /// ₹/quintal from the farmer's location to the delivery place, if a route is known.
    pub freight_per_quintal: Option<f64>,
    pub days_left: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Ranked {
    // Same fields as the BuyerDemand row, so existing clients keep working.
    pub id: i64,
    pub buyer_id: i64,
    pub crop_id: i64,
    pub min_quantity: f64,
    pub max_price: f64,
    pub required_quality: String,
    pub delivery_location: String,
    pub required_by: String,
    // Ranking details.
    pub buyer_name: String,
    pub verified: bool,
    pub trust_score: f64,
    pub freight_per_quintal: Option<f64>,
    pub net_price_per_quintal: f64,
    pub score: f64,
    pub reasons: Vec<String>,
}

/// 3 = A/export, 2 = B/standard, 1 = C/FAQ/processing, None = unknown.
pub fn grade_rank(s: &str) -> Option<i32> {
    let u = s.trim().to_uppercase();
    if u.contains("EXPORT") || u.contains("GRADE A") || u == "A" {
        Some(3)
    } else if u.contains("GRADE B") || u == "B" || u.contains("STANDARD") {
        Some(2)
    } else if u.contains("GRADE C") || u == "C" || u.contains("FAQ") || u.contains("PROCESS") {
        Some(1)
    } else {
        None
    }
}

fn round(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

pub fn rank(lot_quantity: f64, lot_quality: &str, candidates: &[Candidate]) -> Vec<Ranked> {
    let best_price = candidates
        .iter()
        .map(|c| c.max_price)
        .fold(0.0_f64, f64::max);
    let mut out: Vec<Ranked> = candidates
        .iter()
        .map(|c| {
            let mut reasons = vec![];
            let price = if best_price > 0.0 {
                c.max_price / best_price
            } else {
                0.0
            };
            if (price - 1.0).abs() < f64::EPSILON {
                reasons.push("Highest price offered".to_string());
            }
            let trust =
                (if c.verified { 0.2 } else { 0.0 }) + (c.trust_score.clamp(0.0, 5.0) / 5.0) * 0.8;
            if !c.verified {
                reasons.push("Buyer not verified".to_string());
            }
            let freight = match c.freight_per_quintal {
                Some(f) if c.max_price > 0.0 => {
                    reasons.push(format!("Freight about ₹{f:.0}/q"));
                    (1.0 - f / c.max_price).clamp(0.0, 1.0)
                }
                _ => {
                    reasons.push("Freight not known for this route".to_string());
                    0.7
                }
            };
            let quality = match (grade_rank(lot_quality), grade_rank(&c.required_quality)) {
                (Some(have), Some(need)) if have >= need => 1.0,
                (Some(_), Some(_)) => {
                    reasons.push(format!(
                        "Wants {}, lot is {lot_quality}",
                        c.required_quality
                    ));
                    0.3
                }
                _ => 0.6,
            };
            let quantity = if c.min_quantity <= 0.0 || lot_quantity >= c.min_quantity {
                1.0
            } else {
                reasons.push(format!("Needs at least {} q", c.min_quantity));
                lot_quantity / c.min_quantity
            };
            let deadline = if c.days_left < 2.0 {
                reasons.push("Needed within 2 days".to_string());
                0.5
            } else if c.days_left <= 30.0 {
                1.0
            } else {
                0.8
            };
            let score = 100.0
                * (0.30 * price
                    + 0.20 * trust
                    + 0.15 * freight
                    + 0.15 * quality
                    + 0.10 * quantity
                    + 0.10 * deadline);
            Ranked {
                id: c.demand_id,
                buyer_id: c.buyer_id,
                crop_id: c.crop_id,
                min_quantity: c.min_quantity,
                max_price: c.max_price,
                required_quality: c.required_quality.clone(),
                delivery_location: c.delivery_location.clone(),
                required_by: c.required_by.clone(),
                buyer_name: c.buyer_name.clone(),
                verified: c.verified,
                trust_score: c.trust_score,
                freight_per_quintal: c.freight_per_quintal,
                net_price_per_quintal: round(c.max_price - c.freight_per_quintal.unwrap_or(0.0)),
                score: round(score),
                reasons,
            }
        })
        .collect();
    out.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(
        id: i64,
        price: f64,
        quality: &str,
        verified: bool,
        trust: f64,
        freight: Option<f64>,
    ) -> Candidate {
        Candidate {
            demand_id: id,
            buyer_id: id,
            buyer_name: format!("B{id}"),
            crop_id: 1,
            min_quantity: 10.0,
            max_price: price,
            required_quality: quality.into(),
            delivery_location: "Pune".into(),
            required_by: "2026-12-31".into(),
            verified,
            trust_score: trust,
            freight_per_quintal: freight,
            days_left: 10.0,
        }
    }

    #[test]
    fn best_price_and_trust_rank_first() {
        let r = rank(
            20.0,
            "Grade A",
            &[
                cand(1, 2000.0, "Grade A", false, 2.0, Some(50.0)),
                cand(2, 2400.0, "Grade A", true, 4.8, Some(50.0)),
            ],
        );
        assert_eq!(r[0].id, 2);
        assert!(r[0].reasons.iter().any(|x| x == "Highest price offered"));
        assert!(r[1].reasons.iter().any(|x| x == "Buyer not verified"));
    }

    #[test]
    fn high_freight_can_outweigh_a_slightly_higher_price() {
        let near = cand(1, 2400.0, "Grade A", true, 4.5, Some(20.0));
        let far = cand(2, 2450.0, "Grade A", true, 4.5, Some(900.0));
        let r = rank(20.0, "Grade A", &[near, far]);
        assert_eq!(r[0].id, 1);
        assert_eq!(r[1].net_price_per_quintal, 1550.0);
    }

    #[test]
    fn quality_and_quantity_shortfalls_lower_the_score() {
        let ok = rank(
            20.0,
            "Grade B",
            &[cand(1, 2000.0, "Grade B", true, 4.0, None)],
        )[0]
        .score;
        let wants_a = rank(
            20.0,
            "Grade B",
            &[cand(1, 2000.0, "Grade A", true, 4.0, None)],
        )[0]
        .score;
        let too_small = rank(
            5.0,
            "Grade B",
            &[cand(1, 2000.0, "Grade B", true, 4.0, None)],
        )[0]
        .score;
        assert!(wants_a < ok);
        assert!(too_small < ok);
    }

    #[test]
    fn grades() {
        assert_eq!(grade_rank("Export Grade"), Some(3));
        assert_eq!(grade_rank("Grade B"), Some(2));
        assert_eq!(grade_rank("FAQ"), Some(1));
        assert_eq!(grade_rank("mixed"), None);
    }
}
