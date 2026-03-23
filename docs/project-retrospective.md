# Sam — Project Retrospective
## Day 1 → Pause (Feb 12 – Mar 23, 2026)

---

## The Idea

Sam started from a simple frustration: Google always shows you the same 2–3 restaurants. It surfaces the popular ones, not the right ones.

The premise: what if you had a friend who actually lived in every city you visit? Someone who knew the chaos of Jalan Alor at midnight, the specific stall in Chow Kit worth the detour, the places that don't show up on any list. Not a search engine — a friend who gives you an opinion and tells you exactly what to do.

Sam is that friend, powered by real local contributors, available on WhatsApp and the web. The knowledge graph is the product. The LLM is just the voice.

---

## Timeline

### Week 1 — Feb 12–16: Strategy & Foundation

The project started as a strategy doc. Before writing a line of code, the question was: what is this, really? Is it a guide model? A concierge? A community product?

Key decisions made early:
- **Contributors are the moat.** Not the LLM, not the UI. The people who know the city.
- **Start in KL.** One city, done properly. Then expand.
- **WhatsApp first.** That's where Malaysian travelers already are.

By Feb 15 the first working WhatsApp agent was live locally — basic intent routing, a handful of hardcoded KL spots, and a contribution flow that let someone say "I know a great spot" and have it structured and saved.

By Feb 16 the full local dev infrastructure was in place: Express webhook server, Supabase DB, Whisper transcription, the bones of every handler.

---

### Week 1 (cont.) — Feb 17–18: Core Flows Built Out

The first real sprint. In ~48 hours:

- **Contribution flow rewrite** — multi-turn conversation to extract spot details from voice or text, with web search enrichment to fill missing operational fields (hours, payment, address). Contributor confirms before anything is saved. Web-sourced fields annotated so contributors know what Sam looked up vs what they said.
- **Continuous profile extraction** — after every message, silently extract trip preferences into the traveler profile. No separate interview required; Sam learns from normal conversation.
- **Proactive scheduler** — Sam reaches out during active trips. Four message types: TRIP_WELCOME, MORNING_NUDGE, DINNER_NUDGE, FEEDBACK_CHECK. Gates: 24h WhatsApp window, 8h cooldown, daytime only.
- **Multi-city support** — spots from any city saved correctly, not KL-locked.
- **Web chat** — full Sam capabilities in a browser, streamed via SSE. Monorepo restructure: `packages/bot/` and `packages/web/` (Next.js).

The coach pipeline was also born here — a script that reads real conversations, scores them on 6 quality criteria, and suggests targeted prompt improvements. First coach PR merged Feb 18.

---

### Week 2 — Feb 19–21: Quality, Scale, Search

The knowledge graph started growing. Seeds expanded to 200+ KL spots. The team moved from "does it work" to "does it work well."

**Search overhaul:**
- Semantic embeddings via `text-embedding-3-small` + pgvector (`match_spots` RPC)
- Hybrid semantic + structured path (`match_spots_hybrid`) — better for cuisine queries like "Thai food in PJ"
- Area resolution improved: city alias handling, PJ area-to-city mapping, neighborhood centroid geocoding
- Dish-aware routing: "I want nasi lemak" routes differently from "I'm hungry in Bangsar"

**Schema cleanup:**
- `category` (string) → `categories` (string[]) — every spot can have multiple categories
- `tier` + `confidence_score` → `must_go` (bool) + `verified` (bool) — simpler, more honest quality signals
- Dropped 5 dead columns

**Contributor attribution:**
- `spot_contributions` table — every contribution tracked per contributor
- Fuzzy duplicate detection: exact name match → fuzzy match → LLM verify
- Auto-merge: new intel from a contribution folds into an existing spot rather than creating a duplicate

**Channels:**
- Different Sam personalities for web vs WhatsApp (web is slightly more formal, WhatsApp more casual)
- Vercel deploy: `@sam/web` auto-deploys from `main`

---

### Week 2 (cont.) — Feb 22–23: Intelligence Layer

Sam got meaningfully smarter:

**New intents:**
- `spot_info` — deep-dive on a specific spot by name
- `happenings` — what's on this weekend, events, markets
- `spot_correction` — user flags bad info (closed, wrong hours), queued for admin review
- `weather` — OpenWeather integration, adjusts indoor/outdoor recommendations

**Personalization:**
- Disliked spot filtering (never recommend a spot the user has rated 1–2)
- `avg_rating` persistence from feedback loop
- Profile preferences flow into all recommendation queries

**Operational:**
- Railway deploy: `@sam/bot` on `sambot-production-6ab1.up.railway.app`
- Railway development environment added
- Map links in recommendations
- Feedback auto-demotion: enough bad ratings → spot drops from default results
- Slack notifications on prompt changes, errors, and daily digest

---

### Week 3 — Feb 24–25: Autonomy & V1.0

The project reached its most sophisticated state.

**Autonomous coaching loop** (`coach-auto.ts`):
- Runs at 1am UTC
- Reads uncoached conversations → scores them → generates prompt improvement → runs eval suite → commits to main if eval passes
- `coach-revert.ts` at 9am: if post-deploy scores drop ≥ 0.3 vs baseline, auto-reverts
- `coach_runs` table: every run logged with prompt snapshots for traceability
- No human in the loop for routine improvements

**Live bug detection:**
- `trackError()` — fire-and-forget, never blocks users
- 5-minute alerter: detects stuck conversations and error spikes, pings Slack immediately
- Coach integration: bugs flagged in coaching analysis, not just in logs

**Strategic planning:**
- Day-by-day itinerary format with neighbourhood clustering
- Strategic handler: pre-trip planning with area+timing recommendations after profile is built

**V1.0 snapshot** (Feb 25):
- 504 KL spots, 169 PJ spots, 65 Penang spots, 1 Taipei spot
- All core intents working on both WhatsApp and web
- Review UI at `/review` for admin curation
- Batch web-validation UI: validate multiple spots against live web data in one session
- Confidence score dots in review UI

**Knowledge graph at v1.0:** 738 spots across Malaysia + 1 Taipei seed.

---

### Feb 28: Bug fixes

- Supabase singleton fix (was creating multiple GoTrueClient instances on hot reload)
- React error #310 fix in review page (useMemo before early return)

---

### Mar 23: Pause

No new features after Feb 28. Project paused to focus on other work. All data preserved in Supabase.

---

## What Was Built — Final State

### Stack
| Layer | Technology |
|-------|-----------|
| Bot runtime | Node.js / TypeScript / Express |
| Web | Next.js 15 (Vercel) |
| Database | Supabase (PostgreSQL + pgvector) |
| LLM | Claude Haiku (default), Sonnet (coaching/strategic) |
| Voice | OpenAI Whisper |
| Embeddings | OpenAI `text-embedding-3-small` |
| Weather | OpenWeather API |
| Hosting | Railway (bot), Vercel (web) |

### Knowledge Graph at Pause
| City | Spots |
|------|-------|
| Kuala Lumpur | 504 |
| Petaling Jaya | 169 |
| Penang | 65 |
| Taipei | 1 |
| **Total** | **738** |

### Intents Handled
`hungry` · `day_plan` · `nearby` · `spot_info` · `happenings` · `weather` · `contribute` · `profile` · `strategic` · `feedback` · `spot_correction` · `general`

### Channels
- **WhatsApp**: voice notes, location pins, proactive messages, persistent identity, admin commands
- **Web**: SSE streaming, anonymous sessions, `/review` admin UI, rate limiting (30 msg/day)

### Background Processes
- Continuous profile extraction (every message, fire-and-forget)
- Proactive scheduler (5-min interval, WhatsApp only)
- Autonomous coaching loop (1am UTC daily)
- Revert watcher (9am UTC daily)
- Live error alerter (5-min interval)

### Infrastructure at Pause
| Service | Status at pause |
|---------|----------------|
| Railway `@sam/bot` production | **Deleted** |
| Railway `@sam/bot` development | **Deleted** |
| Supabase `Sam` project | **Paused** |
| Vercel `@sam/web` | Running (free tier) |
| WhatsApp Business | Active, no cost when idle |
| API keys | Active, pay-per-use only |

---

## What Was Working Well

- **Contribution flow** — the two-stage extract+confirm loop with web enrichment worked reliably. Voice notes especially smooth via Whisper.
- **Duplicate detection** — fuzzy matching + LLM verify caught most duplicates. Auto-merge preserved intel without creating junk.
- **Autonomous coaching** — actually improved prompts over time without human intervention. The revert failsafe made it safe to run unattended.
- **Hybrid search** — semantic + structured combined was noticeably better than either alone for cuisine queries.
- **Review UI** — batch validation made knowledge graph curation practical. Confidence score dots gave instant quality overview.

## Open Threads at Pause

Things that were on the roadmap but not started:

- **Directions / transport** — Sam tells you where to go but not how to get there. A maps integration was sketched but not implemented.
- **Group size / occasion filtering** — "I'm with a toddler" works via natural language but isn't a first-class query dimension.
- **Cross-city trip planning** — single city per session. Multi-city itinerary support was noted as a gap.
- **Daily cost/usage report** — Slack digest showed token costs but not a clean daily P&L.
- **Activities depth** — food coverage is strong; non-food activities (things to do, sightseeing) are shallow.
- **"I've been meaning to go" problem** — identified but unsolved: how does Sam help users act on places they've bookmarked in their head but never visited?

---

## How to Resume

1. **Restore Supabase**: dashboard → project Sam → Settings → Restore project
2. **Redeploy bot**:
   ```bash
   railway link   # select fortunate-friendship
   npm run build:bot
   railway up --service "@sam/bot"
   ```
3. **Verify**: `GET https://sambot-production-6ab1.up.railway.app/health`
4. **Register webhook** with Meta if needed (the Railway URL may change on fresh deploy)

All 738 spots, all traveler profiles, all conversations, all events — untouched in Supabase.

---

## Commit Count

140 commits over 40 days (Feb 12 – Mar 23, 2026).

---

_Written at pause — Mar 23, 2026_
