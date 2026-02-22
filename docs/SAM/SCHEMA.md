# Sam — Data Model Reference

Engineering reference for the Sam database. Covers every table, column, index, RLS policy, RPC function, migration history, and write-path for every flow. Audience: engineers building or debugging features. Not a user guide.

---

## 1. Overview

**Extensions**: `uuid-ossp` (UUID generation), `vector` / pgvector (semantic embeddings)

**Tables**: 7

| Table | One-liner |
|---|---|
| `spots` | The knowledge graph — every place Sam knows about |
| `travelers` | User profiles — preferences, trip context, visit history |
| `conversations` | Session state — current flow, flow-specific state, message history |
| `contributors` | People who have added spots to the graph |
| `spot_contributions` | Per-contributor attribution records |
| `feedback` | Post-trip ratings and tips from travelers |
| `events` | Fire-and-forget analytics events |

**RPC functions**: 7 — `get_city_stats`, `get_global_stats`, `daily_stats`, `match_spots`, `append_conversation_messages`, `increment_spot_use_count`, `increment_spot_contribution_count`

**Entity relationships summary**:

```
contributors ←── spots.contributor_id
contributors ←── spot_contributions.contributor_id
spots ←── spot_contributions.spot_id (CASCADE DELETE)
spots ←── feedback.spot_id
travelers ←── feedback.traveler_id
```

---

## 2. Table Reference

### 2.1 `spots` — Knowledge Graph

The central table. Every recommendation comes from here.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `uuid_generate_v4()` | PK |
| `name` | `text` | NOT NULL | — | Required |
| `city` | `text` | NOT NULL | `'Kuala Lumpur'` | |
| `country` | `text` | YES | `NULL` | Added 20260219. Backfilled from city map. |
| `area` | `text` | YES | `NULL` | Neighbourhood / district. Renamed from `neighborhood` in 20260218. |
| `categories` | `text[]` | YES | `NULL` | Multi-category. Early rename from `category text` to `categories text[]`. Values: `breakfast`, `lunch`, `dinner`, `cafe`, `activity`, `nightlife`, `market` |
| `address` | `text` | YES | `NULL` | |
| `latitude` | `decimal` | YES | `NULL` | |
| `longitude` | `decimal` | YES | `NULL` | |
| `google_pin_accurate` | `boolean` | YES | `true` | |
| `payment_methods` | `text[]` | YES | `'{"cash","card"}'` | Operational data — NULLed for all rows in 20260220 (was 100% schema default). Web search fills on demand at query time; not persisted. |
| `opening_hours` | `jsonb` | YES | `NULL` | NULLed for all rows in 20260220 (was 94% static seed data). Web search fills on demand at query time; not persisted. Shape when present: `{"mon": "8am-10pm", "tue": "closed", ...}` |
| `price_range` | `text` | YES | `NULL` | `$`, `$$`, `$$$` |
| `what_to_order` | `text[]` | YES | `NULL` | |
| `what_to_skip` | `text[]` | YES | `NULL` | |
| `pro_tips` | `text[]` | YES | `NULL` | Appended by `insertFeedback()` side effect |
| `vibe` | `text` | YES | `NULL` | `casual`, `upscale`, `chaotic`, `chill`, `local`, `touristy` |
| `weather_dependent` | `boolean` | YES | `false` | |
| `best_time_of_day` | `text` | YES | `NULL` | `morning`, `afternoon`, `evening`, `late-night` |
| `indoor_outdoor` | `text` | YES | `'indoor'` | `indoor`, `outdoor`, `both` |
| `must_go` | `boolean` | YES | `false` | Replaces `tier = 1`. Added 20260220 (named `featured` in migration, renamed to `must_go` in code). Used as primary sort key in `querySpots()`. |
| `verified` | `boolean` | YES | `false` | Replaces `confidence_score`. Added 20260220. Set `true` for contributor-verified spots; set `false` by `spot_correction` intent. |
| `avg_rating` | `numeric(3,2)` | YES | `NULL` | Added 20260221. Recomputed by `insertFeedback()` from all `feedback` rows where `did_they_go = true`. |
| `embedding` | `vector(1536)` | YES | `NULL` | OpenAI `text-embedding-3-small`. Added 20260218. Written by `autoEmbedSpot()` (fire-and-forget after insert). |
| `last_verified` | `timestamptz` | YES | `now()` | Staleness threshold: >180 days = stale. Computed at query time; not updated on read. |
| `use_count` | `integer` | YES | `0` | Incremented atomically via `increment_spot_use_count` RPC. |
| `contribution_count` | `integer` | YES | `0` | Incremented atomically via `increment_spot_contribution_count` RPC. Added 20260219. |
| `source` | `text` | YES | `'manual'` | Added 20260216. Values: `seed`, `voice`, `text`, `llm_verified`, `manual` |
| `contributor_id` | `uuid` | YES | `NULL` | FK → `contributors(id)` |
| `created_at` | `timestamptz` | YES | `now()` | |

**Removed columns** (documented for migration archaeology):
- `tier integer` — removed 20260220. Was 1 (must-do), 2 (should-do), 3 (nice-to-have). Replaced by `must_go` + `verified`.
- `confidence_score decimal` — removed 20260220. Was a float 0–1 quality signal. Replaced by `verified boolean`.
- `neighborhood text` — renamed to `area` in 20260218.

**Query-time staleness flag**: `isStale` is a computed field set by `querySpots()` in TypeScript — not a DB column. A spot is stale if `last_verified` is NULL or older than 180 days.

**Query-time sort order** in `querySpots()`:
1. `must_go DESC` (must-go spots first)
2. `verified DESC` (verified spots second)
3. Shuffled within each tier (random rotation to avoid always surfacing the same spots)
4. Spots with `avg_rating < 2.5` demoted to the back regardless of `must_go`/`verified`

**Indexes**:
```sql
idx_spots_city       ON spots(city)
idx_spots_area       ON spots(area)
idx_spots_category   ON spots(category)   -- legacy name; still present
idx_spots_tier       ON spots(tier)       -- legacy name; still present
idx_spots_avg_rating ON spots(avg_rating) -- added 20260221
-- pgvector ivfflat index on embedding (vector_cosine_ops, lists = 1)
```

**RLS**: Service role full access. Public SELECT only (via scoped policy added in 20260218_010000).

---

### 2.2 `travelers` — User Profiles

One row per user. Created on first contact.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `uuid_generate_v4()` | PK |
| `whatsapp_number` | `text` | NOT NULL UNIQUE | — | Phone number or web session ID |
| `name` | `text` | YES | `NULL` | Learned from conversation |
| `user_type` | `text` | YES | `'unknown'` | `local`, `traveler`, `unknown` |
| `home_areas` | `text[]` | YES | `'{}'` | For locals — neighbourhoods they live in |
| `preferences` | `jsonb` | YES | `'{}'` | See sub-schema below |
| `dietary_restrictions` | `text[]` | YES | `'{}'` | |
| `current_city` | `text` | YES | `NULL` | Determines which city to query |
| `trip_dates` | `jsonb` | YES | `NULL` | `{start: "YYYY-MM-DD", end: "YYYY-MM-DD"}` |
| `travel_party` | `text` | YES | `NULL` | `solo`, `couple`, `friends`, `family` |
| `first_time_visitor` | `boolean` | YES | `true` | |
| `spots_visited` | `uuid[]` | YES | `'{}'` | Appended by `markSpotsVisited()` on every recommendation |
| `spots_liked` | `uuid[]` | YES | `'{}'` | Appended by feedback handler when rating ≥ 4 |
| `spots_disliked` | `uuid[]` | YES | `'{}'` | Appended by feedback handler when rating ≤ 2. Filtered out of all future recommendations. |
| `trips_taken` | `integer` | YES | `0` | |
| `last_proactive_at` | `timestamptz` | YES | `NULL` | Scheduler cooldown check. Updated by `touchLastProactive()`. |
| `spots_feedback_asked` | `uuid[]` | YES | `'{}'` | Tracks which spots have been asked about in feedback, to avoid re-asking |
| `created_at` | `timestamptz` | YES | `now()` | |

**`preferences` sub-schema** (all keys optional):
```jsonc
{
  "budget": "budget" | "mid" | "splurge",
  "pace": "slow" | "moderate" | "packed",
  "interests": ["food", "culture", "nightlife", ...],
  "cuisine_preferences": ["chinese", "indian", "western", ...],
  "specific_requests": ["no pork", "outdoor seating preferred", ...]
}
```
`budget`, `pace` are scalars (overwritten). `interests`, `cuisine_preferences`, `specific_requests` are arrays (append + deduplicate via `mergeArray()`).

**`trip_dates` shape**:
```jsonc
{ "start": "2026-03-15", "end": "2026-03-19" }
```

**Indexes**:
```sql
idx_travelers_phone ON travelers(whatsapp_number)
```

**RLS**: Service role only.

---

### 2.3 `conversations` — Session State

One row per user. Persists current flow and message history.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `uuid_generate_v4()` | PK |
| `whatsapp_number` | `text` | NOT NULL UNIQUE | — | |
| `current_flow` | `text` | YES | `'general'` | See flow values below |
| `flow_state` | `jsonb` | YES | `'{}'` | Flow-specific context. See sub-schemas below. |
| `messages` | `jsonb` | YES | `'[]'` | `[{role: "user"|"assistant", content: string}, ...]`. Capped at 40 via `append_conversation_messages` RPC. |
| `last_user_message_at` | `timestamptz` | YES | `NULL` | Tracks WhatsApp 24h messaging window. Updated by `touchLastUserMessage()`. |
| `created_at` | `timestamptz` | YES | `now()` | |
| `updated_at` | `timestamptz` | YES | `now()` | Updated by every `updateConversation()` call. |

**`current_flow` values**: `general`, `contribution`, `profile_learning`, `strategic`, `feedback`, `generate`, `query_clarifying`

**`flow_state` sub-schemas**:

**contribution** (`stage: "collecting" | "confirming" | "asking_must_go"`):
```jsonc
{
  "stage": "collecting",
  "extracted": { /* Partial<ExtractedSpot> */ },
  "source": "voice" | "text",
  "messagesReceived": 3,
  "webSourcedFields": ["price_range"],
  "areaConflict": { "contributor": "Taman Desa", "web": "OUG" }  // optional
}
```

**profile_learning** (set by `startProfileLearning()`):
```jsonc
{
  "stage": "asking",
  "question_index": 2
}
```

**strategic** (set by `handleStrategic()`):
```jsonc
{
  "planGenerated": true
}
```

**feedback** (set by `startFeedbackCollection()`):
```jsonc
{
  "stage": "asking",
  "spot_id": "uuid",
  "spot_name": "Village Park",
  "pending_spots": ["uuid", ...],
  "pending_names": ["Fatty Crab", ...]
}
```

**generate** (set by `startGenerate()`):
```jsonc
{
  "area": "Bangsar",
  "category": "dinner"
}
```

**query_clarifying**: `{}` (no state — just a flow marker)

**Indexes**:
```sql
idx_conversations_phone ON conversations(whatsapp_number)
```

**RLS**: Service role only.

---

### 2.4 `contributors` — Knowledge Builders

One row per contributor. Created on first contribution.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `uuid_generate_v4()` | PK |
| `whatsapp_number` | `text` | NOT NULL UNIQUE | — | |
| `name` | `text` | YES | `NULL` | |
| `cities_contributed` | `text[]` | YES | `'{}'` | Appended (deduped) on each contribution |
| `spots_contributed` | `integer` | YES | `0` | Incremented by `incrementContributorCount()` |
| `created_at` | `timestamptz` | YES | `now()` | |

**Indexes**: None beyond the PK.

**RLS**: Service role full access. Public SELECT (added in 20260218_010000).

---

### 2.5 `spot_contributions` — Per-Contributor Attribution

One row per contributor per spot. Records what each person specifically contributed so credit can be attributed even when data is merged.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `spot_id` | `uuid` | NOT NULL | — | FK → `spots(id)` ON DELETE CASCADE |
| `contributor_id` | `uuid` | NOT NULL | — | FK → `contributors(id)` |
| `what_to_order` | `text[]` | YES | `'{}'` | |
| `what_to_skip` | `text[]` | YES | `'{}'` | |
| `pro_tips` | `text[]` | YES | `'{}'` | |
| `vibe` | `text` | YES | `NULL` | |
| `is_must_go` | `boolean` | YES | `false` | Contributor's opinion. Added 20260220_130000. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

**Removed columns**:
- `tier integer` — was in the original 20260219 create. Removed in 20260220_130000.

**Indexes**:
```sql
idx_spot_contributions_spot_id        ON spot_contributions(spot_id)
idx_spot_contributions_contributor_id ON spot_contributions(contributor_id)
```

**RLS**: Public SELECT; service role for writes.

---

### 2.6 `feedback` — Post-Trip Ratings

One row per traveler per spot rating. Side effects on `spots` are computed in application code, not triggers.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `uuid_generate_v4()` | PK |
| `spot_id` | `uuid` | YES | `NULL` | FK → `spots(id)` (no cascade) |
| `traveler_id` | `uuid` | YES | `NULL` | FK → `travelers(id)` (no cascade) |
| `rating` | `integer` | YES | `NULL` | 1–5. Check constraint: `rating >= 1 AND rating <= 5` |
| `did_they_go` | `boolean` | YES | `NULL` | Only count rating if `true` when recomputing avg_rating |
| `comments` | `text` | YES | `NULL` | Free text |
| `user_tips` | `text[]` | YES | `NULL` | Appended to `spots.pro_tips` by `insertFeedback()` |
| `created_at` | `timestamptz` | YES | `now()` | |

**Side effects on `spots`** (executed in `insertFeedback()` in application code):
1. `avg_rating` — recomputed as `AVG(rating)` across all `feedback` rows for this spot where `did_they_go = true`. Rounded to 2 decimal places. Only fires when `did_they_go != false`.
2. `pro_tips` — `user_tips` from the new feedback row are appended to `spots.pro_tips`.

**Indexes**:
```sql
idx_feedback_spot ON feedback(spot_id)
```

**RLS**: Service role only.

---

### 2.7 `events` — Analytics

Append-only. Written via `trackEvent()` which is fire-and-forget — never blocks the user.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `uuid_generate_v4()` | PK |
| `session_id` | `text` | NOT NULL | — | Phone number (WhatsApp) or browser session ID (web) |
| `channel` | `text` | NOT NULL | — | `web` or `whatsapp`. Check constraint enforced. |
| `event_type` | `text` | NOT NULL | — | See event types below |
| `event_data` | `jsonb` | YES | `'{}'` | Event-specific payload |
| `created_at` | `timestamptz` | YES | `now()` | |

**Indexes**:
```sql
idx_events_session ON events(session_id)
idx_events_type    ON events(event_type)
idx_events_created ON events(created_at)
```

**RLS**: Service role only.

---

## 3. Foreign Key Relationships

| FK column | References | On delete |
|---|---|---|
| `spots.contributor_id` | `contributors(id)` | No action (SET NULL effectively) |
| `spot_contributions.spot_id` | `spots(id)` | CASCADE |
| `spot_contributions.contributor_id` | `contributors(id)` | No action |
| `feedback.spot_id` | `spots(id)` | No action |
| `feedback.traveler_id` | `travelers(id)` | No action |

Note: `travelers` has no FK relationships to `spots` — `spots_visited`, `spots_liked`, `spots_disliked`, `spots_feedback_asked` are all `uuid[]` arrays without referential integrity. Orphan UUIDs are possible if a spot is deleted.

---

## 4. RPC Functions

### 4.1 `get_city_stats(target_city text DEFAULT 'Kuala Lumpur')`

**Returns**: `json — {spot_count: int, contributor_count: int}`

**Security**: `SECURITY DEFINER`. Execute granted to `anon` role.

**Reads**: `spots` (count by city), `contributors` (count).

**Called by**: Web landing page stats display (`packages/web/src/lib/supabase.ts` — `getCityStats()`).

---

### 4.2 `get_global_stats()`

**Returns**: `json — {spot_count: int, contributor_count: int}` — totals across all cities.

**Security**: `SECURITY DEFINER`. Execute granted to `anon`.

**Reads**: `spots` (total count), `contributors` (total count).

**Called by**: Web landing page global counter.

---

### 4.3 `daily_stats(from_date date, to_date date)`

**Returns**: table of rows — `(day, unique_sessions, total_messages, web_messages, whatsapp_messages, top_intent, recommendations, flow_completions)`

**Security**: Service role.

**Reads**: `events` table. Uses `generate_series` for date range, left-joined to events.

**Called by**: `/analytics` skill, admin dashboards.

---

### 4.4 `match_spots(query_embedding vector(1536), filter_city text, filter_categories text[], match_limit int)`

**Returns**: table — all spot columns + `similarity float`

**Security**: `SECURITY DEFINER` (likely).

**Reads**: `spots` via cosine similarity on `embedding` column (pgvector `<=>` operator).

**Sort order**: `must_go DESC, verified DESC, similarity DESC` (updated in 20260220_130000; previously ordered by `tier ASC, similarity DESC`).

**Called by**: `semanticSearchSpots()` in `database.ts` — used as fallback when structured `querySpots()` returns empty results (dish queries, zero-result areas).

---

### 4.5 `append_conversation_messages(p_phone_number text, p_new_messages jsonb, p_max_messages int)`

**Returns**: void

**Security**: `SECURITY DEFINER` (row-level lock prevents race condition).

**Reads + writes**: `conversations.messages`. Appends `p_new_messages`, then trims to the last `p_max_messages` entries (currently 40).

**Why an RPC**: Prevents read-modify-write races when two concurrent messages from the same user arrive simultaneously and overwrite each other's history.

**Called by**: `appendMessages()` in `database.ts` — invoked after every message exchange on both WhatsApp and web.

---

### 4.6 `increment_spot_use_count(p_spot_id uuid)`

**Returns**: void

**Security**: Invoker (service role in practice).

**Reads + writes**: `spots.use_count` — single `UPDATE spots SET use_count = use_count + 1`.

**Why an RPC**: Atomic increment avoids SELECT → UPDATE race under concurrent recommendations.

**Called by**: `incrementSpotUseCount()` in `database.ts` — fired by `handleHungry`, `handleDayPlan`, `handleNearby` for each recommended spot.

---

### 4.7 `increment_spot_contribution_count(p_spot_id uuid)`

**Returns**: void

**Security**: Invoker (service role in practice).

**Reads + writes**: `spots.contribution_count` — single `UPDATE spots SET contribution_count = contribution_count + 1`.

**Called by**: `incrementSpotContributionCount()` in `database.ts` — fired after every contribution save (both new spot and merge paths).

---

## 5. Schema Evolution (Migration Log)

| Date | File | What changed |
|---|---|---|
| 2026-02-16 | `20260216_000000_initial_schema.sql` | Initial schema: `contributors`, `spots` (with `neighborhood`, `tier`, `confidence_score`), `travelers`, `conversations`, `feedback`. Basic indexes + blanket RLS policies. |
| 2026-02-16 | `20260216_010000_add_spot_source.sql` | Added `spots.source text DEFAULT 'manual'`. |
| 2026-02-17 | `20260217_000000_add_city_stats_rpc.sql` | Added `get_city_stats()` RPC. |
| 2026-02-18 | `20260218_000000_add_embeddings.sql` | Enabled pgvector extension. Added `spots.embedding vector(1536)`. Added ivfflat index. Added `match_spots()` RPC (ordered by `tier ASC, similarity DESC`). |
| 2026-02-18 | `20260218_010000_rls_policies.sql` | Replaced blanket `using (true)` RLS with role-scoped policies: `spots`/`contributors` public SELECT, service role writes; `travelers`/`conversations`/`feedback` service role only. |
| 2026-02-18 | `20260218_020000_add_daily_stats_rpc.sql` | Added `daily_stats()` analytics RPC. |
| 2026-02-18 | `20260218_030000_rename_neighborhood_to_area.sql` | Renamed `spots.neighborhood` → `spots.area`. Dropped `idx_spots_neighborhood`, created `idx_spots_area`. Recreated `match_spots` RPC to return `area` instead of `neighborhood`. |
| 2026-02-18 | `20260218_040000_global_stats_rpc.sql` | Added `get_global_stats()` RPC. |
| 2026-02-19 | `20260219_000000_spot_contributions.sql` | Created `spot_contributions` table (with `tier integer` column). Added indexes. |
| 2026-02-19 | `20260219_040000_add_contribution_count.sql` | Added `spots.contribution_count integer DEFAULT 0`. Backfilled from `spot_contributions`, floor 1. |
| 2026-02-19 | `20260219_050000_add_country_to_spots.sql` | Added `spots.country text`. Backfilled from city→country map. |
| 2026-02-20 | `20260220_000000_clear_stale_operational_data.sql` | NULLed `spots.opening_hours` for all rows (was 94% static seed data). NULLed `spots.payment_methods` for all rows (was 100% schema default). These fields now sourced live from web search, never persisted. |
| 2026-02-20 | `20260220_010000_atomic_helpers.sql` | Added three atomic RPCs: `append_conversation_messages`, `increment_spot_use_count`, `increment_spot_contribution_count`. |
| 2026-02-20 | `20260220_130000_replace_tier_confidence_with_featured_verified.sql` | Dropped `spots.tier` and `spots.confidence_score`. Added `spots.must_go boolean DEFAULT false` (named `featured` in migration SQL, renamed to `must_go` in application code). Added `spots.verified boolean DEFAULT false`. Added `spot_contributions.is_must_go boolean DEFAULT false`. Removed `spot_contributions.tier`. Backfilled: `verified = true` for source in (seed, manual, text, voice); `must_go = true` where `tier = 1`. Recreated `match_spots` RPC: sort order `must_go DESC, verified DESC, similarity DESC`; removed unused `match_threshold` parameter. |
| 2026-02-21 | `20260221_000000_add_avg_rating_to_spots.sql` | Added `spots.avg_rating numeric(3,2)`. Added `idx_spots_avg_rating`. Backfilled from `feedback` table (AVG where `did_they_go = true`). |

---

## 6. Write-Path Reference

Every write path in the system, organised by table.

### 6.1 `spots` — Writes

| Operation | Trigger / Handler | Function in code | Columns written | Notes |
|---|---|---|---|---|
| INSERT new spot | Contribution flow save (new spot path) | `insertSpot()` ← `saveSpot()` in `contribution.ts` | All spot columns present in `extracted` + `contributor_id`, `source`, `verified=true`, `must_go` | Fires `autoEmbedSpot()` async to write `embedding` |
| INSERT new spot | Admin `add:` prefix | `insertSpot()` in `index.ts` | Extracted fields + `source='text'` | ADMIN_PHONE_NUMBER gated |
| UPDATE merge | Contribution flow save (duplicate / merge path) | `updateSpot()` ← `saveSpot()` in `contribution.ts` | `what_to_order`, `what_to_skip`, `pro_tips`, `payment_methods`, `vibe`, `price_range`, `address`, `best_time_of_day`, `indoor_outdoor`, `weather_dependent`, `must_go` (if isMustGo) | Only contributor-verified fields; web-sourced fields stripped before merge |
| UPDATE embedding | After any insertSpot | `updateSpot({embedding})` ← `autoEmbedSpot()` in `database.ts` | `embedding` | Fire-and-forget; may fail silently if OPENAI_API_KEY missing |
| UPDATE verified=false | Spot correction report | `updateSpot({verified: false})` ← `handleSpotCorrection()` | `verified` | De-prioritises spot in `querySpots()` (ordered `verified DESC`) |
| UPDATE avg_rating | After feedback insert | `supabase.from("spots").update({avg_rating})` inside `insertFeedback()` | `avg_rating` | Only if `did_they_go != false` |
| UPDATE pro_tips | After feedback insert | `supabase.from("spots").update({pro_tips})` inside `insertFeedback()` | `pro_tips` | Appends `user_tips` from feedback row |
| RPC use_count++ | Every recommendation (hungry/day_plan/nearby) | `incrementSpotUseCount()` ← `handleHungry`, `handleDayPlan`, `handleNearby` | `use_count` | Fire-and-forget |
| RPC contribution_count++ | Contribution flow save (both new and merge) | `incrementSpotContributionCount()` ← `saveSpot()` | `contribution_count` | Fire-and-forget |

---

### 6.2 `travelers` — Writes

| Operation | Trigger / Handler | Function in code | Columns written | Notes |
|---|---|---|---|---|
| INSERT new traveler | First message from any user | `getOrCreateTraveler()` | `whatsapp_number` + all defaults | Upsert pattern |
| UPDATE profile fields | Every message (background) | `updateTraveler()` ← `maybeExtractProfile()` in `continuous-profile.ts` | `name`, `user_type`, `home_areas`, `trip_dates`, `travel_party`, `dietary_restrictions`, `first_time_visitor`, `current_city`, `preferences` | Skipped for: contribution, feedback, generate, profile_learning flows |
| UPDATE profile fields | Profile learning flow completion | `updateTraveler()` ← `handleProfile()` on `[PROFILE_COMPLETE]` | Same fields as above | Explicit profile interview |
| UPDATE spots_visited | Every recommendation | `markSpotsVisited()` ← `handleHungry`, `handleDayPlan`, `handleNearby` | `spots_visited` | Append + deduplicate |
| UPDATE spots_liked | Feedback handler, rating ≥ 4 | `updateTraveler({spots_liked})` in `feedback.ts` | `spots_liked` | Only if `did_they_go != false` |
| UPDATE spots_disliked | Feedback handler, rating ≤ 2 | `updateTraveler({spots_disliked})` in `feedback.ts` | `spots_disliked` | Disliked IDs filtered from all future `querySpots()` calls |
| UPDATE spots_feedback_asked | Scheduler (FEEDBACK_CHECK) + feedback collection | `markFeedbackAsked()` | `spots_feedback_asked` | Prevents re-asking about same spots |
| UPDATE last_proactive_at | After each proactive message sent | `touchLastProactive()` ← `scheduler.ts` | `last_proactive_at` | 8-hour cooldown check |

---

### 6.3 `conversations` — Writes

| Operation | Trigger / Handler | Function in code | Columns written | Notes |
|---|---|---|---|---|
| INSERT new conversation | First message from any user | `getOrCreateConversation()` | `whatsapp_number` + all defaults | |
| APPEND messages | Every message exchange (both channels) | `appendMessages()` → `append_conversation_messages` RPC | `messages` | Atomic RPC; trims to 40 messages |
| UPDATE flow | Intent dispatch / flow transitions | `updateConversation()` | `current_flow`, `flow_state`, `updated_at` | Called at start of every flow, on completion, and on mid-flow stage transitions |
| UPDATE last_user_message_at | Every incoming WhatsApp message | `touchLastUserMessage()` | `last_user_message_at` | Fire-and-forget; drives WhatsApp 24h window check in scheduler |

---

### 6.4 `feedback` — Writes

| Operation | Trigger / Handler | Function in code | Columns written | Notes |
|---|---|---|---|---|
| INSERT feedback row | Feedback flow, after rating parsed | `insertFeedback()` ← `handleFeedback()` | `spot_id`, `traveler_id`, `rating`, `did_they_go`, `comments`, `user_tips` | Side effects: `spots.avg_rating` recomputed, `spots.pro_tips` appended (see §6.1) |

---

### 6.5 `spot_contributions` — Writes

| Operation | Trigger / Handler | Function in code | Columns written | Notes |
|---|---|---|---|---|
| INSERT attribution | Contribution flow save (new spot) | `insertSpotContribution()` ← `saveSpot()` in `contribution.ts` | `spot_id`, `contributor_id`, `what_to_order`, `what_to_skip`, `pro_tips`, `vibe`, `is_must_go` | Fire-and-forget (error logged, not rethrown) |
| INSERT attribution | Contribution flow save (merge path) | Same | Same | Also fires on merge — contributor gets credited even when intel is merged into existing spot |

---

### 6.6 `contributors` — Writes

| Operation | Trigger / Handler | Function in code | Columns written | Notes |
|---|---|---|---|---|
| INSERT new contributor | First contribution by a phone number | `getOrCreateContributor()` inside `incrementContributorCount()` | `whatsapp_number` + defaults | |
| UPDATE count + cities | Contribution flow save (both new and merge) | `incrementContributorCount()` ← `saveSpot()` | `spots_contributed` (+1), `cities_contributed` (append city if new) | Manual UPDATE (not atomic RPC); race condition possible but acceptably rare |

---

### 6.7 `events` — Writes

| Event type | When fired | Key `event_data` fields |
|---|---|---|
| `message` | Every processed message | `{intent, channel}` |
| `recommendation` | After `handleHungry` / `handleDayPlan` / `handleNearby` returns spots | `{spot_ids: [], spot_names: []}` |
| `flow_complete` | On completion of contribution, feedback, profile flows | `{flow, spot_name?, action?, source?, rating?}` |
| `llm_usage` | After each LLM call (via `flushUsage`) | `{model, input_tokens, output_tokens, cost_usd?}` |
| `unsupported_city_request` | User asks about a city Sam doesn't cover | `{city}` |
| `spot_correction` | User reports a problem with a spot | `{spot_id?, spot_name, correction, found_in_db?}` |

All events are written via `trackEvent()` in `database.ts` — fire-and-forget (`Promise` not awaited; errors logged but never rethrown).

---

## 7. What Each Flow Touches (Summary Table)

| Flow / Handler | Reads | Writes | Key side effects |
|---|---|---|---|
| `handleHungry` (hungry intent) | `travelers`, `spots`, `weather` | `travelers.spots_visited`, `spots.use_count` | `trackEvent(recommendation)` |
| `handleDayPlan` (day_plan intent) | `travelers`, `spots`, `weather` | `travelers.spots_visited`, `spots.use_count` | `trackEvent(recommendation)` |
| `handleNearby` (nearby intent) | `travelers`, `spots`, `weather` | `travelers.spots_visited`, `spots.use_count` | `trackEvent(recommendation)` |
| `handleSpotInfo` (spot_info intent) | `spots` | — | Web search for missing fields (hours, payment); not persisted |
| `handleSpotCorrection` (spot_correction intent) | `spots` | `spots.verified = false`, `events` | `trackEvent(spot_correction)` |
| `handleContribution` — new spot | `spots`, `contributors` | `spots` (insert), `spot_contributions`, `contributors`, `conversations`, `events` | Geocoding for lat/lng; `autoEmbedSpot()` async |
| `handleContribution` — merge | `spots`, `contributors` | `spots` (update), `spot_contributions`, `contributors`, `events` | No geocoding |
| `handleProfile` (profile_learning) | `travelers`, `conversations` | `travelers`, `conversations`, `events` | Transitions to `handleStrategic` on completion |
| `maybeExtractProfile` (continuous, every message) | `travelers` | `travelers` | Background; skips contribution/feedback/generate flows |
| `handleStrategic` (strategic flow) | `travelers`, `spots` | `conversations` | Uses Sonnet (not Haiku); read-heavy |
| `handleFeedback` (feedback flow) | `travelers`, `spots`, `feedback` | `feedback` (insert), `travelers.spots_liked/disliked`, `spots.avg_rating`, `spots.pro_tips`, `conversations`, `events` | avg_rating recomputed; pro_tips appended |
| Proactive scheduler (5-min cron) | `travelers`, `conversations`, `spots` | `travelers.last_proactive_at`, `travelers.spots_feedback_asked` | WhatsApp only; gates: 24h window, 8h cooldown, daytime, `current_flow = general` |
| Admin `add:` prefix | `spots` (duplicate check) | `spots` (insert), `conversations.messages` | ADMIN_PHONE_NUMBER gated |
| `appendMessages()` | — | `conversations.messages` | Atomic RPC; fired on every message exchange, both channels |

---

## 8. JSONB Sub-Schemas

### `travelers.preferences`

```typescript
{
  budget?: "budget" | "mid" | "splurge"
  pace?: "slow" | "moderate" | "packed"
  interests?: string[]                  // e.g. ["food", "culture", "nightlife"]
  cuisine_preferences?: string[]        // e.g. ["chinese", "malay", "western"]
  specific_requests?: string[]          // e.g. ["no pork", "outdoor seating preferred"]
}
```

Top-level traveler columns vs preferences JSONB routing:

| Field | Location |
|---|---|
| `name` | Top-level column |
| `user_type` | Top-level column |
| `home_areas` | Top-level column (`text[]`) |
| `trip_dates` | Top-level column (`jsonb`) |
| `travel_party` | Top-level column |
| `dietary_restrictions` | Top-level column (`text[]`) |
| `first_time_visitor` | Top-level column |
| `current_city` | Top-level column |
| `budget`, `pace` | Inside `preferences` JSONB |
| `interests`, `cuisine_preferences`, `specific_requests` | Inside `preferences` JSONB (arrays) |

---

### `travelers.trip_dates`

```typescript
{
  start: string  // "YYYY-MM-DD"
  end: string    // "YYYY-MM-DD"
}
```

---

### `conversations.flow_state` — by flow

**`contribution` (collecting stage)**:
```typescript
{
  stage: "collecting" | "confirming" | "asking_must_go"
  extracted: {
    name?: string
    categories?: string[]
    area?: string
    city?: string
    country?: string
    address?: string
    price_range?: string
    payment_methods?: string[]
    what_to_order?: string[]
    what_to_skip?: string[]
    pro_tips?: string[]
    vibe?: string
    best_time_of_day?: string
    indoor_outdoor?: string
    weather_dependent?: boolean
    is_must_go?: boolean
  }
  source: "voice" | "text"
  messagesReceived: number
  webSourcedFields?: string[]             // Fields filled from web, stripped before DB insert
  areaConflict?: { contributor: string; web: string }  // When web disagrees with contributor's area
}
```

**`profile_learning`**:
```typescript
{
  stage: "asking"
  question_index: number
}
```

**`strategic`**:
```typescript
{
  planGenerated: true
}
```

**`feedback`**:
```typescript
{
  stage: "asking"
  spot_id: string                  // UUID of spot currently being asked about
  spot_name: string
  pending_spots: string[]          // Remaining spot UUIDs to ask about
  pending_names: string[]          // Matching names for pending_spots
}
```

**`generate`**:
```typescript
{
  area: string
  category: string
}
```

---

### `events.event_data` — by event_type

**`message`**:
```typescript
{ intent: string, channel: "web" | "whatsapp" }
```

**`recommendation`**:
```typescript
{ spot_ids: string[], spot_names: string[] }
```

**`flow_complete`**:
```typescript
{
  flow: "contribution" | "feedback" | "profile"
  spot_name?: string
  action?: "updated_existing"          // only on merge path
  source?: "voice" | "text"
  rating?: number                      // only for feedback flow
}
```

**`llm_usage`**:
```typescript
{ model: string, input_tokens: number, output_tokens: number, cost_usd?: number }
```

**`unsupported_city_request`**:
```typescript
{ city: string }
```

**`spot_correction`**:
```typescript
{
  spot_id?: string           // present if spot found in DB
  spot_name: string
  correction: string         // "unspecified" if not provided
  found_in_db?: false        // only present when spot not found
}
```

---

## 9. Known Schema Gaps and Gotchas

1. **`must_go` vs `featured`**: The 20260220_130000 migration SQL uses `ADD COLUMN featured`. Application code (`database.ts`, all handlers) uses `must_go`. The column was either renamed after the migration was applied or the migration SQL description is approximate. Ground truth is the code: the actual column is `must_go`.

2. **`categories` vs `category`**: `schema.sql` shows `category text` in the initial schema. Actual live column is `categories text[]`. This rename happened early, before the migration log starts at 20260216. There is no migration file for this change.

3. **`opening_hours` and `payment_methods`**: Both are NULLed in production (migration 20260220_000000). They appear in the schema as valid columns but contain no data. These fields are sourced live from web search at query time and never persisted.

4. **No FK integrity on traveler history arrays**: `spots_visited`, `spots_liked`, `spots_disliked`, `spots_feedback_asked` are `uuid[]` columns — no FK constraint to `spots`. Orphan UUIDs are possible if spots are deleted.

5. **`feedback` FKs without cascade**: Deleting a `spot` does not cascade to `feedback` rows. Orphan feedback rows are possible.

6. **Staleness is computed, not stored**: `isStale` is a TypeScript boolean computed in `querySpots()` and attached to the returned objects. It does not exist as a DB column.

7. **`contributors.spots_contributed` has no RPC**: Unlike `spots.use_count` and `spots.contribution_count`, `contributors.spots_contributed` is incremented with a direct UPDATE (not an atomic RPC). A race condition is theoretically possible but acceptably rare given contribution frequency.
