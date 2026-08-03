-- Phase 7 — enrol saved items into the refresh schedule (BUILD_PLAN.md §14.1–2).
--
-- Nothing called enqueue_refresh_job, so refresh_jobs stayed empty and the worker had nothing to
-- do. Enrolment happens here, on item insert, rather than from the client: the save path is the
-- extension, and importing the refresh package there risks pulling node-only code (safeFetch's
-- node:dns, ipaddr.js) into the MV3 bundle. A trigger keeps it server-side and automatic.
--
-- The strategy rule mirrors packages/refresh `classifyRefresh` — the client-rendered brand-adapter
-- sites (amazon, wayfair, stockx), whose public HTML has no price, are browser_required; everything
-- else is public_fetch, and the fetch pipeline's backoff downgrades a wrong guess. Kept inline (a
-- trigger function, absent from the generated types) so there is no second typed surface to sync;
-- the two definitions are three names each and cross-referenced.

create or replace function public.enroll_item_refresh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.refresh_jobs (item_id, strategy, next_run_at)
  values (
    new.id,
    case
      when coalesce(new.extractor_id, '') in ('amazon', 'wayfair', 'stockx')
        or lower(coalesce(new.domain, '')) ~ '(^|\.)(amazon|wayfair|stockx)\.com$'
      then 'browser_required'::public.refresh_strategy
      else 'public_fetch'::public.refresh_strategy
    end,
    now() + public.refresh_base_interval()
  )
  on conflict (item_id) do nothing;
  return new;
end;
$$;

comment on function public.enroll_item_refresh is
  'AFTER INSERT on items: enrols the item into refresh_jobs with a strategy mirroring '
  'packages/refresh classifyRefresh. Runs as owner so it may write the system-internal table.';

create trigger items_enroll_refresh
  after insert on public.items
  for each row execute function public.enroll_item_refresh();
