INSERT OR IGNORE INTO users (id, name, role, phone_number) VALUES
    (5, 'Sahyadri Foods', 'buyer', '9123456701'),
    (6, 'Annapurna Retail', 'buyer', '9123456702'),
    (7, 'GreenLeaf Exports', 'buyer', '9123456703'),
    (8, 'Mumbai Fresh Co.', 'buyer', '9123456704');

INSERT OR IGNORE INTO buyers (id, trust_score, is_verified) VALUES
    (5, 4.7, 1),
    (6, 4.5, 1),
    (7, 4.2, 1),
    (8, 4.0, 1);

INSERT OR IGNORE INTO buyer_demand
    (buyer_id, crop_id, min_quantity, max_price, required_quality, delivery_location, required_by)
VALUES
    (5, 1, 25.0, 3200.0, 'Grade A', 'Maharashtra', '2026-09-30 00:00:00'),
    (5, 3, 30.0, 2150.0, 'Grade B', 'Maharashtra', '2026-10-20 00:00:00'),
    (6, 1, 15.0, 3100.0, 'Grade A', 'Mumbai', '2026-10-05 00:00:00'),
    (6, 2, 40.0, 2450.0, 'Grade A', 'Mumbai', '2026-11-30 00:00:00'),
    (6, 3, 18.0, 2050.0, 'Grade B', 'Mumbai', '2026-10-25 00:00:00'),
    (7, 1, 20.0, 3500.0, 'Export Grade', 'Pune', '2026-10-12 00:00:00'),
    (7, 3, 12.0, 2300.0, 'Grade A', 'Pune', '2026-11-05 00:00:00'),
    (8, 1, 35.0, 3050.0, 'Grade A', 'Navi Mumbai', '2026-09-28 00:00:00'),
    (8, 2, 60.0, 2350.0, 'Grade B', 'Navi Mumbai', '2026-12-15 00:00:00'),
    (8, 3, 25.0, 2100.0, 'Grade A', 'Navi Mumbai', '2026-10-18 00:00:00');
