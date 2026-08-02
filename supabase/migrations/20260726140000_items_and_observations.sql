-- Phase 2B — saved products and their observation history.
--
-- Two tables, and a hard separation running through both: retailer-observed fields
-- (price, availability, image, retailer title) live apart from user-authored fields
-- (note, quantity, priority, desired price, status). A refresh may rewrite the first
-- group and may never touch the second (BUILD_PLAN.md §13.2).
--
-- Money is `numeric(20,6)`. Never float: `0.1 + 0.2` is not a price.

create type public.item_status as enum ('saved', 'cart', 'purchased', 'archived');

create type public.item_availability as enum (
  'in_stock',
  'out_of_stock',
  'preorder',
  'backorder',
  'unknown'
);

create type public.item_priority as enum ('low', 'normal', 'high');

create type public.observation_source as enum ('capture', 'revisit', 'manual', 'background');

-- ---------------------------------------------------------------------------
-- items
-- ---------------------------------------------------------------------------

create table public.items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete restrict,

  -- ---- user-authored: a retailer refresh must never write these ----
  status public.item_status not null default 'saved',
  quantity integer not null default 1 constraint items_quantity_positive check (quantity > 0),
  note text constraint items_note_length check (note is null or length(note) <= 2000),
  priority public.item_priority not null default 'normal',
  desired_price numeric(20, 6) constraint items_desired_price_non_negative check (
    desired_price is null or desired_price >= 0
  ),

  -- ---- retailer-observed: refreshed on every capture and revisit ----
  source_url text not null,
  canonical_url text,
  domain text not null,
  retailer_name text not null,
  title text not null constraint items_title_not_blank check (length(btrim(title)) > 0),
  brand text,
  description text,
  image_url text,
  currency text constraint items_currency_iso4217 check (
    currency is null or currency ~ '^[A-Z]{3}$'
  ),
  current_price numeric(20, 6) constraint items_current_price_non_negative check (
    current_price is null or current_price >= 0
  ),
  original_price numeric(20, 6) constraint items_original_price_non_negative check (
    original_price is null or original_price >= 0
  ),
  availability public.item_availability not null default 'unknown',
  selected_variant jsonb not null default '{}'::jsonb,
  identifiers jsonb not null default '{}'::jsonb,

  -- ---- provenance ----
  fingerprint text not null constraint items_fingerprint_sha256 check (
    fingerprint ~ '^[0-9a-f]{64}$'
  ),
  extractor_id text,
  extractor_version text,
  extraction_confidence real constraint items_extraction_confidence_range check (
    extraction_confidence is null or (extraction_confidence >= 0 and extraction_confidence <= 1)
  ),
  last_observed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.items is
  'A saved product. Columns are grouped into user-authored and retailer-observed; see the '
  'migration source for which is which.';

create index items_cart_status_updated_idx on public.items (cart_id, status, updated_at desc);
create index items_domain_idx on public.items (domain);
create index items_created_by_idx on public.items (created_by);

-- Re-saving the same product and variant must refresh, not duplicate. Archived items are
-- excluded so that archiving something and saving it again works as the user expects.
create unique index items_cart_fingerprint_active_idx
  on public.items (cart_id, fingerprint)
  where status <> 'archived';

create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

-- `created_by` records who first saved the item; reassigning it would falsify history.
create or replace function public.reject_item_created_by_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'items.created_by is immutable'
      using errcode = 'check_violation';
  end if;
  if new.cart_id is distinct from old.cart_id then
    raise exception 'items.cart_id is immutable; save the product to the other cart instead'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger items_freeze_provenance
  before update on public.items
  for each row execute function public.reject_item_created_by_change();

-- ---------------------------------------------------------------------------
-- item_observations
-- ---------------------------------------------------------------------------

create table public.item_observations (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.items (id) on delete cascade,
  observed_at timestamptz not null default now(),
  price numeric(20, 6),
  original_price numeric(20, 6),
  currency text constraint item_observations_currency_iso4217 check (
    currency is null or currency ~ '^[A-Z]{3}$'
  ),
  availability public.item_availability not null default 'unknown',
  source public.observation_source not null,
  extractor_id text,
  extractor_version text,
  confidence real constraint item_observations_confidence_range check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  )
);

comment on table public.item_observations is
  'Append-only price and availability history. One row per genuine change, not per visit.';

create index item_observations_item_observed_idx
  on public.item_observations (item_id, observed_at desc);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Observations are written by the ingestion function, never by a client, so `authenticated`
-- gets read access only. Rewriting price history from a browser is not a capability this
-- product needs.

grant select, insert, update, delete on public.items to authenticated;
grant select on public.item_observations to authenticated;
