# Database Migrations

## Naming Convention

```
YYYYMMDD_HHMMSS_description.sql
```

Example: `20260216_000000_initial_schema.sql`

## Running Migrations

Paste the SQL into the Supabase SQL Editor at:
`https://supabase.com/dashboard/project/<project-id>/sql/new`

Or use the migration runner:
```bash
npm run migrate
```

## Migration Log

| File | Description | Applied |
|------|-------------|---------|
| `20260216_000000_initial_schema.sql` | Initial tables: contributors, spots, travelers, conversations, feedback + indexes + RLS | pending |
| `20260216_010000_add_spot_source.sql` | Add source column to spots table | pending |
| `20260217_000000_add_city_stats_rpc.sql` | RPC function for landing page counter (spot + contributor counts) | pending |
| `20260218_000000_add_embeddings.sql` | pgvector extension, embedding column on spots, match_spots RPC for semantic search | pending |
| `20260218_010000_rls_policies.sql` | Replace blanket RLS with proper role-based policies (public read for spots/contributors, service-role only for travelers/conversations/feedback) | pending |
| `20260218_020000_add_daily_stats_rpc.sql` | RPC function for analytics dashboard (daily sessions, messages by channel, top intent, recommendations, flow completions) | pending |
| `20260218_030000_rename_neighborhood_to_area.sql` | Rename spots.neighborhood → area, travelers.home_neighborhoods → home_areas, recreate index + match_spots RPC | pending |
| `20260218_040000_global_stats_rpc.sql` | Global stats RPC for landing page — counts all spots across cities, not just one | pending |
