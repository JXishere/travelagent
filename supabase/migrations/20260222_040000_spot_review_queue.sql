-- Spot review queue: new contributors' spots land here until admin approves them
-- Rule: contributor with < 5 approved spots OR > 5 spots in 24h → needs_review = true
-- Approved spots (needs_review = false) are visible in recommendations as normal

ALTER TABLE spots ADD COLUMN needs_review boolean DEFAULT false;

-- Sparse index — only indexes rows where review is pending, not the full table
CREATE INDEX idx_spots_needs_review ON spots(needs_review) WHERE needs_review = true;
