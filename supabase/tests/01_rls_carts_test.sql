-- Phase 1 — Row Level Security for carts and memberships (BUILD_PLAN.md §8.2).
--
-- Four users:
--   owner    — owns the shared cart
--   editor   — membership role 'editor'
--   viewer   — membership role 'viewer'
--   stranger — no relationship to the shared cart at all
--
-- Role switching uses `set local role` plus `request.jwt.claims`, which is exactly what
-- PostgREST does per request, so these assertions exercise the same code path a real
-- client hits.

begin;
create extension if not exists pgtap;

select plan(18);

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

-- ---------------------------------------------------------------------------
-- Anonymous users see nothing
-- ---------------------------------------------------------------------------

set local role anon;

select throws_ok(
  'select count(*) from public.carts',
  '42501',
  null,
  'anonymous requests are denied on carts'
);

select throws_ok(
  'select count(*) from public.cart_members',
  '42501',
  null,
  'anonymous requests are denied on cart_members'
);

select throws_ok(
  'select count(*) from public.profiles',
  '42501',
  null,
  'anonymous requests are denied on profiles'
);

reset role;

-- ---------------------------------------------------------------------------
-- A stranger cannot see or touch another user's cart
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-000000000004", "role": "authenticated"}';

select is(
  (select count(*) from public.carts where id = '11110000-0000-4000-8000-000000000001'),
  0::bigint,
  'a stranger cannot read another user''s cart'
);

select is(
  (select count(*) from public.carts),
  1::bigint,
  'a stranger sees only their own default cart'
);

select is(
  (select count(*) from public.profiles),
  1::bigint,
  'a user sees only their own profile'
);

select throws_ok(
  $$insert into public.cart_members (cart_id, user_id, role)
    values ('11110000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'editor')$$,
  '42501',
  null,
  'a stranger cannot grant themselves membership in another user''s cart'
);

select throws_ok(
  $$insert into public.carts (owner_id, name)
    values ('a0000000-0000-4000-8000-000000000001', 'Cart owned by someone else')$$,
  '42501',
  null,
  'a user cannot create a cart owned by another user'
);

-- A denied UPDATE matches no rows rather than raising; the state check is below.
update public.carts set name = 'Renamed by stranger'
where id = '11110000-0000-4000-8000-000000000001';

reset role;

select is(
  (select name from public.carts where id = '11110000-0000-4000-8000-000000000001'),
  'Shared cart',
  'a stranger''s update matches no rows'
);

-- ---------------------------------------------------------------------------
-- Viewer: read yes, write no
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "c0000000-0000-4000-8000-000000000003", "role": "authenticated"}';

select is(
  (select name from public.carts where id = '11110000-0000-4000-8000-000000000001'),
  'Shared cart',
  'a viewer can read the shared cart'
);

update public.carts set name = 'Renamed by viewer'
where id = '11110000-0000-4000-8000-000000000001';

reset role;

select is(
  (select name from public.carts where id = '11110000-0000-4000-8000-000000000001'),
  'Shared cart',
  'a viewer cannot modify the shared cart'
);

-- ---------------------------------------------------------------------------
-- Editor: may update, may not delete
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "b0000000-0000-4000-8000-000000000002", "role": "authenticated"}';

update public.carts set name = 'Renamed by editor'
where id = '11110000-0000-4000-8000-000000000001';

delete from public.carts where id = '11110000-0000-4000-8000-000000000001';

select throws_ok(
  $$update public.carts
      set owner_id = 'b0000000-0000-4000-8000-000000000002'
      where id = '11110000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'nobody can reassign cart ownership'
);

reset role;

select is(
  (select name from public.carts where id = '11110000-0000-4000-8000-000000000001'),
  'Renamed by editor',
  'an editor can update the shared cart'
);

select is(
  (select count(*) from public.carts where id = '11110000-0000-4000-8000-000000000001'),
  1::bigint,
  'an editor cannot delete the cart'
);

-- ---------------------------------------------------------------------------
-- Revoking membership revokes access immediately
-- ---------------------------------------------------------------------------

delete from public.cart_members
where cart_id = '11110000-0000-4000-8000-000000000001'
  and user_id = 'c0000000-0000-4000-8000-000000000003';

set local role authenticated;
set local request.jwt.claims = '{"sub": "c0000000-0000-4000-8000-000000000003", "role": "authenticated"}';

select is(
  (select count(*) from public.carts where id = '11110000-0000-4000-8000-000000000001'),
  0::bigint,
  'removing a membership removes read access immediately'
);

reset role;

-- ---------------------------------------------------------------------------
-- Owner: full control
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$insert into public.cart_members (cart_id, user_id, role)
    values ('11110000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'viewer')$$,
  'the owner can add a member'
);

delete from public.carts where id = '11110000-0000-4000-8000-000000000001';

reset role;

select is(
  (select count(*) from public.carts where id = '11110000-0000-4000-8000-000000000001'),
  0::bigint,
  'the owner can delete the cart'
);

select is(
  (select count(*) from public.cart_members where cart_id = '11110000-0000-4000-8000-000000000001'),
  0::bigint,
  'deleting a cart cascades to its memberships'
);

select * from finish();
rollback;
