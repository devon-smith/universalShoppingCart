-- Phase 7 — notification events (BUILD_PLAN.md §15).
--
-- The store behind in-app notifications: one row per alert that actually fired, with the value
-- that triggered it. The decision to fire is made by the worker (packages/refresh, evaluateAlerts)
-- on a state transition, which is the deduplication — this table only records the result. Writing
-- is the worker's alone (service_role, via record_notification); reading is the user's, scoped to
-- items in carts they can read.

create type public.notification_type as enum (
  'price_below_desired',
  'back_in_stock',
  'became_unavailable'
);

create table public.notification_events (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.items(id) on delete cascade,
  type public.notification_type not null,
  observed_value text,
  currency text,
  created_at timestamptz not null default now(),
  seen_at timestamptz
);

comment on table public.notification_events is
  'One row per fired alert, with the triggering value. Written by service_role; read by the user '
  'for items in carts they can read.';

create index notification_events_item_idx
  on public.notification_events (item_id, created_at desc);

alter table public.notification_events enable row level security;

-- A user sees alerts for items in any cart they can read. No insert/update/delete for clients;
-- the worker writes through record_notification below.
create policy notification_events_select_readable
  on public.notification_events for select
  to authenticated
  using (
    exists (
      select 1
      from public.items i
      where i.id = notification_events.item_id
        and public.can_read_cart(i.cart_id)
    )
  );

-- Record a fired alert. service_role only — the worker has already decided (via the transition
-- rule) that this alert should fire; this just persists it.
create or replace function public.record_notification(
  p_item_id uuid,
  p_type public.notification_type,
  p_observed_value text default null,
  p_currency text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.notification_events%rowtype;
begin
  if not exists (select 1 from public.items where id = p_item_id) then
    raise exception 'No item %', p_item_id using errcode = 'no_data_found';
  end if;

  insert into public.notification_events (item_id, type, observed_value, currency)
  values (p_item_id, p_type, nullif(btrim(p_observed_value), ''), nullif(btrim(p_currency), ''))
  returning * into v_event;

  return to_jsonb(v_event);
end;
$$;

comment on function public.record_notification is
  'System path (service_role only): persists one fired alert. Returns the event row.';

revoke all on function public.record_notification(
  uuid, public.notification_type, text, text
) from public;
grant execute on function public.record_notification(
  uuid, public.notification_type, text, text
) to service_role;
