# Sam

**The friend who lives everywhere.**

Sam is a travel intelligence bot — on WhatsApp and the web. Text him like a friend and he'll tell you where to eat, what to order, when to go, and what to skip — all from a knowledge graph built by real locals, not scraped reviews.

Currently live in **Kuala Lumpur**, **Petaling Jaya**, and **Penang**. The architecture is city-aware and built to expand.

## How it works

A traveler texts Sam. Sam classifies the intent, queries a local knowledge graph of vetted spots, and responds with opinionated, operationally-detailed recommendations — what to order, how to pay, pro tips, hours. Every recommendation comes from the database, never fabricated by the LLM.

```
Traveler: "I'm hungry near Bangsar, something casual"

Sam: Head to Devi's Corner — the banana leaf rice is the move here.
     Get the fish head curry if you're with people, mutton varuval
     if you're solo. Cash only, open till 11pm. Go before 8pm on
     weekends or you'll wait 20 minutes for a table.
```

### The knowledge graph

Spots are added by local contributors via voice notes or text, verified by admins, and refined by traveler feedback. Each spot carries:

- **Operational intel**: address, hours, payment methods, price range
- **Ordering intel**: what to order, what to skip, pro tips
- **Context**: vibe, indoor/outdoor, weather-dependent, best time of day
- **Quality flags**: `must_go` (best-in-class, go out of your way) and `verified` (contributor-confirmed, solid recommendation)

### Live knowledge graph

| Country | City | Spots |
|---------|------|-------|
| Malaysia | Kuala Lumpur | 504 |
| Malaysia | Petaling Jaya | 169 |
| Malaysia | Penang | 65 |
| Taiwan | Taipei | 1 |

### What Sam does

| Capability | How it works |
|---|---|
| **Food recommendations** | "I'm hungry" → filters by area, meal type, weather, dietary restrictions. Returns 3 unvisited spots with full operational details. Supports pgvector semantic search. |
| **Day planning** | "What should I do today?" → builds a loose day structure across breakfast, lunch, activities, dinner from the knowledge graph. |
| **Nearby spots** | "What's near KLCC?" → filters by area. Supports text and location pins (WhatsApp). |
| **Spot deep-dive** | "Tell me about Jalan Alor" → full operational detail for a specific spot. |
| **Happenings** | "Anything on this weekend?" → surfaces events, markets, and time-sensitive activity spots. |
| **Weather awareness** | Live OpenWeather data. When it's raining, Sam prefers indoor spots automatically. |
| **Profile learning** | New users get a conversational interview. Background extraction silently captures preferences from every message going forward. |
| **Pre-trip strategic plan** | After learning your profile, Sam generates a personalized trip guide with anchor spots, what to expect, and what to book ahead. |
| **Knowledge contribution** | Locals add spots via voice notes (Whisper transcription) or text. Multi-turn interview with web search enrichment for operational fields, duplicate detection, and auto-merge. |
| **Feedback loop** | Sam asks about visited spots, collects ratings + tips. Ratings adjust spot confidence scores. Tips get added to the knowledge graph. |
| **Spot correction** | "That place is closed" → flags a spot with correction type, queues for admin review. |
| **Proactive messaging** | During your trip, Sam texts you — welcome on day 1, morning/dinner nudges on day 2+, feedback checks for visited spots. Respects WhatsApp 24h window and 8h cooldown. |

### What Sam does NOT do

- **No bookings or reservations** — Sam tells you where to go, not how to secure a table
- **No real-time availability** — hours come from contributors, not live venue feeds
- **No image understanding** — photos get a polite "I can't process images yet"
- **No multi-city itineraries** — city context is single-city per session
- **No directions or transport routing** — Sam tells you where to go, not how to get there
- **No fabrication** — if a spot isn't in the database, Sam says so

For a full capabilities reference see [`docs/sam-v1.md`](docs/sam-v1.md).

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js / TypeScript |
| Bot framework | Express (WhatsApp Cloud API webhook) |
| Web | Next.js 15 / React 19 (landing page + chat interface + admin review UI) |
| Database | Supabase (PostgreSQL + pgvector for semantic search) |
| LLM | Claude API — Haiku for conversations, Sonnet for strategic planning |
| Voice | OpenAI Whisper (voice note transcription) |
| Embeddings | OpenAI `text-embedding-3-small` (pgvector semantic search) |
| Weather | OpenWeather API |

## Project structure

```
packages/
├── bot/                          — WhatsApp bot (Express + Claude)
│   ├── src/
│   │   ├── index.ts              — Express app, webhook routes, flow router
│   │   ├── database.ts           — Supabase client, all DB operations, trackEvent()
│   │   ├── llm.ts                — Claude API wrapper, prompt loading, SSE streaming
│   │   ├── whatsapp.ts           — WhatsApp Cloud API (send/receive/media)
│   │   ├── transcription.ts      — Whisper voice note transcription
│   │   ├── weather.ts            — OpenWeather integration
│   │   ├── scheduler.ts          — Proactive message engine (5-min interval)
│   │   ├── seed.ts               — Seed runner (imports per-city data, inserts to DB)
│   │   ├── embeddings.ts         — OpenAI embeddings for pgvector semantic search
│   │   ├── backfill-embeddings.ts — Backfill script for spots missing embeddings
│   │   ├── coach.ts              — Self-coaching: reviews conversations, suggests prompt improvements
│   │   ├── coach-auto.ts         — Automated coaching: analyze → apply → validate → commit
│   │   ├── eval/
│   │   │   ├── eval-runner.ts         — Prompt evaluation framework
│   │   │   └── scenarios/             — JSONL test scenarios per prompt
│   │   ├── handlers/
│   │   │   ├── query.ts              — Spot recommendations
│   │   │   ├── ontrip.ts             — Hungry, day plan, nearby, spot info handlers
│   │   │   ├── happenings.ts         — Events and time-sensitive spots
│   │   │   ├── contribution.ts       — Voice/text spot ingestion with web enrichment
│   │   │   ├── profile.ts            — Conversational profile interview
│   │   │   ├── continuous-profile.ts — Background preference extraction
│   │   │   ├── strategic.ts          — Pre-trip guide generation
│   │   │   ├── feedback.ts           — Post-visit spot validation
│   │   │   ├── spot-correction.ts    — User-reported corrections (closed, wrong info)
│   │   │   ├── spot-verification.ts  — Staleness re-verification flow
│   │   │   └── generate.ts           — Admin: LLM candidate spot generation
│   │   ├── prompts/
│   │   │   ├── system.txt             — Sam's personality + core rules
│   │   │   ├── extraction.txt         — Voice/text → structured spot data
│   │   │   ├── profile.txt            — Profile interview conversation
│   │   │   ├── continuous_profile.txt — Background extraction rules
│   │   │   ├── strategic.txt          — Pre-trip guide format
│   │   │   ├── proactive.txt          — Proactive message voice
│   │   │   ├── feedback.txt           — Feedback response parsing
│   │   │   ├── generate.txt           — Admin spot generation
│   │   │   └── coach.txt              — Coaching evaluation prompt
│   │   ├── seeds/
│   │   │   ├── kl.ts                  — Kuala Lumpur spots
│   │   │   ├── kl-research.ts         — Research-phase KL candidates
│   │   │   ├── penang.ts              — Penang spots (island + mainland)
│   │   │   ├── pj.ts                  — Petaling Jaya spots
│   │   │   └── pj-research.ts         — Research-phase PJ candidates
│   │   └── utils/
│   │       ├── categories.ts          — Category mappings + synonyms
│   │       ├── city-defaults.ts       — Per-city coordinates, timezone, locale
│   │       └── geo.ts                 — Haversine distance, nearby filtering
│   ├── vitest.config.ts
│   ├── package.json
│   └── tsconfig.json
├── web/                          — Next.js web interface
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx             — Root layout (Geist Mono, dark theme)
│   │   │   ├── page.tsx               — Landing page (server component, ISR)
│   │   │   ├── globals.css            — Tailwind v4 + custom vars
│   │   │   ├── chat/
│   │   │   │   └── page.tsx           — Chat interface page
│   │   │   ├── review/
│   │   │   │   └── page.tsx           — Spot curation admin UI
│   │   │   └── api/
│   │   │       ├── chat/
│   │   │       │   └── route.ts       — SSE streaming endpoint (imports @sam/bot)
│   │   │       ├── extract/
│   │   │       │   └── route.ts       — Text → structured spot fields
│   │   │       └── enrich-spot/
│   │   │           └── route.ts       — Web search → fills missing spot fields
│   │   ├── components/
│   │   │   ├── home-client.tsx        — Landing page client component
│   │   │   ├── chat-panel.tsx         — Chat container with session mgmt
│   │   │   ├── chat-bubble.tsx        — Message bubble (user/Sam)
│   │   │   ├── chat-input.tsx         — Message input bar
│   │   │   ├── chat-messages.tsx      — Scrollable message list
│   │   │   ├── live-feed.tsx          — Real-time contribution teasers feed
│   │   │   ├── prompt-input.tsx       — Landing page prompt input
│   │   │   ├── rotating-city.tsx      — Animated city name rotator
│   │   │   ├── spot-card.tsx          — Expandable spot card with edit/approve/delete
│   │   │   └── spot-filters.tsx       — Filter by category/area/source
│   │   └── lib/
│   │       ├── rate-limit.ts          — Rate limiting utility
│   │       ├── supabase.ts            — Supabase client + spot CRUD + getCityStats()
│   │       └── use-media-query.ts     — Responsive breakpoint hook
│   ├── next.config.ts                 — Env forwarding, @sam/bot transpilation
│   ├── package.json
│   └── tsconfig.json

scripts/                          — Batch research + seed tooling
├── batch-research.ts             — Multi-city batch spot research runner
├── analyze-spots.ts              — Spot data analysis utility
├── count-spots.ts                — Spot count by city/category
├── generate-seeds.ts             — Generate seed file from research output
└── seed-new-only.ts              — Seed only spots not yet in DB

supabase/
├── schema.sql                    — Reference schema (do not append — use migrations)
└── migrations/                   — Incremental migration files (YYYYMMDD_HHMMSS_description.sql)
```

## Setup

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project with pgvector enabled
- A [WhatsApp Business API](https://developers.facebook.com/docs/whatsapp/cloud-api) account
- API keys: [Anthropic](https://console.anthropic.com), [OpenAI](https://platform.openai.com) (Whisper + embeddings), [OpenWeather](https://openweathermap.org/api)

### 1. Install dependencies

```bash
npm install
```

### 2. Set up the database

Run `supabase/schema.sql` in your Supabase SQL editor, then apply any migrations in `supabase/migrations/` in order.

### 3. Configure environment

```bash
cp .env.example .env.local
```

Fill in your API keys:

```
WHATSAPP_TOKEN=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
SUPABASE_URL=
SUPABASE_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
OPENWEATHER_API_KEY=
PORT=3000
ADMIN_PHONE_NUMBER=        # Optional: enables admin features
```

### 4. Seed the knowledge graph

```bash
npm run seed
```

Populates the knowledge graph with curated spots across KL, Petaling Jaya, and Penang.

### 5. Run

```bash
npm run dev      # Bot dev server (Express on :3000)
npm run dev:web  # Web dev server (Next.js on :3001)
npm run build    # Compile both packages
npm run start    # Production bot
```

### 6. Connect WhatsApp

Point your WhatsApp webhook URL to `https://your-domain.com/webhook`. The verify token must match `WHATSAPP_VERIFY_TOKEN`.

## Commands

```bash
npm run dev              # Bot dev server (Express on :3000)
npm run dev:web          # Web dev server (Next.js on :3001)
npm run build            # Build both packages
npm run build:bot        # Build bot only
npm run build:web        # Build web only
npm run start            # Run compiled bot
npm run seed             # Seed knowledge graph
npm test                 # Run tests (vitest)
npm run coach            # Self-coaching: analyze recent conversations + suggest prompt improvements
npm run coach:auto       # Automated coaching: analyze → apply → validate → commit
npm run research         # Batch spot research across cities

# Bot-only (run with npm run <cmd> -w @sam/bot):
#   eval                 — Run prompt evaluation scenarios
#   backfill-embeddings  — Backfill pgvector embeddings for existing spots
#   test:watch           — Vitest in watch mode
```

## Admin features

Gated behind the `ADMIN_PHONE_NUMBER` env var:

- **`add: <spot details>`** — Rapid-add a spot via text. Example: `add: Fatty Crab, Taman Megah, dinner. Cash only. Order the chilli crab.`
- **`/generate <area> <category>`** — LLM suggests candidate spots for admin review and verification.
- **`/corrections`** — List pending user-reported corrections grouped by spot.
- **`/approve <spot name>`** — Mark a spot as closed, hide it from recommendations.
- **`/reject <spot name>`** — Dismiss a correction, restore spot to verified.
- **`/publish <spot name>`** — Publish a spot from the review queue to live recommendations.

## Database schema

| Table | Purpose |
|---|---|
| `spots` | Knowledge graph — name, city, area, categories[], must_go(bool), verified(bool), hours, what_to_order[], pro_tips[], vibe, price_range, confidence_score, embedding |
| `spot_contributions` | Per-contributor attribution — spot_id, contributor_id, what_to_order[], pro_tips[], vibe, must_go |
| `travelers` | User profiles — preferences, dietary_restrictions[], trip_dates, travel_party, spots_recommended[] |
| `conversations` | State machine — current_flow, flow_state(jsonb), messages(jsonb[]) |
| `contributors` | Who added knowledge — cities_contributed[], contribution_count |
| `feedback` | Post-visit validation — rating(1-5), visited, user_tips[] |
| `events` | Analytics — session_id, channel(web/whatsapp), event_type, event_data(jsonb) |

**Spot quality flags**: `must_go` = best-in-class, go out of your way. `verified` = contributor-confirmed, solid recommendation. Neither = unverified lead.

**Categories**: breakfast, lunch, dinner, cafe, activity, nightlife, market

## Architecture

### WhatsApp flow

```
WhatsApp message
  → POST /webhook
  → parseWebhook()
  → processMessage()
  → classifyIntent() [Claude Haiku]
  → handler (hungry | day_plan | nearby | weather | contribute | profile | feedback | general)
  → querySpots() / LLM formatting
  → sendMessage()
  → WhatsApp
```

### Web flow

```
Browser message
  → POST /api/chat
  → classifyIntent() [Claude Haiku]
  → handler (same set as WhatsApp)
  → querySpots() / LLM formatting
  → SSE stream
  → Browser
```

Both flows share the same handlers via the `@sam/bot` workspace dependency — no HTTP indirection.

### Contribution flow (two-stage)

1. **Collecting** — LLM extracts structured spot data from voice/text. Missing operational fields (address, hours, price) are auto-filled from web search and annotated as web-sourced.
2. **Confirming** — Shows formatted summary with web-sourced fields flagged. Contributor can confirm, correct, or ask questions. On confirm: duplicate detection runs (exact → fuzzy → LLM verify). If a duplicate exists, new intel is auto-merged into the existing spot. Every contribution is recorded in `spot_contributions` for attribution. Web-sourced fields are never persisted — only contributor-verified data is saved.

### Background systems

- **Continuous profile extraction** — silently captures preferences and trip context from every message exchange without interrupting conversation flow
- **Proactive scheduler** — checks every 5 minutes for travelers who should hear from Sam (WhatsApp only, requires 24h messaging window, 8h cooldown, daytime hours only, skips users mid-flow)
- **Self-coaching** — `coach.ts` reviews recent conversations against Sam's prompt goals and suggests improvements; `coach-auto.ts` runs the full analyze → apply → validate → commit loop automatically

## Tests

```bash
npm test
```

Unit tests covering spot formatting, contribution extraction, profile merging, scheduler eligibility, message splitting, and category mapping.
