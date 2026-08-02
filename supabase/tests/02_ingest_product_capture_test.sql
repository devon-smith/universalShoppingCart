-- Phase 2B — atomic capture ingestion (BUILD_PLAN.md §18.3).
--
-- Covers: creation, duplicate refresh, survival of user-authored fields, observation
-- insertion rules, access control, and validation.

begin;
create extension if not exists pgtap;

select plan(29);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', '{}'::jsonb),
  ('b0000000-0000-4000-8000-000000000002', 'editor@example.com', '{}'::jsonb),
  ('c0000000-0000-4000-8000-000000000003', 'viewer@example.com', '{}'::jsonb),
  ('d0000000-0000-4000-8000-000000000004', 'stranger@example.com', '{}'::jsonb);

insert into public.carts (id, owner_id, name, is_default)
values ('11110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Shared cart', false);

insert into public.cart_members (cart_id, user_id, role)
values
  ('11110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('11110000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'editor'),
  ('11110000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', 'viewer');

-- Observation timestamps are anchored to now(), not to a fixed date.
--
-- `ingest_product_capture` suppresses an unchanged observation only while the previous one
-- is inside `observation_refresh_interval()` — twelve hours. A hardcoded date therefore
-- makes these assertions pass on the day they were written and fail forever after, which is
-- exactly what happened: the suite went red overnight with no code change. Anchoring to
-- now() tests the rule instead of the calendar.
--
-- now() is the transaction timestamp, so every call below sees the same anchor.
create or replace function pg_temp.anchor()
returns timestamptz
language sql
stable
as $$ select date_trunc('second', now()) - interval '8 hours' $$;

-- An ISO-8601 UTC instant, offset from the anchor.
create or replace function pg_temp.at(p_offset interval)
returns text
language sql
stable
as $$
  select to_char((pg_temp.anchor() + p_offset) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- A capture payload builder, so each test states only what it varies.
create or replace function pg_temp.capture(
  p_title text default 'Meridian Wool Runner',
  p_price text default '98.00',
  p_original text default null,
  p_currency text default 'USD',
  p_availability text default 'in_stock',
  p_observed_at text default null
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'source', jsonb_build_object(
      'url', 'https://shop.northwind.example/p/1?utm_source=x',
      'canonicalUrl', 'https://shop.northwind.example/p/1',
      'domain', 'shop.northwind.example',
      'retailerName', 'Northwind',
      'pageTitle', 'Meridian Wool Runner'
    ),
    'product', jsonb_build_object(
      'title', p_title,
      'brand', 'Northwind',
      'description', 'A shoe.',
      'imageUrls', jsonb_build_array('https://cdn.example.com/1.jpg'),
      'selectedImageUrl', 'https://cdn.example.com/1.jpg',
      'identifiers', jsonb_build_object('sku', 'MWR-042')
    ),
    'offer', jsonb_build_object(
      'priceAmount', p_price,
      'originalPriceAmount', p_original,
      'currency', p_currency,
      'availability', p_availability
    ),
    'selectedVariant', jsonb_build_object('Size', '10'),
    'evidence', jsonb_build_array(),
    'extraction', jsonb_build_object(
      'extractorId', 'generic',
      'extractorVersion', '1.0.0',
      'overallConfidence', 0.9,
      'observedAt', coalesce(p_observed_at, pg_temp.at(interval '0'))
    )
  );
$$;

-- 64 lowercase hex characters.
create or replace function pg_temp.fp(p_seed text default 'a')
returns text language sql as $$ select encode(extensions.digest(p_seed, 'sha256'), 'hex') $$;

-- ---------------------------------------------------------------------------
-- Creation
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select is(
  (public.ingest_product_capture(
    pg_temp.capture(),
    '11110000-0000-4000-8000-000000000001',
    pg_temp.fp(),
    '{"note": "for the trip", "quantity": 2, "priority": "high", "desiredPrice": "80.00"}'::jsonb
  ) ->> 'created')::boolean,
  true,
  'a first capture creates an item'
);

reset role;

select is(
  (select count(*) from public.items where cart_id = '11110000-0000-4000-8000-000000000001'),
  1::bigint,
  'exactly one item exists'
);

select is(
  (select title from public.items where fingerprint = pg_temp.fp()),
  'Meridian Wool Runner',
  'the title is stored'
);

select is(
  (select current_price from public.items where fingerprint = pg_temp.fp()),
  98.00::numeric,
  'the price is stored as an exact numeric'
);

select is(
  (select note from public.items where fingerprint = pg_temp.fp()),
  'for the trip',
  'the user note is stored'
);

select is(
  (select quantity from public.items where fingerprint = pg_temp.fp()),
  2,
  'the user quantity is stored'
);

select is(
  (select priority::text from public.items where fingerprint = pg_temp.fp()),
  'high',
  'the user priority is stored'
);

select is(
  (select desired_price from public.items where fingerprint = pg_temp.fp()),
  80.00::numeric,
  'the desired price is stored'
);

select is(
  (select status::text from public.items where fingerprint = pg_temp.fp()),
  'saved',
  'a new capture defaults to the saved state, not cart'
);

select is(
  (
    select count(*)
    from public.item_observations o
    join public.items i on i.id = o.item_id
    where i.cart_id = '11110000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'creation records one observation'
);

-- ---------------------------------------------------------------------------
-- Duplicate save refreshes rather than duplicating
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select is(
  (public.ingest_product_capture(
    pg_temp.capture(p_price => '88.00', p_original => '98.00',
                    p_observed_at => pg_temp.at(interval '1 hour')),
    '11110000-0000-4000-8000-000000000001',
    pg_temp.fp(),
    '{}'::jsonb,
    'revisit'
  ) ->> 'created')::boolean,
  false,
  'a second capture of the same fingerprint refreshes the existing item'
);

reset role;

select is(
  (select count(*) from public.items where cart_id = '11110000-0000-4000-8000-000000000001'),
  1::bigint,
  'no duplicate item was created'
);

select is(
  (select current_price from public.items where fingerprint = pg_temp.fp()),
  88.00::numeric,
  'the refreshed price is observed'
);

-- The whole point of the observed/authored split.
select is(
  (select note from public.items where fingerprint = pg_temp.fp()),
  'for the trip',
  'the user note survives a refresh'
);

select is(
  (select quantity from public.items where fingerprint = pg_temp.fp()),
  2,
  'the user quantity survives a refresh'
);

select is(
  (select priority::text from public.items where fingerprint = pg_temp.fp()),
  'high',
  'the user priority survives a refresh'
);

select is(
  (select desired_price from public.items where fingerprint = pg_temp.fp()),
  80.00::numeric,
  'the desired price survives a refresh'
);

select is(
  (
    select count(*)
    from public.item_observations o
    join public.items i on i.id = o.item_id
    where i.cart_id = '11110000-0000-4000-8000-000000000001'
  ),
  2::bigint,
  'a price change records a new observation'
);

-- ---------------------------------------------------------------------------
-- Unchanged observations do not create noise
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select is(
  (public.ingest_product_capture(
    pg_temp.capture(p_price => '88.00', p_original => '98.00',
                    p_observed_at => pg_temp.at(interval '1 hour 5 minutes')),
    '11110000-0000-4000-8000-000000000001',
    pg_temp.fp(),
    '{}'::jsonb,
    'revisit'
  ) ->> 'observationInserted')::boolean,
  false,
  'an unchanged re-observation does not append history'
);

reset role;

select is(
  (
    select count(*)
    from public.item_observations o
    join public.items i on i.id = o.item_id
    where i.cart_id = '11110000-0000-4000-8000-000000000001'
  ),
  2::bigint,
  'the observation count is unchanged'
);

-- ---------------------------------------------------------------------------
-- A different variant is a different item
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select is(
  (public.ingest_product_capture(
    pg_temp.capture(),
    '11110000-0000-4000-8000-000000000001',
    pg_temp.fp('different-variant')
  ) ->> 'created')::boolean,
  true,
  'a different fingerprint creates a separate item'
);

reset role;

select is(
  (select count(*) from public.items where cart_id = '11110000-0000-4000-8000-000000000001'),
  2::bigint,
  'both variants are saved'
);

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "b0000000-0000-4000-8000-000000000002", "role": "authenticated"}';

select lives_ok(
  $$select public.ingest_product_capture(
      pg_temp.capture(p_title => 'Editor save'),
      '11110000-0000-4000-8000-000000000001',
      encode(extensions.digest('editor', 'sha256'), 'hex')
    )$$,
  'an editor can save into a shared cart'
);

set local request.jwt.claims = '{"sub": "c0000000-0000-4000-8000-000000000003", "role": "authenticated"}';

select throws_ok(
  $$select public.ingest_product_capture(
      pg_temp.capture(p_title => 'Viewer save'),
      '11110000-0000-4000-8000-000000000001',
      encode(extensions.digest('viewer', 'sha256'), 'hex')
    )$$,
  '42501',
  null,
  'a viewer cannot save into a shared cart'
);

set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-000000000004", "role": "authenticated"}';

select throws_ok(
  $$select public.ingest_product_capture(
      pg_temp.capture(p_title => 'Stranger save'),
      '11110000-0000-4000-8000-000000000001',
      encode(extensions.digest('stranger', 'sha256'), 'hex')
    )$$,
  '42501',
  null,
  'a stranger cannot save into another user''s cart'
);

-- ---------------------------------------------------------------------------
-- Validation
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$select public.ingest_product_capture(
      pg_temp.capture(p_title => null),
      '11110000-0000-4000-8000-000000000001',
      encode(extensions.digest('no-title', 'sha256'), 'hex')
    )$$,
  '23502',
  null,
  'a capture with no title is rejected rather than saved blank'
);

select throws_ok(
  $$select public.ingest_product_capture(
      pg_temp.capture(),
      '11110000-0000-4000-8000-000000000001',
      'not-a-fingerprint'
    )$$,
  '22P02',
  null,
  'a malformed fingerprint is rejected'
);

select throws_ok(
  $$select public.ingest_product_capture(
      pg_temp.capture(p_price => '1.299,00'),
      '11110000-0000-4000-8000-000000000001',
      encode(extensions.digest('bad-money', 'sha256'), 'hex')
    )$$,
  '22P02',
  null,
  'a locale-formatted price is rejected rather than silently truncated'
);

select throws_ok(
  $$select public.ingest_product_capture(
      jsonb_set(pg_temp.capture(), '{schemaVersion}', '2'::jsonb),
      '11110000-0000-4000-8000-000000000001',
      encode(extensions.digest('future', 'sha256'), 'hex')
    )$$,
  '0A000',
  null,
  'a future schema version is rejected rather than guessed at'
);

reset role;

select * from finish();
rollback;
