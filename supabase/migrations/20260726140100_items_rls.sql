-- Phase 2B — Row Level Security for items and observations.
--
-- Access follows the cart: if you can read the cart you can read its items, and if you can
-- edit the cart you can write them. The predicates from Phase 1 are reused, so there is
-- exactly one definition of "can edit this cart" in the schema.

alter table public.items enable row level security;

create policy items_select_readable
  on public.items for select
  to authenticated
  using (public.can_read_cart(cart_id));

-- A user may only create items attributed to themselves, in a cart they can edit.
create policy items_insert_editable
  on public.items for insert
  to authenticated
  with check (public.can_edit_cart(cart_id) and created_by = (select auth.uid()));

create policy items_update_editable
  on public.items for update
  to authenticated
  using (public.can_edit_cart(cart_id))
  with check (public.can_edit_cart(cart_id));

create policy items_delete_editable
  on public.items for delete
  to authenticated
  using (public.can_edit_cart(cart_id));

alter table public.item_observations enable row level security;

create policy item_observations_select_readable
  on public.item_observations for select
  to authenticated
  using (
    exists (
      select 1
      from public.items i
      where i.id = item_observations.item_id
        and public.can_read_cart(i.cart_id)
    )
  );

-- No INSERT, UPDATE, or DELETE policy: observations are written only by
-- `ingest_product_capture`, which is SECURITY DEFINER. Price history that a client can
-- rewrite is not history.
