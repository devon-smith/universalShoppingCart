-- Phase 8 — provenance store + cache for AI comparison summaries (BUILD_PLAN.md §16.2).
--
-- Every AI summary is stored with the model and prompt version that produced it (§16.2 requires
-- recording provenance), and the store doubles as a cache so the same set of facts is not billed
-- to the provider twice. It is a *derived* artifact, kept in its own table: the AI never touches
-- an item's fields, so a summary can never overwrite a deterministic value (§16.2).
--
-- The cache key is `set_fingerprint` — a hash of the exact grounded facts plus the model and
-- prompt version, computed in the app (packages: features/compare/summary `factsFingerprintInput`,
-- then sha256). Because the prompt version is inside the fingerprint, bumping the prompt yields a
-- new key and regenerates rather than serving a stale summary. The DB only stores and uniques the
-- string; it does not hash, so the two sides cannot drift over a hash implementation.

create table public.comparison_summaries (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  -- app-computed sha256 of the grounded facts + model + prompt version; the cache key.
  set_fingerprint text not null,
  -- the items summarized, for reference and debugging. The fingerprint, not this, is the key.
  item_ids uuid[] not null,
  model text not null,
  prompt_version text not null,
  -- the validated summary object (overview / points / missingData). Escaped before render.
  summary jsonb not null,
  created_by uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now()
);

comment on table public.comparison_summaries is
  'AI comparison summaries with model/prompt-version provenance (BUILD_PLAN.md §16.2). Derived and '
  'user-scoped: read/created by anyone who can read the cart; never overwrites item fields. '
  'Doubles as a cache keyed on set_fingerprint.';

-- One cached summary per set of facts per cart. A prompt-version or model change changes the
-- fingerprint, so it does not collide with the older row.
create unique index comparison_summaries_cache_idx
  on public.comparison_summaries (cart_id, set_fingerprint);

alter table public.comparison_summaries enable row level security;

-- A user may read a summary for any cart they can read — the same gate as the items it compares.
create policy comparison_summaries_select_readable
  on public.comparison_summaries for select
  to authenticated
  using (public.can_read_cart(cart_id));

-- A user may create a summary for a cart they can read (comparison is available to viewers), and
-- only as themselves. No update or delete policy: a cached summary is immutable, and a prompt
-- change supersedes it by fingerprint rather than mutating it.
create policy comparison_summaries_insert_readable
  on public.comparison_summaries for insert
  to authenticated
  with check (public.can_read_cart(cart_id) and created_by = (select auth.uid()));

-- A policy filters rows; the grant confers the privilege. RLS is what makes it safe. Only
-- authenticated — anon gets nothing — and no delete/update grant, so rows are immutable.
grant select, insert on public.comparison_summaries to authenticated;
