-- Phase 6 — create_cart_invitation / accept_cart_invitation flow (BUILD_PLAN.md §8.2, §8.3).
--
-- The raw token is returned once by create and never stored, so the test carries it across
-- role switches in a session GUC (test.invite) rather than reading it back from the table —
-- reading it back is exactly what the design makes impossible.

begin;
create extension if not exists pgtap;

select plan(13);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', '{}'::jsonb),
  ('b0000000-0000-4000-8000-000000000002', 'invitee@example.com', '{}'::jsonb),
  ('d0000000-0000-4000-8000-000000000004', 'stranger@example.com', '{}'::jsonb);

insert into public.carts (id, owner_id, name, is_default)
values ('11110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Shared cart', false);

-- ---------------------------------------------------------------------------
-- The owner mints an invitation and gets the raw token back exactly once
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select set_config(
  'test.invite',
  public.create_cart_invitation(
    '11110000-0000-4000-8000-000000000001', 'viewer', 'friend@example.com', interval '7 days'
  )::text,
  false
);

select matches(
  (current_setting('test.invite')::jsonb ->> 'token'),
  '^[0-9a-f]{64}$',
  'create_cart_invitation returns a 64-hex bearer token'
);

select isnt(
  (select token_hash from public.cart_invitations
   where id = (current_setting('test.invite')::jsonb ->> 'id')::uuid),
  (current_setting('test.invite')::jsonb ->> 'token'),
  'the raw token is never stored — the row holds only its hash'
);

select throws_ok(
  $$select public.create_cart_invitation('11110000-0000-4000-8000-000000000001', 'owner')$$,
  '23514',
  null,
  'an invitation cannot be minted for the owner role'
);

reset role;

-- ---------------------------------------------------------------------------
-- A non-owner cannot mint an invitation
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-000000000004", "role": "authenticated"}';

select throws_ok(
  $$select public.create_cart_invitation('11110000-0000-4000-8000-000000000001', 'viewer')$$,
  '42501',
  null,
  'a non-owner cannot create an invitation'
);

reset role;

-- ---------------------------------------------------------------------------
-- The invitee accepts, joins as a viewer, and the token is then spent
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "b0000000-0000-4000-8000-000000000002", "role": "authenticated"}';

select is(
  (select count(*) from public.cart_members
   where cart_id = '11110000-0000-4000-8000-000000000001'
     and user_id = 'b0000000-0000-4000-8000-000000000002'),
  0::bigint,
  'the invitee is not a member before accepting'
);

select lives_ok(
  $$select public.accept_cart_invitation((current_setting('test.invite')::jsonb ->> 'token'))$$,
  'the invitee accepts with the raw token'
);

select is(
  (select role::text from public.cart_members
   where cart_id = '11110000-0000-4000-8000-000000000001'
     and user_id = 'b0000000-0000-4000-8000-000000000002'),
  'viewer',
  'accepting grants exactly the invited role'
);

select is(
  (select count(*) from public.carts where id = '11110000-0000-4000-8000-000000000001'),
  1::bigint,
  'the invitee can now read the shared cart'
);

-- A viewer's rename matches no rows (RLS); the state check follows the reset.
update public.carts set name = 'Renamed by invitee'
where id = '11110000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.accept_cart_invitation((current_setting('test.invite')::jsonb ->> 'token'))$$,
  '22023',
  null,
  'an invitation cannot be accepted twice'
);

reset role;

select is(
  (select name from public.carts where id = '11110000-0000-4000-8000-000000000001'),
  'Shared cart',
  'the invitee joined as a viewer and cannot rename the cart'
);

-- ---------------------------------------------------------------------------
-- Expired, unknown, and malformed tokens are all refused
-- ---------------------------------------------------------------------------

-- Inserted as the test superuser (bypasses RLS), with the hash of a known raw token so it can
-- then be presented to accept. expires_at is in the past.
insert into public.cart_invitations (id, cart_id, role, token_hash, invited_by, expires_at)
values (
  '22220000-0000-4000-8000-000000000009',
  '11110000-0000-4000-8000-000000000001',
  'viewer',
  encode(extensions.digest(repeat('f', 64), 'sha256'), 'hex'),
  'a0000000-0000-4000-8000-000000000001',
  now() - interval '1 hour'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "b0000000-0000-4000-8000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.accept_cart_invitation(repeat('f', 64))$$,
  '22023',
  null,
  'an expired invitation cannot be accepted'
);

select throws_ok(
  $$select public.accept_cart_invitation(repeat('0', 64))$$,
  -- no_data_found resolves to PL/pgSQL's P0002, not the SQL-standard 02000 (which is `no_data`).
  'P0002',
  null,
  'an unknown token is rejected'
);

select throws_ok(
  $$select public.accept_cart_invitation('too-short')$$,
  '22P02',
  null,
  'a malformed token is rejected'
);

reset role;

select * from finish();
rollback;
