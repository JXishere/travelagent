---
description: Query Sam's usage analytics from the events table
argument: Shortcut keyword (today | week | funnel | cities | contributors)
allowed-tools: Bash
---

# /analytics — Sam Usage Analytics

Pre-baked analytics queries on the `events` table in Supabase.

## Input

Shortcut: `$ARGUMENTS`

## Shortcuts

| Shortcut | What it shows |
|---|---|
| `today` | Intents by count, unique sessions, channel split (web vs whatsapp), new users today |
| `week` | 7-day rolling: messages/day, sessions/day, top intents |
| `funnel` | Contribution funnel: started → confirmed → saved (with drop-off %) |
| `cities` | Spot use_count by city, total recommendations served per city |
| `contributors` | Top 10 contributors by spots_contributed, with cities_contributed |

## Process

### 1. Identify Project

Use the Supabase MCP to find the project:
- Call `mcp__supabase__list_projects` to get the project ID

### 2. Run SQL

Use `mcp__supabase__execute_sql` with the relevant SQL below.

If Supabase MCP is unavailable, fall back to:
```bash
npx tsx --env-file .env.local -e "
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
const { data, error } = await sb.rpc('...');  // or sb.from('events').select(...)
console.log(JSON.stringify(data, null, 2));
"
```

### SQL Queries

**today:**
```sql
SELECT
  event_type,
  channel,
  COUNT(*) as count,
  COUNT(DISTINCT session_id) as unique_sessions
FROM events
WHERE created_at >= CURRENT_DATE
GROUP BY event_type, channel
ORDER BY count DESC;
```
Also run:
```sql
SELECT COUNT(DISTINCT whatsapp_number) as new_users
FROM travelers
WHERE created_at >= CURRENT_DATE;
```

**week:**
```sql
SELECT
  DATE_TRUNC('day', created_at)::date as day,
  COUNT(*) as messages,
  COUNT(DISTINCT session_id) as sessions,
  COUNT(DISTINCT CASE WHEN channel = 'web' THEN session_id END) as web_sessions,
  COUNT(DISTINCT CASE WHEN channel = 'whatsapp' THEN session_id END) as wa_sessions
FROM events
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY day
ORDER BY day;
```

**funnel:**
```sql
SELECT
  COUNT(CASE WHEN event_type = 'flow_complete' AND event_data->>'flow' = 'contribution_started' THEN 1 END) as started,
  COUNT(CASE WHEN event_type = 'flow_complete' AND event_data->>'flow' = 'contribution_confirmed' THEN 1 END) as confirmed,
  COUNT(CASE WHEN event_type = 'flow_complete' AND event_data->>'flow' = 'contribution_saved' THEN 1 END) as saved
FROM events
WHERE created_at >= NOW() - INTERVAL '30 days';
```

**cities:**
```sql
SELECT
  city,
  COUNT(*) as total_spots,
  COALESCE(SUM(use_count), 0) as total_recommendations
FROM spots
GROUP BY city
ORDER BY total_recommendations DESC;
```

**contributors:**
```sql
SELECT
  name,
  spots_contributed,
  array_length(cities_contributed, 1) as city_count,
  cities_contributed
FROM contributors
ORDER BY spots_contributed DESC
LIMIT 10;
```

### 3. Format Output

Present results as a clean markdown table. Add a **one-line insight** at the bottom:
- `today`: "X sessions today, Y% web / Z% WhatsApp"
- `week`: "Peak day: [day] with X messages"
- `funnel`: "Contribution funnel: X% completion rate (started → saved)"
- `cities`: "Most recommended city: [city] with X total recs"
- `contributors`: "Top contributor: [name] with X spots across Y cities"

## Events Schema

```
events: id, session_id, channel (web|whatsapp), event_type, event_data (jsonb), created_at

Common event_types:
  message              — every message (event_data: { intent })
  recommendation       — spot recs (event_data: { spot_ids, spot_names, categories, area })
  flow_complete        — flow finished (event_data: { flow })
  unsupported_city_request — user asked about unsupported city (event_data: { city })
```
