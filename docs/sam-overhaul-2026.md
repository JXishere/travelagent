# Sam Overhaul — Strategic Direction
_Discussion: 2026-04-05 | Architecture refined: 2026-04-06 | Status: Vision locked, implementation pending_

---

## Why This Document Exists

Sam was paused on 2026-03-23. The infrastructure is intact. 738 spots across KL, PJ, and Penang live in Supabase. The bot works. But the product is wrong — not in what it knows, but in where it lives.

This document captures a full strategic rethink: what Sam should become, why the current form is a ceiling, and what needs to be built to get there. It's a north star for when Sam is ready to be revived.

---

## The Problem With Sam Today

Sam lives inside WhatsApp. That was the right call for v1 — fast to ship, zero UI to build, already on everyone's phone. But WhatsApp is the most constraining channel possible for a travel product:

- **Text-only** — Travel is visual and emotional. WhatsApp strips all of that.
- **Private and closed** — Everything dies in the conversation. No SEO. No organic discovery. No social layer. No shareable links.
- **Meta's rules** — 24h messaging window, 8h proactive cooldown. The agent is leashed.
- **No platform** — Can't open up the knowledge graph. Can't let others build on it.
- **No monetisation control** — Can't charge, can't partner, can't run a business model.

Sam's knowledge is excellent. The surface is wrong.

---

## The Competitive Context: YaaY

Researched in depth April 2026. Full findings below.

### What YaaY Is

**yaaytravel.com** — Pre-seed Danish startup, Antler VC backed, founded Nov 2024. Core loop:

1. See a restaurant/hotel on TikTok or Instagram Reels
2. Forward it to YaaY (via mobile share sheet — same as forwarding to WhatsApp)
3. AI "VideoMatching" extracts the location
4. Drops it on a personal map
5. Book it via OTA affiliate partners (Booking.com, Airbnb — exact partners undisclosed)

Creator monetisation: verified creators get a "Travel Shop" — followers can book spots from the creator's content, creator earns commission.

Self-described positioning: "Google Maps + TikTok + Yelp."

### Why YaaY Is Structurally Fragile

**YaaY is middleware. They own nothing.**

| What they need | The risk |
|---------------|---------|
| TikTok/Instagram APIs for video import | Instagram killed Basic Display API Dec 2024. TikTok hardened API access 2025. |
| OTA partnerships for inventory | TikTok launched Booking.com integration natively Aug 2025. Expedia launched identical "Trip Matching" Jul 2025. |
| Creator ecosystem for content | Creator program paused — "overwhelming interest" but can't fulfill payouts. TikTok does creator monetisation better natively. |
| VideoMatching AI for location extraction | Inaccurate (Fukuoka video matched to Kyoto). No published accuracy metrics. |

Platforms are doing what YaaY does, natively, without YaaY. YaaY will either be acquihired or fade. The category is consolidating into platforms and incumbent OTAs — there's no room for a middleware startup with no data moat.

### What YaaY Proves That Matters

Despite being fragile, YaaY validates two things:

1. **The share mechanic works.** People want to forward a reel and get something useful back immediately. That demand is real.
2. **Visual discovery drives usage.** Maps, cards, video-first UI — that's the right surface for travel. Text interfaces don't create desire.

---

## Sam's Strategic Position

### The Identity

> **Sam is the most travelled person alive** — because everyone who has ever travelled through a city has poured their knowledge into Sam.

Not a creator marketplace. Not a review aggregator. Not a chatbot. One entity — Sam — who has collectively been everywhere, remembers everything, and tells you the truth without commercial interest.

YaaY is built on the creator economy: many voices, each optimising for engagement and income. Sam is built on the contributor network: one voice, backed by locals who have no incentive to fabricate and every reason to want your trip to be good.

This is the difference between following a travel influencer and texting a friend who lives there. Sam is the friend. Always.

### The Structural Moat

| Layer | YaaY | Sam |
|-------|------|-----|
| Data | None — middleware only | Proprietary knowledge graph — 738 contributor-verified spots |
| API dependency | Existential — platforms are closing access | Zero — Sam searches by name, not video content |
| Location accuracy | VideoMatching fails on ambiguous content | DB lookup by name — reliable |
| Trust model | Creators optimise for engagement | Contributors optimise for your trip being good |
| On-trip presence | None — product ends at booking | Primary value — real-time guidance when you're there |
| Platform risk | TikTok/Expedia already competing natively | Knowledge graph is platform-agnostic |
| Creator economics | Unsustainable — TikTok does it better | Not applicable — contributor model, not creator economy |

**The knowledge graph is the asset no one can replicate.** Every operational detail — cash only, wrong Google pin, arrive before 11am, order the dry not wet — doesn't exist anywhere else on the internet. That's the moat.

---

## The Overhaul: What Sam Becomes

### The Architecture: Two Surfaces, Two Jobs

Not competing. Complementary.

```
WhatsApp  ←  INTAKE + ON-TRIP COMPANION
             The universal input pipe. Any format, anything you encounter.
             ├── Forward a URL (TikTok, IG, YouTube, any link)
             │     → fetch page → extract venue → knowledge graph lookup
             ├── Send a photo (restaurant sign, dish, interior)
             │     → Claude vision → read sign / identify spot → intel or contribute
             ├── Forward a video
             │     → extract keyframe → vision → identify spot
             ├── Voice note → Whisper → contribution flow (already works)
             ├── Location pin → nearby spots (already works)
             └── "I'm hungry near KLCC" → recommendations (already works)

samiseverywhere.com  ←  VISUAL OUTPUT + DISCOVERY
                         Everything absorbed via WhatsApp becomes visible here.
                         ├── City map → all verified spots as pins
                         ├── Discovery feed → scroll spot cards
                         ├── Spot card → photo, Sam's voice, contributor intel
                         ├── Collections → shareable URLs, SEO-able
                         └── Contributor profiles → public attribution

Browser extension  ←  DESKTOP AMBIENT LAYER
                       Badges on TikTok, Google Maps, travel blogs
                       Same mechanic as WhatsApp URL intake, no API dependency
```

WhatsApp is **not demoted** — it is elevated and repositioned. It's no longer the front door to discovery (that's the web). But universal intake + on-trip companion are bigger jobs, not smaller ones.

Each surface has one job:
- **Web**: discovery, browsing, depth, SEO — the visual product
- **WhatsApp**: intake of anything you encounter + real-time on-trip guidance
- **Extension**: ambient intel while browsing on desktop

### The Visual Product (`samiseverywhere.com`)

**City map view** — The city lit up with verified spots. Every dot is a place Sam knows. Tap a dot, a card emerges.

**Discovery feed** — Scroll spot cards like Instagram. Each card: cover photo, Sam's one-liner, vibe tag, contributor attribution.

**Spot card** — Full detail. Photo, Sam's voice, what to order, what to skip, pro tips, hours, payment, contributor name and count.

**Collections** — "Best Dim Sum in KL." Shareable URLs. SEO-able. Curated by contributors or by Sam.

**Contributor profiles** — Public pages. Named attribution. Cities covered, spots contributed, verified local badge.

**Ask Sam** — Floating button, always present. Opens the conversational layer with city context. Power mode for real-time guidance.

The conversational AI doesn't disappear — it becomes a layer on top of the visual product, not the front door to it.

### The Share Mechanic (WhatsApp as the Share Target)

YaaY: install their app → forward reel → VideoMatching AI (misidentifies locations) → pin on map

**Sam**: forward anything to Sam on WhatsApp (already in everyone's share sheet, no install) → Sam processes it → immediate reply with contributor-verified intel

No new app. No VideoMatching. No API dependency. The mechanic is more reliable because Sam searches the knowledge graph by name, not by attempting to extract location from video pixels.

**Three formats, one result:**

| What you send | What Sam does |
|--------------|---------------|
| A URL (TikTok, IG, any link) | Fetches page, extracts venue from caption/og:tags, queries knowledge graph |
| A photo (sign, dish, interior) | Claude vision reads the sign / identifies the cuisine, queries knowledge graph |
| A video | Extracts keyframe, runs vision, same path as photo |

When Sam knows the place: full contributor intel, what to order, pro tips, hours.
When Sam doesn't: "Haven't verified this yet — want to add it?" → contribution flow.

Every share is a potential knowledge graph contribution. That's the viral loop YaaY doesn't have.

**The image analysis capability is a superpower.** No other travel product does this via WhatsApp. Someone sends a photo of a restaurant sign they walked past → Sam reads the sign → returns full intel. YaaY's VideoMatching can't do this; they match from video metadata, not from vision.

### The OpenClaw Layer: Sam as Agent

From `docs/openclaw-plan.md` — the thesis that makes Sam irreplaceable:

> Sam should not just recommend places — it should activate the desire to go, at the moment the stars align.

When you forward a Fatty Crab TikTok, Sam doesn't just show you a card. Sam saves your intent. Friday at 5:30pm, conditions align:

> *"You saved Fatty Crab 3 weeks ago. It's Friday at 5:30pm. They close at 10pm. Cash only — there's a Maybank ATM 100m past the entrance. Grab from KLCC is ~RM12."*

This fires via **browser push notifications** (PWA service worker) — not WhatsApp:
- No Meta 24h window restriction
- No 8h cooldown between messages
- Works on desktop and mobile
- Rich notifications with photo, action buttons

No other travel product does this. Not YaaY, not Mindtrip, not Google Maps. Because none of them have all three: persistent intent tracking + real knowledge graph + proactive execution infrastructure.

Sam has all three.

---

## What "10x Over YaaY" Actually Means

Facebook didn't beat MySpace by being a better MySpace. It changed the unit of value.

MySpace's unit: the profile page (look at me).
Facebook's unit: the connection (us).

YaaY's unit of value: **the saved spot** — a pin on a map.
Sam's unit of value: **the verified local insight** — contributor-sourced, operationally complete, named, living.

A verified local insight is something that:
- Doesn't exist anywhere on the internet
- Comes from someone who was actually there, with their name on it
- Tells you what to order, when to go, what to avoid, what everyone else gets wrong
- Gets updated when things change
- Is signed — "Ahmad, KL, 47 contributions"

This is what Google can't buy. TikTok can't generate. Booking.com doesn't want (it would kill their hotel SEO). YaaY can never build (they have no contributor network, only content creators).

Sam is the only product where this is the entire model.

---

## Implementation Phases

### Phase 1 — The Visual Surface
_Turn samiseverywhere.com from a landing page into a discovery product_

- City map view (spots as pins, tap to expand)
- Spot card component (photo, Sam's one-liner, contributor name, what to order, operational intel)
- Discovery feed (scroll spots by city/vibe/category — filter by vibe: casual/upscale/chaotic/chill/local)
- Collections (shareable URLs — "Best Dim Sum in KL")
- Media strategy: web-sourced on demand per spot, cached; contributor uploads optional; social share frame as cover when available

**Reusable existing code**: `live-feed.tsx` (real-time feed pattern), `getAllSpots()` in `packages/web/src/lib/supabase.ts`

### Phase 2 — WhatsApp as Universal Intake
_Close three gaps in `packages/bot/src/index.ts` that make WhatsApp a full intake pipe_

**Gap 1: URL/link handling**
- Detect URL in incoming text message
- Fetch page → extract venue name from title/og:tags/caption
- Run `webSearchSpot()` → knowledge graph lookup
- Reply: "Sam knows this — [full intel]" OR "Haven't verified this yet — want to add it?"

**Gap 2: Image analysis** ← the superpower
- `imageId` is already extracted in `whatsapp.ts` but never used downstream
- New: download image via WhatsApp media API → Claude vision API
- Prompt: identify restaurant name from sign, menu board, interior, or dish
- Cross-reference knowledge graph → return intel or open contribution flow
- Turns "What is this place?" + a photo into a real feature

**Gap 3: Video handling**
- Videos currently silently dropped — not even parsed by the webhook
- New: download video → extract keyframe → Claude vision → same path as image
- Covers forwarded TikToks, WhatsApp-native videos, YouTube Shorts

**Reusable existing code**: `webSearchSpot()` in `packages/bot/src/llm.ts`, media download pattern from `packages/bot/src/transcription.ts`

### Phase 3 — Contributor Identity
_Make the trust network visible — turn anonymous DB records into public profiles_

- Public contributor profiles at `/contributor/[slug]`
- Named attribution on every spot card (small, not the headline — Sam is the headline)
- Contribution count, cities covered, verified local badge
- Contributor collections ("Ahmad's KL")

**Existing data**: `contributors` table already tracks whatsapp_number, name, contribution_count, cities_contributed

### Phase 4 — The Agent Layer
_OpenClaw thesis: close the loop between "I want to go" and "I went"_

- `latent_intents jsonb[]` column on travelers (schema already designed in `docs/openclaw-plan.md`)
- Intent extraction: every share/save is a stated intent
- Browser push notifications via PWA service worker
- Condition engine: time of day + weather + hours + distance
- INTENT_ACTIVATION notification with full operational context

---

## Business Model

Not the creator economy. Not OTA affiliate commissions (affiliate revenue conflicts with the trust model — the moment Sam takes hotel money, Sam is compromised).

1. **City credits** — Contribute spots in your city, earn Sam access in other cities. No cash changes hands. Strong retention and growth flywheel.
2. **Tourism board / DMO partnerships** — Visit KL, Tourism Malaysia, TAT Thailand pay for official city coverage. Legitimate B2G revenue.
3. **Business verification tier** — Restaurants and cafes claim their Sam listing. Free basic, paid for priority placement and direct Sam response updates.
4. **Open knowledge graph API** — License Sam's spot data to travel apps, travel writers, hotel concierge tools. YaaY can never do this — they own nothing.
5. **Premium web** — Cross-city access, export, private collections, ad-free.

No App Store. No 30% cut. No platform dependency.

---

## What NOT to Build

| Don't build | Why |
|-------------|-----|
| VideoMatching AI | YaaY's approach — expensive, inaccurate, API-dependent. Sam's name-based lookup is better. |
| OTA booking integration | Conflicts with trust model. TikTok/Expedia already won this space. |
| Creator economy / follower system | YaaY's fragile model. TikTok does it better natively. |
| Native iOS/Android app | Extension + PWA first. No App Store, no 30% cut, no review process. |
| WhatsApp-style chat interface on web | The point is a visual surface. Don't replicate the constraint we're escaping. |
| Multi-voice / review aggregation | Sam is one voice. The moment there are "reviews from different people" you become TripAdvisor. |

---

## The Media Problem and Its Solution

738 spots exist, all text-only. Visual product needs photos.

**Priority order**:
1. Forwarded social content becomes the spot's cover — when someone shares a reel, that frame IS the photo. Authentic, no licensing issues.
2. Web-sourced on demand — when a user views a spot card, fetch a photo via web search. Cache it. No upfront batch cost.
3. Contributor uploads — optional photo field on contribution. Low friction, fills slowly.
4. Vibe-based placeholder — per-vibe illustration (not photography) while real photos fill in. Clearly illustrative, never passed off as real.

---

## Competitive Positioning Summary

| Product | What they are | Sam's advantage |
|---------|--------------|-----------------|
| YaaY | Middleware (social → OTA). No data, API-dependent, fragile. | Knowledge graph. Platform-agnostic. On-trip presence. |
| Mindtrip | Visual itinerary builder. $19M funded. Hallucinates hotels. | Real contributor data. No hallucination. On-trip. |
| Layla | Conversational travel AI. Claims 1.1M trips. Generic advice. | Depth. Operational intel. Honesty about gaps. |
| Wanderlog | Collaborative planning tool. You bring the knowledge. | Sam brings the knowledge. |
| ChatGPT | General AI. Gets worse the more specific you are. | Sam gets better the more specific. Local data. |
| TripAdvisor / Google Maps | Massive review DBs. Noisy, gamed, surface-level. | Contributor-verified. Operationally complete. Not gameable. |

---

## Files to Touch When Ready

```
# Phase 1 — Visual surface
packages/web/src/app/page.tsx              ← overhaul into city discovery UI
packages/web/src/components/live-feed.tsx  ← reuse pattern for discovery feed
packages/web/src/lib/supabase.ts           ← extend getAllSpots() for map/feed queries

# Phase 2 — WhatsApp universal intake
packages/bot/src/index.ts                  ← URL detection, image routing, video routing
packages/bot/src/whatsapp.ts               ← imageId already extracted, needs to be used
packages/bot/src/llm.ts                    ← webSearchSpot() reused for URL/image extraction

# Phase 3 — Contributor identity
packages/bot/src/handlers/contribution.ts ← foundation for public profiles
packages/bot/src/database.ts              ← extend for collections, public profiles

# Phase 4 — Agent layer
supabase/migrations/                       ← latent_intents column, photos, collections
docs/openclaw-plan.md                      ← latent_intents schema already designed
```

---

## Status at Pause (2026-04-05)

- Knowledge graph: intact. 738 spots across KL, PJ, Penang. All data in Supabase.
- Web (Vercel): running on free tier. No cost.
- Bot (Railway): paused. Resume with `railway up --service "@sam/bot"`.
- Supabase: paused. Restore via MCP or Supabase dashboard before any development.
- WhatsApp webhook: registered with Meta, will need re-verification after extended pause.

Everything is preserved. When ready to revive: restore Supabase → restart bot on Railway → build Phase 1 visual surface on the existing Next.js app.
