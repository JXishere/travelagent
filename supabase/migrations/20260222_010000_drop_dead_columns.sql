-- Drop dead weight columns identified in schema audit (2026-02-22)
--
-- spots.payment_methods  — always NULL since 20260220 clear; live web-fetch is the source
-- spots.opening_hours    — always NULL since 20260220 clear; live web-fetch is the source
-- spots.google_pin_accurate — never read or written by any application code
-- spots.last_verified    — set on insert via DEFAULT, never updated; staleness computed from created_at instead
-- travelers.trips_taken  — never incremented or queried by any application code

ALTER TABLE spots DROP COLUMN IF EXISTS payment_methods;
ALTER TABLE spots DROP COLUMN IF EXISTS opening_hours;
ALTER TABLE spots DROP COLUMN IF EXISTS google_pin_accurate;
ALTER TABLE spots DROP COLUMN IF EXISTS last_verified;

ALTER TABLE travelers DROP COLUMN IF EXISTS trips_taken;
