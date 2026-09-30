-- T12 reliability — RPC-side selection of terminal research jobs
-- missing certification.
--
-- Migration 0031 is unchanged. This adds a small, additive RPC used
-- exclusively by the drain-embedded reconciliation service to heal
-- transient certification-write losses.
--
-- Why an RPC instead of application pagination:
--
--   * Application-level pagination is only starvation-safe if it can
--     persist scan progress across drain invocations. Without that,
--     an unbounded pool of NEWER certified terminal jobs can hide an
--     older uncertified one forever (the scan cap is reached before
--     the boundary is crossed).
--
--   * An RPC with NOT EXISTS applies LIMIT to MISSING rows directly:
--     Postgres filters certified jobs OUT before LIMIT, so any
--     uncertified terminal job is discoverable in a single bounded
--     invocation regardless of how many certified rows precede it.
--
-- Determinism:
--
--   ORDER BY completed_at DESC, id DESC
--
--   is a total, deterministic key. Rows sharing the exact same
--   completed_at timestamp are ordered by id (also a UUID; total),
--   so no row is ever skipped by a page boundary.
--
-- Bounded:
--
--   The RPC takes an explicit `p_limit` and clamps it server-side to
--   [1, 50]. The default of 5 matches the drain reconciliation
--   budget. There is no pagination — the query naturally applies
--   LIMIT to missing rows, so a single bounded call always makes
--   progress if any missing rows exist.
--
-- Workspace scoping:
--
--   The anti-join matches BOTH `job_id` and `workspace_id`. This is
--   defense-in-depth: `job_id` is already globally unique (UUID) and
--   each row is FK-bound to one workspace via
--   `(job_id, workspace_id) references buyer_trade_research_jobs(id, workspace_id)`,
--   so pair-matching is redundant for correctness but ensures a
--   future hypothetical corrupted cert row cannot mask a job in a
--   different workspace.
--
-- Privilege:
--
--   Marked `security invoker`. The drain worker calls it as
--   service_role, which already has SELECT on both tables via 0025
--   and 0031. RLS on the certifications table remains untouched:
--   authenticated users continue to see workspace-scoped rows only
--   via the existing member SELECT policy.

create or replace function public.select_terminal_research_jobs_missing_certification(p_limit int)
returns setof public.buyer_trade_research_jobs
language sql
stable
security invoker
set search_path = ''
as $$
  select j.*
    from public.buyer_trade_research_jobs j
   where j.status in ('completed','partial','needs_review','failed','cancelled')
     and j.completed_at is not null
     and not exists (
       select 1
         from public.buyer_trade_research_certifications c
        where c.job_id = j.id
          and c.workspace_id = j.workspace_id
     )
   order by j.completed_at desc, j.id desc
   limit greatest(1, least(50, coalesce(p_limit, 5)));
$$;

revoke all on function public.select_terminal_research_jobs_missing_certification(int) from public, anon, authenticated;
grant execute on function public.select_terminal_research_jobs_missing_certification(int) to service_role;

notify pgrst, 'reload schema';
