-- Add is_closed flag to spots table
-- Used by the spot correction flow to permanently hide closed venues from recommendations
ALTER TABLE spots ADD COLUMN IF NOT EXISTS is_closed boolean NOT NULL DEFAULT false;

-- Spot corrections table — attribution for user-reported corrections
CREATE TABLE IF NOT EXISTS spot_corrections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  spot_id uuid REFERENCES spots(id) ON DELETE CASCADE,
  reporter_id text NOT NULL,
  correction_type text NOT NULL CHECK (correction_type IN ('closed', 'moved', 'wrong_info', 'other')),
  correction_note text,
  delta jsonb,
  created_at timestamptz DEFAULT now()
);
