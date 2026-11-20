use crate::models::{NetRealisationRequest, NetRealisationResponse};

pub fn calculate_net_realisation(
    req: &NetRealisationRequest,
    current_price_per_quintal: f64,
    transport_cost_per_quintal: f64,
    storage_cost_per_quintal_per_day: f64,
) -> NetRealisationResponse {
    let sale_price_total = current_price_per_quintal * req.quantity_quintals;
    let transport_cost_total = transport_cost_per_quintal * req.quantity_quintals;
    let storage_cost_total =
        storage_cost_per_quintal_per_day * req.quantity_quintals * req.expected_storage_days;

    let net_realisation = sale_price_total
        - transport_cost_total
        - req.handling_costs
        - storage_cost_total
        - req.expected_deductions;

    NetRealisationResponse {
        sale_price_total,
        transport_cost_total,
        storage_cost_total,
        handling_costs: req.handling_costs,
        expected_deductions: req.expected_deductions,
        net_realisation,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_net_realisation() {
        let req = NetRealisationRequest {
            crop_id: 1,
            market_id: 1,
            quantity_quintals: 10.0,
            farmer_location: "Farm A".to_string(),
            handling_costs: 200.0,
            expected_deductions: 50.0,
            expected_storage_days: 2.0,
        };

        let res = calculate_net_realisation(&req, 2000.0, 50.0, 2.0);

        assert_eq!(res.sale_price_total, 20000.0);
        assert_eq!(res.transport_cost_total, 500.0);
        assert_eq!(res.storage_cost_total, 40.0);
        assert_eq!(res.net_realisation, 19210.0);
    }
}
