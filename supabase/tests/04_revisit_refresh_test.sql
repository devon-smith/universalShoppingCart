-- Phase 4 — revisit refresh and price history.
--
-- The load-bearing claim: a revisit updates what the retailer says and touches nothing the
-- user wrote. Everything else here is about not turning a series of visits into a series of
-- identical history rows.

begin;
create extension if not exists pgtap;

select plan(20);

insert into auth.users (id, email, raw_user_meta_data)
values ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', '{}'::jsonb);

insert into public.carts (id, owner_id, name, is_default)
values ('11110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Cart', false);

insert into public.cart_members (cart_id, user_id, role)
values ('11110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'owner');

create or replace function pg_temp.capture(
  p_price text default '98.00',
  p_availability text default 'in_stock',
  p_observed_at text default '2026-07-26T12:00:00.000Z'
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
      'observedAt', p_observed_at
    )
  );
$$;

create or replace function pg_temp.fp()
returns text language sql as $$ select encode(extensions.digest('revisit-item', 'sha256'), 'hex') $$;

create or replace function pg_temp.item_id()
returns uuid language sql as $$
  select id from public.items
  where cart_id = '11110000-0000-4000-8000-000000000001' and fingerprint = pg_temp.fp()
$$;

create or replace function pg_temp.observation_count()
returns bigint language sql as $$
  select count(*) from public.item_observations where item_id = pg_temp.item_id()
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

-- Save it, with everything a user can author.
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

select is(pg_temp.observation_count(), 1::bigint, 'saving records one observation');

-- ---------------------------------------------------------------------------
-- A revisit at a new price
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select is(
  (public.ingest_product_capture(
    pg_temp.capture(p_price => '88.00', p_observed_at => '2026-07-26T18:00:00.000Z'),
    '11110000-0000-4000-8000-000000000001',
    pg_temp.fp(),
    '{}'::jsonb,
    'revisit'
  ) ->> 'observationInserted')::boolean,
  true,
  'a revisit at a new price records an observation'
);

reset role;

select is(
  (select current_price from public.items where id = pg_temp.item_id()),
  88.00::numeric,
  'the observed price is updated'
);

select is(
  (select last_observed_at from public.items where id = pg_temp.item_id()),
  '2026-07-26T18:00:00.000Z'::timestamptz,
  'last_observed_at moves forward'
);

select is(
  (select source::text from public.item_observations
   where item_id = pg_temp.item_id() order by observed_at desc limit 1),
  'revisit',
  'the observation is recorded as a revisit'
);

-- The whole point.
select is(
  (select note from public.items where id = pg_temp.item_id()),
  'for the trip',
  'a revisit does not touch the note'
);

select is(
  (select quantity from public.items where id = pg_temp.item_id()),
  4,
  'a revisit does not touch the quantity'
);

select is(
  (select priority::text from public.items where id = pg_temp.item_id()),
  'high',
  'a revisit does not touch the priority'
);

select is(
  (select desired_price from public.items where id = pg_temp.item_id()),
  80.00::numeric,
  'a revisit does not touch the desired price'
);

select is(
  (select status::text from public.items where id = pg_temp.item_id()),
  'cart',
  'a revisit does not touch the status'
);

-- ---------------------------------------------------------------------------
-- Repeated identical visits do not become history
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select is(
  (public.ingest_product_capture(
    pg_temp.capture(p_price => '88.00', p_observed_at => '2026-07-26T18:05:00.000Z'),
    '11110000-0000-4000-8000-000000000001', pg_temp.fp(), '{}'::jsonb, 'revisit'
  ) ->> 'observationInserted')::boolean,
  false,
  'an unchanged revisit records nothing'
);

select is(
  (public.ingest_product_capture(
    pg_temp.capture(p_price => '88.00', p_observed_at => '2026-07-26T18:10:00.000Z'),
    '11110000-0000-4000-8000-000000000001', pg_temp.fp(), '{}'::jsonb, 'revisit'
  ) ->> 'observationInserted')::boolean,
  false,
  'and neither does the one after that'
);

-- Availability alone is enough to be worth recording.
select is(
  (public.ingest_product_capture(
    pg_temp.capture(p_price => '88.00', p_availability => 'out_of_stock',
                    p_observed_at => '2026-07-26T19:00:00.000Z'),
    '11110000-0000-4000-8000-000000000001', pg_temp.fp(), '{}'::jsonb, 'revisit'
  ) ->> 'observationInserted')::boolean,
  true,
  'an availability change records an observation even at the same price'
);

reset role;

select is(pg_temp.observation_count(), 3::bigint, 'three observations, not five visits');

-- ---------------------------------------------------------------------------
-- item_price_summary
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select is(
  (select latest_price from public.item_price_summary where item_id = pg_temp.item_id()),
  88.00::numeric,
  'the summary reports the newest price'
);

select is(
  (select previous_price from public.item_price_summary where item_id = pg_temp.item_id()),
  98.00::numeric,
  'the summary reports the last price that differed, skipping repeats'
);

select is(
  (select observation_count from public.item_price_summary where item_id = pg_temp.item_id()),
  3::bigint,
  'the summary counts every observation'
);

reset role;

-- ---------------------------------------------------------------------------
-- The summary is not a way around Row Level Security
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data)
values ('d0000000-0000-4000-8000-000000000004', 'stranger@example.com', '{}'::jsonb);

set local role authenticated;
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-000000000004", "role": "authenticated"}';

select is(
  (select count(*) from public.item_price_summary),
  0::bigint,
  'a stranger sees no price history at all'
);

reset role;

set local role anon;

select throws_ok(
  'select count(*) from public.item_price_summary',
  '42501',
  null,
  'and an anonymous request is denied outright'
);

reset role;

select * from finish();
rollback;
