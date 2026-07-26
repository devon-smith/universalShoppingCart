-- Phase 1 — identity and cart ownership.
--
-- Three tables: one profile per authenticated user, carts owned by a user, and an
-- explicit membership row per (cart, user) carrying a role. Product items and
-- observations arrive in Phase 2B and are deliberately absent here.
--
-- Row Level Security policies live in the next migration; grants here open the tables
-- to the `authenticated` role only, and RLS decides which rows that role may touch.

create type public.cart_role as enum ('owner', 'editor', 'viewer');

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at is
  'Trigger helper: stamps updated_at on every UPDATE.';

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  -- ISO 4217. Used as the default when a capture carries no currency of its own.
  default_currency text not null default 'USD'
    constraint profiles_default_currency_iso4217 check (default_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per authenticated user. Created by the auth.users trigger, never by a client.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- carts
-- ---------------------------------------------------------------------------

create table public.carts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null
    constraint carts_name_not_blank check (length(btrim(name)) > 0),
  description text,
  default_currency text
    constraint carts_default_currency_iso4217 check (
      default_currency is null or default_currency ~ '^[A-Z]{3}$'
    ),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.carts is
  'A named list of saved products. Every user gets exactly one default cart at signup.';

-- Enforces "a default cart is created exactly once" at the database level rather than
-- trusting application code not to race with itself.
create unique index carts_one_default_per_owner
  on public.carts (owner_id)
  where is_default;

create index carts_owner_id_idx on public.carts (owner_id);

create trigger carts_set_updated_at
  before update on public.carts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- cart_members
-- ---------------------------------------------------------------------------

create table public.cart_members (
  cart_id uuid not null references public.carts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.cart_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (cart_id, user_id)
);

comment on table public.cart_members is
  'Access grants. The cart owner also holds an owner membership row so that member '
  'listings are complete; ownership itself is carts.owner_id.';

create index cart_members_user_id_idx on public.cart_members (user_id);

create trigger cart_members_set_updated_at
  before update on public.cart_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- New entities are not auto-exposed to the Data API roles, so access is granted
-- explicitly. `anon` receives nothing: an unauthenticated request must read no user data.

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.carts to authenticated;
grant select, insert, update, delete on public.cart_members to authenticated;
