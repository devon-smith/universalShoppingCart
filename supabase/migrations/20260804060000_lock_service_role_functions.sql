-- Phase 7 hardening — service_role-only functions must be revoked from anon AND authenticated,
-- not only from PUBLIC (BUILD_PLAN.md §8, §17.2).
--
-- The Phase 7 migrations grant these five to service_role and `revoke ... from public`. That is
-- enough on a local `supabase start` stack, whose pgTAP grant assertions therefore pass — but NOT
-- on a hosted Supabase project. Hosted runs `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT
-- EXECUTE ON FUNCTIONS TO anon, authenticated, service_role`, so every new public function is
-- granted to anon/authenticated *directly*, and revoking PUBLIC does not remove that. The result
-- on hosted (verified on the staging project, 2026-08-04): anon and authenticated could call all
-- five via PostgREST /rpc. Unlike the invitation RPCs, these have no in-body auth check — they
-- rely entirely on being service_role-only — so `record_background_observation` would let any
-- signed-in user rewrite any item's observed price/availability, `record_notification` inject
-- alerts, and so on. See docs/DECISIONS.md (2026-08-04).
--
-- Revoking explicitly from anon and authenticated closes it on every environment and is idempotent
-- (a no-op where the grant was never present, i.e. local).

revoke execute on function public.record_background_observation(
  uuid, text, text, text, text, text, text, real
) from anon, authenticated;

revoke execute on function public.record_notification(
  uuid, public.notification_type, text, text
) from anon, authenticated;

revoke execute on function public.enqueue_refresh_job(
  uuid, public.refresh_strategy
) from anon, authenticated;

revoke execute on function public.select_due_refresh_jobs(integer) from anon, authenticated;

revoke execute on function public.record_refresh_result(uuid, boolean) from anon, authenticated;
