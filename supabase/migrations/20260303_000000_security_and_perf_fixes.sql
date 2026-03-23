-- =========================================
-- SECURITY: Enable RLS on unprotected tables
-- =========================================

-- coach_runs: service-role only (contains full system prompt snapshots)
ALTER TABLE coach_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coach_runs_service_only" ON coach_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- spot_corrections: service-role only (user correction attribution data)
ALTER TABLE spot_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "spot_corrections_service_only" ON spot_corrections
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =========================================
-- SECURITY: Pin search_path on atomic helper functions
-- =========================================

CREATE OR REPLACE FUNCTION public.append_conversation_messages(
  p_phone_number TEXT,
  p_new_messages JSONB,
  p_max_messages INTEGER DEFAULT 100
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_current JSONB;
  v_combined JSONB;
  v_count INTEGER;
BEGIN
  SELECT messages INTO v_current
  FROM conversations
  WHERE whatsapp_number = p_phone_number
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_combined := COALESCE(v_current, '[]'::jsonb) || p_new_messages;
  v_count := jsonb_array_length(v_combined);

  IF v_count > p_max_messages THEN
    SELECT jsonb_agg(elem ORDER BY ord)
    INTO v_combined
    FROM (
      SELECT elem, ord
      FROM jsonb_array_elements(v_combined) WITH ORDINALITY AS t(elem, ord)
      WHERE ord > (v_count - p_max_messages)
    ) sub;
  END IF;

  UPDATE conversations
  SET messages = v_combined,
      updated_at = NOW()
  WHERE whatsapp_number = p_phone_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_spot_contribution_count(p_spot_id UUID)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE spots
  SET contribution_count = COALESCE(contribution_count, 0) + 1
  WHERE id = p_spot_id;
END;
$$;

-- =========================================
-- PERFORMANCE: Add missing FK indexes
-- =========================================

CREATE INDEX IF NOT EXISTS idx_happenings_contributor_id
  ON happenings (contributor_id);

CREATE INDEX IF NOT EXISTS idx_spot_corrections_spot_id
  ON spot_corrections (spot_id);

-- =========================================
-- PERFORMANCE: Drop confirmed-unused indexes
-- =========================================

-- No queries filter by last_verified
DROP INDEX IF EXISTS idx_spots_last_verified;

-- Bot queries contributions by spot_id (covered by idx_spot_contributions_spot_id), not contributor_id
DROP INDEX IF EXISTS idx_spot_contributions_contributor_id;

-- No queries sort/filter by avg_rating
DROP INDEX IF EXISTS idx_spots_avg_rating;
