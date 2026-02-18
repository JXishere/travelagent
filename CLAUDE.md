# Sam — Travel Intelligence for KL

Sam is a travel intelligence bot for Kuala Lumpur, available on WhatsApp and the web. He guides travelers with opinionated, operationally-detailed recommendations drawn from a proprietary knowledge graph built by real local contributors.

## Stack

- **Runtime**: Node.js / TypeScript
- **Framework**: Express (webhook server for WhatsApp Cloud API)
- **Web**: Next.js 15 (landing page at `packages/web/`)
- **Database**: Supabase (PostgreSQL)
- **LLM**: Claude API via `@anthropic-ai/sdk` — default model is Haiku (`claude-haiku-4-5-20251001`), Sonnet (`claude-sonnet-4-5-20250929`) available for heavier tasks
- **Voice**: OpenAI Whisper (voice note transcription)
- **Weather**: OpenWeather API (context-aware recommendations)
- **Embeddings**: OpenAI `text-embedding-3-small` (pgvector semantic search)

## Monorepo Structure

npm workspaces monorepo with two packages:

```
packages/
├── bot/                — WhatsApp bot (Express + Claude)
│   ├── src/
│   │   ├── index.ts            — Express app, webhook routes, flow router
│   │   ├── database.ts         — Supabase client + all DB operations + trackEvent()
│   │   ├── llm.ts              — Claude API wrapper, prompt loading, SSE streaming
│   │   ├── whatsapp.ts         — WhatsApp Cloud API (send/receive/media)
│   │   ├── transcription.ts    — Whisper voice note transcription
│   │   ├── weather.ts          — OpenWeather integration
│   │   ├── scheduler.ts        — Proactive message engine (5-min interval)
│   │   ├── seed.ts             — Seed runner (imports per-city data, inserts to DB)
│   │   ├── coach.ts            — Self-coaching: reviews conversations, suggests prompt improvements
│   │   ├── coach-auto.ts       — Automated coaching: analyze → apply → validate → commit
│   │   ├── embeddings.ts       — OpenAI embeddings for pgvector semantic search
│   │   ├── backfill-embeddings.ts — Backfill script for spots missing embeddings
│   │   ├── eval/
│   │   │   ├── eval-runner.ts         — Prompt evaluation framework
│   │   │   └── scenarios/             — JSONL test scenarios per prompt
│   │   ├── handlers/
│   │   │   ├── query.ts              — "I'm hungry" → spot recommendations
│   │   │   ├── contribution.ts       — Voice note → structured spot ingestion
│   │   │   ├── profile.ts            — Conversational trip profile learning
│   │   │   ├── continuous-profile.ts — Background profile extraction from every message
│   │   │   ├── strategic.ts          — Pre-trip strategic planning
│   │   │   ├── ontrip.ts             — Day-by-day guidance (hungry, day_plan, nearby)
│   │   │   ├── feedback.ts           — Post-trip spot validation
│   │   │   └── generate.ts           — Admin /generate command for spot content
│   │   ├── prompts/
│   │   │   ├── system.txt             — Sam's personality + core rules
│   │   │   ├── extraction.txt         — Voice note → JSON extraction
│   │   │   ├── profile.txt            — Conversational profile learning
│   │   │   ├── continuous_profile.txt — Background profile extraction rules
│   │   │   ├── strategic.txt          — Strategic trip planning format
│   │   │   ├── proactive.txt          — Proactive message voice + style
│   │   │   ├── feedback.txt           — Feedback response parsing
│   │   │   ├── generate.txt           — Spot content generation prompt
│   │   │   └── coach.txt              — Coaching evaluation prompt
│   │   ├── seeds/
│   │   │   ├── kl.ts                  — 49 Kuala Lumpur spots
│   │   │   ├── penang.ts             — 87 Penang spots (island + mainland)
│   │   │   └── pj.ts                  — 4 Petaling Jaya spots
│   │   └── utils/
│   │       ├── categories.ts          — Category mappings + synonyms
│   │       ├── city-defaults.ts       — Per-city coordinates, timezone, locale
│   │       └── geo.ts                 — Haversine distance, nearby filtering
│   ├── vitest.config.ts
│   ├── package.json
│   └── tsconfig.json
├── web/                — Next.js web interface (landing page + chat)
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx             — Root layout (Geist Mono, dark theme)
│   │   │   ├── page.tsx               — Counter page (server component, ISR)
│   │   │   ├── globals.css            — Tailwind v4 + custom vars
│   │   │   ├── chat/
│   │   │   │   └── page.tsx           — Chat interface page
│   │   │   ├── review/
│   │   │   │   └── page.tsx           — Spot review/curation admin UI
│   │   │   └── api/
│   │   │       └── chat/
│   │   │           └── route.ts       — SSE streaming endpoint (imports @sam/bot)
│   │   ├── components/
│   │   │   ├── chat-bubble.tsx        — Message bubble (user/Sam)
│   │   │   ├── chat-input.tsx         — Message input bar
│   │   │   ├── chat-messages.tsx      — Scrollable message list
│   │   │   ├── prompt-input.tsx       — Landing page prompt input
│   │   │   ├── rotating-city.tsx      — Animated city name rotator for landing page
│   │   │   ├── spot-card.tsx          — Expandable spot card with edit/approve/delete
│   │   │   └── spot-filters.tsx       — Filter by category/area/tier/source
│   │   └── lib/
│   │       ├── rate-limit.ts          — Rate limiting utility
│   │       └── supabase.ts            — Supabase client, getAllSpots(), updateSpot(), deleteSpot(), getCityStats()
│   ├── next.config.ts                 — Env forwarding, @sam/bot transpilation
│   ├── package.json
│   └── tsconfig.json

supabase/
└── schema.sql          — Full database schema (6 tables + RPC)

docs/                   — Strategy docs, competitive analysis, blueprints
```

## Dev Commands

```bash
npm run dev        # Start bot dev server (Express on :3000)
npm run dev:web    # Start landing page dev server (Next.js on :3001)
npm run build      # Build both packages
npm run build:bot  # Build bot only
npm run build:web  # Build web only
npm run start      # Run compiled bot
npm run seed       # Populate knowledge graph with KL spots
npm test           # Run bot tests (vitest)
npm run coach      # Run self-coaching analysis on recent conversations
npm run coach:auto # Automated coaching: analyze → apply → validate → commit
```

## Code Rules

1. **Never fabricate spots.** Only recommend places that exist in the database. If the DB has no matches, say so honestly.
2. **Only use DB data.** All spot details (address, hours, tips) must come from the `spots` table, not LLM imagination.
3. **Keep WhatsApp messages concise.** People read these on phones — short paragraphs, no walls of text.
4. **Operational intelligence is the product.** Always include: what to order, payment, hours, pro tips. Not just "it's good."
5. **Sam has personality.** Warm, opinionated, slightly irreverent. He's your friend who lives in KL, not a search engine.
6. **SQL changes go in migrations, not schema.sql.** `supabase/schema.sql` is the reference schema — don't append to it. Create a new migration file in `supabase/migrations/` using the naming convention `YYYYMMDD_HHMMSS_description.sql`. Update the migration log in `supabase/migrations/README.md`.

## Schema Overview

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `spots` | Knowledge graph | name, area, category, tier(1-3), what_to_order[], what_to_skip[], pro_tips[], vibe, payment_methods[], opening_hours, price_range, latitude, longitude, best_time_of_day, indoor_outdoor, weather_dependent, embedding, confidence_score, use_count, source, contributor_id |
| `contributors` | Who added knowledge | whatsapp_number, name, cities_contributed[], spots_contributed |
| `travelers` | User profiles | whatsapp_number, preferences(jsonb), dietary_restrictions[], trip_dates, travel_party, user_type, home_areas[], trips_taken |
| `conversations` | State management | whatsapp_number, current_flow, flow_state(jsonb), messages(jsonb[]) |
| `feedback` | Post-trip validation | spot_id, traveler_id, rating(1-5), did_they_go, user_tips[] |
| `events` | Analytics / usage tracking | session_id, channel(web/whatsapp), event_type, event_data(jsonb), created_at |

**Spot categories**: breakfast, lunch, dinner, cafe, activity, nightlife, market
**Spot tiers**: 1 = must-do, 2 = should-do, 3 = nice-to-have/hidden gem
**Vibes**: casual, upscale, chaotic, chill, local, touristy

## Prompt Loading

Prompts live in `packages/bot/src/prompts/*.txt` and are loaded by `packages/bot/src/llm.ts`:

```typescript
const PROMPTS_DIR = join(__dirname, "prompts");
function loadPrompt(name: string): string {
  return readFileSync(join(PROMPTS_DIR, `${name}.txt`), "utf-8");
}
```

- `chatAsSam()` loads `system.txt` for Sam's personality (default: Haiku)
- `chatAsSamStream()` / `chatStream()` — SSE streaming variants used by the web chat
- `extractJSON()` loads any prompt by name for structured extraction (default: Haiku)
- `classifyIntent()` uses an inline prompt (not from file)
- `classifyConfirmation()` classifies user response during contribution save confirmation
- `setPromptsDir()` — lets the web package override the prompts directory path (needed because Next.js resolves from a different root)

## Flow Architecture

**WhatsApp**: WhatsApp → webhook → `processMessage()` → `classifyIntent()` → handler → DB query + LLM → `sendMessage()` → WhatsApp

**Web**: Browser → `POST /api/chat` → `classifyIntent()` → handler → DB query + LLM → SSE stream → Browser

Both flows share the same handlers. The web route imports them directly from `@sam/bot` via the workspace dependency — no HTTP indirection.

Intents: hungry, day_plan, nearby, weather, contribute, profile, feedback, general

Each user has a `current_flow` in the `conversations` table. Flow-specific state is stored in `flow_state` (JSONB).

### Admin Features

Gated behind `ADMIN_PHONE_NUMBER` env var:
- **`add:` prefix** — Rapid-add spots via text: `add: Fatty Crab, Taman Megah, dinner, tier 1. ...`
- **`/generate` command** — Generate spot content: `/generate bangsar dinner`

### Background Processing

- **Continuous profile extraction** — `maybeExtractProfile()` runs after every message exchange, silently extracting trip/preference info into the traveler profile without interrupting the conversation flow.
- **Proactive scheduler** — `startScheduler()` runs on a 5-minute interval (WhatsApp only). Sends 4 message types: TRIP_WELCOME (day 1), MORNING_NUDGE (day 2+), DINNER_NUDGE (afternoon), FEEDBACK_CHECK (visited spots). Gates: requires 24h WhatsApp messaging window, 8h cooldown between messages, daytime hours only, skips users mid-flow.

## Analytics

`trackEvent()` in `database.ts` is fire-and-forget — never blocks the user. Instrumented at:
- **Every message**: `message` event with `intent` (both WhatsApp + web)
- **Recommendations**: `recommendation` event with `spot_ids` and `spot_names`
- **Flow completions**: `flow_complete` event for contribution, profile, and feedback flows

Query the `events` table in Supabase dashboard to analyze usage patterns.

## Environment Variables

Single root `.env.local` (gitignored) shared by both packages. See `.env.example` for the full list.
