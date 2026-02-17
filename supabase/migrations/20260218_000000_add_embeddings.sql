-- Add pgvector support for semantic search
create extension if not exists vector;

-- Add embedding column to spots
alter table spots add column if not exists embedding vector(1536);

-- Create IVFFlat index for cosine similarity search
-- lists = 1 is appropriate for small datasets (< 1000 rows)
-- Increase lists as the dataset grows (sqrt(n) is a good rule)
create index if not exists idx_spots_embedding
  on spots using ivfflat (embedding vector_cosine_ops) with (lists = 1);

-- RPC function for semantic similarity search
create or replace function match_spots(
  query_embedding vector(1536),
  filter_city text default null,
  filter_categories text[] default null,
  match_limit int default 5,
  match_threshold float default 0.3
)
returns table (
  id uuid,
  name text,
  city text,
  neighborhood text,
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
language plpgsql
as $$
begin
  return query
    select
      s.id, s.name, s.city, s.neighborhood, s.category, s.tier,
      s.address, s.latitude, s.longitude, s.google_pin_accurate,
      s.payment_methods, s.opening_hours, s.price_range,
      s.what_to_order, s.what_to_skip, s.pro_tips, s.vibe,
      s.weather_dependent, s.best_time_of_day, s.indoor_outdoor,
      s.contributor_id, s.confidence_score, s.use_count, s.source,
      1 - (s.embedding <=> query_embedding) as similarity
    from spots s
    where s.embedding is not null
      and (filter_city is null or s.city = filter_city)
      and (filter_categories is null or s.category = any(filter_categories))
      and 1 - (s.embedding <=> query_embedding) > match_threshold
    order by s.tier asc, similarity desc
    limit match_limit;
end;
$$;
