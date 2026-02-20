-- Atomic helper functions to eliminate read-modify-write race conditions
-- Fixes:
--   appendMessages: concurrent messages from same user no longer lose history
--   incrementSpotUseCount / incrementSpotContributionCount: no more off-by-one from concurrent recommendations

-- ============================================
-- 1. Atomic message append
--    Locks the conversation row, appends new messages, trims to max_messages.
--    Replaces the read-modify-write pattern in appendMessages().
-- ============================================
CREATE OR REPLACE FUNCTION append_conversation_messages(
  p_phone_number TEXT,
  p_new_messages JSONB,
  p_max_messages INTEGER DEFAULT 100
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_current JSONB;
  v_combined JSONB;
  v_count INTEGER;
BEGIN
  -- Lock the row for this user to prevent concurrent modifications
  SELECT messages INTO v_current
  FROM conversations
  WHERE whatsapp_number = p_phone_number
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Combine existing messages with new ones
  v_combined := COALESCE(v_current, '[]'::jsonb) || p_new_messages;
  v_count := jsonb_array_length(v_combined);

  -- Trim to max_messages, keeping the most recent
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

-- ============================================
-- 2. Atomic spot use count increment
--    Single UPDATE avoids SELECT → UPDATE race condition.
-- ============================================
CREATE OR REPLACE FUNCTION increment_spot_use_count(p_spot_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE spots
  SET use_count = COALESCE(use_count, 0) + 1
  WHERE id = p_spot_id;
END;
$$;

-- ============================================
-- 3. Atomic spot contribution count increment
-- ============================================
CREATE OR REPLACE FUNCTION increment_spot_contribution_count(p_spot_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE spots
  SET contribution_count = COALESCE(contribution_count, 0) + 1
  WHERE id = p_spot_id;
END;
$$;
