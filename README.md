# Sam

**A friend who lives in every city.**

Sam is a travel intelligence bot — on WhatsApp and the web. Text him like a friend and he'll tell you where to eat, what to order, when to go, and what to skip — all from a knowledge graph built by real locals, not scraped reviews.

Currently live in **Kuala Lumpur**. The architecture is city-aware and designed to expand.

## How it works

A traveler texts Sam on WhatsApp. Sam classifies the intent, queries a local knowledge graph of vetted spots, and responds with opinionated, operationally-detailed recommendations — what to order, how to pay, pro tips, hours. Every recommendation comes from the database, never fabricated by the LLM.

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
- **Confidence**: tier (1=must-do, 2=should-do, 3=hidden gem) + confidence score that moves with feedback

### What Sam does

| Capability | How it works |
|---|---|
| **Food recommendations** | "I'm hungry" → filters by neighborhood, meal type, weather, dietary restrictions. Returns 3 unvisited spots with full operational details. |
| **Day planning** | "What should I do today?" → builds a loose day structure across breakfast, lunch, activities, dinner from the knowledge graph. |
| **Nearby spots** | "What's near KLCC?" → filters by neighborhood. Supports text and location pins. |
| **Weather awareness** | Live OpenWeather data. When it's raining, Sam prefers indoor spots automatically. |
| **Profile learning** | New users get a conversational interview. Background extraction silently captures preferences from every message going forward. |
| **Pre-trip strategic plan** | After learning your profile, Sam generates a personalized trip guide with anchor spots, what to expect, and what to book ahead. |
| **Knowledge contribution** | Locals add spots via voice notes (Whisper transcription) or text. Multi-turn interview with duplicate detection and merge. |
| **Feedback loop** | Sam asks about visited spots, collects ratings + tips. Ratings adjust spot confidence scores. Tips get added to the knowledge graph. |
| **Proactive messaging** | During your trip, Sam texts you — welcome on day 1, morning/dinner nudges on day 2+, feedback checks for visited spots. Respects WhatsApp 24h window and 8h cooldown. |

### What Sam does NOT do

- **No bookings or reservations** — Sam tells you where to go, not how to book
- **No real-time info** — hours and prices are from the knowledge graph, not live
- **No image understanding** — photos get a polite "I can't process images yet"
- **No group coordination** — one traveler, one conversation
- **No fabrication** — if a spot isn't in the database, Sam says so

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js / TypeScript |
| Bot framework | Express (WhatsApp Cloud API webhook) |
| Web | Next.js 15 / React 19 (landing page + chat interface) |
| Database | Supabase (PostgreSQL) |
| LLM | Claude API — Haiku for conversations, Sonnet for strategic planning |
| Voice | OpenAI Whisper (voice note transcription) |
| Weather | OpenWeather API |

## Project structure

```
packages/
├── bot/                          — WhatsApp bot (Express + Claude)
│   ├── src/
│   │   ├── index.ts              — Express app, webhook routes, flow router
│   │   ├── database.ts           — Supabase client, all DB operations
│   │   ├── llm.ts                — Claude API wrapper, prompt loading, SSE streaming
│   │   ├── whatsapp.ts           — WhatsApp Cloud API (send/receive/media)
│   │   ├── transcription.ts      — Whisper voice note transcription
│   │   ├── weather.ts            — OpenWeather integration
│   │   ├── scheduler.ts          — Proactive message engine (5-min interval)
│   │   ├── seed.ts               — Knowledge graph seeding (50+ KL spots)
│   │   ├── handlers/
│   │   │   ├── query.ts              — Spot recommendations
│   │   │   ├── ontrip.ts             — Hungry, day plan, nearby handlers
│   │   │   ├── contribution.ts       — Voice/text spot ingestion
│   │   │   ├── profile.ts            — Conversational profile interview
│   │   │   ├── continuous-profile.ts — Background preference extraction
│   │   │   ├── strategic.ts          — Pre-trip guide generation
│   │   │   ├── feedback.ts           — Post-visit spot validation
│   │   │   └── generate.ts           — Admin: LLM candidate spot generation
│   │   ├── prompts/
│   │   │   ├── system.txt             — Sam's personality
│   │   │   ├── extraction.txt         — Voice/text → structured spot data
│   │   │   ├── profile.txt            — Profile interview conversation
│   │   │   ├── continuous_profile.txt — Background extraction rules
│   │   │   ├── strategic.txt          — Pre-trip guide format
│   │   │   ├── proactive.txt          — Proactive message voice
│   │   │   ├── feedback.txt           — Feedback response parsing
│   │   │   └── generate.txt           — Admin spot generation
│   │   └── utils/
│   │       ├── categories.ts          — Category mappings + synonyms
│   │       └── city-defaults.ts       — Per-city coordinates, timezone, locale
│   ├── vitest.config.ts
│   ├── package.json
│   └── tsconfig.json
├── web/                          — Next.js web interface (landing page + chat)
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx             — Root layout (Geist Mono, dark theme)
│   │   │   ├── page.tsx               — Counter page (server component, ISR)
│   │   │   ├── globals.css            — Tailwind v4 + custom vars
│   │   │   ├── chat/
│   │   │   │   └── page.tsx           — Chat interface page
│   │   │   └── api/
│   │   │       └── chat/
│   │   │           └── route.ts       — SSE streaming endpoint (imports @sam/bot handlers)
│   │   ├── components/
│   │   │   ├── chat-bubble.tsx        — Message bubble (user/Sam)
│   │   │   ├── chat-input.tsx         — Message input bar
│   │   │   ├── chat-messages.tsx      — Scrollable message list
│   │   │   └── prompt-input.tsx       — Landing page prompt input
│   │   └── lib/
│   │       └── supabase.ts            — Supabase client + getCityStats()
│   ├── next.config.ts                 — Env forwarding, @sam/bot transpilation
│   ├── package.json
│   └── tsconfig.json

supabase/
├── schema.sql                         — Full database schema (5 tables + RPC)
└── migrations/                        — Incremental migration files
```

## Setup

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- A [WhatsApp Business API](https://developers.facebook.com/docs/whatsapp/cloud-api) account
- API keys: [Anthropic](https://console.anthropic.com), [OpenAI](https://platform.openai.com) (for Whisper), [OpenWeather](https://openweathermap.org/api)

### 1. Install dependencies

This is an npm workspaces monorepo. A single `npm install` at the root installs dependencies for both `packages/bot` and `packages/web`.

```bash
npm install
```

### 2. Set up the database

Run `supabase/schema.sql` in your Supabase SQL editor to create all tables and indexes.

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

Populates 50+ curated KL spots with full operational intel.

### 5. Run

```bash
npm run dev      # Bot dev server (Express on :3000)
npm run dev:web  # Web dev server (Next.js on :3001)
npm run build    # Compile both packages
npm run start    # Production bot
```

### 6. Connect WhatsApp

Point your WhatsApp webhook URL to `https://your-domain.com/webhook`. The verify token must match `WHATSAPP_VERIFY_TOKEN`.

### 7. Web chat (optional)

The web chat at `packages/web/` reuses the same bot handlers via the `@sam/bot` workspace dependency. It streams responses over SSE instead of sending WhatsApp messages. Run `npm run dev:web` and visit `http://localhost:3001/chat`.

## Commands

```bash
npm run dev          # Bot dev server (Express on :3000)
npm run dev:web      # Web dev server (Next.js on :3001)
npm run build        # Build both packages
npm run build:bot    # Build bot only
npm run build:web    # Build web only
npm run start        # Run compiled bot
npm run seed         # Seed knowledge graph
npm test             # Run tests
npm run test:watch   # Run tests in watch mode
```

## Admin features

Gated behind the `ADMIN_PHONE_NUMBER` env var:

- **`add: <spot details>`** — Rapid-add a spot via text. Example: `add: Fatty Crab, Taman Megah, dinner, tier 1. Cash only. Order the chilli crab.`
- **`/generate <neighborhood> <category>`** — LLM suggests candidate spots for admin review and verification.

## Database schema

| Table | Purpose |
|---|---|
| `spots` | Knowledge graph — name, neighborhood, category, tier, hours, what to order, pro tips, vibe, confidence score |
| `travelers` | User profiles — preferences, dietary restrictions, trip dates, visited/liked/disliked spots |
| `conversations` | State machine — current flow, flow state, message history |
| `contributors` | Who added knowledge — cities contributed, spot count |
| `feedback` | Post-visit validation — ratings, comments, user tips |

## Architecture

### WhatsApp flow

```
WhatsApp message
  → webhook (POST /webhook)
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

Both flows share the same handlers via the `@sam/bot` workspace dependency. The web route imports handlers directly — no HTTP indirection.

### Background systems

- **Continuous profile extraction** — silently captures preferences from every message exchange
- **Proactive scheduler** — checks every 5 minutes for travelers who should hear from Sam (WhatsApp only, requires 24h messaging window, 8h cooldown between messages, daytime hours only, skips users mid-flow)

## Tests

```bash
npm test
```

125 unit tests covering spot formatting, contribution extraction, profile merging, scheduler eligibility, message splitting, and category mapping.
