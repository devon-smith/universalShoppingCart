-- Phase 1 — new-user bootstrap.
--
-- Everything runs inside a transaction that is rolled back, including the pgTAP
-- extension itself, so the test leaves no trace in the database.

begin;
create extension if not exists pgtap;

select plan(9);

insert into auth.users (id, email, raw_user_meta_data)
values (
  '11111111-1111-1111-1111-111111111111',
  'ada@example.com',
  '{"full_name": "Ada Lovelace", "avatar_url": "https://example.com/ada.png"}'::jsonb
);

insert into auth.users (id, email, raw_user_meta_data)
values ('22222222-2222-2222-2222-222222222222', 'grace@example.com', '{}'::jsonb);

-- Profile ------------------------------------------------------------------

select is(
  (select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Ada Lovelace',
  'profile display_name comes from the identity provider metadata'
);

select is(
  (select avatar_url from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'https://example.com/ada.png',
  'profile avatar_url comes from the identity provider metadata'
);

select is(
  (select display_name from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'grace',
  'display_name falls back to the email local part when metadata carries no name'
);

select is(
  (select default_currency from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'USD',
  'profile gets a default currency'
);

-- Default cart -------------------------------------------------------------

select is(
  (select count(*) from public.carts where owner_id = '11111111-1111-1111-1111-111111111111'),
  1::bigint,
  'signup creates exactly one cart'
);

select is(
  (select is_default from public.carts where owner_id = '11111111-1111-1111-1111-111111111111'),
  true,
  'the created cart is the default cart'
);

select is(
  (
    select m.role::text
    from public.cart_members m
    join public.carts c on c.id = m.cart_id
    where c.owner_id = '11111111-1111-1111-1111-111111111111'
      and m.user_id = '11111111-1111-1111-1111-111111111111'
  ),
  'owner',
  'the owner also holds an owner membership row'
);

-- A second default cart is impossible even if application code asks for one.
select throws_ok(
  $$insert into public.carts (owner_id, name, is_default)
    values ('11111111-1111-1111-1111-111111111111', 'Second default', true)$$,
  '23505',
  null,
  'a user cannot end up with two default carts'
);

-- Non-default carts stay allowed; only the default is unique.
select lives_ok(
  $$insert into public.carts (owner_id, name, is_default)
    values ('11111111-1111-1111-1111-111111111111', 'Gifts', false)$$,
  'a user may own additional non-default carts'
);

select * from finish();
rollback;
