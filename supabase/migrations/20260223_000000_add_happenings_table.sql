-- Happenings table: temporal events and what's-on intel
-- Distinct from spots (which are permanent venues) — happenings have start/end dates.
-- Examples: food festivals, market pop-ups, live music nights, seasonal events.

CREATE TABLE IF NOT EXISTS happenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city text NOT NULL,
  country text,
  area text,
  description text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  recurring boolean DEFAULT false,
  -- recurrence_rule: simple string descriptor, e.g. "every Saturday", "first Sunday of month"
  recurrence_rule text,
  categories text[] DEFAULT '{}',
  source_url text,
  input_method text DEFAULT 'manual', -- manual, admin, scraped
  contributor_id uuid REFERENCES contributors(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for date-range queries (most common lookup pattern)
CREATE INDEX idx_happenings_city_dates ON happenings (city, start_date, end_date);
CREATE INDEX idx_happenings_start_date ON happenings (start_date);

-- RLS: public read, service-role write
ALTER TABLE happenings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "happenings_public_read" ON happenings
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "happenings_service_write" ON happenings
  FOR ALL TO service_role USING (true);
