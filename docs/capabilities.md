# Sam — Capabilities Reference

Last updated: 2026-02-18

## Dev Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Bot server (Express, :3000) |
| `npm run dev:web` | Web frontend (Next.js, :3001) |
| `npm run build` | Build both packages |
| `npm run test` | Run bot tests (vitest) |
| `npm run seed` | Seed 42 KL spots into knowledge graph |
| `npm run eval -- system` | Run prompt regression tests |
| `npm run coach` | Self-coaching: reviews real convos, suggests prompt fixes |
| `npm run coach -- 50` | Coach with custom conversation limit (default 20) |
| `npm run backfill-embeddings` | Generate vector embeddings for semantic search |

## User-Facing Features

### WhatsApp Bot
Users text Sam on WhatsApp. Messages are classified into intents and routed to handlers.

| Intent | Trigger examples | Handler | What Sam does |
|--------|-----------------|---------|--------------|
| hungry | "I'm hungry", "best nasi lemak" | `query.ts` | Recommends spots from DB with operational details |
| day_plan | "What should I do today" | `ontrip.ts` | Builds a loose day structure from DB spots |
| nearby | "What's near KLCC", shares location pin | `ontrip.ts` | Filters spots by distance (supports GPS coords) |
| weather | "Is it raining" | `weather.ts` | OpenWeather check, adjusts indoor/outdoor recs |
| contribute | "I know a great spot" | `contribution.ts` | Multi-message spot ingestion with web enrichment |
| profile | "I'm visiting KL next week" | `profile.ts` | Conversational interview to learn preferences |
| feedback | (proactive) "Did you visit Soong Kee?" | `feedback.ts` | Collects ratings and tips after trip |
| general | "Hey", "Who are you" | `chatAsSam()` | Free-form conversation |

### Web Chat (`/chat`)
Same handlers as WhatsApp, streamed via SSE. Session stored in localStorage. Rate limited to 30 messages/day.

### Landing Page (`/`)
City stats counter, spot count progress bar, CTA to chat.

## Background Processes

| Process | When it runs | What it does |
|---------|-------------|-------------|
| Continuous profile | After every message (fire-and-forget) | Silently extracts preferences into traveler profile |
| Proactive scheduler | Every 5 min (WhatsApp only) | Sends TRIP_WELCOME, MORNING_NUDGE, DINNER_NUDGE, FEEDBACK_CHECK |

Scheduler gates: 24h WhatsApp window, 8h cooldown, daytime only (8am-10pm KL), skips mid-flow users.

## Admin Features

Gated behind `ADMIN_PHONE_NUMBER` env var.

| Feature | How to trigger | What it does |
|---------|---------------|-------------|
| Rapid-add | `add: Fatty Crab, Bangsar, dinner, tier 1. ...` | Quick spot creation from text |
| Generate | `/generate bangsar dinner` | LLM suggests candidates, admin reviews and saves |

## Prompts (`packages/bot/src/prompts/`)

| Prompt | Used by | Purpose |
|--------|---------|---------|
| `system.txt` | All Sam responses | Personality, tone, length rules, formatting rules |
| `profile.txt` | Profile handler | Conversational interview for new users |
| `continuous_profile.txt` | Background extraction | Silent preference extraction from every message |
| `strategic.txt` | Strategic handler | Pre-trip planning (after profile, travelers only) |
| `extraction.txt` | Contribution handler | Voice note / text -> structured spot JSON |
| `feedback.txt` | Feedback handler | Parse user feedback into rating + tips |
| `proactive.txt` | Scheduler | Generate proactive messages (welcomes, nudges) |
| `generate.txt` | Admin /generate | Suggest candidate spots for admin review |
| `coach.txt` | Coach script | Score conversations on 6 quality criteria |

## Quality Tools

| Tool | Command | Purpose |
|------|---------|---------|
| Eval | `npm run eval -- system` | Regression testing: does the prompt still pass assertions? |
| Coach | `npm run coach` | Discovery: what's weak in real conversations? |

Eval catches "did the prompt break?" Coach discovers "how could it be better?"

## Database (Supabase)

| Table | Purpose | Key fields |
|-------|---------|-----------|
| `spots` | Knowledge graph | name, category, tier(1-3), what_to_order[], pro_tips[], vibe, payment, hours, lat/lng, confidence_score |
| `travelers` | User profiles | preferences, dietary_restrictions, trip_dates, travel_party, user_type |
| `conversations` | State machine | current_flow, flow_state (JSONB), messages[] (last 40) |
| `contributors` | Who added spots | whatsapp_number, cities_contributed[], spots_contributed count |
| `feedback` | Post-trip validation | spot_id, rating(1-5), did_they_go, user_tips[] |
| `events` | Analytics | session_id, channel, event_type, event_data (JSONB) |

Spot categories: breakfast, lunch, dinner, cafe, activity, nightlife, market
Tiers: 1 = must-do, 2 = should-do, 3 = hidden gem
Vibes: casual, upscale, chaotic, chill, local, touristy

## Architecture

```
WhatsApp/Web message
  -> classifyIntent() [Haiku]
  -> handler (query/contribution/profile/etc.)
  -> DB query (spots, traveler profile)
  -> Claude response [Haiku default, Sonnet for strategic/coach]
  -> WhatsApp: sendMessage() | Web: SSE stream
  -> (background) maybeExtractProfile() [fire-and-forget]
  -> (background) trackEvent() [fire-and-forget analytics]
```

## External Services

| Service | Used for | Env var |
|---------|---------|---------|
| Anthropic (Claude) | All LLM calls | `ANTHROPIC_API_KEY` |
| Supabase | Database + vector search | `SUPABASE_URL`, `SUPABASE_KEY` |
| WhatsApp Cloud API | Message send/receive | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` |
| OpenAI | Whisper transcription + embeddings | `OPENAI_API_KEY` |
| OpenWeather | Weather context | `OPENWEATHER_API_KEY` |
