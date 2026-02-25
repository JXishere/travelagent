-- Add completeness-based confidence_score (0-100 integer) to spots.
-- Distinct from the old quality float confidence_score dropped in 20260220.
-- Formula: what_to_order(25) + pro_tips(20) + address(15) + vibe(10)
--          + price_range(10) + best_time_of_day(10) + categories(10) = 100 max
-- Populated by the /api/batch-validate endpoint in the review UI.
ALTER TABLE spots ADD COLUMN IF NOT EXISTS confidence_score integer;
