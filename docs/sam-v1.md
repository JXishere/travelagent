# Sam — v1.0

_First clean capabilities snapshot — Feb 25, 2026_

---

## Who Sam Is

Sam is a travel intelligence service, not a search engine. He gives opinionated, operationally-detailed recommendations drawn from a knowledge graph built by real local contributors — people who live in or deeply know the city. The framing: the friend who lives everywhere. Sam starts in Kuala Lumpur and expands city by city.

---

## How to Reach Sam

| Channel | Address | Session type | Rate limit |
|---------|---------|-------------|------------|
| Web | samiseverywhere.com/chat | Anonymous (IP-based) | 30 messages/day per IP |
| WhatsApp | [link or phone number] | Phone-bound (permanent profile) | None |

---

## Where Sam Lives

| Country | City | Spots in graph |
|---------|------|----------------|
| Malaysia | Kuala Lumpur | 504 |
| Malaysia | Petaling Jaya | 169 |
| Malaysia | Penang | 65 |
| Taiwan | Taipei | 1 |

Outside these cities, Sam will say so honestly rather than guess.

---

## What Sam Can Do — Both Channels

| Capability | What It Does | Example |
|------------|-------------|---------|
| Find food / drinks | Recommends spots by meal type, cuisine, area, vibe, or dietary need. Includes what to order, payment, hours, pro tips. | "Where should I eat in Bangsar tonight?" |
| Day plan / itinerary | Builds a time-structured day with meals and stops sequenced by area. | "Plan my Thursday in KL." |
| What's nearby | Finds spots close to a named place or coordinates. | "What's good near KLCC?" |
| Spot deep-dive | Full detail on a specific spot — hours, what to order, pro tips, vibe. | "Tell me about Jalan Alor." |
| What's on / happenings | Surfaces events, markets, and time-sensitive activity spots. | "Anything on this weekend?" |
| Weather context | Current conditions, hybrid with food recommendations when relevant. | "Is it raining? Where should I eat?" |
| Add a new spot | Multi-turn contribution flow: LLM extracts structured data, missing fields filled from web search, contributor confirms before saving. | "I found this amazing cendol stall…" |
| Learn your taste | Conversational profile: trip dates, dietary needs, travel party, budget, pace. Used to personalise future recommendations. | "I'm here with a toddler, vegetarian." |
| Pre-trip strategy | High-level neighbourhood and timing decisions before the trip starts. Requires profile first. | "I have 4 days, what's the play?" |
| Post-visit feedback | Collects ratings on spots Sam recommended. Feeds back into quality signals. | "We went to Fatty Crab — loved it." |
| Report bad info | Flags a spot as closed, wrong hours, or inaccurate. Queued for admin review. | "Restoran XYZ is closed now." |
| General chat | Freeform conversation. Sam is honest about what he doesn't know (activities, sightseeing depth, cities not in graph). | "What do you think of Brickfields?" |

---

## What Sam Can Do — WhatsApp Only

| Capability | What It Does |
|------------|-------------|
| Voice notes | Whisper transcription → contribution flow. Say a spot recommendation out loud, Sam structures it. |
| Share location | GPS pin → nearby handler. Drop a pin, get spots around you. |
| Proactive messages | Sam reaches out unprompted during active trips: TRIP_WELCOME (day 1), MORNING_NUDGE (day 2+, 8–10am), DINNER_NUDGE (day 2+, 5–7pm), FEEDBACK_CHECK (10–12am or 7–9pm when unrated spots exist). Gates: 24h WhatsApp messaging window, 8h cooldown, daytime only, no mid-flow interruption. |
| Staleness pings | Re-engages original contributors on spots not verified in 180+ days. Runs once daily, 10am–12pm KL. |
| Typing indicator | Sam shows "typing…" while processing. Immediate feedback to the user. |
| Persistent identity | Phone number = permanent traveler profile. Preferences, trip dates, and history persist across sessions. |
| Admin commands | Gated to `ADMIN_PHONE_NUMBER`: `add:` (rapid spot add), `/generate` (generate spot content by area+category), `/approve` (mark spot closed), `/reject` (dismiss correction), `/corrections` (list pending), `/publish` (publish spot from review queue). |

---

## What Sam Can Do — Web Only

| Capability | What It Does |
|------------|-------------|
| Streaming responses | SSE token-by-token output for recommendation intents (hungry, day_plan, nearby, happenings, weather, spot_info, general). Feels live. |
| Flow init without message | The "Tell Sam" button on the landing page primes the contribution flow before the user types anything (`initFlow` API param). |
| Anonymous sessions | No signup. Session ID is client-generated. No persistent identity by default. |
| Rate limiting | 30 messages/day per IP, resets at UTC midnight. Localhost is exempt. |
| Spot admin UI | `/review` — curation interface for reviewing, editing, approving, and deleting spots. Filter by category, area, tier, source. |

---

## What Sam Cannot Do

| Limitation | Notes |
|------------|-------|
| Book or reserve anything | No booking integrations. Sam recommends; the traveler acts. |
| Show real-time venue availability | No live data feeds. Hours come from contributors, not live APIs. |
| Analyse images | WhatsApp image captions are processed as text. Image content itself is not analysed. |
| Plan across multiple cities in one itinerary | City context is single-city per session. Cross-city trip planning is not supported. |
| Link web identity to WhatsApp identity | Anonymous web sessions and phone-bound WhatsApp profiles are separate. No merge path. |
| Give directions or transport routing | No maps integration. Sam tells you where to go, not how to get there. |
| Filter by group size or occasion | Not a current query dimension. Use "I'm with a toddler" or "it's a date" in natural language. |
| Compare two spots side by side | "X vs Y" is not a supported query mode. Sam picks one and says why. |
| Cover cities not in the knowledge graph | Will say honestly. Won't fabricate coverage. |

---

## Quality Signals

Every spot in the graph carries one of three quality tiers:

| Signal | Meaning |
|--------|---------|
| `must_go` | Best-in-class. Go out of your way. Contributor's strongest endorsement. |
| `verified` | Contributor-confirmed accurate. Solid recommendation. |
| _(neither)_ | Unverified lead. In the graph, but not yet confirmed by a contributor. |

Sam uses these signals when deciding what to surface first.

---

_v1.0 — Feb 25, 2026 — First clean capabilities snapshot_
_Next review: on major capability addition or city expansion_
