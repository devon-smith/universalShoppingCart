-- Phase 4 — price change, in one query.
--
-- The dashboard needs, per item: the newest observation, and the most recent one before it
-- whose price actually differed. Fetching the whole observation series for every card
-- would be N+1 and would ship history the list never renders.
--
-- `security_invoker` makes the view run as the querying user, so Row Level Security on
-- `item_observations` applies exactly as it would to a direct select. A view without it
-- would run as its owner and leak every user's price history.

create view public.item_price_summary
with (security_invoker = on)
as
with ranked as (
  select
    o.item_id,
    o.price,
    o.original_price,
    o.currency,
    o.availability,
    o.observed_at,
    row_number() over (
      partition by o.item_id
      order by o.observed_at desc, o.id desc
    ) as rn
  from public.item_observations o
),
latest as (
  select * from ranked where rn = 1
),
-- The most recent earlier observation that recorded a *different* price. A run of
-- identical prices is one price, not several, so "changed since" means since it last moved.
previous as (
  select distinct on (r.item_id)
    r.item_id,
    r.price,
    r.observed_at
  from ranked r
  join latest l on l.item_id = r.item_id
  where r.rn > 1
    and r.price is distinct from l.price
  order by r.item_id, r.rn
)
select
  l.item_id,
  l.price as latest_price,
  l.original_price as latest_original_price,
  l.currency as latest_currency,
  l.availability as latest_availability,
  l.observed_at as latest_observed_at,
  p.price as previous_price,
  p.observed_at as previous_observed_at,
  (select count(*) from ranked r where r.item_id = l.item_id) as observation_count
from latest l
left join previous p on p.item_id = l.item_id;

comment on view public.item_price_summary is
  'Per item: the newest observation, and the last one before it at a different price. '
  'Runs as the querying user, so RLS on item_observations applies.';

grant select on public.item_price_summary to authenticated;
