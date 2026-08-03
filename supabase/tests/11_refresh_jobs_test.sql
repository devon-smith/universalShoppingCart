-- Phase 7 — refresh_jobs: the background-refresh schedule and its backoff.
--
-- Two claims carry the weight: the selector returns only what is genuinely due and fetchable
-- (public_fetch, enabled, past its next-run), and repeated failures back off and then disable a
-- job so a broken page is not hammered forever. And, like every system table, it is reachable by
-- service_role alone.

begin;
create extension if not exists pgtap;

select plan(20);

insert into auth.users (id, email, raw_user_meta_data)
values ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', '{}'::jsonb);

insert into public.carts (id, owner_id, name, is_default)
values ('11110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Cart', false);

insert into public.cart_members (cart_id, user_id, role)
values ('11110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'owner');

create or replace function pg_temp.capture()
returns jsonb language sql as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'source', jsonb_build_object(
      'url', 'https://shop.northwind.example/p/1',
      'canonicalUrl', 'https://shop.northwind.example/p/1',
      'domain', 'shop.northwind.example',
      'retailerName', 'Northwind', 'pageTitle', 'Runner'
    ),
    'product', jsonb_build_object(
      'title', 'Runner', 'brand', 'Northwind', 'description', null,
      'imageUrls', jsonb_build_array(), 'selectedImageUrl', null,
      'identifiers', jsonb_build_object('sku', 'R-1')
    ),
    'offer', jsonb_build_object(
      'priceAmount', '98.00', 'originalPriceAmount', null,
      'currency', 'USD', 'availability', 'in_stock'
    ),
    'selectedVariant', jsonb_build_object(),
    'evidence', jsonb_build_array(),
    'extraction', jsonb_build_object(
      'extractorId', 'generic', 'extractorVersion', '1.0.0',
      'overallConfidence', 0.9,
      'observedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );
$$;

create or replace function pg_temp.fp()
returns text language sql as $$ select encode(extensions.digest('rj-item', 'sha256'), 'hex') $$;

create or replace function pg_temp.item_id()
returns uuid language sql as $$
  select id from public.items
  where cart_id = '11110000-0000-4000-8000-000000000001' and fingerprint = pg_temp.fp()
$$;

create or replace function pg_temp.job_failures()
returns integer language sql as $$
  select consecutive_failures from public.refresh_jobs where item_id = pg_temp.item_id()
$$;

create or replace function pg_temp.job_disabled()
returns boolean language sql as $$
  select disabled from public.refresh_jobs where item_id = pg_temp.item_id()
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';
select public.ingest_product_capture(pg_temp.capture(), '11110000-0000-4000-8000-000000000001', pg_temp.fp());
reset role;

-- ---------------------------------------------------------------------------
-- The table, and its reachability
-- ---------------------------------------------------------------------------

select has_table('public'::name, 'refresh_jobs'::name, 'the refresh_jobs table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.refresh_jobs'::regclass),
  'row level security is enabled on refresh_jobs'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';
select throws_ok(
  'select count(*) from public.refresh_jobs',
  '42501', null,
  'an authenticated user cannot read refresh_jobs'
);
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.enqueue_refresh_job(uuid,public.refresh_strategy)', 'execute'),
  'an authenticated user cannot enqueue'
);
select ok(
  has_function_privilege('service_role', 'public.select_due_refresh_jobs(integer)', 'execute'),
  'service_role can select due jobs'
);

-- ---------------------------------------------------------------------------
-- Enqueue and the due selector
-- ---------------------------------------------------------------------------

select is(
  public.enqueue_refresh_job(pg_temp.item_id()) ->> 'strategy',
  'public_fetch',
  'a new job defaults to public_fetch'
);

select ok(
  (select next_run_at from public.refresh_jobs where item_id = pg_temp.item_id()) > now(),
  'a new job is scheduled in the future'
);

select is(pg_temp.job_failures(), 0, 'a new job has no failures');
select is(pg_temp.job_disabled(), false, 'a new job is not disabled');

select is(
  jsonb_array_length(public.select_due_refresh_jobs(50)), 0,
  'nothing is due yet, so the selector returns an empty array'
);

update public.refresh_jobs set next_run_at = now() - interval '1 hour' where item_id = pg_temp.item_id();

select is(
  jsonb_array_length(public.select_due_refresh_jobs(50)), 1,
  'once past its next run, the job is due'
);

-- A browser_required job is never selected for a public fetch, even when due.
select public.enqueue_refresh_job(pg_temp.item_id(), 'browser_required');
select is(
  jsonb_array_length(public.select_due_refresh_jobs(50)), 0,
  'a browser_required job is excluded from the public-fetch selector'
);
select public.enqueue_refresh_job(pg_temp.item_id(), 'public_fetch');

-- ---------------------------------------------------------------------------
-- Backoff and disable
-- ---------------------------------------------------------------------------

select is(
  public.record_refresh_result(pg_temp.item_id(), true) ->> 'last_ok',
  'true',
  'a success is recorded'
);
select is(pg_temp.job_failures(), 0, 'a success clears the failure count');
select ok(
  (select next_run_at from public.refresh_jobs where item_id = pg_temp.item_id()) > now(),
  'a success reschedules into the future'
);

select is(
  (public.record_refresh_result(pg_temp.item_id(), false) ->> 'consecutive_failures')::integer,
  1,
  'a failure increments the failure count'
);
select is(pg_temp.job_disabled(), false, 'one failure does not disable the job');

-- Four more failures reaches the threshold of five.
select public.record_refresh_result(pg_temp.item_id(), false);
select public.record_refresh_result(pg_temp.item_id(), false);
select public.record_refresh_result(pg_temp.item_id(), false);
select public.record_refresh_result(pg_temp.item_id(), false);

select is(pg_temp.job_disabled(), true, 'five consecutive failures disables the job');

-- A disabled job is never selected, even when overdue.
update public.refresh_jobs set next_run_at = now() - interval '1 hour' where item_id = pg_temp.item_id();
select is(
  jsonb_array_length(public.select_due_refresh_jobs(50)), 0,
  'a disabled job is excluded even when overdue'
);

select throws_ok(
  $$select public.record_refresh_result('99990000-0000-4000-8000-000000000009'::uuid, true)$$,
  'P0002', null,
  'recording against a missing job raises no_data_found'
);

select * from finish();
rollback;
