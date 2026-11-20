//! Rules for farmer–buyer deals, kept free of the database so they can be tested:
//! who may answer an offer, how an order moves forward, and how payment status
//! and net realisation are worked out.

use serde::Serialize;

/// The role that must answer an offer created by `created_by_role`.
pub fn responder_role(created_by_role: &str) -> &'static str {
    if created_by_role == "buyer" {
        "farmer"
    } else {
        "buyer"
    }
}

/// Checks that `actor_role` may reject or counter this offer.
/// Returns a plain-language reason when not allowed.
pub fn can_respond(
    offer_status: &str,
    created_by_role: &str,
    actor_role: &str,
) -> Result<(), String> {
    if offer_status != "pending" {
        return Err(format!(
            "This offer is already {offer_status}; only pending offers can be answered"
        ));
    }
    if actor_role != responder_role(created_by_role) {
        return Err(format!(
            "This offer was made by the {created_by_role}; only the {} can answer it",
            responder_role(created_by_role)
        ));
    }
    Ok(())
}

/// A counter price must be positive and different from the price being answered.
pub fn validate_counter_price(old_price: f64, new_price: f64) -> Result<(), String> {
    if !(new_price.is_finite() && new_price > 0.0) {
        return Err("Enter a price above ₹0 per quintal".into());
    }
    if (new_price - old_price).abs() < 0.005 {
        return Err("A counter offer must have a different price".into());
    }
    Ok(())
}

pub const ORDER_STEPS: [&str; 4] = ["accepted", "picked_up", "in_transit", "delivered"];

fn step_index(status: &str) -> Option<usize> {
    ORDER_STEPS.iter().position(|s| *s == status)
}

/// The latest step reached; old deals stored as 'completed' count as accepted
/// until someone records a delivery step.
pub fn current_step<'a>(events: impl IntoIterator<Item = &'a str>) -> &'static str {
    events
        .into_iter()
        .filter_map(step_index)
        .max()
        .map(|i| ORDER_STEPS[i])
        .unwrap_or("accepted")
}

/// Checks an order status update. The farmer (seller) records pickup and
/// transit; either side can record delivery. Steps only move forward, and a
/// step can be skipped (for example straight to delivered for a buyer pickup).
pub fn can_set_order_status(current: &str, requested: &str, role: &str) -> Result<(), String> {
    let (Some(cur), Some(req)) = (step_index(current), step_index(requested)) else {
        return Err(format!("Unknown order status '{requested}'"));
    };
    if req <= cur {
        return Err(format!(
            "This order is already {}; it can only move forward",
            current.replace('_', " ")
        ));
    }
    match (role, requested) {
        ("farmer", _) => Ok(()),
        ("buyer", "delivered") => Ok(()),
        ("buyer", _) => Err("Only the farmer can mark pickup and transit".into()),
        _ => Err("Only the farmer or buyer on this order can update it".into()),
    }
}

/// Payment status of a deal from its total value and the payments recorded.
/// `confirmed` = received as confirmed by the farmer; `awaiting` = marked paid
/// by the buyer but not yet confirmed.
pub fn payment_status(total_due: f64, confirmed: f64, awaiting: f64) -> &'static str {
    const EPS: f64 = 0.5; // half a rupee
    if total_due > 0.0 && confirmed + EPS >= total_due {
        "paid"
    } else if awaiting > EPS {
        "awaiting_confirmation"
    } else if confirmed > EPS {
        "partially_paid"
    } else {
        "pending"
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct NetRealisation {
    pub gross: f64,
    pub transport: f64,
    pub freight_per_quintal: f64,
    pub freight_known: bool,
    pub platform_fee: f64,
    pub platform_fee_percent: f64,
    pub net: f64,
    pub net_per_quintal: f64,
}

fn r2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0 + 0.0
}

/// What the farmer takes home from a deal: price × quantity, minus freight
/// (when the farmer delivers) and the platform fee.
pub fn net_realisation(
    price_per_quintal: f64,
    quantity_quintals: f64,
    freight_per_quintal: Option<f64>,
    fee_percent: f64,
) -> NetRealisation {
    let gross = price_per_quintal * quantity_quintals;
    let freight = freight_per_quintal.unwrap_or(0.0);
    let transport = freight * quantity_quintals;
    let fee = gross * fee_percent / 100.0;
    let net = gross - transport - fee;
    NetRealisation {
        gross: r2(gross),
        transport: r2(transport),
        freight_per_quintal: r2(freight),
        freight_known: freight_per_quintal.is_some(),
        platform_fee: r2(fee),
        platform_fee_percent: fee_percent,
        net: r2(net),
        net_per_quintal: if quantity_quintals > 0.0 {
            r2(net / quantity_quintals)
        } else {
            0.0
        },
    }
}

/// Platform fee on direct farmer–buyer deals, from `PLATFORM_FEE_PERCENT` (default 0).
pub fn platform_fee_percent() -> f64 {
    std::env::var("PLATFORM_FEE_PERCENT")
        .ok()
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|v| (0.0..=20.0).contains(v))
        .unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_other_side_can_answer_an_offer() {
        assert!(can_respond("pending", "buyer", "farmer").is_ok());
        assert!(can_respond("pending", "farmer", "buyer").is_ok());
        assert!(can_respond("pending", "buyer", "buyer").is_err());
        assert!(can_respond("pending", "farmer", "farmer").is_err());
    }

    #[test]
    fn answered_offers_cannot_be_countered_again() {
        for status in ["accepted", "rejected", "countered", "cancelled"] {
            let err = can_respond(status, "buyer", "farmer").unwrap_err();
            assert!(err.contains(status), "{err}");
        }
    }

    #[test]
    fn counter_price_must_change_and_be_positive() {
        assert!(validate_counter_price(2000.0, 2200.0).is_ok());
        assert!(validate_counter_price(2000.0, 2000.0).is_err());
        assert!(validate_counter_price(2000.0, 0.0).is_err());
        assert!(validate_counter_price(2000.0, f64::NAN).is_err());
    }

    #[test]
    fn order_moves_forward_only() {
        assert!(can_set_order_status("accepted", "picked_up", "farmer").is_ok());
        assert!(can_set_order_status("picked_up", "in_transit", "farmer").is_ok());
        assert!(can_set_order_status("in_transit", "delivered", "buyer").is_ok());
        assert!(can_set_order_status("accepted", "delivered", "buyer").is_ok());
        assert!(can_set_order_status("in_transit", "picked_up", "farmer").is_err());
        assert!(can_set_order_status("delivered", "delivered", "farmer").is_err());
        assert!(can_set_order_status("accepted", "picked_up", "buyer").is_err());
        assert!(can_set_order_status("accepted", "lost", "farmer").is_err());
    }

    #[test]
    fn current_step_is_the_furthest_event() {
        assert_eq!(current_step([]), "accepted");
        assert_eq!(
            current_step(["accepted", "in_transit", "picked_up"]),
            "in_transit"
        );
        assert_eq!(current_step(["completed"]), "accepted");
    }

    #[test]
    fn payment_status_changes() {
        assert_eq!(payment_status(10_000.0, 0.0, 0.0), "pending");
        assert_eq!(
            payment_status(10_000.0, 0.0, 10_000.0),
            "awaiting_confirmation"
        );
        assert_eq!(payment_status(10_000.0, 4_000.0, 0.0), "partially_paid");
        assert_eq!(
            payment_status(10_000.0, 4_000.0, 6_000.0),
            "awaiting_confirmation"
        );
        assert_eq!(payment_status(10_000.0, 10_000.0, 0.0), "paid");
        assert_eq!(payment_status(10_000.0, 9_999.8, 0.0), "paid");
    }

    #[test]
    fn net_realisation_subtracts_freight_and_fee() {
        let n = net_realisation(2_500.0, 20.0, Some(60.0), 1.0);
        assert_eq!(n.gross, 50_000.0);
        assert_eq!(n.transport, 1_200.0);
        assert_eq!(n.platform_fee, 500.0);
        assert_eq!(n.net, 48_300.0);
        assert_eq!(n.net_per_quintal, 2_415.0);
        let unknown = net_realisation(2_500.0, 20.0, None, 0.0);
        assert!(!unknown.freight_known);
        assert_eq!(unknown.net, 50_000.0);
    }
}
