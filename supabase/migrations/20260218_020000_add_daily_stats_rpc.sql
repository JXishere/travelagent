-- daily_stats() — Analytics summary function
-- Returns one row per day with session counts, message splits, top intent, etc.
-- Usage: select * from daily_stats('2026-02-18', '2026-02-25')

create or replace function daily_stats(
  from_date date default (now() - interval '7 days')::date,
  to_date date default now()::date
)
returns table (
  day date,
  unique_sessions bigint,
  total_messages bigint,
  web_messages bigint,
  whatsapp_messages bigint,
  top_intent text,
  recommendations bigint,
  flow_completions bigint
)
language sql stable
as $$
  select
    d.day,
    count(distinct e.session_id) as unique_sessions,
    count(*) filter (where e.event_type = 'message') as total_messages,
    count(*) filter (where e.event_type = 'message' and e.channel = 'web') as web_messages,
    count(*) filter (where e.event_type = 'message' and e.channel = 'whatsapp') as whatsapp_messages,
    (
      select e2.event_data->>'intent'
      from events e2
      where e2.created_at::date = d.day
        and e2.event_type = 'message'
        and e2.event_data->>'intent' is not null
      group by e2.event_data->>'intent'
      order by count(*) desc
      limit 1
    ) as top_intent,
    count(*) filter (where e.event_type = 'recommendation') as recommendations,
    count(*) filter (where e.event_type = 'flow_complete') as flow_completions
  from generate_series(from_date, to_date, '1 day'::interval) as d(day)
  left join events e on e.created_at::date = d.day
  group by d.day
  order by d.day;
$$;
