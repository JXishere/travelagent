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
