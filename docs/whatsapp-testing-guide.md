# WhatsApp Testing Guide — Phased Plan

## Context

Sam has been tested primarily via web chat. WhatsApp has several capabilities that don't exist on web (voice notes, location pins, proactive messages, admin commands, image captions) and some UX differences (single-shot responses vs streaming, no rate limiting). This guide gives JX a phased test script to verify the full WhatsApp experience end-to-end.

---

## Phase 1 — First Contact & Profile Setup

**Goal:** Verify Sam greets correctly and completes profile learning.

1. Send: `hi`
   - Expect: Sam introduces himself, asks about your trip

2. Follow through the full profile conversation:
   - Name → trip dates → travel party → interests → dietary restrictions
   - Expect: multi-turn conversation, not a form
   - Expect: after ~6–8 exchanges, Sam wraps up and offers to help

3. Send a food signal mid-profile (e.g. `actually I'm hungry`):
   - Expect: Sam **escapes the profile flow** immediately and asks "what are you feeling?"

**Verify**: Check `travelers` table in Supabase — your row should have `name`, `trip_dates`, `travel_party`, `dietary_restrictions` populated.

---

## Phase 2 — Core Query Flows

**Goal:** Test the main on-trip intents that exist on web too, but verify WhatsApp formatting.

1. **Hungry**: `I want nasi lemak`
   - Expect: ≤3 spots, each with Order / Tips / Hours / Price / Payment / Vibe
   - Verify: no invented data, all fields from DB

2. **Vague hungry**: `I'm hungry`
   - Expect: clarifying question ("What are you feeling?")
   - Reply: `something casual and cheap for lunch in Bangsar`
   - Expect: recommendations without another question

3. **Day plan**: `what should I do today?`
   - Expect: breakfast + lunch + activity + dinner structure
   - Verify: all 4 meal slots covered

4. **Spot info**: `tell me about Jalan Alor`
   - Expect: DB info + live web data for hours/payment, flagged "(from web)"

5. **Strategic**: `I arrive tomorrow for 5 days, can you plan my trip?`
   - Expect: Sam asks clarifying questions then produces a structured pre-trip guide

---

## Phase 3 — WhatsApp-Exclusive: Location Pin

**Goal:** Test GPS-based nearby recommendations.

1. Open WhatsApp → attachment → Location → **Send Your Current Location**
   - Expect: Sam responds with nearby spots with distances (e.g. "0.3 km away")

2. Send a location pin from somewhere you're not (share "Share a Place" from Maps)
   - Expect: nearby spots relative to that location, not your GPS

---

## Phase 4 — WhatsApp-Exclusive: Voice Notes

**Goal:** Test Whisper transcription + contribution via voice.

1. Send a voice note saying: `I'm in the mood for something spicy for dinner`
   - Expect: Sam transcribes and responds with dinner recommendations

2. Send a voice note contributing a spot:
   `Hey I just found this amazing place called Restoran Sri Nirwana Maju in Bangsar, it's a banana leaf rice place. Tier one, must go. Get the fish and the papadum. Open from 7am to 3pm, cash only.`
   - Expect: Sam enters contribution flow, shows structured summary with fields extracted from your voice note
   - Confirm it, then check Supabase `spots` table for the new entry

---

## Phase 5 — Contribution Flow (Text)

**Goal:** Test the full multi-turn contribution flow with corrections and duplicate handling.

1. Type a contribution: `add a spot — Imbi Market, breakfast, tier 1. Get the economy rice and kopi. Cash only, opens at 7am.`
   - Expect: structured summary showing what was extracted + any web-sourced fields flagged

2. Make a correction: `actually it's tier 2 not tier 1`
   - Expect: summary updates, Sam re-confirms

3. Confirm: `yes that's right`
   - Expect: spot saved. Sam thanks you.

4. Try to add the same spot again
   - Expect: Sam detects duplicate and merges the intel, doesn't create a new entry

---

## Phase 6 — Feedback Flow

**Goal:** Test post-trip feedback collection.

1. After getting recommendations, send: `I visited Imbi Market yesterday, it was amazing`
   - Expect: Sam asks for a rating (1–5)

2. Rate it: `5 stars`
   - Expect: Sam records it, asks if you have any tips to share

3. Send: `the economy rice counter closes at 11am not noon`
   - Expect: Sam thanks you and records the user tip

**Verify**: Check `feedback` table in Supabase. Check that `spots_liked` in your `travelers` row is updated.

---

## Phase 7 — Spot Correction

**Goal:** Test the correction / de-verification flow.

1. Send: `heads up, Fatty Crab in Taman Megah has closed down`
   - Expect: Sam acknowledges, says it'll be flagged for review

**Verify**: Check `spots` table — `verified` should be `false` for that spot.

---

## Phase 8 — Admin Commands (Your Number Only)

**Goal:** Test rapid-add and /generate (gated to ADMIN_PHONE_NUMBER = 60172062559).

1. **Rapid add**:
   `add: Yut Kee, Dang Wangi, breakfast, tier 1. Get the French toast and roti babi. Cash only, opens 7:30am.`
   - Expect: Sam extracts, confirms, saves — no multi-turn

2. **Generate**:
   `/generate bangsar dinner`
   - Expect: Sam generates marketing-ready content for a Bangsar dinner spot

---

## Phase 9 — Proactive Messages

**Goal:** Verify the scheduler sends the right messages at the right times.

1. Set your `trip_dates` to include today (via profile flow or direct DB edit)
2. Wait — scheduler runs every 5 minutes and checks:
   - **Day 1**: TRIP_WELCOME (once, any time)
   - **Day 2+, 8–10am**: MORNING_NUDGE
   - **Day 2+, 5–7pm**: DINNER_NUDGE
   - **Post-recommendation**: FEEDBACK_CHECK (if you have unrated visited spots)

> Note: Easiest to test FEEDBACK_CHECK by getting a recommendation, not rating it, then waiting.

---

## Phase 10 — Edge Cases

**Goal:** Verify graceful handling of edge cases.

1. **Cancel mid-flow**: Start contribution, then send `cancel`
   - Expect: Sam exits flow gracefully, back to general

2. **Malay language**: `nak makan apa kat KL malam ni?`
   - Expect: full response in Bahasa Malaysia

3. **Unsupported city**: `I'm going to Tokyo next week`
   - Expect: Sam is honest about no coverage, doesn't hallucinate spots

4. **Image**: Send any photo
   - Expect: Sam acknowledges but says it can't process images yet

---

## Verification Checklist

| Test | Signal |
|------|--------|
| Profile saved | `travelers` table has your row |
| Spots recommended | `events` table has `recommendation` event |
| Voice note transcribed | Bot terminal shows transcription text |
| Contribution saved | `spots` table has new row |
| Duplicate detected | `spot_contributions` row added to existing spot |
| Feedback recorded | `feedback` table has row, `spots_liked` updated |
| Spot correction | `spots.verified = false` |
| Proactive sent | `events` table has proactive event |
