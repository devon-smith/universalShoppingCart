-- Phase 7 — record_background_observation.
--
-- The system path a worker uses to re-observe an existing item. Two claims carry the weight: it
-- refreshes retailer-observed fields and never user-authored ones, and it is reachable by
-- service_role alone — an authenticated user must not be able to rewrite observed history through
-- it. The rest is that unchanged re-observations do not become noise, same as the user path.

begin;
create extension if not exists pgtap;

select plan(20);

insert into auth.users (id, email, raw_user_meta_data)
values ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', '{}'::jsonb);

insert into public.carts (id, owner_id, name, is_default)
values ('11110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Cart', false);

insert into public.cart_members (cart_id, user_id, role)
values ('11110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'owner');

create or replace function pg_temp.at(p_offset interval)
returns text
language sql
stable
as $$
  select to_char(
    (date_trunc('second', now()) + p_offset) at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  )
$$;

create or replace function pg_temp.capture(
  p_price text default '98.00',
  p_availability text default 'in_stock',
  p_observed_at text default null
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'source', jsonb_build_object(
      'url', 'https://shop.northwind.example/p/1',
      'canonicalUrl', 'https://shop.northwind.example/p/1',
      'domain', 'shop.northwind.example',
      'retailerName', 'Northwind',
      'pageTitle', 'Meridian Wool Runner'
    ),
    'product', jsonb_build_object(
      'title', 'Meridian Wool Runner',
      'brand', 'Northwind',
      'description', null,
      'imageUrls', jsonb_build_array(),
      'selectedImageUrl', null,
      'identifiers', jsonb_build_object('sku', 'MWR-042')
    ),
    'offer', jsonb_build_object(
      'priceAmount', p_price,
      'originalPriceAmount', null,
      'currency', 'USD',
      'availability', p_availability
    ),
    'selectedVariant', jsonb_build_object('Size', '10'),
    'evidence', jsonb_build_array(),
    'extraction', jsonb_build_object(
      'extractorId', 'generic',
      'extractorVersion', '1.0.0',
      'overallConfidence', 0.9,
      'observedAt', coalesce(p_observed_at, pg_temp.at(interval '-8 hours'))
    )
  );
$$;

create or replace function pg_temp.fp()
returns text language sql as $$ select encode(extensions.digest('bg-item', 'sha256'), 'hex') $$;

create or replace function pg_temp.item_id()
returns uuid language sql as $$
  select id from public.items
  where cart_id = '11110000-0000-4000-8000-000000000001' and fingerprint = pg_temp.fp()
$$;

create or replace function pg_temp.obs_count()
returns bigint language sql as $$
  select count(*) from public.item_observations where item_id = pg_temp.item_id()
$$;

-- Save the item through the user path, with everything a user can author.
set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.ingest_product_capture(
      pg_temp.capture(),
      '11110000-0000-4000-8000-000000000001',
      pg_temp.fp(),
      '{"note": "for the trip", "quantity": 4, "priority": "high",
        "desiredPrice": "80.00", "status": "cart"}'::jsonb
    )$$,
  'the product is saved with user fields'
);

reset role;

-- ---------------------------------------------------------------------------
-- Reachability: service_role only
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege(
    'authenticated',
    'public.record_background_observation(uuid,text,text,text,text,text,text,real)',
    'execute'
  ),
  'an authenticated user cannot call the background path'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.record_background_observation(uuid,text,text,text,text,text,text,real)',
    'execute'
  ),
  'service_role can call the background path'
);

-- ---------------------------------------------------------------------------
-- A background observation at a new price
-- ---------------------------------------------------------------------------

select is(
  (public.record_background_observation(
    pg_temp.item_id(), '88.00', null, 'USD', 'in_stock', 'refresh', '1.0.0', 0.9
  ) ->> 'observationInserted')::boolean,
  true,
  'the first background record inserts an observation'
);

select is(pg_temp.obs_count(), 2::bigint, 'two observations now: the save and the background one');

select is(
  (select source::text from public.item_observations
   where item_id = pg_temp.item_id() order by observed_at desc limit 1),
  'background',
  'the observation is sourced background'
);

select is(
  (select current_price from public.items where id = pg_temp.item_id()),
  88.00::numeric,
  'the observed price is updated on the item'
);

select is(
  (select last_observed_at from public.items where id = pg_temp.item_id()),
  now(),
  'last_observed_at moves to the observation time'
);

select is(
  (select extractor_id from public.items where id = pg_temp.item_id()),
  'refresh',
  'the observing extractor is recorded on the item'
);

-- ---------------------------------------------------------------------------
-- Unchanged re-observations do not become history
-- ---------------------------------------------------------------------------

select is(
  (public.record_background_observation(
    pg_temp.item_id(), '88.00', null, 'USD', 'in_stock', 'refresh', '1.0.0', 0.9
  ) ->> 'observationInserted')::boolean,
  false,
  'an unchanged background record inserts nothing'
);

select is(pg_temp.obs_count(), 2::bigint, 'still two observations');

-- ---------------------------------------------------------------------------
-- A price change is recorded
-- ---------------------------------------------------------------------------

select is(
  (public.record_background_observation(
    pg_temp.item_id(), '79.99', null, 'USD', 'in_stock', 'refresh', '1.0.0', 0.9
  ) ->> 'observationInserted')::boolean,
  true,
  'a price change records a background observation'
);

select is(pg_temp.obs_count(), 3::bigint, 'three observations');

select is(
  (select current_price from public.items where id = pg_temp.item_id()),
  79.99::numeric,
  'the new price is stored'
);

-- ---------------------------------------------------------------------------
-- User-authored fields are never touched
-- ---------------------------------------------------------------------------

select is((select note from public.items where id = pg_temp.item_id()), 'for the trip',
  'a background refresh never touches the note');
select is((select quantity from public.items where id = pg_temp.item_id()), 4,
  'a background refresh never touches the quantity');
select is((select priority::text from public.items where id = pg_temp.item_id()), 'high',
  'a background refresh never touches the priority');
select is((select desired_price from public.items where id = pg_temp.item_id()), 80.00::numeric,
  'a background refresh never touches the desired price');
select is((select status::text from public.items where id = pg_temp.item_id()), 'cart',
  'a background refresh never touches the status');

-- ---------------------------------------------------------------------------
-- A missing item is an error, not a silent no-op
-- ---------------------------------------------------------------------------

select throws_ok(
  $$select public.record_background_observation(
      '99990000-0000-4000-8000-000000000009'::uuid, '10.00'
    )$$,
  'P0002',
  null,
  'a missing item raises no_data_found'
);

select * from finish();
rollback;
