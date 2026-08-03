-- Phase 6 — cart_invitations table, RLS, and constraints (BUILD_PLAN.md §8).
--
-- Slice A: the table and its policies, tested directly. The create/accept RPCs and their
-- flow (single-use, expiry, membership grant) are exercised in 09_cart_invitation_rpcs_test.
--
-- Role switching uses `set local role` + `request.jwt.claims`, the same path PostgREST takes
-- per request. A valid token_hash is any 64-char lowercase hex; here they are fabricated,
-- because this file tests the table, not the token minting.

begin;
create extension if not exists pgtap;

select plan(12);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', '{}'::jsonb),
  ('d0000000-0000-4000-8000-000000000004', 'stranger@example.com', '{}'::jsonb);

insert into public.carts (id, owner_id, name, is_default)
values ('11110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Shared cart', false);

-- ---------------------------------------------------------------------------
-- Anonymous users see nothing
-- ---------------------------------------------------------------------------

set local role anon;

select throws_ok(
  'select count(*) from public.cart_invitations',
  '42501',
  null,
  'anonymous requests are denied on cart_invitations'
);

reset role;

-- ---------------------------------------------------------------------------
-- The owner may create an invitation directly; it is scoped to their cart
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$insert into public.cart_invitations (id, cart_id, role, token_hash, invited_by, expires_at)
    values (
      '22220000-0000-4000-8000-000000000001',
      '11110000-0000-4000-8000-000000000001',
      'viewer',
      repeat('a', 64),
      'a0000000-0000-4000-8000-000000000001',
      now() + interval '7 days'
    )$$,
  'the owner can create an invitation for their own cart'
);

select is(
  (select count(*) from public.cart_invitations
   where cart_id = '11110000-0000-4000-8000-000000000001'),
  1::bigint,
  'the owner can read invitations for their cart'
);

-- role 'owner' is rejected by the table constraint, whoever writes it.
select throws_ok(
  $$insert into public.cart_invitations (cart_id, role, token_hash, invited_by, expires_at)
    values (
      '11110000-0000-4000-8000-000000000001', 'owner', repeat('b', 64),
      'a0000000-0000-4000-8000-000000000001', now() + interval '7 days'
    )$$,
  '23514',
  null,
  'an invitation cannot grant the owner role'
);

-- token_hash must be lowercase hex of length 64.
select throws_ok(
  $$insert into public.cart_invitations (cart_id, role, token_hash, invited_by, expires_at)
    values (
      '11110000-0000-4000-8000-000000000001', 'viewer', 'not-a-real-hash',
      'a0000000-0000-4000-8000-000000000001', now() + interval '7 days'
    )$$,
  '23514',
  null,
  'a malformed token hash is rejected'
);

-- accepted_at and accepted_by must be set together.
select throws_ok(
  $$insert into public.cart_invitations (cart_id, role, token_hash, invited_by, expires_at, accepted_at)
    values (
      '11110000-0000-4000-8000-000000000001', 'viewer', repeat('c', 64),
      'a0000000-0000-4000-8000-000000000001', now() + interval '7 days', now()
    )$$,
  '23514',
  null,
  'accepted_at without accepted_by is rejected'
);

-- The owner cannot forge invited_by to someone else (WITH CHECK: invited_by = auth.uid()).
select throws_ok(
  $$insert into public.cart_invitations (cart_id, role, token_hash, invited_by, expires_at)
    values (
      '11110000-0000-4000-8000-000000000001', 'viewer', repeat('d', 64),
      'd0000000-0000-4000-8000-000000000004', now() + interval '7 days'
    )$$,
  '42501',
  null,
  'invited_by cannot be forged to another user'
);

-- No UPDATE grant: a client cannot mark an invitation accepted or un-expire one.
select throws_ok(
  $$update public.cart_invitations set accepted_at = now()
    where id = '22220000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'a client cannot UPDATE an invitation (accepted_* is the accept RPC''s to write)'
);

reset role;

-- ---------------------------------------------------------------------------
-- A stranger can neither read, insert into, nor delete the owner's invitation
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-000000000004", "role": "authenticated"}';

select is(
  (select count(*) from public.cart_invitations
   where cart_id = '11110000-0000-4000-8000-000000000001'),
  0::bigint,
  'a stranger cannot read another cart''s invitations'
);

select throws_ok(
  $$insert into public.cart_invitations (cart_id, role, token_hash, invited_by, expires_at)
    values (
      '11110000-0000-4000-8000-000000000001', 'viewer', repeat('e', 64),
      'd0000000-0000-4000-8000-000000000004', now() + interval '7 days'
    )$$,
  '42501',
  null,
  'a stranger cannot create an invitation in a cart they do not own'
);

-- A denied DELETE matches no rows rather than raising; the state check follows.
delete from public.cart_invitations where id = '22220000-0000-4000-8000-000000000001';

reset role;

select is(
  (select count(*) from public.cart_invitations
   where id = '22220000-0000-4000-8000-000000000001'),
  1::bigint,
  'a stranger''s delete matches no rows'
);

-- ---------------------------------------------------------------------------
-- The owner may revoke (delete) their own invitation
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

delete from public.cart_invitations where id = '22220000-0000-4000-8000-000000000001';

reset role;

select is(
  (select count(*) from public.cart_invitations
   where id = '22220000-0000-4000-8000-000000000001'),
  0::bigint,
  'the owner can revoke their own invitation'
);

select * from finish();
rollback;
