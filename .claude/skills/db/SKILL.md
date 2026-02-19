---
description: Quick database queries against Sam's Supabase knowledge graph
argument: Natural language query (e.g. "spots in Bangsar", "count by category", "stats")
allowed-tools: Bash
---

# /db — Quick Database Queries

You are a database assistant for Sam's travel intelligence knowledge graph in Supabase.

## Input

The user provides a natural language query as the argument: `$ARGUMENTS`

## Shortcuts

- **"spots"** or **"all"** → `SELECT name, area, category, tier, price_range FROM spots ORDER BY area, category`
- **"stats"** → Run all of these and format as a summary:
  - `SELECT COUNT(*) FROM spots`
  - `SELECT category, COUNT(*) FROM spots GROUP BY category ORDER BY count DESC`
  - `SELECT area, COUNT(*) FROM spots GROUP BY area ORDER BY count DESC`
  - `SELECT tier, COUNT(*) FROM spots GROUP BY tier ORDER BY tier`
  - `SELECT COUNT(*) FROM travelers`
  - `SELECT COUNT(*) FROM contributors`

## Process

1. Translate the natural language query to SQL against Sam's schema
2. Run the query using the Supabase MCP server (`supabase` → use the `execute_sql` tool)
3. If the Supabase MCP is not available, fall back to querying via the Supabase JS client:
```bash
npx tsx --env-file .env.local -e "
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
const { data, error } = await sb.from('spots').select('name, area, category, tier, price_range');
if (error) { console.error(error); process.exit(1); }
console.log(JSON.stringify(data, null, 2));
"
```
   Adapt the `.from()` / `.select()` / `.eq()` calls to match the query. The project uses `@supabase/supabase-js` and env vars are in `.env.local` (`SUPABASE_URL`, `SUPABASE_KEY`). Use `npx tsx --env-file .env.local` to load env vars without needing dotenv.
4. Format results as a readable markdown table

## Schema Reference

**spots**: id, name, city, area, category (breakfast|lunch|dinner|cafe|activity|nightlife|market), tier (1-3), address, latitude, longitude, google_pin_accurate, payment_methods[], opening_hours, price_range ($|$$|$$$), what_to_order[], what_to_skip[], pro_tips[], vibe (casual|upscale|chaotic|chill|local|touristy), weather_dependent, best_time_of_day, indoor_outdoor, contributor_id, confidence_score, use_count, source (seed|voice|text|llm_verified|manual), last_verified

**spot_contributions**: id, spot_id, contributor_id, what_to_order[], what_to_skip[], pro_tips[], vibe, tier, created_at

**travelers**: id, whatsapp_number, name, user_type (local|traveler|unknown), home_areas[], preferences (jsonb), dietary_restrictions[], current_city, trip_dates (jsonb), travel_party, first_time_visitor, spots_visited[], spots_liked[], spots_disliked[], trips_taken

**contributors**: id, whatsapp_number, name, cities_contributed[], spots_contributed

**conversations**: id, whatsapp_number, current_flow, flow_state, messages

**feedback**: id, spot_id, traveler_id, rating (1-5), did_they_go, comments, user_tips[]

**events**: id, session_id, channel (web|whatsapp), event_type, event_data (jsonb), created_at

## Output

Always format results as a clean markdown table. Include a row count at the bottom.
