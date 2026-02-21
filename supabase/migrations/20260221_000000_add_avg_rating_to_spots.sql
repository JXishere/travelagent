-- Add avg_rating to spots for aggregated feedback quality signal
ALTER TABLE spots ADD COLUMN IF NOT EXISTS avg_rating numeric(3,2);

-- Index for filtering/sorting low-rated spots
CREATE INDEX IF NOT EXISTS idx_spots_avg_rating ON spots(avg_rating);

-- Backfill from existing feedback (compute avg per spot)
UPDATE spots s
SET avg_rating = sub.avg_r
FROM (
  SELECT spot_id, ROUND(AVG(rating)::numeric, 2) AS avg_r
  FROM feedback
  WHERE rating IS NOT NULL AND did_they_go = true
  GROUP BY spot_id
) sub
WHERE s.id = sub.spot_id;
