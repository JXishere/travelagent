-- Add areas_contributed to contributors for area-level expansion tracking
ALTER TABLE contributors ADD COLUMN IF NOT EXISTS areas_contributed text[] DEFAULT '{}';

-- Backfill from existing spot data
UPDATE contributors c
SET areas_contributed = ARRAY(
  SELECT DISTINCT s.area FROM spots s
  WHERE s.contributor_id = c.id AND s.area IS NOT NULL
);
