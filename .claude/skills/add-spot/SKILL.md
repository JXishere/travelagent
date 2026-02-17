---
description: Research and add a KL spot to Sam's knowledge graph
argument: Spot name or description (e.g. "Restoran Nasi Kandar Line Clear")
allowed-tools: WebSearch, WebFetch, Read, Bash
---

# /add-spot — Add a KL Spot

You are a KL local intelligence researcher for Sam's travel knowledge graph.

## Input

The user wants to add this spot: `$ARGUMENTS`

## Process

### 1. Research the Spot

Search the web for the spot's details. Look for:
- **Full name** and any common aliases
- **Address** and neighborhood within KL/greater KL
- **Opening hours** (day-by-day if possible)
- **Payment methods** (cash only? Cards? E-wallets like Touch 'n Go?)
- **Price range** ($, $$, or $$$)
- **What to order** — the must-try items, ideally 3-5
- **What to skip** — anything reviewers consistently warn about
- **Pro tips** — timing, seating, ordering hacks, local knowledge
- **Vibe** — casual, upscale, chaotic, chill, local, touristy
- **Category** — breakfast, lunch, dinner, cafe, activity, nightlife, market
- **Best time of day** — morning, afternoon, evening, late-night
- **Indoor/outdoor** — indoor, outdoor, both
- **Weather dependent** — true/false
- **Tier** — 1 (must-do), 2 (should-do), 3 (nice-to-have/hidden gem)

Use multiple sources: Google reviews, food blogs, TripAdvisor, local KL food sites (KL Foodie, TimeOut KL, Zomato).

### 2. Check for Duplicates

Query existing spots to check if this place is already in the database:
- Use the Supabase MCP to run: `SELECT name, neighborhood, category FROM spots WHERE name ILIKE '%<name>%'`
- If MCP is unavailable, query via the Supabase JS client:
```bash
npx tsx --env-file .env.local -e "
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
const { data } = await sb.from('spots').select('name, neighborhood, category').ilike('name', '%SPOT_NAME%');
console.log(JSON.stringify(data, null, 2));
"
```
- If a duplicate exists, tell the user and show what's already stored

### 3. Structure the Data

Format the researched data to match the spots schema:

```typescript
{
  name: "Full Spot Name",
  city: "Kuala Lumpur",
  neighborhood: "Bangsar",           // KL neighborhood
  category: "lunch",                 // breakfast|lunch|dinner|cafe|activity|nightlife|market
  tier: 2,                          // 1=must-do, 2=should-do, 3=hidden-gem
  address: "Full address",
  latitude: 3.1234,                 // decimal coordinates
  longitude: 101.5678,
  payment_methods: ["cash", "card"],
  opening_hours: { "mon": "8am-10pm", ... },
  price_range: "$$",
  what_to_order: ["Item 1", "Item 2"],
  what_to_skip: ["Item to avoid"],
  pro_tips: ["Go before 12pm to avoid queue"],
  vibe: "chaotic",
  weather_dependent: false,
  best_time_of_day: "morning",
  indoor_outdoor: "indoor",
  confidence_score: 0.7,            // 0-1, how confident in the data
  source: "manual"                  // seed|voice|text|llm_verified|manual
}
```

### 4. Insert the Spot

- **Preferred**: Use Supabase MCP to insert directly
- **Fallback**: Insert via the Supabase JS client:
```bash
npx tsx --env-file .env.local -e "
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
const { data, error } = await sb.from('spots').insert({
  name: '...', city: 'Kuala Lumpur', neighborhood: '...', /* ... all fields */
}).select().single();
if (error) { console.error(error); process.exit(1); }
console.log('Inserted:', JSON.stringify(data, null, 2));
"
```
- Also append to `src/seed.ts` so the spot is included in future re-seeds

### 5. Confirm

Show the user what was added with all the operational intelligence. Flag any fields that couldn't be found and might need verification.

## Quality Standards

- **Never fabricate details.** If you can't find hours or payment info, mark it as unknown rather than guessing.
- **Operational depth matters.** "Good nasi lemak" is useless. "Get the nasi lemak with extra sambal, the ayam goreng berempah is the real star, cash only, go before 11am" is what Sam needs.
- **Local language is welcome.** Use Malay food terms naturally (nasi lemak, roti canai, teh tarik) — Sam's audience expects it.
