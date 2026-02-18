-- RPC: Global aggregate stats for the landing page counter
-- Returns { spot_count, contributor_count } across ALL cities
-- Replaces the city-filtered get_city_stats for the landing page

create or replace function get_global_stats()
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'spot_count', (select count(*)::int from spots),
    'contributor_count', (select count(distinct contributor_id)::int from spots where contributor_id is not null)
  );
$$;

grant execute on function get_global_stats() to anon;
