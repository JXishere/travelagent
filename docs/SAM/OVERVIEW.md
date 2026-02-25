# Sam — Full Architecture & Capabilities Summary

## What Sam Is

Sam is a **travel intelligence assistant** — not a search engine, not a booking tool. He gives the kind of answer a well-connected local friend would give: specific, opinionated, operationally complete. The product is the combination of a proprietary contributor-built knowledge graph + a personality-driven LLM layer that never fabricates.

**Tagline**: "The friend who lives everywhere"
**Currently live**: Kuala Lumpur (504 spots), Petaling Jaya (169), Penang (65), Taipei (1 seeded)

---

## Channels

| Channel | Capabilities |
|---|---|
| **WhatsApp** | Multi-turn sessions, voice notes (Whisper), location pins, image captions, proactive outbound messages, full conversation history (40 messages) |
| **Web chat** (`/chat`) | SSE streaming, UUID sessions in localStorage, rate-limited (30 msg/day), text only, no proactive messages |

Both channels share identical handlers via the `@sam/bot` npm workspace — no HTTP hop between Next.js and bot logic.

---

## Message Flow

```
WhatsApp/Web message
  → classifyIntent() [Haiku, last 6 messages context]
  → handler (routes to one of 11 intents)
  → querySpots() / LLM format [Haiku default]
  → sendMessage() / SSE stream
  → (background) maybeExtractProfile() [fire-and-forget]
  → (background) trackEvent() [fire-and-forget analytics]
```

---

## Intent Routing (11 intents)

| Intent | Trigger | Handler |
|---|---|---|
| `hungry` | "I'm hungry", cuisine/meal requests | `handleHungry()` → structured DB + LLM format |
| `day_plan` | "plan my day", events + food in same message | `handleDayPlan()` → multi-category DB, area-aware |
| `happenings` | "what's on", "any events", "any markets" | `handleHappenings()` → DB 7-day + web search |
| `nearby` | "what's near me", area text, location pin | `handleNearby()` → Haversine filter on coords |
| `spot_info` | "tell me more about X", named venue questions | `handleSpotInfo()` → DB lookup by name |
| `spot_correction` | "that place closed", "wrong address" | `handleSpotCorrection()` → `verified=false`, tracks event |
| `weather` | "is it raining", weather-aware requests | OpenWeather → indoor filter → `handleQuery()` |
| `contribute` | "I know a great spot", voice notes | Two-stage `handleContribution()` |
| `profile` | "I'm visiting for 3 days", first message | `startProfileLearning()` or continuous extraction |
| `feedback` | "I went to X, it was great/terrible" | `startFeedbackCollection()` → `handleFeedback()` |
| `general` | Off-topic, personality chat | `chatAsSam()` with personality prompt |

---

## Recommendation Engine

**3-stage query pipeline:**

1. **Structured DB query** (`querySpots()`): filters by city/area/category/weather/price/excluded IDs. Sort order: `must_go DESC → verified DESC → shuffled within tier → avg_rating < 2.5 demoted to back`
2. **Area widening**: if zero results for a specific area, retries city-wide with a 3km Haversine proximity filter using area centroid (computed from actual spot coordinates in DB, cached per process)
3. **Semantic fallback** (`semanticSearchSpots()`): pgvector cosine similarity on user's full message — also primary path for dish queries ("laksa", "roti canai")
4. **Honest empty**: if all paths return nothing, Sam says so — no fabrication

**Personalization applied at DB level:**
- `spots_disliked` → filtered via `excludeIds`
- Weather → forces `indoor_outdoor = "indoor"` when raining
- Budget preference → mapped to `$`/`$$`/`$$$` price filter

**Personalization at LLM level only:**
- Dietary restrictions, interests, cuisine preferences

**Data quality signals surfaced to LLM:**
- `must_go` flag, `verified` flag, `avg_rating`, staleness (>180 days since `last_verified`), time-of-day soft filter

---

## Contribution Flow (Two-Stage)

**Stage 1 — Collecting:**
- LLM extracts structured spot data using `extraction.txt`
- Pronoun resolution (last 2 messages as context)
- Early duplicate check on first spot name mention
- Web enrichment (`enrichFromWeb()`) for operational fields — **strict allowlist**: only name, categories, city, price_range, payment_methods. Address, area, hours, what_to_order, pro_tips, vibe are **deliberately excluded** from web
- Flow continues until `isReady()` = name + categories + area + (what_to_order OR pro_tips OR vibe)

**Stage 2 — Confirming:**
- Shows formatted summary with web-sourced fields annotated
- Contributor can confirm, correct, or ask questions
- On confirm: dedup runs (exact → fuzzy → LLM similarity). Duplicate found → auto-merge (arrays appended + deduped, scalars overwritten)
- Attribution recorded in `spot_contributions` for every save (new or merge)
- Web-sourced fields stripped before DB write — only contributor-verified data persists

---

## Profile System

**Continuous extraction (background, every message):**
- `maybeExtractProfile()` runs fire-and-forget after every exchange using Haiku
- Fields: name, user_type, home_areas, trip_dates, travel_party, dietary_restrictions, budget, pace, interests, cuisine_preferences, specific_requests, first_time_visitor, current_city
- Array merge: append + deduplicate; `!prefix` removes items
- Skipped flows: contribution, feedback, generate, profile_learning

**Explicit profile learning:**
- Structured interview via `profile.txt` for new users with no profile data
- `[PROFILE_COMPLETE]` sentinel signals completion
- Escape hatch: if food/dining signal detected mid-interview, bypasses and handles query directly
- Completion routes locals → `general`, travelers → `strategic`

**Strategic planning (Sonnet):**
- Triggered after traveler profile completion
- Covers: accommodation area recommendation, what to book ahead, 3–5 anchor spots, climate/payment/cultural context

---

## Happenings Handler

- Temporal events (festivals, markets, pop-ups) — distinct from `spots`
- Runs DB query + web search in parallel
- Web results deduplicated against DB by name
- DB entries: confirmed. Web entries: annotated `(from web, unverified)`
- Zero results → defers explicitly to Time Out KL / KLUE

---

## Proactive Messaging (WhatsApp only)

Scheduler runs on **5-minute interval**. Message types:

| Type | When |
|---|---|
| `TRIP_WELCOME` | Day 1 of trip dates |
| `MORNING_NUDGE` | Day 2+, morning hours |
| `DINNER_NUDGE` | Afternoon on active trip days |
| `FEEDBACK_CHECK` | Visited spots with no feedback yet |

**Gates (all must pass):** last user message within 23h, 8h cooldown, daytime only (UTC+8), user not mid-flow

**Background scheduler jobs:**
- **Daily digest** (9am KL): message counts, new spots, cost → Slack
- **Staleness check** (10–12am KL): pings original contributors for spots >180 days unverified

---

## Language Support

Malay detected via 30+ word function-word regex (≥2 matches). When detected: system prompt and user prompt both reinforced to respond in Bahasa Malaysia. English is the default for everything else.

---

## Data Model (8 tables)

| Table | Purpose |
|---|---|
| `spots` | Knowledge graph — every permanent venue |
| `happenings` | Temporal events (festivals, markets, pop-ups) |
| `travelers` | User profiles, preferences, visit/dislike history |
| `conversations` | Session state machine — current_flow, flow_state JSONB, messages (capped at 40) |
| `contributors` | People who've added spots |
| `spot_contributions` | Per-contributor attribution (preserves voice after merges) |
| `feedback` | Post-trip ratings (1–5), tips, visited flag |
| `events` | Append-only analytics — fire-and-forget, never blocks user |

**7 RPC functions** for atomic operations: `match_spots` (pgvector), `append_conversation_messages` (race-safe), `increment_spot_use_count`, `increment_spot_contribution_count`, `get_city_stats`, `get_global_stats`, `daily_stats`

---

## Prompt System (11 prompts)

| Prompt | Model | Temp | Purpose |
|---|---|---|---|
| `system.txt` | Haiku | 0.7 | Sam's core personality + rules |
| `system-web.txt` / `system-whatsapp.txt` | Haiku | 0.7 | Channel-specific addendums |
| `extraction.txt` | Haiku | 0.3 | Voice/text → structured spot JSON |
| `profile.txt` | Haiku | 0.7 | Conversational profile interview |
| `continuous_profile.txt` | Haiku | 0.3 | Background preference extraction |
| `strategic.txt` | **Sonnet** | 0.7 | Pre-trip strategic planning |
| `proactive.txt` | Haiku | 0.8 | Proactive message voice + style |
| `feedback.txt` | Haiku | 0.3 | Feedback response parsing |
| `generate.txt` | Haiku | 0.3 | Admin spot content generation |
| `coach.txt` | **Sonnet** | default | Coaching evaluation scoring |
| `classifyIntent` (inline) | Haiku | 0.2 | Intent classification |

---

## Autonomous Coaching Loop

- `coach.ts`: reviews recent conversations, scores on 6 quality criteria, suggests prompt improvements
- `coach-auto.ts`: automated loop — analyze → apply → validate → commit directly to main (1am UTC, requires ≥3 conversations)
- `coach-revert.ts`: reverts if post-deploy eval scores drop ≥0.3 vs baseline (9am UTC)
- `coach_runs` table: snapshots prompt state before each change for auto-revert
- Slack digest: daily coaching status (healthy / changed / reverted / skipped)

---

## Admin Features (gated by `ADMIN_PHONE_NUMBER`)

| Command | What it does |
|---|---|
| `add: <spot details>` | Rapid text-based spot ingestion (no two-stage flow, no web enrichment) |
| `/generate <city> <category>` | Sonnet generates candidate spots for review |
| `/approve <spot name>` | Applies a pending spot correction |
| `/reject <spot name>` | Dismisses a correction report |
| `/corrections` | Lists all pending corrections |
| `/publish <spot name>` | Moves spot from review queue to live |

---

## Claude Code Skills (8 slash commands)

| Skill | Purpose |
|---|---|
| `/add-spot` | Research + insert a spot into knowledge graph + seed file |
| `/analytics` | Pre-baked SQL analytics (today / week / funnel / cities / contributors) |
| `/city` | Expand to a new city or audit existing coverage |
| `/db` | Natural language → SQL queries via Supabase MCP |
| `/deploy` | Build → type-check → Railway deploy → health check |
| `/eval` | Scenario evaluation suite against live web endpoint (LLM judge) |
| `/test-convo` | Send real messages to Sam, analyze responses, fix issues |
| `/tune-prompt` | Iterative prompt improvement with test scenarios |

---

## Infrastructure

- **Bot**: Express on port 3000, deployed to Railway (`sambot-production-6ab1.up.railway.app`)
- **Web**: Next.js 15 on port 3001, deployed to Railway
- **DB**: Supabase (managed PostgreSQL + pgvector)
- **Builds**: TypeScript → `packages/bot/dist/`, Next.js → `.next/`
- **Health check**: `GET /health`
- **Dev vs prod deploys**: separate Railway environments sharing the same Supabase DB

---

## What Sam Cannot Do (Hard Limits)

- No bookings or reservations
- No real-time venue availability
- No image analysis (captions only)
- No multi-city itineraries
- No cross-device identity linking (web UUID ≠ WhatsApp phone)
- No transport/directions
- No group size or occasion-aware filtering
- No comparison intent ("X vs Y")
