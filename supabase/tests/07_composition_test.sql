-- Composition is stored raw, refreshed conservatively, and unwritable by a client.
--
-- `composition` is a retailer-observed field (docs/DECISIONS.md, 2026-08-02): the ingestion
-- function writes the raw string the page published, a refresh that did not read it keeps the
-- stored value rather than wiping it, and the reject_observed_field_writes trigger stops a
-- client editing it — exactly like price or availability.

begin;
create extension if not exists pgtap;

select plan(6);

insert into auth.users (id, email, raw_user_meta_data)
values ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', '{}'::jsonb);

insert into public.carts (id, owner_id, name, is_default)
values ('11110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Cart', false);

insert into public.cart_members (cart_id, user_id, role)
values ('11110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'owner');

-- A capture builder whose composition varies; null omits the key, as an unknowing capture does.
create or replace function pg_temp.capture(p_composition text default null)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'source', jsonb_build_object(
      'url', 'https://shop.northwind.example/p/polo',
      'canonicalUrl', 'https://shop.northwind.example/p/polo',
      'domain', 'shop.northwind.example',
      'retailerName', 'Northwind',
      'pageTitle', 'Merino Polo'
    ),
    'product', jsonb_build_object(
      'title', 'Merino Polo',
      'brand', 'Northwind',
      'description', 'A polo.',
      'composition', p_composition,
      'imageUrls', jsonb_build_array('https://cdn.example.com/polo.jpg'),
      'selectedImageUrl', 'https://cdn.example.com/polo.jpg',
      'identifiers', jsonb_build_object('sku', 'POLO-1')
    ),
    'offer', jsonb_build_object(
      'priceAmount', '98.00', 'originalPriceAmount', null,
      'currency', 'USD', 'availability', 'in_stock'
    ),
    'selectedVariant', jsonb_build_object('Size', 'M'),
    'evidence', jsonb_build_array(),
    'extraction', jsonb_build_object(
      'extractorId', 'json-ld', 'extractorVersion', '1.0.0', 'overallConfidence', 0.9,
      'observedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );
$$;

create or replace function pg_temp.fp(p_seed text default 'polo')
returns text language sql as $$ select encode(extensions.digest(p_seed, 'sha256'), 'hex') $$;

-- ---------------------------------------------------------------------------
-- Stored raw on capture
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.ingest_product_capture(
       pg_temp.capture('Shell: 100% wool; Lining: 52% polyester'),
       '11110000-0000-4000-8000-000000000001', pg_temp.fp(), '{}'::jsonb) $$,
  'a capture carrying composition saves'
);

reset role;

select is(
  (select composition from public.items where fingerprint = pg_temp.fp()),
  'Shell: 100% wool; Lining: 52% polyester',
  'composition is stored exactly as the page published it, un-normalized'
);

-- ---------------------------------------------------------------------------
-- Absent when the page said nothing
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.ingest_product_capture(
       pg_temp.capture(),
       '11110000-0000-4000-8000-000000000001', pg_temp.fp('plain'), '{}'::jsonb) $$,
  'a capture without composition saves'
);

reset role;

select is(
  (select composition from public.items where fingerprint = pg_temp.fp('plain')),
  null::text,
  'composition is null when the page said nothing about it'
);

-- ---------------------------------------------------------------------------
-- A refresh that did not read composition keeps the stored value
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select public.ingest_product_capture(
  pg_temp.capture(),
  '11110000-0000-4000-8000-000000000001', pg_temp.fp(), '{}'::jsonb, 'revisit');

reset role;

select is(
  (select composition from public.items where fingerprint = pg_temp.fp()),
  'Shell: 100% wool; Lining: 52% polyester',
  'a refresh that read no composition keeps the stored value rather than wiping it'
);

-- ---------------------------------------------------------------------------
-- A client cannot write it
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

update public.items
set composition = '100% acrylic'
where fingerprint = pg_temp.fp();

reset role;

select is(
  (select composition from public.items where fingerprint = pg_temp.fp()),
  'Shell: 100% wool; Lining: 52% polyester',
  'a client update cannot change composition'
);

select * from finish();
rollback;
