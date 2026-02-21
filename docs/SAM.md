# Who Sam Is Now

_Internal reference — last updated 2026-02-21_

For stack, file tree, schema, and code rules, see [CLAUDE.md](../CLAUDE.md). For deeper engineering guides, see the [`SAM/`](../SAM/) folder: [PROMPTS.md](../SAM/PROMPTS.md), [SCHEMA.md](../SAM/SCHEMA.md), [API.md](../SAM/API.md), [INFRA.md](../SAM/INFRA.md), [TESTING.md](../SAM/TESTING.md), [CITY-GUIDE.md](../SAM/CITY-GUIDE.md), [SKILLS.md](../SAM/SKILLS.md). This document answers a different question: **what is Sam as a product today?**

---

## 1. Identity

Sam is a travel intelligence friend — opinionated, warm, and direct. He knows a city the way a local does: what to order, which stall to skip, what time to show up, and why that other place everyone talks about isn't actually worth it.

**The core idea**: Don't over-plan. I'll guide you when you're there.

**What Sam is:**
- A recommendation engine backed by a real knowledge graph built by local contributors
- A conversational interface — not a database search box
- A city-by-city expansion: deep in KL now, building toward global coverage

**What Sam is not:**
- A transport guide or navigation app
- A booking engine or reservation system
- An itinerary builder
- A general search engine with a friendly face

The knowledge Sam gives comes from `spots` in the database, not from LLM imagination. If the DB doesn't have it, Sam says so honestly.

---

## 2. Where Sam Lives

### Channels

| Channel | Status | Behaviour |
|---------|--------|-----------|
| WhatsApp | Primary | Full relationship-building; proactive messaging; scheduler nudges; voice note contribution |
| Web (`/chat`) | Live | Same handlers; SSE streaming; session in localStorage; 30 msg/day rate limit |

WhatsApp and web share the same handler code. The difference is in the system prompt addendum layered on top of the core identity: WhatsApp gets `system-whatsapp.txt` (relationship-aware, knows the user's history); web gets `system-web.txt` (opinionated and direct, no relationship assumed).

### Cities and Knowledge Graph

| Country | City | Spots |
|---------|------|-------|
| Malaysia | Kuala Lumpur | 504 |
| Malaysia | Petaling Jaya | 169 |
| Malaysia | Penang | 65 |
| Taiwan | Taipei | 1 |

For cities outside this list: Sam says honestly that he has no coverage yet rather than improvising.

### Spot Taxonomy

- **Categories**: breakfast, lunch, dinner, cafe, activity, nightlife, market
- **Tiers**: 1 = must-do, 2 = should-do, 3 = hidden gem
- **Vibes**: casual, upscale, chaotic, chill, local, touristy

---

## 3. What Sam Can Do

### Flows

| Flow | Trigger | What it does | Key constraints |
|------|---------|--------------|-----------------|
| **Hungry** | "I'm hungry", food/drink request | DB query → 1–3 spot recommendations with operational intel (what to order, payment, hours, tips) | DB-only; no repeat-avoidance within a session |
| **Day plan** | "What should I do today?" | Loose breakfast / lunch / activity / dinner structure from DB | Activity data is thin; Sam adds a disclaimer |
| **Nearby** | "What's near X?" / location pin | Haversine proximity filter (3 km radius) then recommendation | No walking time estimates; no turn-by-turn directions |
| **Spot info** | "Is X open?", "What should I order at Y?" | DB lookup first; falls back to web search for hours/payment only | Web-sourced hours flagged as potentially stale |
| **Strategic** | Post-profile, traveler users only | Pre-trip anchor spots + what to expect (runs on Sonnet) | Travelers only; fires before arrival; skips local users |
| **Contribute** | "I know a place", voice note | Two-stage collect → confirm; duplicate detection; auto-merge new intel into existing spots | Web-sourced fields (address, hours) are never persisted without contributor confirmation |
| **Profile** | "I'm going to KL", new user onboarding | Conversational interview — traveler vs. local, dates, party, preferences | No pause/resume: if user leaves mid-interview it restarts next visit |
| **Feedback** | Post-trip scheduler nudge or manual trigger | Rate visited spots; capture user tips that feed back into the knowledge graph | Reactive — needs scheduler or explicit trigger to start |
| **Spot correction** | "That place closed", "Wrong hours" | Marks spot stale; records correction in DB | Flagging only — no auto-correction of the spot record |
| **Background profile** | Every message (fire-and-forget) | Silent extraction of trip facts and preferences into the traveler profile | Skips zero-signal messages; skips contribution and feedback flows to avoid noise |
| **Proactive scheduler** | 5-min cron (WhatsApp only) | Sends 4 message types: TRIP_WELCOME (day 1), MORNING_NUDGE (day 2+), DINNER_NUDGE (afternoon), FEEDBACK_CHECK (visited spots) | Requires 24h WhatsApp messaging window; 8h cooldown between messages; daytime hours only (8am–10pm local); skips users mid-flow |
| **Weather** | "Is it raining?", weather-sensitive queries | OpenWeather lookup; adjusts indoor/outdoor recommendations | Real-time but not hyperlocal |
| **General** | "Hey", "Who are you?", anything unclassified | Free-form Sam personality — no DB query | No spot data; conversational only |

### Contribution Flow — detail

The contribution flow is two-stage and non-trivial:

1. **Collecting** — LLM extracts structured spot data from voice or text. Missing operational fields (address, price range, opening hours) are auto-filled from web search and tagged as `webSourcedFields[]`.
2. **Confirming** — Summary is shown to the contributor with web-sourced fields annotated. Contributor can confirm, correct, or ask questions. On confirm: duplicate detection runs (exact match → fuzzy match → LLM verify). If a duplicate is found, new intel is merged into the existing spot rather than creating a duplicate. Every contribution (new or merged) is recorded in `spot_contributions` for contributor attribution.

Web-sourced fields are never persisted. Only data the contributor explicitly confirms is saved.

---

## 4. How Sam Thinks — Prompt Architecture

Prompts live in `packages/bot/src/prompts/`. The system is layered:

**Core identity (every Sam response)**
- `system.txt` — Sam's permanent identity, hard rules, and tone. Always included in `chatAsSam()` calls.
- `system-mini.txt` — Compact personality for `samSays()` — quick one-liners and conversational glue where the full system prompt would be wasteful.
- `system-web.txt` / `system-whatsapp.txt` — Channel addenda layered on top of `system.txt` for channel-specific behaviour.

**Task prompts (structured outputs)**
- `extraction.txt` — Voice note or text → structured spot JSON (contribution flow)
- `profile.txt` — Conversational interview for onboarding (traveler vs. local)
- `continuous_profile.txt` — Background extraction rules (silent, fire-and-forget)
- `strategic.txt` — Pre-trip planning format (Sonnet, travelers only)
- `proactive.txt` — Proactive message voice and style (scheduler)
- `feedback.txt` — Parse user feedback into rating + tips
- `generate.txt` — Admin spot content generation
- `coach.txt` — Quality evaluation rubric (6-dimension scoring, runs independently from conversations)

**Hard rules baked into `system.txt` worth calling out:**
- Plain text only. No markdown, no bullet points in responses.
- 1–3 sentences maximum per response.
- Never fabricate spots, dishes, hours, or prices not in the database.
- Match the language the user writes in (English, Malay, Manglish).
- Never mention Anthropic, Claude, or any AI company.

---

## 5. What Sam Cannot Do Yet — Honest Gaps

**By design (food-first scope):**
- No activity or sightseeing data — the knowledge graph is food and cafe-focused
- No transport, navigation, or directions
- No booking or reservation integration
- No multi-city itinerary building

**Technical gaps:**
- No verified live hours — web search is a fallback and is flagged as potentially stale
- No session repeat-avoidance — Sam may recommend the same spot twice in one session
- No image recognition — images are acknowledged but not processed
- Cities outside KL / PJ / Penang / Taipei: Sam is honest about having no coverage yet

---

## 6. Known Rough Edges

**Duplicate detection**: exact match → fuzzy match → LLM verify. Works well for exact name matches. Fuzzy matching is approximate and may miss variations (e.g. "Peter's Pork Noodle" vs "Peter Pork Noodle").

**Profile interview**: no pause/resume. If a user leaves mid-interview and returns later, the interview restarts from the beginning. The data collected before they left is not preserved.

**Feedback**: reactive only. The feedback flow only fires when the proactive scheduler nudges a user or when a user manually triggers it. No automatic post-trip prompt if the scheduler window has closed.

**Language detection**: keyword-based. Handles clear Malay and Manglish well, but may miss ambiguous signals or code-switching mid-sentence.

**Contribution area conflict**: when the contributor's stated area differs from what web search returns for the address, the conflict is flagged in the confirmation summary. It is not auto-resolved — the contributor has to clarify.

**Proactive scheduler (WhatsApp only)**: requires the 24-hour messaging window to be open (i.e. the user messaged within the last 24h). Users who go quiet for a day will not receive proactive messages until they message again.

---

## 7. Quality Infrastructure

| Tool | How to run | Purpose |
|------|-----------|---------|
| Eval | `npm run eval` | Regression testing — does a prompt still pass scenario assertions? Catches breakage. |
| Coach | `npm run coach` | Discovery — reviews real conversations and suggests prompt improvements. Finds weakness. |
| Coach auto | `npm run coach:auto` | Automated loop: analyze → apply → validate → commit. |

Eval catches "did the prompt break?" — Coach discovers "how could it be better?"

See `packages/bot/src/eval/` for scenario files, `coach.txt` for the 6-dimension rubric, and [SAM/TESTING.md](../SAM/TESTING.md) for the full testing strategy.
