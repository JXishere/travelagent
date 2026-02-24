-- Add coach_runs table for tracking autonomous self-coaching runs
-- and coached_at column on conversations for incremental analysis

CREATE TABLE coach_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at                timestamptz NOT NULL DEFAULT now(),
  conversations_analyzed int NOT NULL DEFAULT 0,
  avg_scores            jsonb,        -- {brevity, personality, ...} → float
  prev_avg_scores       jsonb,        -- scores from the run before, for trend comparison
  change_applied        bool NOT NULL DEFAULT false,
  reverted              bool NOT NULL DEFAULT false,
  system_prompt_before  text,         -- snapshot before change (enables auto-revert)
  system_prompt_after   text,         -- snapshot after change
  synthesis             text          -- full coaching report text
);

ALTER TABLE conversations ADD COLUMN coached_at timestamptz;

-- Index for fast "uncoached" filter used by onlyNew mode
CREATE INDEX conversations_coached_at_null_idx
  ON conversations (coached_at)
  WHERE coached_at IS NULL;
