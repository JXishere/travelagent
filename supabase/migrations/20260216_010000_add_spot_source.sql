-- Add source column to track where each spot came from
-- Values: 'seed', 'voice', 'text', 'llm_verified', 'manual'
ALTER TABLE spots ADD COLUMN source text DEFAULT 'manual';
