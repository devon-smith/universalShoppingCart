-- Phase 7 — notification_events.
--
-- The claims: the worker (service_role) writes alerts and a user reads only their own, and a
-- stranger or an anonymous request sees nothing. The transition/dedup decision is unit-tested in
-- packages/refresh; here the table and its access are what matter.

begin;
create extension if not exists pgtap;

select plan(11);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', '{}'::jsonb),
  ('d0000000-0000-4000-8000-000000000004', 'stranger@example.com', '{}'::jsonb);

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
      'domain', 'shop.northwind.example', 'retailerName', 'Northwind', 'pageTitle', 'Runner'
    ),
    'product', jsonb_build_object(
      'title', 'Runner', 'brand', 'Northwind', 'description', null,
      'imageUrls', jsonb_build_array(), 'selectedImageUrl', null,
      'identifiers', jsonb_build_object('sku', 'R-1')
    ),
    'offer', jsonb_build_object(
      'priceAmount', '75.00', 'originalPriceAmount', null, 'currency', 'USD', 'availability', 'in_stock'
    ),
    'selectedVariant', jsonb_build_object(),
    'evidence', jsonb_build_array(),
    'extraction', jsonb_build_object(
      'extractorId', 'generic', 'extractorVersion', '1.0.0', 'overallConfidence', 0.9,
      'observedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );
$$;

create or replace function pg_temp.fp()
returns text language sql as $$ select encode(extensions.digest('ne-item', 'sha256'), 'hex') $$;

create or replace function pg_temp.item_id()
returns uuid language sql as $$
  select id from public.items
  where cart_id = '11110000-0000-4000-8000-000000000001' and fingerprint = pg_temp.fp()
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';
select public.ingest_product_capture(pg_temp.capture(), '11110000-0000-4000-8000-000000000001', pg_temp.fp());
reset role;

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

select has_table('public'::name, 'notification_events'::name, 'the notification_events table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.notification_events'::regclass),
  'row level security is enabled'
);

-- ---------------------------------------------------------------------------
-- Only the worker writes
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.record_notification(uuid,public.notification_type,text,text)', 'execute'),
  'an authenticated user cannot record a notification'
);
select ok(
  has_function_privilege('service_role', 'public.record_notification(uuid,public.notification_type,text,text)', 'execute'),
  'service_role can record a notification'
);

select is(
  public.record_notification(pg_temp.item_id(), 'price_below_desired', '75.00', 'USD') ->> 'type',
  'price_below_desired',
  'recording an alert returns the event'
);

select throws_ok(
  $$select public.record_notification('99990000-0000-4000-8000-000000000009'::uuid, 'back_in_stock')$$,
  'P0002', null,
  'recording against a missing item raises no_data_found'
);

-- ---------------------------------------------------------------------------
-- The user reads their own; nobody else does
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';
select is(
  (select count(*) from public.notification_events where item_id = pg_temp.item_id()),
  1::bigint,
  'the owner sees the alert for their item'
);
select is(
  (select observed_value from public.notification_events where item_id = pg_temp.item_id()),
  '75.00',
  'the triggering value is stored'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-000000000004", "role": "authenticated"}';
select is(
  (select count(*) from public.notification_events),
  0::bigint,
  'a stranger sees no alerts at all'
);
reset role;

set local role anon;
select throws_ok(
  'select count(*) from public.notification_events',
  '42501', null,
  'an anonymous request is denied outright'
);
reset role;

select * from finish();
rollback;
