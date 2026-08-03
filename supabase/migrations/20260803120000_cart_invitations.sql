-- Phase 6 — shared-cart invitations (BUILD_PLAN.md §7.6, §8).
--
-- A bearer-token invitation: the raw token is the capability, returned once from
-- create_cart_invitation (next migration) and never stored. Only its SHA-256 hash lives
-- here, so a leak of this table cannot be replayed into access. Acceptance runs through
-- accept_cart_invitation (SECURITY DEFINER), which is why an invitee needs no RLS read on
-- this table at all — they present the token to the function, they never select the row.

-- pgcrypto supplies digest() and gen_random_bytes(). Supabase installs it in the
-- `extensions` schema; the functions that use it run with `search_path = ''`, so they
-- schema-qualify as extensions.digest / extensions.gen_random_bytes.
create extension if not exists pgcrypto with schema extensions;

create table public.cart_invitations (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  -- Informational only: who it was sent to, for the owner's pending-invites list. Acceptance
  -- is by token, not by email — a bearer link, so this is display, never an access check.
  email text
    constraint cart_invitations_email_shape
      check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- editor or viewer only. Ownership is carts.owner_id and is immutable
  -- (reject_cart_owner_change), so it cannot be handed out through an invitation.
  role public.cart_role not null
    constraint cart_invitations_role_not_owner check (role <> 'owner'),
  -- SHA-256 hex of the raw token. Unique, so a duplicate or collision cannot fork state.
  token_hash text not null
    constraint cart_invitations_token_hash_shape check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cart_invitations_token_hash_key unique (token_hash),
  -- accepted_at and accepted_by are written together by the accept RPC, or not at all.
  constraint cart_invitations_accepted_pair check (
    (accepted_at is null) = (accepted_by is null)
  )
);

comment on table public.cart_invitations is
  'Bearer-token invitations to shared carts. Stores only the token hash; the raw token is '
  'returned once at creation. Acceptance is via accept_cart_invitation, so invitees never '
  'read this table directly.';

create index cart_invitations_cart_id_idx on public.cart_invitations (cart_id);

-- The owner's management view: pending invitations for a cart, newest first.
create index cart_invitations_cart_pending_idx
  on public.cart_invitations (cart_id, created_at desc)
  where accepted_at is null;

create trigger cart_invitations_set_updated_at
  before update on public.cart_invitations
  for each row execute function public.set_updated_at();

-- New entities are not auto-exposed to the Data API roles. `anon` receives nothing.
grant select, insert, delete on public.cart_invitations to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Owner-only for every direct operation. The invitee never touches this table through the
-- Data API; they present the raw token to accept_cart_invitation, which runs as definer and
-- bypasses RLS. There is deliberately NO update policy and NO update grant: accepted_at and
-- accepted_by are writable only by the SECURITY DEFINER accept RPC, so a client can neither
-- mark an invitation accepted nor un-expire one.
-- ---------------------------------------------------------------------------

alter table public.cart_invitations enable row level security;

create policy cart_invitations_select_owner
  on public.cart_invitations for select
  to authenticated
  using (public.owns_cart(cart_id));

-- Only the owner may invite, and only in their own name. Role validity (never 'owner') is the
-- cart_invitations_role_not_owner CHECK constraint's job — one authoritative guard that also
-- covers the definer create RPC, rather than a copy here that only covers direct client writes.
create policy cart_invitations_insert_owner
  on public.cart_invitations for insert
  to authenticated
  with check (
    public.owns_cart(cart_id)
    and invited_by = (select auth.uid())
  );

-- The owner may revoke a pending invitation by deleting it. Re-inviting mints a new row with
-- a fresh token rather than editing an old one.
create policy cart_invitations_delete_owner
  on public.cart_invitations for delete
  to authenticated
  using (public.owns_cart(cart_id));
