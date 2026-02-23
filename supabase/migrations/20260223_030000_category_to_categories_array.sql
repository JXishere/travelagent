-- category text → categories text[] (idempotent) + fix match_spots RPC
--
-- The column migration was applied manually in Feb 2026 but the file was never committed.
-- The critical fix here is match_spots: it still references columns dropped by
-- 20260222_010000 (payment_methods, opening_hours, google_pin_accurate) and
-- columns renamed by 20260222_020000 (use_count→recommendation_count, source→input_method).
-- Calling match_spots() would fail at runtime until this migration runs.

-- Column migration (idempotent — already applied 2026-02-20)
ALTER TABLE spots ADD COLUMN IF NOT EXISTS categories text[] DEFAULT '{}';

-- Migrate any rows that still have the old single-category column
-- (no-op if category column no longer exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'spots' AND column_name = 'category'
  ) THEN
    UPDATE spots
    SET categories = ARRAY[category]
    WHERE category IS NOT NULL AND category != ''
      AND (categories IS NULL OR array_length(categories, 1) IS NULL);

    ALTER TABLE spots DROP COLUMN category;
  END IF;
END;
$$;

DROP INDEX IF EXISTS idx_spots_category;

-- GIN index for array overlap queries (&&)
CREATE INDEX IF NOT EXISTS idx_spots_categories ON spots USING gin(categories);

-- Recreate match_spots with correct current-schema column references
-- Must DROP first because the return type changed (removed dead columns, added new ones)
DROP FUNCTION IF EXISTS match_spots(vector, text, text[], int, float);

CREATE OR REPLACE FUNCTION match_spots(
  query_embedding vector(1536),
  filter_city text DEFAULT NULL,
  filter_categories text[] DEFAULT NULL,
  match_limit int DEFAULT 5,
  match_threshold float DEFAULT 0.3
)
RETURNS TABLE (
  id uuid, name text, city text, country text, area text,
  categories text[], address text, price_range text,
  latitude decimal, longitude decimal,
  what_to_order text[], what_to_skip text[], pro_tips text[],
  vibe text, indoor_outdoor text, best_time_of_day text,
  weather_dependent boolean, contributor_id uuid,
  recommendation_count int, contribution_count int,
  input_method text, must_go boolean, verified boolean,
  avg_rating numeric, is_closed boolean, needs_review boolean,
  last_verified timestamptz, created_at timestamptz,
  embedding vector(1536), similarity float
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.name, s.city, s.country, s.area,
    s.categories, s.address, s.price_range,
    s.latitude, s.longitude,
    s.what_to_order, s.what_to_skip, s.pro_tips,
    s.vibe, s.indoor_outdoor, s.best_time_of_day,
    s.weather_dependent, s.contributor_id,
    s.recommendation_count, s.contribution_count,
    s.input_method, s.must_go, s.verified,
    s.avg_rating, s.is_closed, s.needs_review,
    s.last_verified, s.created_at,
    s.embedding,
    1 - (s.embedding <=> query_embedding) AS similarity
  FROM spots s
  WHERE s.embedding IS NOT NULL
    AND (filter_city IS NULL OR s.city = filter_city)
    AND (filter_categories IS NULL OR s.categories && filter_categories)
    AND 1 - (s.embedding <=> query_embedding) > match_threshold
  ORDER BY s.must_go DESC, s.verified DESC, similarity DESC
  LIMIT match_limit;
END;
$$;
