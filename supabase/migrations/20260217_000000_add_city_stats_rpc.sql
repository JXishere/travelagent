-- RPC: Aggregate city stats for the landing page counter
-- Returns { spot_count, contributor_count } for a given city
-- SECURITY DEFINER so anon key can call it without row-level access

create or replace function get_city_stats(target_city text default 'Kuala Lumpur')
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'spot_count', (select count(*)::int from spots where city = target_city),
    'contributor_count', (select count(distinct contributor_id)::int from spots where city = target_city and contributor_id is not null)
  );
$$;

grant execute on function get_city_stats(text) to anon;
