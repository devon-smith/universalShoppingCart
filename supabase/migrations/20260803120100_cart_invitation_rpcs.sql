-- Phase 6 — invitation create/accept RPCs (BUILD_PLAN.md §8.3).
--
-- Both are SECURITY DEFINER: create writes a cart_invitations row after checking ownership in
-- the body (not via RLS, which it bypasses as owner), and accept writes cart_members and the
-- invitation's accepted_* columns, which no client may write directly. The raw token exists
-- only between create returning it and accept hashing it; the database stores only the hash.

-- ---------------------------------------------------------------------------
-- create_cart_invitation — owner-only. Mints a single-use bearer token, returns it ONCE.
-- ---------------------------------------------------------------------------

create or replace function public.create_cart_invitation(
  p_cart_id uuid,
  p_role public.cart_role,
  p_email text default null,
  p_ttl interval default interval '7 days'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_token text;
  v_token_hash text;
  v_id uuid;
  v_expires timestamptz := now() + p_ttl;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;
  -- Managing members is owner-only (§8.1); inviting is managing members.
  if not public.owns_cart(p_cart_id) then
    raise exception 'Only the cart owner may invite' using errcode = 'insufficient_privilege';
  end if;
  if p_role = 'owner' then
    raise exception 'Cannot invite as owner' using errcode = 'check_violation';
  end if;
  if p_ttl <= interval '0' then
    raise exception 'Invitation TTL must be positive' using errcode = 'check_violation';
  end if;

  -- 256 bits of randomness, hex-encoded to a 64-char url-safe token. Returned once below and
  -- never stored; only its SHA-256 is persisted, so this table cannot be replayed into access.
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.cart_invitations (cart_id, email, role, token_hash, invited_by, expires_at)
  values (
    p_cart_id,
    nullif(btrim(p_email), ''),
    p_role,
    v_token_hash,
    v_user_id,
    v_expires
  )
  returning id into v_id;

  -- The raw token leaves the database exactly here, and never again.
  return jsonb_build_object(
    'id', v_id,
    'token', v_token,
    'role', p_role,
    'expiresAt', v_expires
  );
end;
$$;

comment on function public.create_cart_invitation is
  'Owner-only. Mints a single-use bearer invitation and returns its raw token ONCE. Only the '
  'token hash is stored. Returns { id, token, role, expiresAt }.';

revoke all on function public.create_cart_invitation(uuid, public.cart_role, text, interval) from public;
grant execute on function public.create_cart_invitation(uuid, public.cart_role, text, interval) to authenticated;

-- ---------------------------------------------------------------------------
-- accept_cart_invitation — redeems a bearer token for the calling user.
-- ---------------------------------------------------------------------------

create or replace function public.accept_cart_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_token_hash text;
  v_inv public.cart_invitations%rowtype;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Malformed invitation token' using errcode = 'invalid_text_representation';
  end if;

  v_token_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  -- Lock the row so two concurrent accepts of the same token cannot both pass the single-use
  -- check and both grant membership.
  select * into v_inv
  from public.cart_invitations
  where token_hash = v_token_hash
  for update;

  if v_inv.id is null then
    raise exception 'Invitation not found' using errcode = 'no_data_found';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'Invitation already accepted' using errcode = 'invalid_parameter_value';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'Invitation has expired' using errcode = 'invalid_parameter_value';
  end if;

  -- Grant the membership. Idempotent, and it never downgrades: cart_role is declared
  -- owner < editor < viewer, so least(existing, invited) keeps the more-privileged of the two.
  -- An owner testing their own link stays owner; an editor is not demoted by a viewer invite.
  insert into public.cart_members (cart_id, user_id, role)
  values (v_inv.cart_id, v_user_id, v_inv.role)
  on conflict (cart_id, user_id) do update
    set role = least(cart_members.role, excluded.role);

  update public.cart_invitations
  set accepted_at = now(), accepted_by = v_user_id
  where id = v_inv.id;

  return jsonb_build_object('cartId', v_inv.cart_id, 'role', v_inv.role);
end;
$$;

comment on function public.accept_cart_invitation is
  'Redeems a bearer invitation token for the calling user: single-use, expiry-checked, adds a '
  'cart_members row (never downgrading an existing role). Returns { cartId, role }.';

revoke all on function public.accept_cart_invitation(text) from public;
grant execute on function public.accept_cart_invitation(text) to authenticated;
