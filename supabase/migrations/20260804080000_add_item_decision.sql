-- Decision groups: which purchase a saved candidate is for.
--
-- Long-horizon shopping compares different candidates for one purchase — three jackets, two
-- pairs of running shoes — often over days or weeks. The group is the decision's name
-- ("winter jacket"), free text authored by the user, and null means not yet assigned.
--
-- A column on items, not a table: a group has no life of its own — no metadata, no sharing,
-- no membership beyond the items that carry its name — so a `decision_groups` table would be
-- structure ahead of need (see docs/DECISIONS.md, 2026-08-04). User-authored, so the ingest
-- function never writes it and a retailer refresh cannot erase it (BUILD_PLAN.md §13.2).
alter table public.items
  add column decision text
  check (decision is null or char_length(decision) between 1 and 120);
