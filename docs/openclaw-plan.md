# OpenClaw → Sam Opportunity Plan
_Last updated: 2026-02-25_

---

## What is OpenClaw

Open-source autonomous AI agent framework by Peter Steinberger (PSPDFKit founder). Hit 100k+ GitHub stars in record time. Steinberger just joined OpenAI and handed it to an open-source foundation.

**Core idea**: instead of a chatbot that replies with text, OpenClaw is a local agent that _does things_ — executing commands, automating browsers, managing calendars — all through messaging apps you already use.

**Architecture (four tiers)**:
```
Channel Layer  →  WhatsApp, Telegram, Slack, Discord, iMessage
Gateway        →  Node.js hub (state, routing, execution)
LLM Brain      →  Claude, GPT-4, Gemini, or local Llama
Skills         →  shell, browser automation, file ops, ClawHub plugins
```

**Key design decisions**:
- Messaging as UI — agent lives in your chat apps as a contact, not a separate interface
- Local-first memory — stores preferences as Markdown "soul files"
- Heartbeat scheduler — proactive background monitoring without user prompting
- ClawHub — community skill marketplace (npm for agent capabilities)

---

## How Sam Compares

Sam has independently arrived at most of the same patterns:

| Capability | OpenClaw | Sam | Gap? |
|---|---|---|---|
| Messaging-as-UI | WhatsApp, Telegram, Slack, Discord, iMessage | WhatsApp + Web | Multi-channel |
| LLM backend | Claude/GPT/Gemini/local | Claude (Haiku + Sonnet) | None (intentional) |
| Proactive scheduler | Heartbeat | Yes — scheduler.ts, 5-min interval | No gap |
| Persistent user memory | Local Markdown soul file | travelers table (JSONB) | No gap |
| Skills/plugins | ClawHub marketplace | Handlers (query, ontrip, strategic…) | No gap |
| State management | Local | conversations table | No gap |

**Key difference**: OpenClaw is a general-purpose autonomous executor. Sam is a deep domain specialist with a proprietary knowledge graph no general agent can replicate.

---

## The Core Insight

From `whatsonmymind.md`:
> _"many people haven't explored many places yet... only will execute if the stars align... 'I've been wanting to visit that restaurant but haven't found the right time to'"_

OpenClaw's thesis: remove execution friction by acting proactively. For travel booking, it books flights while you sleep. **Sam's equivalent: make the stars align.**

**Current state**: User asks → Sam recommends → user maybe goes
**Opportunity**: Sam tracks expressed desire → monitors conditions → nudges at the perfect moment → removes all friction

---

## What the Codebase Analysis Found

### What already works (don't touch)
- categories is already `text[]` — multi-category per spot already supported (max 3)
- Proactive scheduler is sophisticated — 4 message types, weather-aware, trip-day-aware
- Contribution flow has web enrichment + duplicate detection + auto-merge
- Semantic + structured hybrid query path is in place
- Staleness pings already fire at 10am–12pm for spots >180 days old

### Confirmed gaps
| Area | Gap |
|---|---|
| Recommendations | No directions / how to get there |
| Day planning | No web search for live events — only DB happenings |
| Day planning | No geographic routing — spots listed in random order |
| Query ranking | All verified spots equally weighted — low-use spots never surface |
| Contribution | No hard gate if spot can't be found online — accepts bad data |
| Scheduler | No latent intent tracking — nudges are generic, not desire-based |
| Spot tiers | No "hidden/secret" tier — only must_go + verified |
| Reporting | Daily Slack digest exists but missing cost, web search count, new spots |

---

## The Plan

### Tier 1 — Quick Wins (days, no architecture changes)

**1. Directions in every recommendation**
Every spot response adds a "how to get there" line: nearest LRT stop, Grab estimate, walking time from a known landmark. Sam already has lat/long for every spot. One-liner addition to the query handler response formatter.

**2. Live events in day_plan**
`day_plan` queries DB for happenings but never calls web search. `webSearchSpot()` already exists. Wire a parallel web search for "what's on in [city] today" into the day plan builder. Covers pop-ups, festivals, weekend markets that aren't in the DB.

**3. Enriched daily Slack report**
The 9am digest fires already. Extend it with: total messages, total cost, total web searches, new spots added today, new countries added. Pure schema query + Slack formatter change.

**4. Exploration tax in ranking**
Current sort: `must_go DESC, verified DESC` — same top spots forever. Add a **10% exploration slot** per response: one spot that is _not_ must_go/verified, selected from recently added or low-recommendation-count spots. Prevents stagnation. Fixes the "unfair to low use-count spots" concern.

---

### Tier 2 — Real Product Bets (weeks)

**5. Contribution verification gate**
Currently accepts any spot name — web enrichment happens but isn't a hard gate. Add: if `webSearchSpot()` returns no confident match for name + city, prompt contributor to confirm before saving. _"I couldn't find a place called [X] in KL — can you double-check the name?"_ Stops bad-faith uploads before they hit the DB.

**6. Geographic day plan routing**
After selecting spots for a day plan, sort them by area proximity to minimize backtracking. Haversine distance already lives in `geo.ts`. Simple clustering pass: group spots by area, sequence them logically. "Breakfast Bangsar → lunch Damansara → dinner Bangsar" is avoidable.

**7. "Hidden" spot tier**
Schema has `must_go` (best-in-class) but no concept of "not on Google, you have to know someone." Add a `hidden boolean` flag. Contributors explicitly mark these as local secrets. Sam surfaces them sparingly, as rewards for engaged users.

Discovery hierarchy: `verified → must_go → hidden`

---

### Tier 3 — The Big Opportunity

**8. Latent Intent Activation**

This is what OpenClaw does for tasks (books flights while you sleep). Sam's version: **close the loop between "I want to go" and "I went."**

#### How it works

When a user says anything like _"I've been meaning to try that char kuey teow place"_ or _"maybe next time I'll hit Bangsar Village"_ — Sam stores this as **stated intent** in the traveler profile.

The proactive scheduler already runs every 5 minutes. Add a new message type: **INTENT_ACTIVATION** — fires when conditions align:
- Right time of day (matches spot's best_time_of_day)
- Weather is good (if spot is weather_dependent)
- Spot is within reasonable distance
- Intent is at least 6 hours old
- User hasn't visited the spot yet

**Example nudge**:
> _"You mentioned wanting to try Fatty Crab — it's 5:30pm on a Friday and they close at 10pm. Grab from KLCC is ~RM12. Go?"_

No other travel product does this because no other product has (a) persistent conversation memory + (b) real knowledge graph with hours/tips + (c) proactive messaging infrastructure.

#### Implementation path

1. Add `latent_intents: jsonb[]` to `travelers` — schema: `{ spot_id, expressed_at, status: "pending|activated|dismissed" }`
2. Extend `maybeExtractProfile()` to detect intent expressions and write to `latent_intents`
3. Add `INTENT_ACTIVATION` scheduler type with condition checks
4. Fire nudge with full operational context: how to get there, what to order, hours, pro tip

#### Migration needed
```sql
ALTER TABLE travelers ADD COLUMN IF NOT EXISTS latent_intents jsonb[] DEFAULT '{}';
```

---

## What NOT to Build (from OpenClaw)

| Idea | Why not |
|---|---|
| Telegram channel | WhatsApp not fully leveraged yet. Later. |
| Booking execution | Sam's moat is knowledge, not transaction. Don't become a booking agent. |
| Browser automation for freshness | Contributor staleness pings already handle this with human verification — better model. |
| Local-first / self-hosted | Sam is cloud-hosted. Correct for travelers. |
| Model agnosticism | Claude is genuinely better for Sam's use case. Not a gap. |

---

## Priority Stack

| # | What | Impact | Effort |
|---|---|---|---|
| 1 | Directions in recommendations | Immediate trust + utility boost | Hours |
| 2 | Events web search in day_plan | Fills biggest day planning gap | Hours |
| 3 | Contribution verification gate | Protects data quality before scale | Day |
| 4 | Exploration tax in ranking | Fairness + prevents stagnation | Day |
| 5 | **Latent Intent Activation** | Strategic differentiator, unique to Sam | Week |
| 6 | Geographic day plan routing | Concrete day planning improvement | Day |
| 7 | "Hidden" spot tier | Product identity + contributor hook | Day |
| 8 | Enriched daily report | Ops hygiene | Hours |

---

## One-Line Summary

OpenClaw validates Sam's architectural instincts. The real opportunity it surfaces: Sam should not just recommend places — it should activate the desire to go, at the moment the stars align.
