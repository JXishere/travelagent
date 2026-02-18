-- Rename neighborhood → area across all tables
-- This is a column rename only — no data changes

-- Spots table: rename neighborhood column
ALTER TABLE spots RENAME COLUMN neighborhood TO area;

-- Drop and recreate the index with new name
DROP INDEX IF EXISTS idx_spots_neighborhood;
CREATE INDEX idx_spots_area ON spots(area);

-- Drop old function (return type changed — can't use CREATE OR REPLACE)
DROP FUNCTION IF EXISTS match_spots(vector, text, text[], int, float);

-- Recreate match_spots RPC with area instead of neighborhood
CREATE OR REPLACE FUNCTION match_spots(
  query_embedding vector(1536),
  filter_city text DEFAULT NULL,
  filter_categories text[] DEFAULT NULL,
  match_limit int DEFAULT 5,
  match_threshold float DEFAULT 0.3
)
RETURNS TABLE (
  id uuid,
  name text,
  city text,
  area text,
  category text,
  tier integer,
  address text,
  latitude decimal,
  longitude decimal,
  google_pin_accurate boolean,
  payment_methods text[],
  opening_hours jsonb,
  price_range text,
  what_to_order text[],
  what_to_skip text[],
  pro_tips text[],
  vibe text,
  weather_dependent boolean,
  best_time_of_day text,
  indoor_outdoor text,
  contributor_id uuid,
  confidence_score decimal,
  use_count integer,
  source text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
    SELECT
      s.id, s.name, s.city, s.area, s.category, s.tier,
      s.address, s.latitude, s.longitude, s.google_pin_accurate,
      s.payment_methods, s.opening_hours, s.price_range,
      s.what_to_order, s.what_to_skip, s.pro_tips, s.vibe,
      s.weather_dependent, s.best_time_of_day, s.indoor_outdoor,
      s.contributor_id, s.confidence_score, s.use_count, s.source,
      1 - (s.embedding <=> query_embedding) AS similarity
    FROM spots s
    WHERE s.embedding IS NOT NULL
      AND (filter_city IS NULL OR s.city = filter_city)
      AND (filter_categories IS NULL OR s.category = ANY(filter_categories))
      AND 1 - (s.embedding <=> query_embedding) > match_threshold
    ORDER BY s.tier ASC, similarity DESC
    LIMIT match_limit;
END;
$$;
