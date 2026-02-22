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
| `20260219_000000_spot_contributions.sql` | Per-contributor attribution table — tracks each contributor's specific notes (what_to_order, pro_tips, etc.) separately from the aggregated spots arrays | pending |
| `20260219_010000_add_travelers_user_type_home_areas.sql` | Add missing `user_type` (text, default 'unknown', CHECK constraint) and `home_areas` (text[]) columns to travelers — fixes proactive scheduler silently returning no travelers | applied via MCP |
| `20260219_020000_enable_rls_spot_contributions.sql` | Enable RLS on spot_contributions; add public read policy — closes security gap where anon key had unrestricted write access | applied via MCP |
| `20260219_030000_fix_security_and_perf_advisors.sql` | Fix function search paths (daily_stats, match_spots); scope RLS policies to service_role only; add missing FK indexes (feedback.traveler_id, spots.contributor_id) | applied via MCP |
| `20260219_040000_add_contribution_count.sql` | Add contribution_count integer column to spots; backfill from spot_contributions | applied via MCP |
| `20260219_050000_add_country_to_spots.sql` | Add country text column to spots; backfill from city mappings — removes hardcoded CITY_TO_COUNTRY map in web package | applied via MCP |
| `20260220_000000_clear_stale_operational_data.sql` | Clear opening_hours and payment_methods from all spots — both fields are now fetched live from web search, seeded values are stale noise | pending |
| `20260220_010000_atomic_helpers.sql` | Atomic RPC helpers: append_conversation_messages (row-locked append), increment_spot_use_count, increment_spot_contribution_count — eliminates read-modify-write race conditions | applied via MCP |
| `20260220_200000_category_text_to_categories_array.sql` | Migrate spots.category (text) → categories (text[]); split 4 pipe-hacked rows on \|; update match_spots RPC to filter with array overlap (&&) | applied via MCP |
| `20260221_000000_add_avg_rating_to_spots.sql` | Add avg_rating (numeric 3,2) to spots; index; backfill from existing feedback | applied via MCP |
| `20260222_000000_backfill_spot_coordinates_from_area_centroid.sql` | Backfill lat/lng for 42 spots missing coordinates using area-centroid averages — reduced null count from 42 to 19 (spots in areas with no geocoded peers remain null) | applied via MCP |
| `20260222_010000_drop_dead_columns.sql` | Drop 5 dead columns: spots.payment_methods, spots.opening_hours (both always NULL since 20260220 clear), spots.google_pin_accurate (never used), spots.last_verified (replaced by created_at for staleness), travelers.trips_taken (never used) | applied via MCP |
| `20260222_020000_rename_misleading_columns.sql` | Rename misleading columns: travelers.spots_visited→spots_recommended, spots.use_count→recommendation_count, spots.source→input_method (remap llm_verified→generate), feedback.did_they_go→visited, contributors.spots_contributed→contribution_count, spot_contributions.is_must_go→must_go; replace increment_spot_use_count RPC with increment_recommendation_count | applied via MCP |
