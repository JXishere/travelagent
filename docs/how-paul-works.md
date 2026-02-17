# How Paul Works — Operational Guide

## The 30-Second Version

Paul is an Express server that receives WhatsApp messages via webhook, decides what the user wants (intent classification), queries a Supabase knowledge graph of KL spots, asks Claude to write a natural response using that data, and sends it back via WhatsApp.

```
User sends WhatsApp message
        │
        ▼
  Meta delivers webhook POST to your server (/webhook)
        │
        ▼
  parseWebhook() extracts: who sent it, text or audio, message ID
        │
        ▼
  showTyping() fires immediately (typing dots appear on user's phone)
        │
        ▼
  processMessage() decides what to do
        │
        ├─ Mid-flow? → routeToCurrentFlow() → resume that handler
        │
        ├─ Voice note (no active flow)? → start contribution flow
        │
        ├─ Admin command? → rapid-add or /generate
        │
        └─ New message → classifyIntent() via Claude
                │
                ├─ hungry     → handleHungry()     — recommend food spots
                ├─ day_plan   → handleDayPlan()     — build a loose day
                ├─ nearby     → handleNearby()      — what's around here
                ├─ weather    → handleQuery()       — weather-aware recs
                ├─ contribute → handleContribution()— add a spot to the graph
                ├─ profile    → startProfileLearning() — learn trip preferences
                ├─ feedback   → startFeedbackCollection() — post-trip ratings
                └─ general    → chatAsP()           — personality chat
        │
        ▼
  Response sent back via WhatsApp + saved to conversation history
```

## External Services

Paul depends on 5 external services. All configured via `.env`:

| Service | What it does | Env vars |
|---------|-------------|----------|
| **WhatsApp Cloud API** | Receives and sends messages | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` |
| **Supabase** | PostgreSQL database — spots, travelers, conversations | `SUPABASE_URL`, `SUPABASE_KEY` |
| **Claude API** | Intent classification, personality responses, JSON extraction | `ANTHROPIC_API_KEY` |
| **OpenAI Whisper** | Voice note transcription | `OPENAI_API_KEY` |
| **OpenWeather** | Weather-aware recommendations | `OPENWEATHER_API_KEY` |

The WhatsApp token is the one that expires. Temporary tokens from Meta's dashboard last ~24 hours. For production you'd use a System User permanent token.

## The Two Modes: Stateless vs. Stateful Flows

Paul operates in two modes, tracked by `current_flow` in the `conversations` table:

### Stateless (current_flow = "general")

Every message is classified fresh. No memory between messages beyond conversation history. This handles: hungry, day_plan, nearby, weather, general chat.

The pattern: classify intent → query DB → build prompt with spot data → Claude writes response → send.

### Stateful (current_flow = anything else)

Multi-turn flows where Paul remembers what step you're on. State is stored in `flow_state` (JSONB column). The flow router (`routeToCurrentFlow`) skips intent classification and sends messages straight to the active handler.

Active flows:
- **contribution** — collecting spot info across multiple messages
- **profile_learning** — conversational interview about trip preferences
- **feedback** — asking about visited spots one by one
- **generate** — admin reviewing Claude-generated spot candidates
- **strategic** — auto-triggered after profile completes

Users can always say "cancel" or "stop" to exit any flow.

## How Each Handler Works

### Recommendation Handlers (stateless)

**handleHungry** (`src/handlers/ontrip.ts`)
1. Look up traveler profile for dietary preferences
2. Check current weather
3. Map time of day → meal categories (morning → breakfast/cafe, etc.)
4. Query `spots` table with filters (neighborhood, categories, indoor if raining)
5. Filter out spots they've already visited
6. Build a prompt: "here are the matching spots from the knowledge graph, recommend naturally"
7. Claude writes a conversational recommendation
8. If zero spots match → Claude admits it honestly, never fabricates

**handleDayPlan** (`src/handlers/ontrip.ts`)
- Same pattern but queries across all categories (breakfast + lunch + activity + dinner)
- Asks Claude to build a loose day flow, not a rigid itinerary

**handleNearby** (`src/handlers/ontrip.ts`)
- Same but filtered by neighborhood from the user's message

**handleQuery** (`src/handlers/query.ts`)
- General-purpose query handler used by weather flow
- Maps meal_type/time_of_day to categories, queries DB, Claude responds

### Contribution Flow (stateful)

**handleContribution** (`src/handlers/contribution.ts`)

Two stages: `collecting` → `confirming`

**Collecting:**
1. User says "I know a great spot" or sends a voice note
2. Every message gets run through Claude extraction with context of what Paul already knows
3. Results get smart-merged into a running `extracted` object in `flow_state`
4. Paul checks what's missing and asks ONE natural follow-up (hardcoded, not LLM)
5. Priority: name → neighborhood → category → what_to_order → operational tips
6. Once Paul has name + category + neighborhood + at least one operational detail → transition to confirming

**Confirming:**
1. Paul shows a formatted summary
2. "save" / "yes" / "done" → saves to `spots` table, increments contributor count
3. Any other text → merge new info, re-show summary

Voice notes work at any stage — they're transcribed via Whisper then fed through the same extraction pipeline.

### Profile Learning Flow (stateful)

**handleProfile** (`src/handlers/profile.ts`)
1. Claude conducts a conversational interview using `profile.txt` prompt
2. When Claude includes `[PROFILE_COMPLETE]` marker → extract structured profile via JSON extraction
3. Save to `travelers` table (dates, party, interests, budget, pace, dietary restrictions)
4. Auto-transition to strategic flow

### Strategic Decisions (auto-triggered)

**handleStrategic** (`src/handlers/strategic.ts`)
- Triggered automatically after profile completes
- Queries top 20 spots, builds a strategic pre-trip guide
- Picks 3-5 anchor spots based on traveler profile
- Appends an "agreement plan" (what Paul promises)
- Transitions back to general flow

### Feedback Flow (stateful)

**handleFeedback** (`src/handlers/feedback.ts`)
1. Looks up recently recommended spots
2. Asks about each one: "Did you go? How was it? (1-5)"
3. Saves ratings, updates spot confidence scores
4. Appends user tips to the spot's `pro_tips` array

### Generate Flow (admin only, stateful)

**handleGenerate** (`src/handlers/generate.ts`)
- Admin sends `/generate bangsar dinner`
- Claude generates candidate spots using `generate.txt` prompt
- Admin reviews each: type details to enrich and save, "skip" to pass, "done" to stop
- Saved with `source: "llm_verified"`

## The LLM Layer

All Claude interactions go through `src/llm.ts`:

| Function | Model | Purpose |
|----------|-------|---------|
| `chat()` | Sonnet (default) | Core chat with any system prompt |
| `chatAsP()` | Sonnet | Chat with Paul's personality (`system.txt`) |
| `extractJSON()` | Haiku (default) | Structured JSON extraction from text |
| `classifyIntent()` | Haiku | Intent classification |

Key design: recommendation handlers never let Claude freestyle about spots. They query the DB first, then pass the actual spot data to Claude as context. Claude's job is to present the data naturally, not to invent recommendations.

Prompts live in `src/prompts/*.txt` and are loaded at call time:
- `system.txt` — Paul's personality and rules
- `extraction.txt` — voice note / text → structured spot JSON
- `profile.txt` — conversational profile interview
- `strategic.txt` — pre-trip strategic decisions format
- `generate.txt` — candidate spot generation for admin

## The Database

Five tables in Supabase:

```
spots              — the knowledge graph (name, neighborhood, category, tier, what_to_order, pro_tips, etc.)
travelers          — user profiles (preferences, dietary, trip dates, visited/liked spots)
conversations      — state machine (current_flow, flow_state JSONB, message history)
contributors       — who added knowledge (count tracking)
feedback           — post-trip ratings and tips
```

The `conversations` table is the state machine. `current_flow` determines routing, `flow_state` holds arbitrary stage-specific data, `messages` is a JSONB array of the last 40 messages.

## Running It

```bash
# 1. Start dev server
npm run dev

# 2. Expose to internet (WhatsApp needs a public URL)
ngrok http 3000    # or your preferred tunnel

# 3. Set webhook URL in Meta Developer Dashboard
#    https://your-ngrok-url.ngrok.io/webhook

# 4. Seed the knowledge graph (first time)
npm run seed
```

## Admin Commands

Only work from the phone number set in `ADMIN_PHONE_NUMBER`:

| Command | What it does |
|---------|-------------|
| `add: Fatty Crab, Taman Megah, dinner, tier 1. Famous for chilli crab...` | Rapid-add a spot (extracts via Claude, saves immediately) |
| `/generate bangsar dinner` | Generate candidate spots for review |

## What Happens When a User Messages Paul

Concrete example — user texts "im hungry":

1. Meta POSTs webhook payload to `/webhook`
2. Server responds 200 immediately (WhatsApp retries on timeout)
3. `parseWebhook()` extracts `{ from, messageId, type: "text", text: "im hungry" }`
4. `showTyping(messageId)` fires (user sees typing dots)
5. `getOrCreateConversation(from)` loads conversation state
6. `current_flow` is "general" → not mid-flow
7. Not audio, not admin command → classify intent
8. `classifyIntent("im hungry", recentContext)` → `{ intent: "hungry", details: {} }`
9. `handleHungry(from, "im hungry", {})`:
   - Gets traveler profile
   - Checks weather
   - It's 2pm → categories = ["lunch", "cafe"]
   - `querySpots({ city: "Kuala Lumpur", categories: ["lunch", "cafe"], limit: 5 })`
   - Gets 5 spots, filters already-visited, takes top 3
   - Builds prompt with spot data
   - Claude writes: "Yo! For lunch right now, you gotta check out..."
10. Response saved to conversation history
11. `sendMessage(from, response)` → WhatsApp delivers it (typing dots disappear)

Total LLM calls: 2 (classify intent via Haiku + write response via Sonnet)
Total DB calls: 3 (get conversation + get traveler + query spots)
