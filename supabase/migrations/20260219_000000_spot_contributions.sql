-- spot_contributions: per-contributor attribution for spots
-- Captures each contributor's specific notes independently from the aggregated spots table.
-- Enables surfacing diverse perspectives ("contributor A swears by X, contributor B prefers Y").

CREATE TABLE spot_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_id UUID REFERENCES spots(id) ON DELETE CASCADE NOT NULL,
  contributor_id UUID REFERENCES contributors(id) NOT NULL,
  what_to_order TEXT[] DEFAULT '{}',
  what_to_skip TEXT[] DEFAULT '{}',
  pro_tips TEXT[] DEFAULT '{}',
  vibe TEXT,
  tier INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_spot_contributions_spot_id ON spot_contributions(spot_id);
CREATE INDEX idx_spot_contributions_contributor_id ON spot_contributions(contributor_id);
