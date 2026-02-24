-- match_spots_hybrid: combined structured + semantic search
-- Uses pgvector cosine similarity for ranking within structured filter constraints.
-- match_threshold is 0.1 (permissive) — structured filters already constrain the set;
-- similarity is used for ranking, not gatekeeping.
-- ORDER BY: must_go DESC, verified DESC, similarity DESC — preserves tier guarantees.

CREATE OR REPLACE FUNCTION match_spots_hybrid(
  query_embedding              vector(1536),
  filter_city                  text     DEFAULT NULL,
  filter_cities                text[]   DEFAULT NULL,
  filter_areas                 text[]   DEFAULT NULL,
  filter_categories            text[]   DEFAULT NULL,
  filter_indoor_outdoor        text     DEFAULT NULL,
  filter_exclude_weather_dependent boolean DEFAULT FALSE,
  filter_price_ranges          text[]   DEFAULT NULL,
  filter_exclude_ids           uuid[]   DEFAULT NULL,
  match_limit                  int      DEFAULT 20,
  match_threshold              float    DEFAULT 0.1
)
RETURNS TABLE (
  id                   uuid,
  name                 text,
  city                 text,
  country              text,
  area                 text,
  categories           text[],
  address              text,
  price_range          text,
  latitude             decimal,
  longitude            decimal,
  what_to_order        text[],
  what_to_skip         text[],
  pro_tips             text[],
  vibe                 text,
  indoor_outdoor       text,
  best_time_of_day     text,
  weather_dependent    boolean,
  contributor_id       uuid,
  recommendation_count int,
  contribution_count   int,
  input_method         text,
  must_go              boolean,
  verified             boolean,
  avg_rating           numeric,
  is_closed            boolean,
  needs_review         boolean,
  last_verified        timestamptz,
  created_at           timestamptz,
  embedding            vector(1536),
  similarity           float
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.name,
    s.city,
    s.country,
    s.area,
    s.categories,
    s.address,
    s.price_range,
    s.latitude,
    s.longitude,
    s.what_to_order,
    s.what_to_skip,
    s.pro_tips,
    s.vibe,
    s.indoor_outdoor,
    s.best_time_of_day,
    s.weather_dependent,
    s.contributor_id,
    s.recommendation_count,
    s.contribution_count,
    s.input_method,
    s.must_go,
    s.verified,
    s.avg_rating,
    s.is_closed,
    s.needs_review,
    s.last_verified,
    s.created_at,
    s.embedding,
    (1 - (s.embedding <=> query_embedding))::float AS similarity
  FROM spots s
  WHERE
    s.embedding IS NOT NULL
    AND s.is_closed IS NOT TRUE
    AND s.needs_review IS NOT TRUE
    AND (filter_city IS NULL OR s.city = filter_city)
    AND (filter_cities IS NULL OR s.city = ANY(filter_cities))
    AND (
      filter_areas IS NULL OR
      EXISTS (
        SELECT 1 FROM unnest(filter_areas) fa
        WHERE s.area ILIKE '%' || fa || '%'
      )
    )
    AND (filter_categories IS NULL OR s.categories && filter_categories)
    AND (
      filter_indoor_outdoor IS NULL OR
      s.indoor_outdoor = filter_indoor_outdoor OR
      s.indoor_outdoor = 'both'
    )
    AND (NOT filter_exclude_weather_dependent OR s.weather_dependent IS NOT TRUE)
    AND (filter_price_ranges IS NULL OR s.price_range = ANY(filter_price_ranges))
    AND (filter_exclude_ids IS NULL OR s.id != ALL(filter_exclude_ids))
    AND (1 - (s.embedding <=> query_embedding)) > match_threshold
  ORDER BY s.must_go DESC, s.verified DESC, (1 - (s.embedding <=> query_embedding)) DESC
  LIMIT match_limit;
END;
$$;
