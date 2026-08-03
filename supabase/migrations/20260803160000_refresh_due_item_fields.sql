-- Phase 7 fix — the due selector returns the item fields the worker needs.
--
-- The worker (POST /api/refresh) runs as service_role, which has no table privileges — only the
-- SECURITY DEFINER RPCs it is granted execute on. The original selector returned only
-- refresh_jobs rows, so the worker read `public.items` directly for the URL and prior state, and
-- service_role cannot: it fails with "permission denied for table items". Folding those fields
-- into the selector keeps the worker entirely on RPCs (no table grant to a role that bypasses
-- RLS) and removes a two-read race where an item could vanish between the job read and the item
-- read.
--
-- Return type is unchanged (jsonb array), so no generated-types change. The lock is `for update
-- of j` so only the refresh_jobs row is claimed, not the joined item.

create or replace function public.select_due_refresh_jobs(p_limit integer default 50)
returns jsonb language sql security definer set search_path = '' as $$
  with due as (
    select
      j.item_id,
      i.source_url,
      i.availability,
      i.current_price,
      i.desired_price,
      j.next_run_at
    from public.refresh_jobs j
    join public.items i on i.id = j.item_id
    where not j.disabled
      and j.strategy = 'public_fetch'
      and j.next_run_at <= now()
    order by j.next_run_at asc
    limit greatest(p_limit, 0)
    for update of j skip locked
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'item_id', due.item_id,
        'source_url', due.source_url,
        'availability', due.availability,
        -- Money as text so the exact decimal is not rounded into a JSON double.
        'current_price', due.current_price::text,
        'desired_price', due.desired_price::text
      )
      order by due.next_run_at
    ),
    '[]'::jsonb
  )
  from due;
$$;
