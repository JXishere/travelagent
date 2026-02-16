# Paul — WhatsApp Travel Intelligence for KL

Paul is a WhatsApp-based travel intelligence bot for Kuala Lumpur. He guides travelers with opinionated, operationally-detailed recommendations drawn from a proprietary knowledge graph built by real local contributors.

## Stack

- **Runtime**: Node.js / TypeScript
- **Framework**: Express (webhook server for WhatsApp Cloud API)
- **Database**: Supabase (PostgreSQL)
- **LLM**: Claude API (`claude-sonnet-4-5-20250929` via `@anthropic-ai/sdk`)
- **Voice**: OpenAI Whisper (voice note transcription)
- **Weather**: OpenWeather API (context-aware recommendations)

## Key Directories

```
src/
├── index.ts            — Express app, webhook routes, flow router
├── database.ts         — Supabase client + all DB operations
├── llm.ts              — Claude API wrapper, prompt loading
├── whatsapp.ts         — WhatsApp Cloud API (send/receive/media)
├── transcription.ts    — Whisper voice note transcription
├── weather.ts          — OpenWeather integration
├── seed.ts             — Knowledge graph seeding (50+ KL spots)
├── handlers/
│   ├── query.ts        — "I'm hungry" → spot recommendations
│   ├── contribution.ts — Voice note → structured spot ingestion
│   ├── profile.ts      — Conversational trip profile learning
│   ├── strategic.ts    — Pre-trip strategic planning
│   ├── ontrip.ts       — Day-by-day guidance (hungry, day_plan, nearby)
│   └── feedback.ts     — Post-trip spot validation
└── prompts/
    ├── system.txt      — Paul's personality + core rules
    ├── extraction.txt  — Voice note → JSON extraction
    ├── profile.txt     — Conversational profile learning
    └── strategic.txt   — Strategic trip planning format

supabase/
└── schema.sql          — Full database schema (5 tables)

docs/                   — Strategy docs, competitive analysis, blueprints
```

## Dev Commands

```bash
npm run dev    # Start dev server with auto-reload (tsx watch)
npm run build  # Compile TypeScript (tsc)
npm run start  # Run compiled app (node dist/index.js)
npm run seed   # Populate knowledge graph with KL spots
```

## Code Rules

1. **Never fabricate spots.** Only recommend places that exist in the database. If the DB has no matches, say so honestly.
2. **Only use DB data.** All spot details (address, hours, tips) must come from the `spots` table, not LLM imagination.
3. **Keep WhatsApp messages concise.** People read these on phones — short paragraphs, no walls of text.
4. **Operational intelligence is the product.** Always include: what to order, payment, hours, pro tips. Not just "it's good."
5. **Paul has personality.** Warm, opinionated, slightly irreverent. He's your friend who lives in KL, not a search engine.

## Schema Overview

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `spots` | Knowledge graph | name, neighborhood, category, tier(1-3), what_to_order[], pro_tips[], vibe, payment_methods[], opening_hours, price_range |
| `contributors` | Who added knowledge | whatsapp_number, name, cities_contributed[], spots_contributed |
| `travelers` | User profiles | whatsapp_number, preferences(jsonb), dietary_restrictions[], trip_dates, travel_party |
| `conversations` | State management | whatsapp_number, current_flow, flow_state(jsonb), messages(jsonb[]) |
| `feedback` | Post-trip validation | spot_id, traveler_id, rating(1-5), did_they_go, user_tips[] |

**Spot categories**: breakfast, lunch, dinner, cafe, activity, nightlife, market
**Spot tiers**: 1 = must-do, 2 = should-do, 3 = nice-to-have/hidden gem
**Vibes**: casual, upscale, chaotic, chill, local, touristy

## Prompt Loading

Prompts live in `src/prompts/*.txt` and are loaded by `src/llm.ts`:

```typescript
const PROMPTS_DIR = join(__dirname, "prompts");
function loadPrompt(name: string): string {
  return readFileSync(join(PROMPTS_DIR, `${name}.txt`), "utf-8");
}
```

- `chatAsP()` loads `system.txt` for Paul's personality
- `extractJSON()` loads any prompt by name for structured extraction
- `classifyIntent()` uses an inline prompt (not from file)

## Flow Architecture

User messages flow: WhatsApp → webhook → `processMessage()` → `classifyIntent()` → handler → DB query + LLM → `sendMessage()` → WhatsApp

Intents: hungry, day_plan, nearby, weather, contribute, profile, feedback, general

Each user has a `current_flow` in the `conversations` table. Flow-specific state is stored in `flow_state` (JSONB).

## Environment Variables

See `.env.example` for all required vars: WhatsApp tokens, Supabase URL/key, Anthropic key, OpenAI key, OpenWeather key.
