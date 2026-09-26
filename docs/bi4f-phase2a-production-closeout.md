# BI4F Phase 2A — Production Closeout

Status: **CLOSED / PRODUCTION VALIDATED**
Closeout date: 2026-09-27
Automatic monetary spend: **₹0 hard limit — preserved**
Migrations 0025, 0026: **live and immutable**

---

## 1. Architecture summary

Phase 2A is a durable, resumable, zero-cost trade-research engine that operates independently of any browser session and cannot exceed the Vercel Hobby plan's 60 s serverless function ceiling. It is composed of:

- A workspace-scoped **batch → job → provider plan → attempt → event** hierarchy persisted in Postgres (migration 0025).
- A **shared public-dataset snapshot cache** keyed by provider + dataset + material hash (`public.buyer_trade_source_snapshots`).
- A **service-role worker** (`processTradeResearchJob`) that is deadline-aware, lease-owned, resume-idempotent, and free-provider-only.
- Three serverless entrypoints that all invoke the same worker with the same shared `createTradeResearchDeadline(startedAt)` helper:
  - Inline server action after batch create.
  - Vercel Cron `GET /api/cron/trade-research-drain` (recovery sweeper, `0 3 * * *` UTC).
  - Owner/manual `POST /api/internal/trade-research/drain` (QA / recovery).
- A read repository backed by an authenticated Supabase client (RLS-enforced).

---

## 2. Migrations

| Migration | Purpose | Status |
|---|---|---|
| `0025_buyer_trade_research_engine.sql` | Full engine schema: batches, jobs, provider plans, attempts, events, source snapshots. Triggers enforce terminal immutability, monotonic stage forward, events append-only, ₹0 spend. SECURITY INVOKER RPCs granted to `service_role` only. | **immutable** |
| `0026_trade_research_service_role_buyer_candidates_grant.sql` | Additive: `GRANT SELECT ON public.buyer_candidates TO service_role`. Repairs the post-claim 42501 raised by `TradeResearchWriter.getCandidate`. Preserves RLS, does not widen authenticated/anon, does not add mutation privileges. | **immutable** |

No further migrations are permitted in Phase 2A.

---

## 3. Provider semantics

**FDA FSVP is the sole Phase 2A provider.** The FDA Foreign Supplier Verification Programs participant list is a quarterly public workbook of U.S. food importer names + states.

FDA FSVP **may** establish:
- Official participant-list corroboration for a U.S. food importer.
- Company identity corroboration when name + state align.

FDA FSVP **does NOT** establish:
- Individual shipment evidence.
- India origin, Guntur origin.
- Product imported.
- Supplier / manufacturer.
- Quantity or value.
- CBP importer-of-record status.

Result decisions:
- `strong` identity → `outcome: official_importer_program_corroboration`, `officialProgramEvidence: verified`.
- `ambiguous` → `outcome: needs_review`, `officialProgramEvidence: needs_review`.
- `none` → `outcome: no_verified_evidence`, `officialProgramEvidence: no_verified_match`.
- Ineligible / unsupported coverage → `outcome: unsupported_coverage`, `sourcesChecked: 0`.

**No-match is not evidence that the company does not import. Needs-review is not verified identity.**

---

## 4. Execution architecture

Three serverless entrypoints, one worker:

- **Inline server action** [src/app/(app)/buyer-finder/tradeResearchActions.ts:113](../src/app/(app)/buyer-finder/tradeResearchActions.ts) — after `createTradeResearchBatchAction`, an awaited bounded drain kick executes so the first job typically reaches a terminal state before the button un-freezes. Bounded by `INLINE_KICK_MAX_ITERATIONS = 2`, `INLINE_KICK_HARD_CEILING_MS = 50_000`.
- **Vercel Cron GET** [src/app/api/cron/trade-research-drain/route.ts](../src/app/api/cron/trade-research-drain/route.ts) — `maxDuration = 60`, `0 3 * * *` UTC, timing-safe Bearer against `CRON_SECRET` or `TRADE_RESEARCH_DRAIN_SECRET`. Passive recovery sweeper.
- **Owner/manual POST** [src/app/api/internal/trade-research/drain/route.ts](../src/app/api/internal/trade-research/drain/route.ts) — `maxDuration = 60`, same-origin owner session OR bearer secret. Used for controlled QA and recovery.

All three call the shared worker via `drainTradeResearch({..., deadlineAt: createTradeResearchDeadline(started)})`. A repo-wide static scan test (`deadlineCallSites.test.ts`) enforces that every production call site plumbs `deadlineAt`.

---

## 5. Caching contract

- `public.buyer_trade_source_snapshots` — one row per (provider_id, dataset_id, material_hash).
- Freshness horizon: `expires_at`. Configured via `FDA_FSVP_DESCRIPTOR.cacheMaxAgeDays = 100`.
- Conditional refresh: ETag / Last-Modified honoured; a 304 refreshes `retrieved_at` + `expires_at` without re-parsing.
- Shared across all workspaces (deliberately no `workspace_id` on this table).
- Production evidence (2026-09-26): `provider_id=fda-fsvp, snapshot_count=1, fetched_at=2026-09-26 08:27:55.577+00, expires_at=2027-01-04 08:27:55.577+00`. Snapshot count remained 1 after multiple candidate runs across Iberia Foods, Savory Spice, Wixon, Sauer Brands, Newly Weds Foods, and McCormick — **proving shared cache reuse**.

---

## 6. Deadline / checkpoint architecture

- Shared helper: `createTradeResearchDeadline(startedAt = Date.now()): startedAt + TRADE_RESEARCH_SAFE_EXECUTION_MS`. Constants: `VERCEL_FUNCTION_MAX_MS = 60_000`, `TRADE_RESEARCH_SAFE_EXECUTION_MS = 50_000` — a minimum 10 s cleanup headroom under the Vercel Hobby ceiling.
- Two voluntary worker checkpoints inside `processTradeResearchJob`:
  - **Pre-FDA gate** — before the potentially expensive cold-fetch path. `requiredMs = FDA_COLD_PATH_WORST_CASE_MS (25_000)`. Skipped when a fresh cached snapshot already exists.
  - **Pre-match gate** — before matcher + finalize. `requiredMs = 5_000`.
- On budget-low: `writer.release(job, workerId, now + 2s)` + emit `job_checkpointed_runtime_budget`. Returns `"retry"`.
- Server-only. `worker.ts` opens with `import "server-only"`; no client component references the helper or the constants (static-scan enforced).

---

## 7. Recovery behavior

- **Resume-idempotent stage advance**: `PHASE_2A_STAGE_INDEX` compare — replaying `advanceStage` is a no-op past the persisted stage.
- **Attempt reuse**: previous attempts with `state ∈ {completed, skipped_cached}` are reused; no `startAttempt`, no `finishAttempt`, no re-fetch.
- **FDA cache reuse**: `getFreshSnapshot` probe before any deadline gate; cache hit → skip cold path.
- **Retry-wait release**: transient FDA glitch → `writer.finishAttempt(state: "retry_wait")` + `writer.release(job, workerId, now + retryDelayMs)`.
- **Outer catch recovery**: any thrown post-claim error → `writer.recoverClaimedJob(...)` which finishes a running attempt as `failed_retryable` and either `release`s the job (requeued) or `finalize`s as `cancelled` when the batch was cancel-requested.
- **Lease + CAS + SKIP LOCKED**: preserved end-to-end. Two overlapping drains cannot claim the same job.
- Cron schedule: `0 3 * * *` daily; a job that missed today's cron waits 24 h max unless the inline kick or manual drain picks it up first.

---

## 8. Production QA evidence

**Latitude 36 Foods recovery** — the job stalled during the pre-Phase-2A worker → was safely requeued after the Phase 2A worker landed → recovered by owner manual drain:
```
POST /api/internal/trade-research/drain
→ 200 { outcome: "processed", claimed: 1, processed: 1, completed: 1,
        failed: 0, requeued: 0, automatic_spend_rupees: 0 }
```

**Iberia Foods** — fresh one-click UI research:
- Sources checked: 1 (FDA FSVP)
- ₹0
- Matched: `IBERIA FOODS CORP.` (state: FL)
- Outcome: `needs_review` — candidate lacked unambiguous state, so identity decision was `ambiguous`.

---

## 9. Five-candidate production QA

| # | Candidate | Result | Matched | State | Sources | Spend |
|---|---|---|---|---|---|---|
| 1 | Savory Spice | No verified match found | — | — | 1 | ₹0 |
| 2 | Wixon | Needs review | WIXON, INC. | WI | 1 | ₹0 |
| 3 | Sauer Brands | Needs review | SAUER BRANDS INC. | VA | 1 | ₹0 |
| 4 | Newly Weds Foods | Needs review | NEWLY WEDS FOODS, LLC | IL | 1 | ₹0 |
| 5 | McCormick | No verified match found | — | — | 1 | ₹0 |

Every row: `automatic_spend_rupees = 0`, `sourcesChecked = 1`, single FDA FSVP source.

---

## 10. Cache-reuse proof

`buyer_trade_source_snapshots` after the full six-candidate production run:

```
provider_id     = fda-fsvp
snapshot_count  = 1
fetched_at      = 2026-09-26 08:27:55.577+00
expires_at      = 2027-01-04 08:27:55.577+00
```

One snapshot, reused across six candidate runs. The `getFreshSnapshot` cache-hit path skipped the FDA fetch entirely for candidates 2–6. Conservatively, this is the single most load-bearing invariant the engine preserves in production.

---

## 11. ₹0 contract

Layers enforcing the ₹0 invariant:

- **Provider descriptor**: `FDA_FSVP_DESCRIPTOR.costClass = "free"`. `isAutomaticallyExecutable` refuses `free_quota` without a positive quota reservation (Phase 2A has no quota ledger, so it fails closed).
- **Planner**: `planTradeResearch` marks any non-free descriptor as `reason ∈ {paid, quota_unknown, manual_only, unsupported, terms_unapproved}`.
- **Worker**: `processTradeResearchJob` line 292 throws `PROVIDER_COST_POLICY_VIOLATION` if the fetched plan reports `cost_class !== "free"` or `automatic_spend_rupees !== 0`.
- **Writer**: `TradeResearchWriter.finalize` throws `AUTOMATIC_SPEND_MUST_REMAIN_ZERO` if `result.automaticSpendRupees !== 0`.
- **Database**:
  - Column `check (automatic_spend_rupees = 0)` on `batches`, `jobs`, `provider_plans`, `attempts`, `events`, `source_snapshots`.
  - Trigger `mdf.__trade_research_job_guard()` raises on any update where `new.automatic_spend_rupees <> 0`.
  - Trigger `mdf.__trade_research_attempt_guard()` raises on any update where `new.automatic_spend_rupees <> 0`.
- **API response contract**: every drain route emits `automatic_spend_rupees: 0` in every code path.
- **Test contract**: `zero(value)` helper in the repository throws `PERSISTED_AUTOMATIC_SPEND_NONZERO` when reading any row that reports non-zero spend; unit tests assert `automaticSpendRupees: 0` in every outcome branch.

Production evidence: every one of the six candidates recorded `automatic_spend_rupees: 0` end-to-end.

---

## 12. Security model

| Boundary | Enforcement |
|---|---|
| RLS on batches / jobs / provider_plans / attempts / events | Enabled; policies `to authenticated using (workspace_id = mdf.current_workspace_id())`. |
| RLS on `buyer_candidates` | Enabled; policies `to authenticated` only (0010). |
| Mutation privileges on trade_research tables | `service_role` only — 0025. `anon`, `authenticated`, `public` revoked. |
| Mutation privileges on `buyer_candidates` | `authenticated` only — 0010. `service_role` has SELECT only via 0026. **No INSERT/UPDATE/DELETE for service_role.** |
| RPC EXECUTE | 8 RPCs (`create_buyer_trade_research_batch`, `claim_…`, `heartbeat_…`, `advance_…`, `release_…`, `finalize_…`, `request_…_cancel`, `recompute_…`) granted to `service_role` only. `authenticated`/`anon`/`public` revoked. |
| `CRON_SECRET` / `TRADE_RESEARCH_DRAIN_SECRET` | Server-only. `process.env` inside route handlers. `timingSafeEqual` compare. Never in response bodies, logs, or client bundles. |
| Same-origin owner drain | `POST /api/internal/trade-research/drain` accepts bearer OR same-origin + owner session (`requireMdfSession` + `membership.role === "owner"`). Members are 403. |
| Client-side surface | `worker.ts` is `server-only`. Static scan asserts named client components (`BuyerFinderClient.tsx`, `TradeResearchProgressPanel.tsx`) do not reference `createTradeResearchDeadline`, `TRADE_RESEARCH_SAFE_EXECUTION_MS`, or `VERCEL_FUNCTION_MAX_MS`. |
| Feature flags | `BUYER_SEND_ENABLED=false`, `BUYER_FINDER_HUNTER_REVEAL_ENABLED=false` — preserved. |

---

## 13. Current limitations

- **US-only.** FDA FSVP is `countries: ["US"]`; Canadian, EU, and every other candidate is `wrong_country` and finalizes as `unsupported_coverage` with `sourcesChecked: 0`.
- **One source per candidate.** The planner emits a single-element plan array. No cross-source deduplication yet.
- **No shipment / product / origin evidence.** FDA FSVP does not carry these fields; result summary literals reflect that: `productEvidence: "not_available"`, `indiaOrigin: "not_verified"`, `shipmentEvidence: "not_verified"`.
- **Daily cron cadence only.** Vercel Hobby doesn't support sub-daily cron. Long-idle recovery could take up to 24 h if the inline kick and manual drain are both bypassed.
- **`buyer_candidates` service_role privilege is SELECT-only.** Deliberate; the worker never writes to that table.
- **`quota_state = unknown` fails closed.** Any `free_quota` provider without a positive reservation is refused; Phase 2A has no quota ledger.

---

## 14. Evidence semantics (permanent invariant)

Under FDA FSVP:

| Fact | May Phase 2A establish it? |
|---|---|
| Official FSVP participant-list corroboration | Yes, only if identity match is `strong`. |
| Company identity corroboration | Yes, only if identity match is `strong`. |
| Shipment evidence | **No.** |
| India origin | **No.** |
| Guntur origin | **No.** |
| Product imported | **No.** |
| Supplier | **No.** |
| Quantity, value | **No.** |
| CBP importer-of-record status | **No.** |

Absence of a match is **not** evidence that the company does not import. `needs_review` is **not** verified identity. Any Phase 2B or later phase that presents FDA FSVP output as more than the above breaks the Phase 2A contract.

---

## 15. What Phase 2B may rely on

- Migrations 0025 and 0026 as the durable schema. Tables, triggers, and RPCs remain byte-identical.
- The `TradeResearchWriter` API (`claim`, `heartbeat`, `advance`, `release`, `finalize`, `recoverClaimedJob`, `getEligiblePlan`, `latestAttempt`, `startAttempt`, `finishAttempt`, `appendEvent`, `getCandidate`, `getFreshSnapshot`, `getLatestSnapshot`, `saveSnapshot`, `refreshSnapshotExpiry`).
- `processTradeResearchJob`, `drainTradeResearch`, `createTradeResearchDeadline` — the deadline + checkpoint architecture.
- `PHASE_2A_STAGES` monotonic stage ordering.
- `TradeResearchProviderDescriptor` shape with `costClass`, `countries`, `roles`, `automationAllowed`, `termsApproved`, `datasetCadence`, `cacheMaxAgeDays`, `compatiblePlannerVersions`.
- `isAutomaticallyExecutable` and `planTradeResearch` decision tree.
- `buyer_trade_source_snapshots` (a Phase 2B provider must pick a distinct `provider_id` + `dataset_id`; the unique constraint is `(provider_id, dataset_id, material_hash)`).
- The static-scan tests: `deadlineCallSites.test.ts` and `postClaim42501.test.ts`.

---

## 16. What Phase 2B must NOT change

- Migrations 0025 and 0026 — immutable.
- `AUTOMATIC_SPEND_RUPEES = 0` invariant in every layer (planner, worker, writer, DB, API).
- The three feature flags: `BUYER_SEND_ENABLED=false`, `BUYER_FINDER_HUNTER_REVEAL_ENABLED=false`, and any future automatic paid-provider gate must remain `false` in production.
- `worker.ts` server-only boundary. No client component may import the deadline helper.
- Existing FDA FSVP planner eligibility (MDF-catalogue productIds count as food-import relevance). Existing FDA FSVP outcome mapping (`strong` → verified, `ambiguous` → needs_review, `none` → no_verified_evidence).
- The `TradeResearchResultSummary` field literals for FDA FSVP outputs. A Phase 2B provider that populates product / origin evidence **must add new result fields**; it must not overload FDA FSVP fields.
- Owner-only same-origin authorization on `/api/internal/trade-research/drain`. Timing-safe bearer authorization on `/api/cron/trade-research-drain`.
- Buyer Intelligence ingestion: `ingest_buyer_intelligence_source`, `_claim`, `_observation`, and `refresh_buyer_intelligence` remain **out of scope**. Phase 2B does not write to BI.
- Buyer conversion: a research candidate is never automatically promoted to a buyer. Email remains mandatory for buyer conversion.
- Migration 0025 / 0026 grants. A Phase 2B additive migration (0027 if strictly required) must not widen `authenticated` or `anon`, must not remove RLS, must not add mutation privileges on `buyer_candidates`, and must not add or widen BI ingestion RPCs.

---

## 17. Final status

**PHASE 2A = CLOSED / PRODUCTION VALIDATED**

Six-candidate live QA green. One FDA snapshot reused across all six runs. `automatic_spend_rupees = 0` end-to-end. Migrations 0025 + 0026 live and immutable. Test suite: **2383 pass / 2 skipped** (`vitest run --pool=forks --poolOptions.forks.singleFork=true`, 2026-09-27). `tsc` clean. `next build` clean.
