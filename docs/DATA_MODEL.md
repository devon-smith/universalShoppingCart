# Data model

Current schema. Reference: [BUILD_PLAN.md](../BUILD_PLAN.md) §7–§8. Migrations live in
`supabase/migrations/` and are applied in filename order; the generated TypeScript shapes
are committed at `packages/contracts/src/database.types.ts` and refreshed with
`pnpm db:types`.

Product tables (`items`, `item_observations`) arrive in Phase 2B and are deliberately
absent here.

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

## Functions and triggers

| Name                                | Kind                    | Purpose                                             |
| ----------------------------------- | ----------------------- | --------------------------------------------------- |
| `public.set_updated_at()`           | trigger                 | stamps `updated_at` on update                       |
| `public.handle_new_user()`          | trigger on `auth.users` | creates profile, default cart, and owner membership |
| `public.reject_cart_owner_change()` | trigger                 | rejects any change to `carts.owner_id`              |
| `public.can_read_cart(uuid)`        | `security definer`      | owner or any member                                 |
| `public.can_edit_cart(uuid)`        | `security definer`      | owner or `owner`/`editor` member                    |
| `public.owns_cart(uuid)`            | `security definer`      | owner only                                          |

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

Coverage lives in `supabase/tests/` and runs with `pnpm test:db`.

## Conventions

- Money will be stored as `numeric(20,6)` and carried in TypeScript as decimal strings.
  No floating-point money, anywhere (BUILD_PLAN.md §6.2).
- Retailer-observed fields and user-authored fields stay in separate columns so a refresh
  can never overwrite a note, priority, desired price, quantity, or status.
- Unknown values stay `null` or an explicit `unknown` enum member. Nothing is invented.
