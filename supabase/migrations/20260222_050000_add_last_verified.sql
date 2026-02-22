-- Re-add last_verified column (dropped in 20260222_010000 as "replaced by created_at")
-- Needed for P2.B stale re-verification: tracks when a spot was last confirmed accurate
-- by its original contributor, independent of when it was created.

ALTER TABLE spots ADD COLUMN last_verified timestamptz;

-- Backfill: verified spots start with last_verified = created_at
UPDATE spots SET last_verified = created_at WHERE verified = true;

-- Index for efficient staleness queries (find spots not verified in 180+ days)
CREATE INDEX idx_spots_last_verified ON spots(last_verified) WHERE last_verified IS NOT NULL;
