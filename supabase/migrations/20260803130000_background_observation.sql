-- Phase 7 — record a background observation (BUILD_PLAN.md §14.2, §7.5).
--
-- `ingest_product_capture` already records observations with suppression, but it is the user's
-- path: it authenticates with `auth.uid()`, checks edit access, and creates or refreshes an item
-- in a cart. The background refresh has no user — a worker fetches a public page and re-observes
-- an item that already exists — so it needs a system path.
--
-- `record_background_observation` refreshes one existing item's retailer-observed fields and
-- appends an observation, reusing the same suppression rule (`observation_refresh_interval`) and
-- the same `universal_cart.ingesting` marker the protect trigger looks for. It writes ONLY
-- observed columns, so a background refresh can never touch a note, quantity, priority, desired
-- price, or status (§13.2). It does no authorization of its own and is therefore granted to
-- `service_role` alone — never to `authenticated`, which would let any user rewrite any item's
-- observed history.
--
-- The worker calls this with a successfully parsed observation (a price it actually read); a
-- fetch or parse failure is the refresh scheduler's concern (backoff), not a null observation.

create or replace function public.record_background_observation(
  p_item_id uuid,
  p_price text default null,
  p_original_price text default null,
  p_currency text default null,
  p_availability text default null,
  p_extractor_id text default null,
  p_extractor_version text default null,
  p_confidence real default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_price numeric(20, 6) := public.parse_money(p_price);
  v_original_price numeric(20, 6) := public.parse_money(p_original_price);
  v_currency text := upper(nullif(btrim(p_currency), ''));
  v_availability public.item_availability :=
    coalesce(nullif(p_availability, '')::public.item_availability, 'unknown');
  v_item public.items%rowtype;
  v_last public.item_observations%rowtype;
  v_observation_inserted boolean := false;
begin
  -- Observed columns are about to be written legitimately, same marker the ingestion path uses.
  perform set_config('universal_cart.ingesting', 'on', true);

  update public.items
  set
    currency = coalesce(v_currency, currency),
    current_price = coalesce(v_price, current_price),
    original_price = coalesce(v_original_price, original_price),
    availability = case when v_availability = 'unknown' then availability else v_availability end,
    extractor_id = coalesce(p_extractor_id, extractor_id),
    extractor_version = coalesce(p_extractor_version, extractor_version),
    extraction_confidence = coalesce(p_confidence, extraction_confidence),
    last_observed_at = v_now
  where id = p_item_id
  returning * into v_item;

  if v_item.id is null then
    perform set_config('universal_cart.ingesting', 'off', true);
    raise exception 'No item %', p_item_id using errcode = 'no_data_found';
  end if;

  select * into v_last
  from public.item_observations
  where item_id = v_item.id
  order by observed_at desc
  limit 1;

  if
    v_last.id is null
    or v_last.price is distinct from v_price
    or v_last.original_price is distinct from v_original_price
    or v_last.currency is distinct from v_currency
    or v_last.availability is distinct from v_availability
    or v_last.observed_at < v_now - public.observation_refresh_interval()
  then
    insert into public.item_observations (
      item_id, observed_at, price, original_price, currency, availability,
      source, extractor_id, extractor_version, confidence
    )
    values (
      v_item.id, v_now, v_price, v_original_price, v_currency, v_availability,
      'background', p_extractor_id, p_extractor_version, p_confidence
    );

    v_observation_inserted := true;
  end if;

  perform set_config('universal_cart.ingesting', 'off', true);

  return jsonb_build_object(
    'observationInserted', v_observation_inserted,
    'item', to_jsonb(v_item)
  );
end;
$$;

comment on function public.record_background_observation is
  'System path (service_role only): refreshes one existing item''s observed fields and appends a '
  'background observation, with the same suppression as ingest. Never touches user-authored '
  'fields. Returns { observationInserted, item }.';

revoke all on function public.record_background_observation(
  uuid, text, text, text, text, text, text, real
) from public;
grant execute on function public.record_background_observation(
  uuid, text, text, text, text, text, text, real
) to service_role;
