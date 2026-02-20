-- Clear stale operational data
-- opening_hours: 94% seeded from static data, always fetch live going forward
-- payment_methods: 100% inherited schema default ["cash","card"], meaningless noise

UPDATE spots SET opening_hours = NULL WHERE opening_hours IS NOT NULL;
UPDATE spots SET payment_methods = NULL WHERE payment_methods IS NOT NULL;
