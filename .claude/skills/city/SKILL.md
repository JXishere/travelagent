---
description: Expand Sam to a new city or audit existing city coverage
argument: Subcommand and city name (add <City> | audit <City> | list)
allowed-tools: Read, Edit, Write, Bash
---

# /city — City Management

Tooling for expanding Sam to new cities and auditing coverage in existing ones.

## Input

Subcommand: `$ARGUMENTS`

## Subcommands

---

### `list`

Show all cities Sam supports with spot counts from the DB.

1. Read `packages/bot/src/utils/city-defaults.ts` to get supported city names
2. Query spot counts from Supabase via MCP (`mcp__supabase__execute_sql`):
```sql
SELECT city, COUNT(*) as spots,
  COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as with_embeddings
FROM spots
GROUP BY city
ORDER BY spots DESC;
```
3. Merge with CITY_DEFAULTS to show unsupported cities (in DB but no defaults entry)
4. Output as markdown table: City | Country | Spots | Embeddings %

---

### `audit <CityName>`

Full coverage report for an existing city.

1. Run audit SQL via Supabase MCP:
```sql
SELECT
  COUNT(*) as total_spots,
  COUNT(CASE WHEN 'breakfast' = ANY(categories) THEN 1 END) as breakfast,
  COUNT(CASE WHEN 'lunch' = ANY(categories) THEN 1 END) as lunch,
  COUNT(CASE WHEN 'dinner' = ANY(categories) THEN 1 END) as dinner,
  COUNT(CASE WHEN 'cafe' = ANY(categories) THEN 1 END) as cafe,
  COUNT(CASE WHEN 'activity' = ANY(categories) THEN 1 END) as activity,
  COUNT(CASE WHEN 'nightlife' = ANY(categories) THEN 1 END) as nightlife,
  COUNT(CASE WHEN 'market' = ANY(categories) THEN 1 END) as market,
  COUNT(CASE WHEN must_go = true THEN 1 END) as tier1_must_go,
  COUNT(CASE WHEN verified = true AND must_go = false THEN 1 END) as tier2_verified,
  COUNT(CASE WHEN verified = false AND must_go = false THEN 1 END) as tier3_unverified,
  COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as with_embeddings,
  COUNT(CASE WHEN last_verified > NOW() - INTERVAL '180 days' THEN 1 END) as recently_verified,
  COUNT(CASE WHEN opening_hours IS NOT NULL THEN 1 END) as with_hours,
  COUNT(CASE WHEN price_range IS NOT NULL THEN 1 END) as with_price_range,
  COUNT(CASE WHEN latitude IS NOT NULL THEN 1 END) as with_coordinates
FROM spots
WHERE city = '<CityName>';
```

2. Format as a coverage report:

```
## Kuala Lumpur — Coverage Audit

Category Coverage:
  breakfast: 82  |  lunch: 76  |  dinner: 134
  cafe: 91       |  activity: 45  |  nightlife: 28  |  market: 12

Quality:
  Tier 1 (must-go): 89   Tier 2 (verified): 301   Tier 3 (unverified): 114
  With embeddings: 87%   Recently verified: 34%
  With hours: 62%        With price range: 71%     With coordinates: 78%
```

3. Flag gaps (warn if any of these are true):
   - Any category has < 5 spots → "⚠ Low coverage: market (12 spots)"
   - Embeddings < 70% → "⚠ Run backfill-embeddings to improve semantic search"
   - Recently verified < 30% → "⚠ Many spots may be stale — consider a verification pass"

---

### `add <CityName>`

Scaffold a new city entry so Sam can start covering it.

#### Step 1 — Add to city-defaults.ts

Read `packages/bot/src/utils/city-defaults.ts`, then add a new entry to `CITY_DEFAULTS`:

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

Use web search to find the correct timezone and center coordinates if needed.

#### Step 2 — Create seed stub

Read an existing seed file (`packages/bot/src/seeds/kl.ts`) as a template, then create `packages/bot/src/seeds/<city-slug>.ts`.

The stub should have:
- 3-5 placeholder spots (real places you know exist, minimal data)
- A `seed()` function following the same pattern as kl.ts
- A comment at the top: `// Seed stub for <CityName> — expand with research`

#### Step 3 — Verify

Check that the city doesn't already have spots in the DB:
```sql
SELECT COUNT(*) FROM spots WHERE city = '<CityName>';
```

#### Step 4 — Report

Summarize what was created and the next steps:
1. Run seed: `npm run seed` (after filling in real spots)
2. Backfill embeddings: `npm run backfill-embeddings -w @sam/bot`
3. Run audit: `/city audit <CityName>`
4. Add area → city mappings to `AREA_CITY_MAP` in `city-defaults.ts` if needed

---

## Key Files

| File | Purpose |
|---|---|
| `packages/bot/src/utils/city-defaults.ts` | CITY_DEFAULTS, getCityDefaults, isSupportedCity, AREA_CITY_MAP |
| `packages/bot/src/seeds/<city>.ts` | Seed data for each city |
| `packages/bot/src/utils/categories.ts` | Global category mappings (no per-city changes needed) |

## Supabase MCP Fallback

If MCP is unavailable, use:
```bash
npx tsx --env-file .env.local -e "
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
const { data } = await sb.from('spots').select('city, count').eq('city', '<CityName>');
console.log(JSON.stringify(data));
"
```
