-- Phase 2B — atomic capture ingestion (BUILD_PLAN.md §8.3).
--
-- One transaction inside Postgres rather than several client-side writes: validate the
-- caller, confirm edit access, normalize, find an existing item by fingerprint, insert or
-- refresh it, and append an observation only when something actually changed.
--
-- The function is SECURITY DEFINER because it writes `item_observations`, which no client
-- may write directly — price history a browser can rewrite is not history. Access control
-- is therefore explicit in the body, not delegated to RLS.

-- How stale the newest observation must be before an unchanged re-observation is recorded
-- anyway. Without this, revisiting a page daily would write an identical row every time;
-- without an upper bound, a price that never changes would have no evidence of being
-- checked.
create or replace function public.observation_refresh_interval()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '12 hours' $$;

/**
 * Parse a decimal money string into numeric.
 *
 * Rejects anything that is not a plain decimal, so a locale-formatted string that escaped
 * client-side normalization fails loudly instead of being silently truncated by a cast.
 */
create or replace function public.parse_money(p_value text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;

  if p_value !~ '^-?\d+(\.\d+)?$' then
    raise exception 'Money value % is not a decimal string', p_value
      using errcode = 'invalid_text_representation';
  end if;

  return p_value::numeric;
end;
$$;

create or replace function public.ingest_product_capture(
  p_capture jsonb,
  p_cart_id uuid,
  p_fingerprint text,
  p_user_fields jsonb default '{}'::jsonb,
  p_source public.observation_source default 'capture'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_now timestamptz := now();

  v_title text;
  v_domain text;
  v_source_url text;
  v_canonical_url text;
  v_retailer_name text;
  v_price numeric(20, 6);
  v_original_price numeric(20, 6);
  v_currency text;
  v_availability public.item_availability;
  v_selected_variant jsonb;
  v_identifiers jsonb;
  v_observed_at timestamptz;

  v_existing public.items%rowtype;
  v_item public.items%rowtype;
  v_created boolean := false;
  v_observation_inserted boolean := false;
  v_last public.item_observations%rowtype;
begin
  -- 1. Authenticated caller.
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- 2. Edit access to the destination cart.
  if not public.can_edit_cart(p_cart_id) then
    raise exception 'No edit access to cart %', p_cart_id using errcode = 'insufficient_privilege';
  end if;

  -- 3. Schema version. A payload this build does not understand is rejected, not guessed at.
  if coalesce((p_capture -> 'schemaVersion')::text, '') <> '1' then
    raise exception 'Unsupported capture schemaVersion %', p_capture -> 'schemaVersion'
      using errcode = 'feature_not_supported';
  end if;

  -- 4. Fingerprint shape. The value is computed by the client from the normalized URL,
  -- the selected variant, and the primary identifier; the server verifies its shape and
  -- scopes it to the cart, so a malformed or hostile value can only affect the caller's
  -- own cart deduplication.
  if p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Fingerprint must be a lowercase hex SHA-256'
      using errcode = 'invalid_text_representation';
  end if;

  -- 5. Required and normalized fields. The user may have corrected the title before
  -- saving, in which case their value wins over the extractor's.
  v_title := btrim(
    coalesce(
      nullif(btrim(p_user_fields ->> 'title'), ''),
      nullif(btrim(p_capture -> 'product' ->> 'title'), '')
    )
  );
  if v_title is null or v_title = '' then
    raise exception 'A capture needs a title before it can be saved'
      using errcode = 'not_null_violation';
  end if;

  v_source_url := nullif(btrim(p_capture -> 'source' ->> 'url'), '');
  v_domain := nullif(btrim(p_capture -> 'source' ->> 'domain'), '');
  if v_source_url is null or v_domain is null then
    raise exception 'A capture needs a source URL and domain'
      using errcode = 'not_null_violation';
  end if;

  v_canonical_url := nullif(btrim(p_capture -> 'source' ->> 'canonicalUrl'), '');
  v_retailer_name := coalesce(nullif(btrim(p_capture -> 'source' ->> 'retailerName'), ''), v_domain);

  v_price := public.parse_money(
    coalesce(p_user_fields ->> 'priceAmount', p_capture -> 'offer' ->> 'priceAmount')
  );
  v_original_price := public.parse_money(p_capture -> 'offer' ->> 'originalPriceAmount');
  v_currency := upper(
    nullif(
      btrim(coalesce(p_user_fields ->> 'currency', p_capture -> 'offer' ->> 'currency')),
      ''
    )
  );
  v_availability := coalesce(
    nullif(p_capture -> 'offer' ->> 'availability', '')::public.item_availability,
    'unknown'
  );
  v_selected_variant := coalesce(p_capture -> 'selectedVariant', '{}'::jsonb);
  v_identifiers := coalesce(p_capture -> 'product' -> 'identifiers', '{}'::jsonb);
  v_observed_at := coalesce(
    (p_capture -> 'extraction' ->> 'observedAt')::timestamptz,
    v_now
  );

  -- 6. An existing active item with the same fingerprint in this cart.
  select * into v_existing
  from public.items
  where cart_id = p_cart_id
    and fingerprint = p_fingerprint
    and status <> 'archived'
  limit 1;

  if v_existing.id is null then
    -- 7a. Create. User-authored fields come from p_user_fields, defaults otherwise.
    insert into public.items (
      cart_id, created_by,
      status, quantity, note, priority, desired_price,
      source_url, canonical_url, domain, retailer_name,
      title, brand, description, image_url,
      currency, current_price, original_price, availability,
      selected_variant, identifiers,
      fingerprint, extractor_id, extractor_version, extraction_confidence, last_observed_at
    )
    values (
      p_cart_id, v_user_id,
      coalesce(nullif(p_user_fields ->> 'status', '')::public.item_status, 'saved'),
      coalesce((p_user_fields ->> 'quantity')::integer, 1),
      nullif(btrim(p_user_fields ->> 'note'), ''),
      coalesce(nullif(p_user_fields ->> 'priority', '')::public.item_priority, 'normal'),
      public.parse_money(p_user_fields ->> 'desiredPrice'),
      v_source_url, v_canonical_url, v_domain, v_retailer_name,
      v_title,
      nullif(btrim(p_capture -> 'product' ->> 'brand'), ''),
      nullif(btrim(p_capture -> 'product' ->> 'description'), ''),
      nullif(btrim(p_capture -> 'product' ->> 'selectedImageUrl'), ''),
      v_currency, v_price, v_original_price, v_availability,
      v_selected_variant, v_identifiers,
      p_fingerprint,
      p_capture -> 'extraction' ->> 'extractorId',
      p_capture -> 'extraction' ->> 'extractorVersion',
      (p_capture -> 'extraction' ->> 'overallConfidence')::real,
      v_observed_at
    )
    returning * into v_item;

    v_created := true;
  else
    -- 7b. Refresh. Only retailer-observed columns are written: note, quantity, priority,
    -- desired_price, and status are the user's and survive untouched (BUILD_PLAN.md §13.2).
    update public.items
    set
      source_url = v_source_url,
      canonical_url = coalesce(v_canonical_url, canonical_url),
      retailer_name = v_retailer_name,
      title = v_title,
      brand = coalesce(nullif(btrim(p_capture -> 'product' ->> 'brand'), ''), brand),
      description = coalesce(
        nullif(btrim(p_capture -> 'product' ->> 'description'), ''),
        description
      ),
      image_url = coalesce(
        nullif(btrim(p_capture -> 'product' ->> 'selectedImageUrl'), ''),
        image_url
      ),
      currency = coalesce(v_currency, currency),
      current_price = coalesce(v_price, current_price),
      original_price = coalesce(v_original_price, original_price),
      availability = case when v_availability = 'unknown' then availability else v_availability end,
      selected_variant = v_selected_variant,
      identifiers = case
        when v_identifiers = '{}'::jsonb then identifiers
        else identifiers || v_identifiers
      end,
      extractor_id = p_capture -> 'extraction' ->> 'extractorId',
      extractor_version = p_capture -> 'extraction' ->> 'extractorVersion',
      extraction_confidence = (p_capture -> 'extraction' ->> 'overallConfidence')::real,
      last_observed_at = v_observed_at
    where id = v_existing.id
    returning * into v_item;
  end if;

  -- 8. Observation, only when something tracked changed or the last one is stale.
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
      v_item.id, v_observed_at, v_price, v_original_price, v_currency, v_availability,
      p_source,
      p_capture -> 'extraction' ->> 'extractorId',
      p_capture -> 'extraction' ->> 'extractorVersion',
      (p_capture -> 'extraction' ->> 'overallConfidence')::real
    );

    v_observation_inserted := true;
  end if;

  -- 9. The canonical saved item, and what happened to it.
  return jsonb_build_object(
    'created', v_created,
    'observationInserted', v_observation_inserted,
    'item', to_jsonb(v_item)
  );
end;
$$;

comment on function public.ingest_product_capture is
  'Atomically saves or refreshes a ProductCaptureV1 in a cart. Refreshing never overwrites '
  'user-authored fields. Returns { created, observationInserted, item }.';

revoke all on function public.ingest_product_capture(jsonb, uuid, text, jsonb, public.observation_source) from public;
grant execute on function public.ingest_product_capture(jsonb, uuid, text, jsonb, public.observation_source) to authenticated;

revoke all on function public.parse_money(text) from public;
revoke all on function public.observation_refresh_interval() from public;
