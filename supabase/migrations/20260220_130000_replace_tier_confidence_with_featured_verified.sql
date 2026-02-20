-- Replace tier + confidence_score with featured + verified
-- Rationale: tier was 90% T2 (default), confidence_score was bulk-defaulted at 0.500 for llm_research
-- New model: two clean booleans — verified (human confirmed) + featured (contributor called it must-go)
-- Sort order: featured DESC, verified DESC, use_count DESC

-- Add new columns
ALTER TABLE spots ADD COLUMN featured boolean DEFAULT false;
ALTER TABLE spots ADD COLUMN verified boolean DEFAULT false;
ALTER TABLE spot_contributions ADD COLUMN is_must_go boolean DEFAULT false;

-- Migrate existing data
UPDATE spots SET verified = true WHERE source IN ('seed', 'manual', 'text', 'voice');
UPDATE spots SET verified = false WHERE source = 'llm_research';
UPDATE spots SET featured = true WHERE tier = 1;  -- preserve editorial intent

-- Drop old columns
ALTER TABLE spots DROP COLUMN tier;
ALTER TABLE spots DROP COLUMN confidence_score;
ALTER TABLE spot_contributions DROP COLUMN tier;

-- Drop old index, add new ones
DROP INDEX IF EXISTS idx_spots_tier;
CREATE INDEX idx_spots_featured ON spots(featured);
CREATE INDEX idx_spots_verified ON spots(verified);

-- Update match_spots RPC — remove tier/confidence from return and ordering
CREATE OR REPLACE FUNCTION match_spots(
  query_embedding vector(1536),
  filter_city text DEFAULT NULL,
  filter_categories text[] DEFAULT NULL,
  match_limit int DEFAULT 5
)
RETURNS TABLE (
  id uuid, name text, city text, area text, category text,
  address text, price_range text, payment_methods text[],
  what_to_order text[], what_to_skip text[], pro_tips text[],
  vibe text, indoor_outdoor text, best_time_of_day text,
  weather_dependent boolean, latitude decimal, longitude decimal,
  source text, contributor_id uuid, featured boolean, verified boolean,
  use_count int, opening_hours jsonb, embedding vector(1536),
  similarity float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.name, s.city, s.area, s.category,
    s.address, s.price_range, s.payment_methods,
    s.what_to_order, s.what_to_skip, s.pro_tips,
    s.vibe, s.indoor_outdoor, s.best_time_of_day,
    s.weather_dependent, s.latitude, s.longitude,
    s.source, s.contributor_id, s.featured, s.verified,
    s.use_count, s.opening_hours, s.embedding,
    1 - (s.embedding <=> query_embedding) AS similarity
  FROM spots s
  WHERE s.embedding IS NOT NULL
    AND (filter_city IS NULL OR s.city = filter_city)
    AND (filter_categories IS NULL OR s.category = ANY(filter_categories))
  ORDER BY s.featured DESC, s.verified DESC, similarity DESC
  LIMIT match_limit;
END;
$$;
