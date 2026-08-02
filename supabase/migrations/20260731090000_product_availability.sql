-- The second availability fact, persisted.
--
-- docs/DECISIONS.md (2026-07-27): `availability` describes the selected variant, and the
-- capture carries a separate `productAvailability` when the page makes a *different*
-- product-level claim — Nike still sells this shoe, your 6.5 is gone. The capture contract
-- and the pipeline have emitted the pair since then; this migration stops the database from
-- dropping the second half. Without it the extension shows both facts at capture time and
-- the dashboard can never show them again.
--
-- `item_observations` deliberately does not get the column. History's job is "what was the
-- thing I want to buy doing over time", and that is the resolved, variant-first
-- availability the observations already record. The product-level claim matters as a
-- *current* annotation on the item card, not as a second time series — and it can be added
-- later without rewriting anything if alerts prove otherwise.

alter table public.items
  add column product_availability public.item_availability;

comment on column public.items.product_availability is
  'The page''s product-level availability claim, kept only when it differs from '
  '`availability` (which describes the selected variant). Null means the page made no '
  'separate product-level claim, or the two agree.';

-- A retailer-observed column, so a client must not be able to write it.
create or replace function public.reject_observed_field_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Set by ingest_product_capture for the duration of its transaction.
  if coalesce(current_setting('universal_cart.ingesting', true), '') = 'on' then
    return new;
  end if;

  -- A client update silently keeps the observed values rather than failing: the UI sends
  -- whole rows, and rejecting an unchanged observed column would make every edit an error.
  new.source_url := old.source_url;
  new.canonical_url := old.canonical_url;
  new.domain := old.domain;
  new.retailer_name := old.retailer_name;
  new.title := old.title;
  new.brand := old.brand;
  new.description := old.description;
  new.image_url := old.image_url;
  new.currency := old.currency;
  new.current_price := old.current_price;
  new.original_price := old.original_price;
  new.availability := old.availability;
  new.product_availability := old.product_availability;
  new.selected_variant := old.selected_variant;
  new.identifiers := old.identifiers;
  new.fingerprint := old.fingerprint;
  new.extractor_id := old.extractor_id;
  new.extractor_version := old.extractor_version;
  new.extraction_confidence := old.extraction_confidence;
  new.last_observed_at := old.last_observed_at;

  return new;
end;
$$;

-- Re-declare the ingestion function. The body is identical to 20260726160000 except for
-- the product_availability handling, marked below.
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
  v_product_availability public.item_availability;
  v_selected_variant jsonb;
  v_identifiers jsonb;
  v_observed_at timestamptz;

  v_existing public.items%rowtype;
  v_item public.items%rowtype;
  v_created boolean := false;
  v_observation_inserted boolean := false;
  v_last public.item_observations%rowtype;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if not public.can_edit_cart(p_cart_id) then
    raise exception 'No edit access to cart %', p_cart_id using errcode = 'insufficient_privilege';
  end if;

  if coalesce((p_capture -> 'schemaVersion')::text, '') <> '1' then
    raise exception 'Unsupported capture schemaVersion %', p_capture -> 'schemaVersion'
      using errcode = 'feature_not_supported';
  end if;

  if p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Fingerprint must be a lowercase hex SHA-256'
      using errcode = 'invalid_text_representation';
  end if;

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
  -- No coalesce to 'unknown': absent means the page made no separate product-level claim,
  -- and null is that statement. The capture only carries the key when the claim differs.
  v_product_availability :=
    nullif(p_capture -> 'offer' ->> 'productAvailability', '')::public.item_availability;
  v_selected_variant := coalesce(p_capture -> 'selectedVariant', '{}'::jsonb);
  v_identifiers := coalesce(p_capture -> 'product' -> 'identifiers', '{}'::jsonb);
  v_observed_at := coalesce((p_capture -> 'extraction' ->> 'observedAt')::timestamptz, v_now);

  -- Observed columns are about to be written legitimately.
  perform set_config('universal_cart.ingesting', 'on', true);

  select * into v_existing
  from public.items
  where cart_id = p_cart_id
    and fingerprint = p_fingerprint
    and status <> 'archived'
  limit 1;

  if v_existing.id is null then
    insert into public.items (
      cart_id, created_by,
      status, quantity, note, priority, desired_price,
      source_url, canonical_url, domain, retailer_name,
      title, brand, description, image_url,
      currency, current_price, original_price, availability, product_availability,
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
      v_currency, v_price, v_original_price, v_availability, v_product_availability,
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
      -- The pair moves together. A capture that knows nothing about availability keeps
      -- both old halves; one that does replaces both — including replacing the second
      -- half with null, because null is the capture saying the two facts now agree, and
      -- keeping the old value would assert a disagreement that no longer exists.
      product_availability = case
        when v_availability = 'unknown' then product_availability
        else v_product_availability
      end,
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

  perform set_config('universal_cart.ingesting', 'off', true);

  return jsonb_build_object(
    'created', v_created,
    'observationInserted', v_observation_inserted,
    'item', to_jsonb(v_item)
  );
end;
$$;
