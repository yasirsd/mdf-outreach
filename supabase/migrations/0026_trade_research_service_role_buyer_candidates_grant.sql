-- MDF Outreach — BI4F Phase 2A, additive privilege repair.
--
-- Production symptom (2026-09-27):
--   POST /api/internal/trade-research/drain returned
--     { outcome: "failed", safe_error_code: "DATABASE_42501",
--       claimed: 1, requeued: 1, failed: 1, automatic_spend_rupees: 0 }
-- claim_buyer_trade_research_job succeeded, and the outer
-- recoverClaimedJob path (SELECT on buyer_trade_research_jobs +
-- release_buyer_trade_research_job) also succeeded. The 42501 was
-- raised strictly between claim and finalize.
--
-- Post-claim trace inside processTradeResearchJob:
--   • writer.isCancellationRequested  → SELECT public.buyer_trade_research_batches      (0025 grants service_role)
--   • writer.advance                  → RPC advance_buyer_trade_research_job            (0025 grants service_role)
--   • writer.getEligiblePlan          → SELECT public.buyer_trade_research_provider_plans (0025 grants service_role)
--   • writer.latestAttempt            → SELECT public.buyer_trade_research_attempts     (0025 grants service_role)
--   • writer.getFreshSnapshot         → SELECT public.buyer_trade_source_snapshots      (0025 grants service_role)
--   • writer.startAttempt             → INSERT public.buyer_trade_research_attempts     (0025 grants service_role)
--   • writer.appendEvent              → INSERT public.buyer_trade_research_events       (0025 grants service_role)
--   • writer.finishAttempt            → UPDATE public.buyer_trade_research_attempts     (0025 grants service_role)
--   • writer.advance                  → RPC (grant)
--   • writer.getCandidate             → SELECT public.buyer_candidates                  ← ONLY GRANT MISSING FOR service_role
--   • writer.appendEvent              → INSERT (grant)
--   • writer.advance / writer.finalize → RPCs (grants)
--
-- Migration 0010 established public.buyer_candidates with RLS +
-- explicit grants to `authenticated` only, and revoked from
-- anon/authenticated/public. `service_role` was never granted.
-- Migration 0025 introduced the durable server-only trade-research
-- worker which — from processTradeResearchJob only, via
-- TradeResearchWriter.getCandidate — must read the buyer candidate
-- row to feed the FDA FSVP matcher. That single SELECT is the
-- operation raising SQLSTATE 42501 in production.
--
-- FIX: additive, minimum, service_role-only, SELECT-only.
-- We do NOT touch RLS, do NOT widen authenticated or anon, do NOT
-- add any mutation privilege on this table, and do NOT alter
-- migrations 0010 or 0025. Every other privilege setup in the live
-- schema is preserved byte-identical.
--
-- Invariants explicitly preserved:
--   * RLS remains ENABLED on public.buyer_candidates.
--   * authenticated continues to read/write only via existing RLS
--     policies from migration 0010 — untouched.
--   * anon continues to have zero access — untouched.
--   * service_role gains ONLY the minimum privilege the server-only
--     trade-research worker needs: SELECT.
--   * No INSERT / UPDATE / DELETE for service_role on this table.
--   * No paid-provider RPC, no BI-ingest RPC, no buyer-intelligence
--     write path is added or widened.
--   * Automatic monetary spend contract (₹0) is unchanged.
--   * BUYER_SEND_ENABLED / BUYER_FINDER_HUNTER_REVEAL_ENABLED are
--     application-layer flags — unaffected.
--
-- Preflight (idempotent): the migration is safely re-runnable — the
-- underlying GRANT is idempotent in PostgreSQL and the notify is
-- side-effect-free.

grant select on public.buyer_candidates to service_role;

-- Verification (advisory): fail loudly at migration time if the grant
-- did not take effect for any reason. This runs inside the migration
-- transaction so a broken deployment is caught immediately.
do $mig_verify$
declare
  has_select boolean;
begin
  select bool_or(privilege_type = 'SELECT')
    into has_select
    from information_schema.role_table_grants
    where grantee = 'service_role'
      and table_schema = 'public'
      and table_name = 'buyer_candidates';
  if not coalesce(has_select, false) then
    raise exception 'BI4F 2A repair: service_role SELECT on public.buyer_candidates did not take effect';
  end if;
end
$mig_verify$;

notify pgrst, 'reload schema';
