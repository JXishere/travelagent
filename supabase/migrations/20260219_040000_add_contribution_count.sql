alter table spots add column contribution_count integer default 0;

-- Backfill from existing spot_contributions rows; floor at 1 since every spot was contributed by someone
update spots s
set contribution_count = greatest(1, (
  select count(*) from spot_contributions sc where sc.spot_id = s.id
));
