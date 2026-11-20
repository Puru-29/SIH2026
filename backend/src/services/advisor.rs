use crate::models::{Crop, SmartSaleRequest, SmartSaleResponse, SmartSaleStrategy, UrgencyLevel};

// Simple rule engine: sell now, wait, or split based on perishability, urgency, and price gain.
pub fn evaluate_smart_sale(req: &SmartSaleRequest, crop: &Crop) -> SmartSaleResponse {
    let immediate_revenue = req.current_price_per_quintal * req.quantity_quintals;
    let immediate_net_realisation = immediate_revenue - req.handling_costs;

    // Assume we can hold for half the crop's shelf life at most.
    let wait_days = (crop.perishability_days as f64 / 2.0).max(1.0);
    let storage_cost_total = req.storage_cost_per_day * wait_days * req.quantity_quintals;
    let future_revenue = req.expected_future_price * req.quantity_quintals;
    let future_net_realisation = future_revenue - req.handling_costs - storage_cost_total;

    let price_gain_pct = if immediate_net_realisation > 0.0 {
        (future_net_realisation - immediate_net_realisation) / immediate_net_realisation
    } else {
        0.0
    };

    let urgency = req.farmer_urgency;
    let is_highly_perishable = crop.perishability_days <= 3;

    if is_highly_perishable || urgency == UrgencyLevel::High || price_gain_pct < 0.02 {
        return SmartSaleResponse {
            strategy: SmartSaleStrategy::SellNow,
            reason: "Selling now is optimal: crop is highly perishable, farmer urgency is high, \
                     or expected price gains are too small to justify storage risk."
                .to_string(),
            immediate_net_realisation,
            future_net_realisation,
            suggested_sell_ratio: 1.0,
        };
    }

    if price_gain_pct > 0.10 && urgency == UrgencyLevel::Low {
        return SmartSaleResponse {
            strategy: SmartSaleStrategy::Wait,
            reason: format!(
                "Expected price gain of {:.1}% justifies waiting up to {:.0} days. \
                 Storage costs are viable given low farmer urgency.",
                price_gain_pct * 100.0,
                wait_days
            ),
            immediate_net_realisation,
            future_net_realisation,
            suggested_sell_ratio: 0.0,
        };
    }

    // Split the numbers by what we'd actually sell vs hold.
    let sell_ratio = 0.5_f64;
    let partial_immediate = (req.current_price_per_quintal * req.quantity_quintals * sell_ratio)
        - (req.handling_costs * sell_ratio);
    let partial_future = (req.expected_future_price * req.quantity_quintals * (1.0 - sell_ratio))
        - (req.handling_costs * (1.0 - sell_ratio))
        - (req.storage_cost_per_day * wait_days * req.quantity_quintals * (1.0 - sell_ratio));

    SmartSaleResponse {
        strategy: SmartSaleStrategy::PartialSell,
        reason: format!(
            "Moderate expected gain of {:.1}%. Sell {:.0}% now to cover immediate costs \
             and hold {:.0}% for a better price in up to {:.0} days.",
            price_gain_pct * 100.0,
            sell_ratio * 100.0,
            (1.0 - sell_ratio) * 100.0,
            wait_days
        ),
        immediate_net_realisation: partial_immediate,
        future_net_realisation: partial_future,
        suggested_sell_ratio: sell_ratio,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_crop(perishability_days: i64) -> Crop {
        Crop {
            id: 1,
            name: "Test".to_string(),
            perishability_days,
        }
    }

    #[test]
    fn test_sell_now_high_urgency() {
        // high urgency wins even if the future price looks great
        let req = SmartSaleRequest {
            crop_id: 1,
            quantity_quintals: 10.0,
            current_price_per_quintal: 2000.0,
            expected_future_price: 2500.0,
            storage_cost_per_day: 10.0,
            farmer_urgency: UrgencyLevel::High,
            handling_costs: 100.0,
        };
        let crop = make_crop(10);
        let res = evaluate_smart_sale(&req, &crop);
        assert_eq!(res.strategy, SmartSaleStrategy::SellNow);
        assert_eq!(res.suggested_sell_ratio, 1.0);
    }

    #[test]
    fn test_sell_now_highly_perishable() {
        // rots in 2 days — sell regardless of price outlook
        let req = SmartSaleRequest {
            crop_id: 1,
            quantity_quintals: 50.0,
            current_price_per_quintal: 2000.0,
            expected_future_price: 4000.0,
            storage_cost_per_day: 1.0,
            farmer_urgency: UrgencyLevel::Low,
            handling_costs: 500.0,
        };
        let crop = make_crop(2);
        let res = evaluate_smart_sale(&req, &crop);
        assert_eq!(res.strategy, SmartSaleStrategy::SellNow);
    }

    #[test]
    fn test_wait_low_urgency_high_gain() {
        // ~24% gain after storage — worth waiting when urgency is low
        let req = SmartSaleRequest {
            crop_id: 2,
            quantity_quintals: 100.0,
            current_price_per_quintal: 2000.0,
            expected_future_price: 2500.0,
            storage_cost_per_day: 2.0,
            farmer_urgency: UrgencyLevel::Low,
            handling_costs: 1000.0,
        };
        let crop = make_crop(30);
        let res = evaluate_smart_sale(&req, &crop);
        assert_eq!(res.strategy, SmartSaleStrategy::Wait);
        assert_eq!(res.suggested_sell_ratio, 0.0);
    }

    #[test]
    fn test_partial_sell_medium_urgency() {
        // ~3.5% gain with medium urgency → split the lot
        let req = SmartSaleRequest {
            crop_id: 2,
            quantity_quintals: 10.0,
            current_price_per_quintal: 2000.0,
            expected_future_price: 2100.0,
            storage_cost_per_day: 2.0,
            farmer_urgency: UrgencyLevel::Medium,
            handling_costs: 100.0,
        };
        let crop = make_crop(30);
        let res = evaluate_smart_sale(&req, &crop);
        assert_eq!(res.strategy, SmartSaleStrategy::PartialSell);
        assert_eq!(res.suggested_sell_ratio, 0.5);
        assert!(res.immediate_net_realisation < 10_000.0);
    }
}
