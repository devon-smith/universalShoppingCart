-- The second availability fact survives a save, and only a save.
--
-- `availability` describes the selected variant; `product_availability` is the page's
-- product-level claim, present only when the two differ (docs/DECISIONS.md, 2026-07-27).
-- These tests pin the pair's lifecycle through ingestion — stored, absent, cleared, kept —
-- and that a client cannot write the second half any more than the first.

begin;
create extension if not exists pgtap;

select plan(11);

insert into auth.users (id, email, raw_user_meta_data)
values ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', '{}'::jsonb);

insert into public.carts (id, owner_id, name, is_default)
values ('11110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Cart', false);

insert into public.cart_members (cart_id, user_id, role)
values ('11110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'owner');

-- A capture payload builder. `p_product_availability` null means the key is absent, which
-- is how the pipeline emits agreement — jsonb_build_object keeps a null value as JSON
-- null, and the function reads both shapes as "no separate claim".
create or replace function pg_temp.capture(
  p_availability text default 'out_of_stock',
  p_product_availability text default null,
  p_price text default '94.97'
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'source', jsonb_build_object(
      'url', 'https://shop.northwind.example/p/dunk',
      'canonicalUrl', 'https://shop.northwind.example/p/dunk',
      'domain', 'shop.northwind.example',
      'retailerName', 'Northwind',
      'pageTitle', 'Dunk Low'
    ),
    'product', jsonb_build_object(
      'title', 'Dunk Low',
      'brand', 'Northwind',
      'description', 'A shoe.',
      'imageUrls', jsonb_build_array('https://cdn.example.com/dunk.jpg'),
      'selectedImageUrl', 'https://cdn.example.com/dunk.jpg',
      'identifiers', jsonb_build_object('sku', 'DUNK-042')
    ),
    'offer', jsonb_build_object(
      'priceAmount', p_price,
      'originalPriceAmount', null,
      'currency', 'USD',
      'availability', p_availability,
      'productAvailability', p_product_availability
    ),
    'selectedVariant', jsonb_build_object('Size', 'M 6.5 / W 8'),
    'evidence', jsonb_build_array(),
    'extraction', jsonb_build_object(
      'extractorId', 'generic',
      'extractorVersion', '1.0.0',
      'overallConfidence', 0.9,
      'observedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );
$$;

create or replace function pg_temp.fp(p_seed text default 'dunk')
returns text language sql as $$ select encode(extensions.digest(p_seed, 'sha256'), 'hex') $$;

-- ---------------------------------------------------------------------------
-- Both facts survive a save: the size is gone, the product is not
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.ingest_product_capture(
       pg_temp.capture('out_of_stock', 'in_stock'),
       '11110000-0000-4000-8000-000000000001', pg_temp.fp(), '{}'::jsonb) $$,
  'a capture carrying both availability facts saves'
);

reset role;

select is(
  (select availability::text from public.items where fingerprint = pg_temp.fp()),
  'out_of_stock',
  'availability stores the selected-variant fact'
);

select is(
  (select product_availability::text from public.items where fingerprint = pg_temp.fp()),
  'in_stock',
  'product_availability stores the product-level fact'
);

-- ---------------------------------------------------------------------------
-- Absent means no separate claim
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.ingest_product_capture(
       pg_temp.capture('in_stock'),
       '11110000-0000-4000-8000-000000000001', pg_temp.fp('plain'), '{}'::jsonb) $$,
  'a capture with no product-level claim saves'
);

reset role;

select is(
  (select product_availability from public.items where fingerprint = pg_temp.fp('plain')),
  null::public.item_availability,
  'product_availability is null when the capture made no separate claim'
);

-- ---------------------------------------------------------------------------
-- A refresh where the facts now agree clears the stale disagreement
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.ingest_product_capture(
       pg_temp.capture('in_stock'),
       '11110000-0000-4000-8000-000000000001', pg_temp.fp(), '{}'::jsonb, 'revisit') $$,
  'a revisit whose facts agree saves'
);

reset role;

select is(
  (select product_availability from public.items where fingerprint = pg_temp.fp()),
  null::public.item_availability,
  'a refresh whose facts agree clears the recorded disagreement'
);

-- ---------------------------------------------------------------------------
-- A refresh that knows nothing keeps both halves of the pair
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.ingest_product_capture(
       pg_temp.capture('out_of_stock', 'in_stock'),
       '11110000-0000-4000-8000-000000000001', pg_temp.fp(), '{}'::jsonb, 'revisit') $$,
  'the disagreement is re-recorded on a later revisit'
);

select lives_ok(
  $$ select public.ingest_product_capture(
       pg_temp.capture('unknown'),
       '11110000-0000-4000-8000-000000000001', pg_temp.fp(), '{}'::jsonb, 'revisit') $$,
  'a revisit that knows nothing about availability saves'
);

reset role;

select is(
  (select product_availability::text from public.items where fingerprint = pg_temp.fp()),
  'in_stock',
  'a capture that knows nothing about availability keeps the stored pair'
);

-- ---------------------------------------------------------------------------
-- A client cannot write the second fact
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

update public.items
set product_availability = 'out_of_stock'
where fingerprint = pg_temp.fp();

reset role;

select is(
  (select product_availability::text from public.items where fingerprint = pg_temp.fp()),
  'in_stock',
  'a client update cannot change product_availability'
);

select * from finish();
rollback;
