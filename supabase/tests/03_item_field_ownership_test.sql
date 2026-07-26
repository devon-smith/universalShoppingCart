-- Phase 3 — the user-authored / retailer-observed boundary, from both directions.
--
-- A refresh must not overwrite the user's fields (covered for the ingestion path in 02),
-- and a client edit must not overwrite the retailer's (covered here).

begin;
create extension if not exists pgtap;

select plan(14);

insert into auth.users (id, email, raw_user_meta_data)
values ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', '{}'::jsonb);

insert into public.carts (id, owner_id, name, is_default)
values ('11110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Cart', false);

insert into public.cart_members (cart_id, user_id, role)
values ('11110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'owner');

insert into public.items (
  id, cart_id, created_by,
  source_url, domain, retailer_name, title,
  currency, current_price, original_price, availability,
  selected_variant, fingerprint, last_observed_at,
  note, quantity, priority, desired_price, status
)
values (
  '22220000-0000-4000-8000-000000000001',
  '11110000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'https://shop.northwind.example/p/1', 'shop.northwind.example', 'Northwind', 'Meridian Wool Runner',
  'USD', 98.00, 120.00, 'in_stock',
  '{"Size": "10"}'::jsonb,
  encode(extensions.digest('item-1', 'sha256'), 'hex'),
  '2026-07-26T12:00:00Z',
  'original note', 1, 'normal', null, 'saved'
);

-- ---------------------------------------------------------------------------
-- A client may change its own fields
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

update public.items
set note = 'a better note',
    quantity = 3,
    priority = 'high',
    desired_price = 75.00,
    status = 'cart'
where id = '22220000-0000-4000-8000-000000000001';

reset role;

select is(
  (select note from public.items where id = '22220000-0000-4000-8000-000000000001'),
  'a better note',
  'a client can edit the note'
);

select is(
  (select quantity from public.items where id = '22220000-0000-4000-8000-000000000001'),
  3,
  'a client can edit the quantity'
);

select is(
  (select priority::text from public.items where id = '22220000-0000-4000-8000-000000000001'),
  'high',
  'a client can edit the priority'
);

select is(
  (select desired_price from public.items where id = '22220000-0000-4000-8000-000000000001'),
  75.00::numeric,
  'a client can set a desired price'
);

select is(
  (select status::text from public.items where id = '22220000-0000-4000-8000-000000000001'),
  'cart',
  'a client can move an item to the cart state'
);

-- ---------------------------------------------------------------------------
-- A client may not rewrite what the retailer said
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

update public.items
set title = 'Something I made up',
    current_price = 1.00,
    original_price = 2.00,
    currency = 'EUR',
    availability = 'out_of_stock',
    retailer_name = 'Definitely Not Northwind',
    image_url = 'https://evil.example/pixel.png',
    selected_variant = '{"Size": "42"}'::jsonb,
    last_observed_at = now(),
    extraction_confidence = 1
where id = '22220000-0000-4000-8000-000000000001';

reset role;

select is(
  (select title from public.items where id = '22220000-0000-4000-8000-000000000001'),
  'Meridian Wool Runner',
  'a client cannot rewrite the observed title'
);

select is(
  (select current_price from public.items where id = '22220000-0000-4000-8000-000000000001'),
  98.00::numeric,
  'a client cannot rewrite the observed price'
);

select is(
  (select original_price from public.items where id = '22220000-0000-4000-8000-000000000001'),
  120.00::numeric,
  'a client cannot rewrite the observed original price'
);

select is(
  (select currency from public.items where id = '22220000-0000-4000-8000-000000000001'),
  'USD',
  'a client cannot rewrite the observed currency'
);

select is(
  (select availability::text from public.items where id = '22220000-0000-4000-8000-000000000001'),
  'in_stock',
  'a client cannot rewrite the observed availability'
);

select is(
  (select retailer_name from public.items where id = '22220000-0000-4000-8000-000000000001'),
  'Northwind',
  'a client cannot rewrite the retailer name'
);

select is(
  (select selected_variant from public.items where id = '22220000-0000-4000-8000-000000000001'),
  '{"Size": "10"}'::jsonb,
  'a client cannot rewrite the observed variant'
);

select is(
  (select last_observed_at from public.items where id = '22220000-0000-4000-8000-000000000001'),
  '2026-07-26T12:00:00Z'::timestamptz,
  'a client cannot fake a fresh observation'
);

-- ---------------------------------------------------------------------------
-- The user's edits are still there afterwards
-- ---------------------------------------------------------------------------

select is(
  (select note from public.items where id = '22220000-0000-4000-8000-000000000001'),
  'a better note',
  'the rejected write did not disturb the user fields'
);

select * from finish();
rollback;
