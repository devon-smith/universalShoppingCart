# Data model

Current schema. Reference: [BUILD_PLAN.md](../BUILD_PLAN.md) §7–§8. Migrations live in
`supabase/migrations/` and are applied in filename order; the generated TypeScript shapes
are committed at `packages/contracts/src/database.types.ts` and refreshed with
`pnpm db:types`.

The user-authored / retailer-observed split described under `items` is the load-bearing
idea in this schema: a refresh may rewrite one group and may never touch the other.

## Tables

### `profiles`

One row per authenticated user, created by the `auth.users` trigger.

| Column             | Type          | Notes                                             |
| ------------------ | ------------- | ------------------------------------------------- |
| `id`               | `uuid` PK     | references `auth.users(id)`, cascade on delete    |
| `display_name`     | `text`        | from provider metadata, else the email local part |
| `avatar_url`       | `text`        | from provider metadata                            |
| `default_currency` | `text`        | ISO 4217, defaults to `USD`, format-checked       |
| `created_at`       | `timestamptz` |                                                   |
| `updated_at`       | `timestamptz` | maintained by trigger                             |

### `carts`

| Column             | Type          | Notes                                      |
| ------------------ | ------------- | ------------------------------------------ |
| `id`               | `uuid` PK     |                                            |
| `owner_id`         | `uuid`        | references `auth.users(id)`; **immutable** |
| `name`             | `text`        | non-blank                                  |
| `description`      | `text`        |                                            |
| `default_currency` | `text`        | ISO 4217 when present                      |
| `is_default`       | `boolean`     |                                            |
| `created_at`       | `timestamptz` |                                            |
| `updated_at`       | `timestamptz` | maintained by trigger                      |

Indexes: `carts_owner_id_idx (owner_id)`, and a **partial unique index**
`carts_one_default_per_owner (owner_id) where is_default`. That index is what makes
"exactly one default cart per user" a database guarantee rather than a convention.

Ownership transfer is not a supported operation: the `carts_freeze_owner` trigger rejects
any `UPDATE` that changes `owner_id`.

### `cart_members`

Access grants. The owner also holds an `owner` membership row so that member listings are
complete; authority itself comes from `carts.owner_id`.

| Column       | Type             | Notes                           |
| ------------ | ---------------- | ------------------------------- |
| `cart_id`    | `uuid`           | PK part, cascade on cart delete |
| `user_id`    | `uuid`           | PK part, cascade on user delete |
| `role`       | `cart_role` enum | `owner` \| `editor` \| `viewer` |
| `created_at` | `timestamptz`    |                                 |
| `updated_at` | `timestamptz`    | maintained by trigger           |

Index: `cart_members_user_id_idx (user_id)`.

### `items`

A saved product. The columns fall into three groups, and the grouping is the point.

**User-authored — a retailer refresh must never write these:**

| Column          | Type                 | Notes                                                           |
| --------------- | -------------------- | --------------------------------------------------------------- |
| `status`        | `item_status` enum   | `saved` \| `cart` \| `purchased` \| `archived`, default `saved` |
| `quantity`      | `integer`            | > 0, default 1                                                  |
| `note`          | `text`               | ≤ 2000 characters                                               |
| `priority`      | `item_priority` enum | `low` \| `normal` \| `high`                                     |
| `desired_price` | `numeric(20,6)`      | ≥ 0 when present                                                |

**Retailer-observed — rewritten on every capture and revisit:**

| Column                 | Type                     | Notes                                                                                                                |
| ---------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `source_url`           | `text`                   | the URL as visited                                                                                                   |
| `canonical_url`        | `text`                   | when the page provides one                                                                                           |
| `domain`               | `text`                   |                                                                                                                      |
| `retailer_name`        | `text`                   |                                                                                                                      |
| `title`                | `text`                   | non-blank                                                                                                            |
| `brand`                | `text`                   |                                                                                                                      |
| `description`          | `text`                   |                                                                                                                      |
| `composition`          | `text`                   | fibre content, raw and un-normalized — "100% cotton", "Shell: 100% wool; Lining: 52% polyester"; null when unstated  |
| `image_url`            | `text`                   |                                                                                                                      |
| `currency`             | `text`                   | ISO 4217 when present                                                                                                |
| `current_price`        | `numeric(20,6)`          | ≥ 0 when present                                                                                                     |
| `original_price`       | `numeric(20,6)`          | ≥ 0 when present                                                                                                     |
| `availability`         | `item_availability` enum | default `unknown`; the **selected variant's** availability                                                           |
| `product_availability` | `item_availability` enum | nullable; the page's product-level claim, kept only when it differs — "Nike still sells this shoe, your 6.5 is gone" |
| `selected_variant`     | `jsonb`                  | only what is selected                                                                                                |
| `identifiers`          | `jsonb`                  | sku / gtin / mpn / productId / variantId                                                                             |

**Provenance:** `fingerprint` (64 lowercase hex, checked), `extractor_id`,
`extractor_version`, `extraction_confidence` (0–1), `last_observed_at`, `created_by`.

Indexes: `(cart_id, status, updated_at desc)`, `(domain)`, `(created_by)`, and a **partial
unique index** `(cart_id, fingerprint) where status <> 'archived'`. That index is what
makes a re-save refresh rather than duplicate; excluding archived rows means archiving
something and saving it again works the way a user expects.

`cart_id` and `created_by` are immutable (`items_freeze_provenance`).

### `item_observations`

Append-only price and availability history. One row per genuine change, not per visit.

| Column                                            | Type                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `id`                                              | `bigint` identity                                                             |
| `item_id`                                         | `uuid`, cascade on delete                                                     |
| `observed_at`                                     | `timestamptz`                                                                 |
| `price`, `original_price`                         | `numeric(20,6)`                                                               |
| `currency`                                        | `text`                                                                        |
| `availability`                                    | `item_availability` enum                                                      |
| `source`                                          | `observation_source` enum: `capture` \| `revisit` \| `manual` \| `background` |
| `extractor_id`, `extractor_version`, `confidence` | provenance                                                                    |

Index: `(item_id, observed_at desc)`.

`authenticated` holds **select only**. Rows are written exclusively by
`ingest_product_capture`; price history a client can rewrite is not history.

## Views

### `item_price_summary`

One row per item with observations, so a dashboard can show a price-change badge without
fetching the whole series for every card.

| Column                                              | Meaning                                          |
| --------------------------------------------------- | ------------------------------------------------ |
| `item_id`                                           | the item                                         |
| `latest_price`, `latest_original_price`, `currency` | the newest observation                           |
| `latest_availability`, `latest_observed_at`         | the newest observation                           |
| `previous_price`, `previous_observed_at`            | the most recent observation whose price differed |
| `observation_count`                                 | every observation, including unchanged repeats   |

`previous_price` deliberately skips repeats: after three revisits at the same price, the
comparison a user wants is still against the price before it moved.

Declared `with (security_invoker = on)`, so the reader's RLS on `item_observations` applies
rather than the view owner's. A view is otherwise a way around row-level security.
`supabase/tests/04_revisit_refresh_test.sql` asserts a stranger sees no rows and `anon` is
refused outright.

## Functions and triggers

| Name                                     | Kind                    | Purpose                                              |
| ---------------------------------------- | ----------------------- | ---------------------------------------------------- |
| `public.set_updated_at()`                | trigger                 | stamps `updated_at` on update                        |
| `public.handle_new_user()`               | trigger on `auth.users` | creates profile, default cart, and owner membership  |
| `public.reject_cart_owner_change()`      | trigger                 | rejects any change to `carts.owner_id`               |
| `public.can_read_cart(uuid)`             | `security definer`      | owner or any member                                  |
| `public.can_edit_cart(uuid)`             | `security definer`      | owner or `owner`/`editor` member                     |
| `public.owns_cart(uuid)`                 | `security definer`      | owner only                                           |
| `public.reject_item_created_by_change()` | trigger                 | `items.created_by` and `items.cart_id` are immutable |
| `public.parse_money(text)`               | immutable               | decimal string → numeric, rejecting locale formats   |
| `public.observation_refresh_interval()`  | immutable               | how stale an unchanged observation may get (12h)     |
| `public.ingest_product_capture(...)`     | `security definer`      | atomic capture save; see below                       |

The three predicates are `security definer` to break the policy recursion between `carts`
and `cart_members`: each policy needs to consult the other table, which its own RLS would
otherwise re-enter. They answer a yes/no question about the calling user only, and
`EXECUTE` is granted to `authenticated` alone.

## Row Level Security

RLS is enabled on all three tables. `anon` has no grants at all, so an unauthenticated
request is rejected before any policy is consulted.

| Table          | select                   | insert                  | update              | delete                          |
| -------------- | ------------------------ | ----------------------- | ------------------- | ------------------------------- |
| `profiles`     | own row                  | own row                 | own row             | —                               |
| `carts`        | `can_read_cart(id)`      | `owner_id = auth.uid()` | `can_edit_cart(id)` | owner only                      |
| `cart_members` | `can_read_cart(cart_id)` | owner of the cart       | owner of the cart   | owner, or the member themselves |

| `items` | `can_read_cart(cart_id)` | `can_edit_cart` **and** `created_by = auth.uid()` | `can_edit_cart(cart_id)` | `can_edit_cart(cart_id)` |
| `item_observations` | via the item's cart | — (function only) | — | — |

Coverage lives in `supabase/tests/` and runs with `pnpm test:db` — 56 assertions.

## `ingest_product_capture`

```sql
ingest_product_capture(
  p_capture jsonb,
  p_cart_id uuid,
  p_fingerprint text,
  p_user_fields jsonb default '{}',
  p_source observation_source default 'capture'
) returns jsonb  -- { created, observationInserted, item }
```

One transaction rather than several client-side writes (BUILD_PLAN.md §8.3). In order it:

1. requires an authenticated caller and edit access to the destination cart;
2. rejects an unsupported `schemaVersion` instead of guessing at the payload;
3. rejects a fingerprint that is not 64 lowercase hex characters;
4. requires a title — a user correction wins over the extractor's value;
5. parses money with `parse_money`, so a locale-formatted string fails loudly rather than
   being silently truncated by a cast;
6. finds an active item with the same `(cart_id, fingerprint)`;
7. inserts it, or **refreshes only the retailer-observed columns**;
8. appends an observation only when a tracked value changed or the newest one is older
   than `observation_refresh_interval()`.

It is `SECURITY DEFINER` because it writes `item_observations`, so its access checks are
explicit in the body rather than delegated to RLS.

The fingerprint is computed by the client (`packages/extractors/src/fingerprint.ts`)
because the URL and variant normalization it depends on must produce identical values on
every surface. The server verifies its shape and scopes it to the cart, so a wrong value
can only affect the caller's own deduplication.

## Conventions

- Money will be stored as `numeric(20,6)` and carried in TypeScript as decimal strings.
  No floating-point money, anywhere (BUILD_PLAN.md §6.2).
- Retailer-observed fields and user-authored fields stay in separate columns so a refresh
  can never overwrite a note, priority, desired price, quantity, or status.
- Unknown values stay `null` or an explicit `unknown` enum member. Nothing is invented.
