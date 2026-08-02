-- Phase 1 — new-user bootstrap.
--
-- On signup, every user gets a profile, exactly one default cart, and an owner
-- membership row for it. Doing this in a trigger rather than in client code means a
-- user who signs in from the extension first is in the same state as one who signs in
-- from the web app first, and there is no window in which a signed-in user has nowhere
-- to save a product.
--
-- Idempotency: `carts_one_default_per_owner` makes a second default cart impossible, and
-- every insert here tolerates a conflict, so a replayed trigger cannot duplicate anything.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart_id uuid;
  v_display_name text;
begin
  v_display_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), '')
  );

  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    v_display_name,
    nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), '')
  )
  on conflict (id) do nothing;

  insert into public.carts (owner_id, name, is_default)
  values (new.id, 'My cart', true)
  on conflict do nothing
  returning id into v_cart_id;

  -- v_cart_id is null when the default cart already existed, in which case its owner
  -- membership was written by the same earlier run.
  if v_cart_id is not null then
    insert into public.cart_members (cart_id, user_id, role)
    values (v_cart_id, new.id, 'owner')
    on conflict do nothing;
  end if;

  return new;
end;
$$;

comment on function public.handle_new_user is
  'Creates the profile, the single default cart, and its owner membership for a new user.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
