# SAM — Capabilities Reference

**Last updated:** 2026-02-23
**Status:** Production (KL full coverage, PJ / Penang live, Taipei seeded)

Sam is a travel intelligence assistant powered by a proprietary knowledge graph built by local contributors. He is not a search engine. He gives you the answer a well-connected local friend would give — specific, opinionated, operationally complete.

---

## 1. Product Identity

- **What he is:** Conversational food and travel guide with a curated, contributor-sourced knowledge graph
- **What he is not:** A booking tool, a navigation app, or a general LLM chatbot
- **Persona:** Warm, opinionated, slightly irreverent — adapts tone per city (KL is casual/direct)
- **Starting city:** Kuala Lumpur. Expanding city by city.

### Knowledge Graph (as of 2026-02-21)

| Country | City | Spots |
|---------|------|-------|
| Malaysia | Kuala Lumpur | 504 |
| Malaysia | Petaling Jaya | 169 |
| Malaysia | Penang | 65 |
| Taiwan | Taipei | 1 |

---

## 2. Channels

### WhatsApp
- Real phone number via WhatsApp Cloud API
- Multi-turn sessions: full conversation history persisted in `conversations.messages[]` (capped at 40 messages)
- Supports: text, voice notes (transcribed via OpenAI Whisper), location pins, image captions
- Typing indicator shown while Sam processes
- Proactive outbound messages (see §10)

### Web Chat (`/chat`)
- UUID session stored in `localStorage` — no persistent identity across browsers or devices
- SSE streaming: response appears word-by-word
- Rate-limited (daily limit enforced via `rate-limit.ts`)
- No voice notes, no location pin, no proactive outreach
- Shares all handlers with WhatsApp — same logic, same DB

---

## 3. Intent Routing

Sam classifies every incoming message into one of 11 intents before routing to a handler. Classification uses Claude Haiku with the last 6 messages as context.

| Intent | Triggers | Resolves via |
|--------|----------|-------------|
| `hungry` | "I'm hungry", "where to eat", cuisine/meal requests, continuation/refinement of previous recs | `handleHungry()` → structured DB query + LLM format |
| `day_plan` | "plan my day", "what should I do today", full itinerary requests. Also triggers when asking about events AND food in the same message | `handleDayPlan()` → multi-category DB query, area-aware |
| `happenings` | "what's on", "any events", "any festivals", "what's happening", "anything on this weekend", "any markets on", "any pop-ups". Exception: if asking about events AND food → `day_plan` instead | `handleHappenings()` → DB 7-day lookahead + web search |
| `nearby` | "what's near me", "spots around X area", text-based proximity, location pin | `handleNearby()` → Haversine filter on coordinates |
| `spot_info` | "tell me more about Y", "what's Z like", named venue questions | `handleSpotInfo()` → DB lookup by name |
| `spot_correction` | "that place closed", "wrong address", "Y moved" | `handleSpotCorrection()` → marks spot `verified=false`, tracks event |
| `weather` | "is it raining", weather-aware food requests | Weather API → indoor filter → `handleQuery()` |
| `contribute` | "I know a great spot", voice notes (outside contribution flow) | Two-stage `handleContribution()` flow |
| `profile` | "I'm visiting for 3 days", "I'm a local", profile-bearing first message | `startProfileLearning()` or continuous extraction |
| `feedback` | "I went to X, it was great/terrible" | `startFeedbackCollection()` → `handleFeedback()` |
| `general` | Off-topic, personality chat, questions about Sam | `chatAsSam()` with personality prompt |

### Unclear queries
If a `hungry` intent is ambiguous (no area, no meal type), Sam asks one clarifying question before querying. The clarifying answer is re-classified and merged with the original query — no context lost.

---

## 4. Recommendation Engine

### Query path (structured → semantic → honest empty)

1. **Structured DB query** (`querySpots()` in `database.ts`): filters by city/area/category/weather/price/excluded IDs. Spots ordered: verified → tier → use_count.
2. **Area widening**: if structured query returns zero results for a specific area, retries city-wide and applies a 3km Haversine proximity filter using the area's centroid (computed from actual spot coordinates in DB, cached per process).
3. **Semantic fallback** (`semanticSearchSpots()`): if structured returns nothing, falls back to pgvector similarity search on the user's full message. Also the primary path for dish queries ("laksa", "roti canai").
4. **Honest empty**: if all three paths return nothing, Sam says so — no fabrication. He offers to search a different area if one was specified.

### Personalization filters applied at DB level

- `spots_disliked` → excluded via `excludeIds` parameter (set when traveler rates a spot ≤ 2)
- `indoor_outdoor` → forced to `"indoor"` when weather reports rain
- `priceRange` → mapped from traveler's `budget` preference to `$` / `$$` / `$$$` filter values (see below)

**Budget → price_range mapping** (in `mapBudgetToPriceRange()`):

| Budget preference | Price filter |
|-------------------|-------------|
| backpacker / tight / budget | `$` |
| moderate / mid | `$`, `$$` |
| splurge / luxury | `$$`, `$$$` |

### Personalization at LLM level only (not DB-filtered)

- `dietary_restrictions` — shown to LLM in `prefContext`; LLM excludes mentally
- `interests`, `cuisine_preferences` — shown to LLM; influences framing
- `spots_visited` — filtered before recommending for travelers; locals see visited spots again

### avg_rating demotion

After every new rating submission, `avg_rating` on the spot is recomputed from all verified feedback rows. In `querySpots()`, any spot with `avg_rating < 2.5` is demoted to the lowest sort tier — it stays in the DB and can still surface, but ranks below everything else.

### Staleness signal

Spots with `last_verified` older than 180 days get `isStale = true` in the query result. The LLM sees: `"Freshness: last verified 6+ months ago — details may have changed"`. Sam is expected to mention this caveat if relevant.

### Time-aware soft filter

After the DB query, spots are soft-filtered by `best_time_of_day` vs. current local hour. If filtering would empty the result set, all spots are kept but the LLM receives a timing note: `"current local time is X:00 — these spots' usual hours may not match"`.

### What the LLM sees per spot (`formatSpotsForLLM()`)

Name, neighborhood, distance label (if widened), category, address, price, payment, hours, what_to_order, what_to_skip, pro_tips, vibe, setting, best_time, verification status (must-go / verified / unverified), avg_rating, staleness flag. If contributor perspectives exist (≥2 contributors with different `what_to_order`), those are appended as a separate block.

### No-fabrication guarantee

The LLM is explicitly instructed: "ONLY mention details that appear in the spot data below." If a spot has limited data, Sam says so. Distance and travel times may never be invented.

---

## 5. Happenings Handler

Handles the `happenings` intent — temporal events such as festivals, markets, pop-ups, and weekend activities.

### Trigger

`happenings` intent. If the user asks about events AND food in the same message, the classifier routes to `day_plan` instead.

### Data sources (run in parallel)

1. **DB query** (`queryHappenings(city, today, 7)`): returns happenings with `start_date` within the next 7 days (or recurring events that overlap the window).
2. **Web search** (`webSearchHappenings(city, todayDate)`): fetches current what's-on results via Claude's web search tool.

### De-duplication

Web results whose `name` (case-insensitive) matches a DB entry are dropped — DB entry takes precedence.

### Formatting

- DB entries are verified facts — presented as confirmed.
- Web entries are annotated `(from web, unverified)`.
- If both sources return nothing, Sam defers explicitly to Time Out KL / KLUE — no fabrication.

### Response construction

`buildHappeningsPayload()` is shared between WhatsApp and web channels, returning the same structured content. WhatsApp formats concisely; web may render with more detail.

### `happenings` table schema

| Column | Purpose |
|--------|---------|
| `id` | UUID primary key |
| `name` | Event name |
| `city`, `country` | Location scope |
| `area` | Neighbourhood / venue |
| `description` | What it is |
| `start_date`, `end_date` | Date range |
| `recurring` | Boolean — weekly market, annual festival, etc. |
| `recurrence_rule` | iCal RRULE string (e.g. `FREQ=WEEKLY;BYDAY=SA`) |
| `categories` | Array of tags (e.g. `["market", "food", "music"]`) |
| `source_url` | Origin link for web-sourced entries |
| `input_method` | `seed`, `manual`, `web` |

**Distinct from `spots`**: happenings are temporal events (festivals, markets, pop-ups), not permanent venues. They live in a separate table and are never mixed into spot recommendation results.

---

## 6. Contribution Flow

Two-stage flow for capturing new spots from local contributors.

### Stage 1: Collecting

1. User triggers contribution (voice note or text with intent `contribute`)
2. LLM extracts structured spot data from each message using `extraction.txt` prompt
3. Pronoun resolution: last 2 messages are passed as context ("it", "that place" resolved)
4. Early duplicate check: on first mention of a spot name, fuzzy-matched against DB — if found, flow ends and user is told it's already in the graph
5. On each name change: web enrichment runs (see below) and `webSourcedFields[]` is updated
6. Flow continues collecting until `isReady()` returns true: needs name + categories + area + (what_to_order OR pro_tips OR vibe)

### Stage 2: Confirming

Shows formatted summary. Contributor can:
- **Confirm** → asked one more question (must-go or not?), then saved
- **Correct** → LLM extracts correction, corrected fields removed from `webSourcedFields`, summary reshown
- **Ask a question** → Sam answers in context, re-asks if they want to save
- **Go off-topic** → if minimum fields met, saves anyway and responds to new topic

### Web enrichment (`enrichFromWeb()`)

When a spot name is first provided, Sam searches the web for operational details.

**Web-allowed fields** (strict allowlist):
- `name`, `categories`, `city`, `price_range`, `payment_methods`

**Deliberately excluded from web:**
- `address` — web often returns wrong outlet (chains, multiple locations)
- `area` — web returns generic descriptions that confuse contributors
- `opening_hours` — stripped with belt-and-suspenders delete (unreliable from web)
- `what_to_order`, `pro_tips`, `vibe` — contributor opinion only, never from web

**Area conflict detection:** if contributor gave an area and web returns a different one, the summary shows: `Taman Megah ⚠️ _(web says: Damansara Jaya — which is right?)_`

**Web-sourced fields in summary:** annotated with `_(from web)_`. If contributor corrects a field, it is removed from `webSourcedFields`.

### Deduplication

At save time: exact name match → fuzzy match → LLM similarity check. If duplicate found: contributor's new intel is **auto-merged** into the existing spot (arrays appended, deduped case-insensitively; scalars overwritten if provided).

### Attribution (`spot_contributions` table)

Every save — new spot or merge — records a `spot_contributions` row with the contributor's specific: `what_to_order`, `what_to_skip`, `pro_tips`, `vibe`, `is_must_go`. This preserves each contributor's voice even when their intel is merged into an existing spot.

### What never reaches the DB

Web-sourced fields are stripped before `insertSpot()` / `updateSpot()`. Only contributor-verified data is persisted. Geocoding (address → lat/lng) is the exception: coordinates are factual metadata, not opinion, and may be derived from a web-sourced address.

---

## 7. Profile System

### Continuous extraction (background, every message)

After every message exchange, `maybeExtractProfile()` runs fire-and-forget using Haiku. It extracts a delta from the last 2 messages and merges it into the traveler record.

**Fields extracted:**
name, user_type (local/traveler), home_areas, trip_dates, travel_party, dietary_restrictions, budget, pace, interests, cuisine_preferences, specific_requests, first_time_visitor, current_city

**Array merge logic:**
- Additions appended, deduped (case-insensitive)
- `!prefix` removes: `"!vegetarian"` deletes "vegetarian" from `dietary_restrictions`

**Skipped flows:** contribution, feedback, generate, profile_learning (these handle profiles explicitly or aren't about the traveler)

**Note:** the `profile` intent is intentionally NOT skipped — continuous extraction acts as the safety net for returning users who update their preferences mid-conversation.

### Explicit profile learning (`profile_learning` flow)

Structured interview via `profile.txt` prompt. Runs for new users with no existing profile data. Uses `[PROFILE_COMPLETE]` sentinel in the LLM response to signal completion. On completion:
- Profile extracted via `continuous_profile.txt` applied to the full conversation transcript
- Saved to `travelers` table
- **Locals** → routed to `general` flow
- **Travelers** → routed to `strategic` flow

Escape hatch: if a food/dining signal is detected mid-interview (`FOOD_SIGNALS` regex), the profile flow is bypassed and the query is handled directly.

### Strategic planning

Generated by Sonnet when a traveler completes their profile. Covers:
- Recommended accommodation area (based on their interests and budget)
- What to book ahead
- 3–5 anchor spots (disliked spots excluded)
- What to expect: climate, payment norms, cultural context

---

## 8. Personalization Summary

| Signal | Source | Applied at |
|--------|---------|-----------|
| `spots_disliked` | feedback flow (≤2 rating) | DB level (`excludeIds`) |
| `indoor_outdoor` | weather API | DB level |
| `price_range` | budget preference → mapping | DB level |
| `dietary_restrictions` | profile / continuous extraction | LLM prompt only |
| `budget` (display) | profile | LLM prompt only |
| `interests`, `cuisine_preferences` | profile | LLM prompt only |
| `user_type` (local vs traveler) | profile | Changes visited-spot filtering logic |
| `spots_visited` | post-recommendation auto-tracking | Filtered pre-query (travelers only) |

---

## 9. Geographic Intelligence

### Supported cities (`city-defaults.ts`)

| City | Country | Timezone | UTC Offset |
|------|---------|----------|-----------|
| Kuala Lumpur | Malaysia | Asia/Kuala_Lumpur | +8 |
| Petaling Jaya | Malaysia | Asia/Kuala_Lumpur | +8 |
| Penang | Malaysia | Asia/Kuala_Lumpur | +8 |

(Taipei has 1 seeded spot but is not yet in `CITY_DEFAULTS` — recommendations in Taipei will fail gracefully with an "unsupported city" message.)

### Area resolution

`AREA_CITY_MAP` in `city-defaults.ts` maps ~30 area aliases to their parent city. Examples:
- "PJ", "SS2", "SS23", "Subang", "Ara Damansara" → Petaling Jaya
- "TTDI", "Bangsar", "KLCC", "Bukit Bintang" → Kuala Lumpur
- "George Town", "Georgetown" → Penang

City-level aliases (pj, kl, penang, etc.) are filtered out before being used as sub-area tags in DB queries.

### Area extractor (`area-extractor.ts`)

Longest-match-first parsing against the full vocabulary of DB area names + AREA_CITY_MAP keys. Handles space-separated codes ("ss2 ss23 taman megah") and comma-separated lists. Prevents "SS2" from matching inside "SS23".

### Area centroid for proximity filtering

Computed on-demand from actual spot coordinates in the DB for a given area name. Cached per process. Used to:
1. Apply 3km proximity filter on area-widened queries
2. Generate distance labels ("~2.5km from Bangsar") for spots outside the requested area

If no geocoded spots exist for an area (no centroid), the widened query returns empty rather than serving citywide results as if they were nearby.

### Coordinate-based queries

Location pins (WhatsApp) and text coordinates ("3.139,101.687") both route to `handleNearby()`, which applies Haversine filtering directly on spot coordinates.

---

## 10. Proactive Messaging (WhatsApp only)

The scheduler (`scheduler.ts`) runs on a **5-minute interval**. On each tick, it queries active travelers and determines which, if any, should receive a message.

### Message types

| Type | When sent |
|------|-----------|
| `TRIP_WELCOME` | Day 1 of trip dates |
| `MORNING_NUDGE` | Day 2+ of trip, morning hours |
| `DINNER_NUDGE` | Afternoon on any active trip day |
| `FEEDBACK_CHECK` | User has visited spots with no feedback yet |

### Gates (all must pass)

- Last user message was within the WhatsApp 24h messaging window (23h buffer used)
- 8h cooldown since last proactive message
- Local daytime hours only (UTC+8 hardcoded — KL timezone only)
- User must not be mid-flow (`current_flow !== "general"`)

Weather context is injected into nudge messages when available.

### Background Scheduler Jobs

In addition to per-user proactive messages, the scheduler runs two background jobs on each tick:

| Job | Time (KL) | What it does |
|-----|-----------|-------------|
| **Daily digest** | 9:00–9:05am | Counts messages, new spots, and cost for the day. Sends summary to Slack via `SLACK_WEBHOOK_URL`. No-op if env var not set. Tracked as `daily_digest` event. |
| **Staleness check** | 10am–12pm | Finds up to 5 spots not verified in 180+ days. Pings the original contributor via WhatsApp: "Still accurate?" Sets `current_flow = "spot_verification"`. Response is handled by `spot-verification.ts`. |

---

## 11. Language Support

### Malay

`detectLanguage()` in `llm.ts` checks for ≥2 matches from a 30+ word Malay function-word regex (nak, makan, sedap, kat, ada, tak, boleh, macam, lah, pun, dah, je, kan, etc.).

When detected:
- System prompt receives: `"You MUST reply entirely in Malay (Bahasa Malaysia). Do not switch to English."`
- User prompt receives a recency reinforcement: `"PENTING: Balas semua dalam Bahasa Malaysia sahaja."`

Sam replies in Malay or Manglish mix to match the user's register.

### Other languages

No other languages are explicitly supported. English is the default. The LLM may attempt other languages but there are no guardrails.

---

## 12. Analytics Events

All events tracked via `trackEvent()` in `database.ts` — fire-and-forget, never blocks the user. Stored in the `events` table.

| Event | When | Key data |
|-------|------|----------|
| `message` | Every exchange (both channels) | `intent` |
| `recommendation` | Every set of spot recommendations | `spot_ids`, `spot_names`, `categories`, `area` |
| `flow_complete` | Contribution, profile, feedback flows complete | `flow`, `user_type`, `source`, `action` |
| `llm_usage` | End of each WhatsApp message processing | `input_tokens`, `output_tokens`, `calls`, `intent` |
| `unsupported_city_request` | User asks about a city Sam doesn't cover | `city` |
| `spot_correction` | User reports a spot issue | `spot_id` (if found), `spot_name`, `correction` |

---

## 13. Admin Features

All features gated behind `ADMIN_PHONE_NUMBER` environment variable (WhatsApp only).

| Command | What it does |
|---------|-------------|
| `add: <spot details>` | Rapid spot ingestion via text: `add: Fatty Crab, Taman Megah, dinner. Cash only. Must order: chilli crab.` Extracts structured data using `extraction.txt`. Asks one clarifying question if name/category/area missing. Runs duplicate check. Inserts on confirmation. No web enrichment, no two-stage flow. |
| `/generate <city> <category>` | Generates spot descriptions, `what_to_order`, and `pro_tips` for a city+category via Sonnet. Used for seeding content when contributor data is sparse. |
| `/approve <spot name>` | Approves a pending spot correction — applies the reported change to the spot. |
| `/reject <spot name>` | Dismisses a correction report without applying it. |
| `/corrections` | Lists all pending spot corrections grouped by spot. |
| `/publish <spot name>` | Moves a spot from the review queue to live recommendations (`needs_review = false`). |

---

## 14. What Sam Cannot Do

### Hard limits (by design or absent infrastructure)

| Limitation | Detail |
|-----------|--------|
| No cross-device continuity | Web UUID ≠ WhatsApp phone number. Separate profiles, no linking |
| No transport / directions | One-sentence deflection only. No routing, maps, or ETA |
| No booking / reservations | Cannot reserve tables or integrate with booking systems |
| No real-time availability | Hours come from DB or web search, not live venue APIs |
| No image analysis | Only reads image captions from WhatsApp; cannot process image content |
| No multi-city itinerary | Each session is city-scoped; no "day 1 KL, day 2 Penang" planning |
| No group size filtering | Party of 8 gets same recs as party of 2; venue capacity not in schema |
| No event planning intent | Anniversary dinner → routed as `hungry`; no occasion-aware venue matching |
| No comparison intent | "Bijan vs Dewakan" → looks up one; no side-by-side comparison |
| Activities are sparse | Sam is food-first; the `activity` category has limited coverage outside KL |

### Soft limits (works but imperfectly)

| Limitation | Detail |
|-----------|--------|
| Dietary restrictions at LLM level only | Not DB-filtered; less reliable when result pools are large |
| Budget not wired to DB filter | `mapBudgetToPriceRange()` exists; only applied in `handleQuery()`, not `handleHungry()` / `handleNearby()` |
| Spot staleness flagged, not auto-remediated | Old spots stay in DB; Sam flags them but can't auto-verify |
| Proactive messages KL-timezone only | UTC+8 hardcoded in `scheduler.ts`; Penang is fine (same zone), but will break for other timezones |
| No contributor incentive loop | Contributors receive no visibility into how their spots perform |
| Tips accumulate without curation | `pro_tips[]` grows with each contribution merge; no deduplication or curation gate |
| Web chat: no voice, no location | Text only; no proximity-based queries possible |
| Conversation history capped at 40 messages | Beyond that, older context truncates; long conversations lose early trip context |

### Roadmap gaps (identified, not yet built)

| Gap | Notes |
|-----|-------|
| Cross-device identity linking | WhatsApp phone ↔ web UUID association |
| Budget → price_range wiring in all handlers | Currently only in `handleQuery()` |
| Event planning intent | Group size, occasion, venue capacity matching |
| Comparison intent | "X vs Y" — look up both and compare |
| Contributor leaderboard / use_count loop-back | Contributors can't see how their spots perform |
| Analytics funnels | Recommended → visited → rated conversion tracking |
| City area maps hardcoded in TypeScript | Adding a new city requires a code change + redeploy |
| A/B prompt testing infrastructure | No mechanism to test prompt variants on live traffic |

---

## 15. Data Quality Signals

| Signal | Column | How set | How used |
|--------|--------|---------|---------|
| `verified` | `spots.verified` | `true` on insert; `false` when `spot_correction` fires | Sort order: verified spots rank above unverified |
| `must_go` | `spots.must_go` | Set by contributor during contribution flow (must-go question) | Flagged as "must-go" in `formatSpotsForLLM()` |
| `avg_rating` | `spots.avg_rating` | Recomputed from `feedback` table on every new rating | `< 2.5` → demoted to lowest sort tier |
| `last_verified` | `spots.last_verified` | Updated on spot edits | `> 180 days` → `isStale` flag → LLM sees freshness warning |
| `use_count` | `spots.use_count` | Incremented on every recommendation | Part of sort order; signal of popularity |
| `contribution_count` | `spots.contribution_count` | Incremented on each contributor merge | Indicates depth of community coverage |

---

## Appendix: Key Files

### Handlers

| File | Purpose |
|------|---------|
| `packages/bot/src/index.ts` | Flow router, intent dispatch, admin commands |
| `packages/bot/src/database.ts` | All DB operations including `querySpots()`, `queryHappenings()`, `appendMessages()`, `trackEvent()` |
| `packages/bot/src/llm.ts` | Claude API wrapper, language detection, prompt loading |
| `packages/bot/src/handlers/query.ts` | Core recommendation engine, `formatSpotsForLLM()` |
| `packages/bot/src/handlers/ontrip.ts` | `handleHungry()`, `handleDayPlan()`, `handleNearby()`, `handleSpotInfo()` |
| `packages/bot/src/handlers/happenings.ts` | Happenings intent handler — `handleHappenings()`, `buildHappeningsPayload()`, `webSearchHappenings()` |
| `packages/bot/src/handlers/contribution.ts` | Two-stage contribution flow, `enrichFromWeb()`, dedup + merge |
| `packages/bot/src/handlers/spot-correction.ts` | Spot correction handler |
| `packages/bot/src/handlers/spot-verification.ts` | Staleness verification response handler (set by scheduler's staleness-check job) |
| `packages/bot/src/handlers/continuous-profile.ts` | Background profile extraction, `mergeArray()` with `!` removal |
| `packages/bot/src/handlers/profile.ts` | Explicit profile interview flow |
| `packages/bot/src/handlers/strategic.ts` | Pre-trip strategic planning (Sonnet) |
| `packages/bot/src/handlers/feedback.ts` | Post-trip rating flow |
| `packages/bot/src/scheduler.ts` | Proactive message engine + background jobs (daily digest, staleness check) |
| `packages/bot/src/utils/city-defaults.ts` | City coordinates, area-to-city mappings |
| `packages/bot/src/utils/area-extractor.ts` | Longest-match area parser |
| `packages/bot/src/utils/geo.ts` | Haversine distance, proximity filter |

### Prompt Files (`packages/bot/src/prompts/`)

| File | Purpose |
|------|---------|
| `system.txt` | Sam's core personality and rules (default: used by `chatAsSam()`) |
| `system-mini.txt` | Lightweight Sam voice — used by `samSays()` for one-liner responses |
| `system-web.txt` | Web-channel personality addendum (overlaid on `system.txt` for web sessions) |
| `system-whatsapp.txt` | WhatsApp-channel personality addendum |
| `extraction.txt` | Voice note / text → structured spot JSON |
| `profile.txt` | Conversational profile interview |
| `continuous_profile.txt` | Background profile extraction rules |
| `strategic.txt` | Strategic pre-trip planning format |
| `proactive.txt` | Proactive message voice and style |
| `feedback.txt` | Feedback response parsing |
| `generate.txt` | Spot content generation (used by `/generate` admin command) |
| `coach.txt` | Coaching evaluation prompt |

### DB Tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `spots` | Knowledge graph of permanent venues | name, city, area, categories[], must_go, verified, what_to_order[], pro_tips[], embedding |
| `happenings` | Temporal events and what's-on intel | name, city, area, description, start_date, end_date, recurring, recurrence_rule, categories |
| `spot_contributions` | Per-contributor attribution | spot_id, contributor_id, what_to_order[], pro_tips[], vibe, must_go |
| `contributors` | Who added knowledge | whatsapp_number, name, cities_contributed[], contribution_count |
| `travelers` | User profiles | whatsapp_number, preferences, dietary_restrictions[], trip_dates, user_type |
| `conversations` | Session state management | whatsapp_number, current_flow, flow_state(jsonb), messages(jsonb[]) |
| `feedback` | Post-trip spot ratings | spot_id, traveler_id, rating(1-5), visited, user_tips[] |
| `events` | Analytics and usage tracking | session_id, channel, event_type, event_data(jsonb), created_at |
