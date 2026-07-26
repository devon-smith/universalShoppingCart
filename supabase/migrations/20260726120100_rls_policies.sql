-- Phase 1 — Row Level Security.
--
-- Authorization model (BUILD_PLAN.md §8.1):
--   read a cart    — owner, or any cart_members row
--   edit a cart's contents — owner, or membership role 'owner'/'editor'
--   delete a cart  — owner only
--   manage members — owner only
--   viewer         — read, never write
--
-- `carts` and `cart_members` policies reference each other, which would recurse if each
-- policy queried the other table directly. The two SECURITY DEFINER helpers below break
-- the cycle: they bypass RLS on the tables they read, and both are restricted to
-- answering a yes/no question about the *calling* user, so they leak nothing.

create or replace function public.can_read_cart(p_cart_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.carts c
    where c.id = p_cart_id
      and c.owner_id = (select auth.uid())
  ) or exists (
    select 1
    from public.cart_members m
    where m.cart_id = p_cart_id
      and m.user_id = (select auth.uid())
  );
$$;

comment on function public.can_read_cart is
  'True when the calling user owns the cart or holds any membership in it.';

create or replace function public.can_edit_cart(p_cart_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.carts c
    where c.id = p_cart_id
      and c.owner_id = (select auth.uid())
  ) or exists (
    select 1
    from public.cart_members m
    where m.cart_id = p_cart_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'editor')
  );
$$;

comment on function public.can_edit_cart is
  'True when the calling user may modify the cart and, from Phase 2B, its items. '
  'Viewers are excluded.';

create or replace function public.owns_cart(p_cart_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.carts c
    where c.id = p_cart_id
      and c.owner_id = (select auth.uid())
  );
$$;

comment on function public.owns_cart is
  'True only for the cart owner. Deleting a cart and managing its members require this.';

revoke all on function public.can_read_cart(uuid) from public;
revoke all on function public.can_edit_cart(uuid) from public;
revoke all on function public.owns_cart(uuid) from public;
grant execute on function public.can_read_cart(uuid) to authenticated;
grant execute on function public.can_edit_cart(uuid) to authenticated;
grant execute on function public.owns_cart(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Profiles are created by the auth.users trigger. This policy exists only so a client
-- can self-heal a missing row for its own user; it can never create a row for anyone else.
create policy profiles_insert_own
  on public.profiles for insert
  to authenticated
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- carts
-- ---------------------------------------------------------------------------

alter table public.carts enable row level security;

create policy carts_select_readable
  on public.carts for select
  to authenticated
  using (public.can_read_cart(id));

create policy carts_insert_own
  on public.carts for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

-- Editors may rename a shared cart. Reassigning ownership is blocked by the
-- carts_freeze_owner trigger below rather than by WITH CHECK, because a policy check
-- sees only the proposed row and cannot tell an unchanged owner_id from a rewritten one.
create policy carts_update_editable
  on public.carts for update
  to authenticated
  using (public.can_edit_cart(id))
  with check (public.can_edit_cart(id));

create or replace function public.reject_cart_owner_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'cart owner_id is immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.reject_cart_owner_change is
  'Ownership transfer is not a supported operation; an UPDATE may never change owner_id.';

create trigger carts_freeze_owner
  before update on public.carts
  for each row execute function public.reject_cart_owner_change();

create policy carts_delete_owner
  on public.carts for delete
  to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- cart_members
-- ---------------------------------------------------------------------------

alter table public.cart_members enable row level security;

create policy cart_members_select_readable
  on public.cart_members for select
  to authenticated
  using (public.can_read_cart(cart_id));

create policy cart_members_insert_owner
  on public.cart_members for insert
  to authenticated
  with check (public.owns_cart(cart_id));

create policy cart_members_update_owner
  on public.cart_members for update
  to authenticated
  using (public.owns_cart(cart_id))
  with check (public.owns_cart(cart_id));

-- An owner may remove anyone; a member may remove themselves (leave a shared cart).
create policy cart_members_delete_owner_or_self
  on public.cart_members for delete
  to authenticated
  using (public.owns_cart(cart_id) or user_id = (select auth.uid()));
