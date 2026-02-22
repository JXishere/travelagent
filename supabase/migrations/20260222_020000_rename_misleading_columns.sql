-- Column renames: fix misleading names that don't match what the columns actually store
--
-- travelers.spots_visited  → spots_recommended  (stores spots recommended TO the user, not visited)
-- spots.use_count          → recommendation_count (counts recommendations, not visits)
-- spots.source             → input_method         (semantically pure: how the spot was entered)
-- feedback.did_they_go     → visited              (cleaner boolean name)
-- contributors.spots_contributed → contribution_count (matches the pattern of other count columns)
-- spot_contributions.is_must_go  → must_go        (drop the verbose "is_" prefix)
--
-- Also: remap 'llm_verified' → 'generate' in input_method enum values
-- Also: drop increment_spot_use_count RPC and create increment_recommendation_count

-- travelers
ALTER TABLE travelers RENAME COLUMN spots_visited TO spots_recommended;

-- spots
ALTER TABLE spots RENAME COLUMN use_count TO recommendation_count;
ALTER TABLE spots RENAME COLUMN source TO input_method;
UPDATE spots SET input_method = 'generate' WHERE input_method = 'llm_verified';

-- feedback
ALTER TABLE feedback RENAME COLUMN did_they_go TO visited;

-- contributors
ALTER TABLE contributors RENAME COLUMN spots_contributed TO contribution_count;

-- spot_contributions
ALTER TABLE spot_contributions RENAME COLUMN is_must_go TO must_go;

-- Update atomic RPC helper to reference the renamed column
DROP FUNCTION IF EXISTS increment_spot_use_count(uuid);
CREATE OR REPLACE FUNCTION increment_recommendation_count(p_spot_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE spots
  SET recommendation_count = COALESCE(recommendation_count, 0) + 1
  WHERE id = p_spot_id;
$$;
