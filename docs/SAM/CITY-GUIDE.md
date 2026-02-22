# CITY-GUIDE.md — How to Add a New City

Step-by-step guide to expanding Sam to a new city. Use the `/city add <CityName>` skill to automate most of this, or follow manually below.

---

## Overview

Adding a city involves four things:
1. Register city coordinates and metadata in `city-defaults.ts`
2. Create a seed file with initial spots
3. Seed the database
4. Backfill embeddings for semantic search

---

## Step 1 — Register city defaults

Edit `packages/bot/src/utils/city-defaults.ts` and add an entry to `CITY_DEFAULTS`:

```typescript
"Bangkok": {
  name: "Bangkok",
  country: "Thailand",
  timezone: "Asia/Bangkok",
  utcOffset: 7,
  latitude: 13.7563,
  longitude: 100.5018,
  language: "en",
  currency: "THB",
},
```

**Fields:**
- `timezone` — IANA timezone string (e.g. `Asia/Kuala_Lumpur`, `Asia/Bangkok`)
- `utcOffset` — hours from UTC (used by the proactive scheduler for local time gating)
- `latitude` / `longitude` — city center (used as fallback when user doesn't share location)
- `language` — `en` for now; Sam supports Malay in KL but English everywhere
- `currency` — ISO 4217 (used in price context)

**Area → city mappings**: If the city has well-known sub-areas users might mention, add them to `AREA_CITY_MAP`:

```typescript
"sukhumvit": "Bangkok",
"silom": "Bangkok",
"chatuchak": "Bangkok",
```

Also add the city-level alias to `CITY_LEVEL_ALIASES` if needed (e.g. `"bkk"` → users saying "bkk" mean the whole city, not a sub-area).

---

## Step 2 — Create a seed file

Create `packages/bot/src/seeds/<city-slug>.ts`. Use an existing seed as a reference — `packages/bot/src/seeds/penang.ts` is the most recent and cleanest template.

Each spot in the seed follows the schema below. Every field matters — the more operational intelligence you include, the better Sam's recommendations will be.

```typescript
export const spots = [
  {
    name: "Jay Fai",
    city: "Bangkok",
    country: "Thailand",
    area: "Samran Rat",
    categories: ["dinner"],
    must_go: true,
    address: "327 Maha Chai Rd, Samran Rat, Phra Nakhon",
    latitude: 13.7534,
    longitude: 100.5013,
    payment_methods: ["cash"],
    opening_hours: {
      "tue": "2pm-12am",
      "wed": "2pm-12am",
      "thu": "2pm-12am",
      "fri": "2pm-12am",
      "sat": "2pm-12am",
    },
    price_range: "$$$",
    what_to_order: ["crab omelette", "drunken noodles", "crab curry"],
    what_to_skip: [],
    pro_tips: [
      "Book weeks in advance — walk-ins are rarely possible",
      "She still cooks everything herself in massive wok glasses",
      "One Michelin star but the vibe is completely no-frills street food",
    ],
    vibe: "local",
    weather_dependent: false,
    best_time_of_day: "evening",
    indoor_outdoor: "indoor",
    source: "seed",
  },
  // ...
];
```

**Quality guide:**
- `must_go: true` — Best-in-class, category-defining. If you visit the city, you go here.
- `must_go: false` (default) — Solid, reliable, worth visiting. The bulk of the DB.
- `verified: true` — Data has been confirmed accurate by a contributor or admin.

**Minimum viable spot** (if you're adding a placeholder):
- `name`, `city`, `area`, `categories[]` are required
- `what_to_order[]` should have at least one item

---

## Step 3 — Wire the seed file into the runner

Open `packages/bot/src/seed.ts` and import your new file:

```typescript
import { spots as bangkokSpots } from "./seeds/bangkok.js";

// Add to the ALL_SPOTS array:
const ALL_SPOTS = [...klSpots, ...penangSpots, ...pjSpots, ...bangkokSpots, ...researchSpots];
```

---

## Step 4 — Seed the database

```bash
# Seed a specific city
npm run seed Bangkok

# Output:
# Seeding 45 Bangkok spots...
#   ✓ Jay Fai (Samran Rat)
#   ✓ Baan Pad Thai (Phra Nakhon)
#   ...
# Done! Run some test queries to verify.
```

If you get `No seed data for "Bangkok"` — check the city name matches exactly (case-sensitive) between the seed file and the CLI argument.

---

## Step 5 — Backfill embeddings

Embeddings power semantic search ("something light and healthy" → finds salad spots even without keyword match). Run the backfill after seeding:

```bash
npm run backfill-embeddings -w @sam/bot
```

This calls OpenAI `text-embedding-3-small` for each spot missing an embedding and writes the vector to `spots.embedding`. Costs ~$0.001 per 100 spots.

---

## Step 6 — Verify coverage

Use the `/city audit Bangkok` skill, or run manually:

```bash
npx tsx --env-file .env.local -e "
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const { data } = await sb.from('spots')
  .select('categories, must_go, verified')
  .eq('city', 'Bangkok');
const byCategory = {};
for (const s of data) {
  for (const c of (s.categories || [])) {
    byCategory[c] = (byCategory[c] || 0) + 1;
  }
}
console.log(byCategory);
"
```

**Coverage targets before going live with a city:**
- At least 20 spots total
- Breakfast, lunch, dinner, cafe all represented
- At least 5 must_go spots
- Embeddings backfilled

---

## Step 7 — Test Sam in the new city

Start `npm run dev:web` and use `/test-convo` to send messages in the city context:

```
tell sam: I'm in Bangkok for 5 days, first time, love street food
```

Sam should ask profile questions and then make Bangkok-specific recommendations.

---

## Checklist

- [ ] City added to `CITY_DEFAULTS` in `city-defaults.ts`
- [ ] Area → city mappings added to `AREA_CITY_MAP`
- [ ] Seed file created at `packages/bot/src/seeds/<city-slug>.ts`
- [ ] Seed file imported and added to `ALL_SPOTS` in `seed.ts`
- [ ] `npm run seed <CityName>` ran successfully
- [ ] `npm run backfill-embeddings` ran
- [ ] `/city audit <CityName>` shows acceptable coverage
- [ ] Test conversation works end-to-end
- [ ] `CLAUDE.md` Live Knowledge Graph table updated

---

## Removing a city

Don't remove cities — Sam's knowledge graph is append-only. If a city shouldn't be recommended, mark its spots `active: false` (if that column exists) or remove the entry from `CITY_DEFAULTS` so `isSupportedCity()` returns false. Sam will honestly tell users it doesn't cover that city yet.
