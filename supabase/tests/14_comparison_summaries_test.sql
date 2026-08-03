-- Phase 8 — comparison_summaries (BUILD_PLAN.md §16.2).
--
-- The claims: an AI summary is readable and creatable by anyone who can read the cart (comparison
-- is available to viewers too), scoped to that cart, and stored with its provenance; a stranger
-- can neither read nor write one, a user cannot forge another's authorship, the set fingerprint is
-- unique per cart, and an anonymous request sees nothing. The grounding/refusal guardrails are
-- unit-tested in features/compare; here the table and its access are what matter.

begin;
create extension if not exists pgtap;

select plan(12);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a0000000-0000-4000-8000-000000000001', 'owner@example.com', '{}'::jsonb),
  ('b0000000-0000-4000-8000-000000000002', 'viewer@example.com', '{}'::jsonb),
  ('d0000000-0000-4000-8000-000000000004', 'stranger@example.com', '{}'::jsonb);

insert into public.carts (id, owner_id, name, is_default)
values ('11110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Cart', false);

insert into public.cart_members (cart_id, user_id, role)
values
  ('11110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('11110000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'viewer');

create or replace function pg_temp.summary_json()
returns jsonb language sql as $$
  select '{"overview":"Two parkas; Item 2 is cheaper.","points":[],"missingData":[]}'::jsonb
$$;

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

select has_table('public'::name, 'comparison_summaries'::name, 'the comparison_summaries table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.comparison_summaries'::regclass),
  'row level security is enabled'
);

-- ---------------------------------------------------------------------------
-- The owner creates and reads a summary, with provenance
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$insert into public.comparison_summaries (cart_id, set_fingerprint, item_ids, model, prompt_version, summary)
    values ('11110000-0000-4000-8000-000000000001', 'fp-owner-1', array[]::uuid[],
            'claude-opus-5', '2026-08-03.1', pg_temp.summary_json())$$,
  'the owner can create a summary for their cart'
);

select is(
  (select model from public.comparison_summaries where set_fingerprint = 'fp-owner-1'),
  'claude-opus-5',
  'the model that produced the summary is stored as provenance'
);

select is(
  (select prompt_version from public.comparison_summaries where set_fingerprint = 'fp-owner-1'),
  '2026-08-03.1',
  'the prompt version is stored as provenance'
);

-- The same set of facts in the same cart is cached once, not billed twice.
select throws_ok(
  $$insert into public.comparison_summaries (cart_id, set_fingerprint, item_ids, model, prompt_version, summary)
    values ('11110000-0000-4000-8000-000000000001', 'fp-owner-1', array[]::uuid[],
            'claude-opus-5', '2026-08-03.1', pg_temp.summary_json())$$,
  '23505', null,
  'the same fingerprint cannot be stored twice for one cart'
);

-- A user cannot forge another user's authorship.
select throws_ok(
  $$insert into public.comparison_summaries (cart_id, set_fingerprint, item_ids, model, prompt_version, summary, created_by)
    values ('11110000-0000-4000-8000-000000000001', 'fp-forged', array[]::uuid[],
            'claude-opus-5', '2026-08-03.1', pg_temp.summary_json(),
            'd0000000-0000-4000-8000-000000000004')$$,
  '42501', null,
  'a user cannot attribute a summary to someone else'
);
reset role;

-- ---------------------------------------------------------------------------
-- A viewer may summarize and read; a stranger may do neither
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "b0000000-0000-4000-8000-000000000002", "role": "authenticated"}';
select lives_ok(
  $$insert into public.comparison_summaries (cart_id, set_fingerprint, item_ids, model, prompt_version, summary)
    values ('11110000-0000-4000-8000-000000000001', 'fp-viewer-1', array[]::uuid[],
            'claude-opus-5', '2026-08-03.1', pg_temp.summary_json())$$,
  'a viewer can create a summary for a cart they can read'
);
select is(
  (select count(*) from public.comparison_summaries where cart_id = '11110000-0000-4000-8000-000000000001'),
  2::bigint,
  'a viewer reads every summary in the cart'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-000000000004", "role": "authenticated"}';
select is(
  (select count(*) from public.comparison_summaries),
  0::bigint,
  'a stranger sees no summaries at all'
);
select throws_ok(
  $$insert into public.comparison_summaries (cart_id, set_fingerprint, item_ids, model, prompt_version, summary)
    values ('11110000-0000-4000-8000-000000000001', 'fp-stranger', array[]::uuid[],
            'claude-opus-5', '2026-08-03.1', pg_temp.summary_json())$$,
  '42501', null,
  'a stranger cannot create a summary in a cart they cannot read'
);
reset role;

set local role anon;
select throws_ok(
  'select count(*) from public.comparison_summaries',
  '42501', null,
  'an anonymous request is denied outright'
);
reset role;

select * from finish();
rollback;
