-- Phase 7 — automatic enrolment of saved items into refresh_jobs.
--
-- Saving an item enrols it exactly once, with a strategy that matches classifyRefresh: the
-- client-rendered brand-adapter sites are browser_required, everything else public_fetch, and a
-- lookalike domain is not mistaken for a brand site.

begin;
create extension if not exists pgtap;

select plan(8);

insert into auth.users (id, email, raw_user_meta_data)
values ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', '{}'::jsonb);

insert into public.carts (id, owner_id, name, is_default)
values ('11110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Cart', false);

insert into public.cart_members (cart_id, user_id, role)
values ('11110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'owner');

-- A capture parameterised by the two signals enrolment reads: domain and extractor id.
create or replace function pg_temp.capture(p_domain text, p_extractor text default 'generic')
returns jsonb language sql as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'source', jsonb_build_object(
      'url', 'https://' || p_domain || '/p/1',
      'canonicalUrl', 'https://' || p_domain || '/p/1',
      'domain', p_domain, 'retailerName', 'Shop', 'pageTitle', 'Thing'
    ),
    'product', jsonb_build_object(
      'title', 'Thing', 'brand', 'Shop', 'description', null,
      'imageUrls', jsonb_build_array(), 'selectedImageUrl', null,
      'identifiers', jsonb_build_object('sku', 'S-1')
    ),
    'offer', jsonb_build_object(
      'priceAmount', '10.00', 'originalPriceAmount', null, 'currency', 'USD', 'availability', 'in_stock'
    ),
    'selectedVariant', jsonb_build_object(),
    'evidence', jsonb_build_array(),
    'extraction', jsonb_build_object(
      'extractorId', p_extractor, 'extractorVersion', '1.0.0', 'overallConfidence', 0.9,
      'observedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );
$$;

create or replace function pg_temp.fp(p_seed text)
returns text language sql as $$ select encode(extensions.digest(p_seed, 'sha256'), 'hex') $$;

create or replace function pg_temp.strategy_for(p_seed text)
returns text language sql as $$
  select j.strategy::text
  from public.items i
  join public.refresh_jobs j on j.item_id = i.id
  where i.cart_id = '11110000-0000-4000-8000-000000000001' and i.fingerprint = pg_temp.fp(p_seed)
$$;

create or replace function pg_temp.job_count(p_seed text)
returns bigint language sql as $$
  select count(*)
  from public.items i
  join public.refresh_jobs j on j.item_id = i.id
  where i.cart_id = '11110000-0000-4000-8000-000000000001' and i.fingerprint = pg_temp.fp(p_seed)
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select public.ingest_product_capture(pg_temp.capture('shop.northwind.example'), '11110000-0000-4000-8000-000000000001', pg_temp.fp('generic'));
select public.ingest_product_capture(pg_temp.capture('amazon.com'), '11110000-0000-4000-8000-000000000001', pg_temp.fp('amazon-domain'));
select public.ingest_product_capture(pg_temp.capture('shop.example', 'amazon'), '11110000-0000-4000-8000-000000000001', pg_temp.fp('amazon-extractor'));
select public.ingest_product_capture(pg_temp.capture('notamazon.com'), '11110000-0000-4000-8000-000000000001', pg_temp.fp('lookalike'));

reset role;

-- Saving enrols exactly one job, and it is fetchable by default.
select is(pg_temp.job_count('generic'), 1::bigint, 'saving an item enrols exactly one refresh job');
select is(pg_temp.strategy_for('generic'), 'public_fetch', 'an ordinary site enrols as public_fetch');

select ok(
  (select next_run_at from public.refresh_jobs j
   join public.items i on i.id = j.item_id
   where i.fingerprint = pg_temp.fp('generic')) > now(),
  'the new job is scheduled in the future'
);

-- The brand-adapter sites are browser_required, by domain or by the adapter that captured them.
select is(pg_temp.strategy_for('amazon-domain'), 'browser_required', 'an amazon.com item is browser_required');
select is(pg_temp.strategy_for('amazon-extractor'), 'browser_required',
  'an item captured by the amazon adapter is browser_required even off-domain');

-- A lookalike is not a brand site.
select is(pg_temp.strategy_for('lookalike'), 'public_fetch', 'notamazon.com is not mistaken for amazon');

-- Re-saving the same item (a duplicate refresh, not a new insert) does not enrol a second time.
set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';
select public.ingest_product_capture(pg_temp.capture('shop.northwind.example'), '11110000-0000-4000-8000-000000000001', pg_temp.fp('generic'));
reset role;

select is(pg_temp.job_count('generic'), 1::bigint, 're-saving the same item does not enrol it twice');

-- Enrolment writes only the system table; the item is otherwise a normal save.
select is(
  (select status::text from public.items where fingerprint = pg_temp.fp('generic')),
  'saved',
  'enrolment does not disturb the saved item'
);

select * from finish();
rollback;
