-- Phase 7 — the background-refresh schedule (BUILD_PLAN.md §14.2).
--
-- One row per item: when it is next due, and the failure backoff that stops a broken page from
-- being hammered and disables it after repeated failures. The strategy comes from the TS
-- classifier (packages/refresh) and is stored so the selector can filter without recomputing it
-- in SQL. The table is system-internal — RLS is on with no policies, so only service_role and the
-- SECURITY DEFINER functions here touch it.

create type public.refresh_strategy as enum ('public_fetch', 'api', 'browser_required', 'disabled');

create table public.refresh_jobs (
  item_id uuid primary key references public.items(id) on delete cascade,
  strategy public.refresh_strategy not null default 'public_fetch',
  next_run_at timestamptz not null default now(),
  last_run_at timestamptz,
  last_ok boolean,
  consecutive_failures integer not null default 0,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.refresh_jobs is
  'Per-item background-refresh schedule. System-internal; written only by service_role functions.';

create index refresh_jobs_due_idx on public.refresh_jobs (next_run_at) where not disabled;

alter table public.refresh_jobs enable row level security;
-- Deliberately no policies: anon and authenticated get nothing; service_role bypasses RLS, and
-- the SECURITY DEFINER functions below run as owner.

-- Tunables as functions, so each is one definition.
create or replace function public.refresh_base_interval()
returns interval language sql immutable set search_path = '' as $$ select interval '24 hours' $$;

create or replace function public.refresh_max_failures()
returns integer language sql immutable set search_path = '' as $$ select 5 $$;

-- Enqueue or re-point a job. Re-enqueuing updates the strategy but keeps the existing schedule.
create or replace function public.enqueue_refresh_job(
  p_item_id uuid,
  p_strategy public.refresh_strategy default 'public_fetch'
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_job public.refresh_jobs%rowtype;
begin
  insert into public.refresh_jobs (item_id, strategy, next_run_at)
  values (p_item_id, p_strategy, now() + public.refresh_base_interval())
  on conflict (item_id) do update
    set strategy = excluded.strategy, updated_at = now()
  returning * into v_job;
  return to_jsonb(v_job);
end; $$;

-- Claim up to p_limit due public_fetch jobs, skipping any another worker already holds. Returns
-- a jsonb array (empty when nothing is due).
create or replace function public.select_due_refresh_jobs(p_limit integer default 50)
returns jsonb language sql security definer set search_path = '' as $$
  with due as (
    select *
    from public.refresh_jobs
    where not disabled
      and strategy = 'public_fetch'
      and next_run_at <= now()
    order by next_run_at asc
    limit greatest(p_limit, 0)
    for update skip locked
  )
  select coalesce(jsonb_agg(to_jsonb(due) order by due.next_run_at), '[]'::jsonb) from due;
$$;

-- Record a refresh outcome: success resets and reschedules; failure backs off exponentially
-- (capped at 7 days) and disables the job after refresh_max_failures() in a row.
create or replace function public.record_refresh_result(p_item_id uuid, p_ok boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_job public.refresh_jobs%rowtype;
  v_failures integer;
begin
  select * into v_job from public.refresh_jobs where item_id = p_item_id for update;
  if v_job.item_id is null then
    raise exception 'No refresh job for item %', p_item_id using errcode = 'no_data_found';
  end if;

  if p_ok then
    update public.refresh_jobs
    set consecutive_failures = 0,
        last_ok = true,
        last_run_at = now(),
        next_run_at = now() + public.refresh_base_interval(),
        updated_at = now()
    where item_id = p_item_id
    returning * into v_job;
  else
    v_failures := v_job.consecutive_failures + 1;
    update public.refresh_jobs
    set consecutive_failures = v_failures,
        last_ok = false,
        last_run_at = now(),
        next_run_at = now() + least(
          public.refresh_base_interval() * (2 ^ least(v_failures, 10))::integer,
          interval '7 days'
        ),
        disabled = (v_failures >= public.refresh_max_failures()),
        updated_at = now()
    where item_id = p_item_id
    returning * into v_job;
  end if;

  return to_jsonb(v_job);
end; $$;

revoke all on function public.refresh_base_interval() from public;
revoke all on function public.refresh_max_failures() from public;
revoke all on function public.enqueue_refresh_job(uuid, public.refresh_strategy) from public;
revoke all on function public.select_due_refresh_jobs(integer) from public;
revoke all on function public.record_refresh_result(uuid, boolean) from public;

grant execute on function public.enqueue_refresh_job(uuid, public.refresh_strategy) to service_role;
grant execute on function public.select_due_refresh_jobs(integer) to service_role;
grant execute on function public.record_refresh_result(uuid, boolean) to service_role;
