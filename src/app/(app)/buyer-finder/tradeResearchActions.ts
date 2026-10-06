"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireMdfSession } from "@/lib/auth/require";
import { findCountryByCode } from "@/lib/catalogue/countries";
import { isActiveBusinessProductId } from "@/lib/buyerFinder/businessCatalogue";
import { serverRepositories } from "@/lib/repositories/server";
import { createClient } from "@/utils/supabase/server";
import { CANADA_CID_DESCRIPTOR, DEFAULT_TRADE_RESEARCH_DESCRIPTORS, FDA_FSVP_DESCRIPTOR, FDA_VQIP_DESCRIPTOR, planTradeResearch } from "@/lib/tradeResearch/providers";
import { CANADA_CID_DATASET_ID } from "@/lib/tradeResearch/canadaCid";
import { FDA_VQIP_DATASET_ID } from "@/lib/tradeResearch/fdaVqip";
import { createTradeResearchReadRepository, TradeResearchWriter } from "@/lib/tradeResearch/repository";
import { canonicalizeResearchContext, fingerprintResearchContext } from "@/lib/tradeResearch/context";
import { logTradeResearchDiagnostic, safeTradeResearchErrorCode } from "@/lib/tradeResearch/server/diagnostics";
import { getTradeResearchServiceRoleClient } from "@/lib/tradeResearch/server/serviceRoleClient";
import { createTradeResearchDeadline, drainTradeResearch, TradeResearchDrainExecutionError } from "@/lib/tradeResearch/server/worker";
import {
  TRADE_RESEARCH_INTERPRETATION_VERSION,
  TRADE_RESEARCH_PLANNER_VERSION,
  isTerminalTradeResearchStatus,
  type ResearchContext,
  type TradeResearchBatchSnapshot,
  type TradeResearchJobSnapshot,
  type TradeResearchRequest,
} from "@/lib/tradeResearch/types";

/**
 * BI4F 2A Hobby-plan adaptation. After a batch is committed, the server
 * action awaits a bounded drain execution so the first job normally
 * reaches a terminal state before the button un-freezes — no browser
 * cron, no unawaited background promise, no HTTP hop.
 *
 *   INLINE_KICK_JOBS               = 1
 *   INLINE_KICK_BUDGET_MS          = 45_000  (soft per-drain budget; the
 *                                             worker only checks this
 *                                             between claims — an
 *                                             already-claimed job runs
 *                                             to completion)
 *   INLINE_KICK_HARD_CEILING_MS    = 50_000  (server-action ceiling; the
 *                                             kick will not START a new
 *                                             drain iteration once we've
 *                                             spent this long, leaving
 *                                             ≥10 s under Vercel Hobby's
 *                                             60 s maxDuration for
 *                                             cleanup + logging)
 *   INLINE_KICK_MAX_ITERATIONS     = 2       (initial drain + one
 *                                             follow-up after retry_wait)
 *
 * The kick observes the just-created batch. If after one drain iteration
 * the batch still has a non-terminal job AND we still have safe hard
 * headroom AND the last drain wasn't a no_work bail-out, we call drain
 * once more (e.g. the first attempt hit a retry-wait and released the
 * lease; the second attempt reclaims and finishes on the now-cached
 * FDA snapshot). The daily Vercel Hobby cron remains a recovery sweeper.
 * Kick failures are absorbed — the batch stays safely queued.
 */
const INLINE_KICK_JOBS = 1;
const INLINE_KICK_BUDGET_MS = 45_000;
const INLINE_KICK_HARD_CEILING_MS = 50_000;
const INLINE_KICK_MAX_ITERATIONS = 2;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CreateTradeResearchBatchResult =
  | { outcome: "created"; batch: TradeResearchBatchSnapshot; jobCount: number }
  | { outcome: "forbidden" | "invalid_input" | "candidate_not_found" | "already_active"; message: string };

function canonicalRequest(input: TradeResearchRequest): TradeResearchRequest | undefined {
  if (!input || typeof input !== "object") return undefined;
  if (!UUID.test(input.candidateId)) return undefined;
  const market = findCountryByCode(input.marketCountryCode);
  const productId = typeof input.productId === "string" ? input.productId.trim().toLowerCase() : "";
  if (!market || !productId || !isActiveBusinessProductId(productId)) return undefined;
  // The current catalogue has no independent form selector. Null is explicit
  // and prevents website/history text from becoming an inferred form.
  if (input.productForm !== null) return undefined;
  if (input.researchGoal !== "screen_trade_activity") return undefined;
  return {
    candidateId: input.candidateId.toLowerCase(),
    marketCountryCode: market.code,
    productId,
    productForm: null,
    researchGoal: input.researchGoal,
  };
}

function serverResearchContext(
  request: TradeResearchRequest,
  workspaceId: string,
): ResearchContext {
  return canonicalizeResearchContext({
    workspaceId,
    candidateId: request.candidateId,
    marketCountryCode: request.marketCountryCode,
    productId: request.productId,
    productForm: request.productForm,
    researchGoal: request.researchGoal,
    providerPlanVersion: TRADE_RESEARCH_PLANNER_VERSION,
    interpretationVersion: TRADE_RESEARCH_INTERPRETATION_VERSION,
  });
}

export async function createTradeResearchBatchAction(
  requests: readonly TradeResearchRequest[],
): Promise<CreateTradeResearchBatchResult> {
  // TH07 DEFECT 03 — every branch below emits a diagnostic. In
  // production, "action returned without persistence" could only
  // happen if a typed early-return fired silently (the function
  // itself has no `return null` path). Logging the exact branch
  // and reason makes the "200 with no DB row" symptom debuggable
  // and ensures the operator sees proof of which gate rejected.
  logTradeResearchDiagnostic({
    event: "batch_action_entered",
    requestCount: Array.isArray(requests) ? requests.length : 0,
  });
  const session = await requireMdfSession();
  if (session.membership.role !== "owner") {
    logTradeResearchDiagnostic({ event: "batch_action_forbidden", reason: "role_not_owner" });
    return { outcome: "forbidden", message: "Only a workspace owner can start trade research." };
  }
  if (!Array.isArray(requests) || requests.length === 0 || requests.length > 500) {
    logTradeResearchDiagnostic({
      event: "batch_action_invalid_input",
      reason: !Array.isArray(requests) ? "not_an_array" : requests.length === 0 ? "empty_array" : "too_many_requests",
      requestCount: Array.isArray(requests) ? requests.length : 0,
    });
    return { outcome: "invalid_input", message: "Select between 1 and 500 valid research contexts." };
  }
  const normalized = requests.map(canonicalRequest);
  if (normalized.some((request) => !request)) {
    logTradeResearchDiagnostic({
      event: "batch_action_invalid_input",
      reason: "canonical_request_rejected",
      requestCount: requests.length,
    });
    return { outcome: "invalid_input", message: "Choose a valid market and associated product before starting research." };
  }
  const normalizedRequests = normalized as TradeResearchRequest[];
  const ids = [...new Set(normalizedRequests.map((request) => request.candidateId))];
  const { repos } = await serverRepositories();
  const writer = new TradeResearchWriter(getTradeResearchServiceRoleClient());
  const read = createTradeResearchReadRepository(createClient(cookies()), session.membership.workspaceId);
  const [freshFdaCache, freshCanadaCache, freshVqipCache, allCandidates, productMatches] = await Promise.all([
    writer.getFreshSnapshot().then(Boolean),
    writer.getFreshSnapshotByProvider(CANADA_CID_DESCRIPTOR.id, CANADA_CID_DATASET_ID).then(Boolean),
    writer.getFreshSnapshotByProvider(FDA_VQIP_DESCRIPTOR.id, FDA_VQIP_DATASET_ID).then(Boolean),
    repos.buyerCandidates.list(),
    repos.buyerCandidateProductMatches.listByCandidateIds
      ? repos.buyerCandidateProductMatches.listByCandidateIds(ids)
      : Promise.all(ids.map((id) => repos.buyerCandidateProductMatches.listByCandidate(id))).then((rows) => rows.flat()),
  ]);
  const freshCacheByProviderId = new Map<string, boolean>([
    [FDA_FSVP_DESCRIPTOR.id, freshFdaCache],
    [CANADA_CID_DESCRIPTOR.id, freshCanadaCache],
    [FDA_VQIP_DESCRIPTOR.id, freshVqipCache],
  ]);
  const candidates = new Map(allCandidates.filter((candidate) => ids.includes(candidate.id)).map((candidate) => [candidate.id, candidate]));
  for (const request of normalizedRequests) {
    const candidate = candidates.get(request.candidateId);
    if (!candidate) {
      logTradeResearchDiagnostic({
        event: "batch_action_candidate_not_found",
        candidateId: request.candidateId,
        reason: "candidate_missing_from_workspace_scope",
      });
      return { outcome: "candidate_not_found", message: "A selected candidate is not available in this workspace." };
    }
    const ownsProductContext = productMatches.some((match) =>
      match.candidateId === request.candidateId && match.productId === request.productId
    );
    if (!ownsProductContext) {
      logTradeResearchDiagnostic({
        event: "batch_action_invalid_input",
        candidateId: request.candidateId,
        reason: `product_match_absent_for_${request.productId}`,
      });
      return { outcome: "invalid_input", message: `${candidate.companyName} is not associated with the selected product context.` };
    }
  }
  const contexts = normalizedRequests.map((request) => serverResearchContext(
    request,
    session.membership.workspaceId,
  ));
  const uniqueContexts = new Map(contexts.map((context) => [fingerprintResearchContext(context), context]));
  const requestedContexts = [...uniqueContexts.entries()].map(([contextFingerprint, context]) => ({
    context,
    contextFingerprint,
  }));
  const latestJobs = await read.getLatestJobsForContexts(
    requestedContexts.map(({ context, contextFingerprint }) => ({
      candidateId: context.candidateId,
      contextFingerprint,
    })),
  );
  const jobs = [];
  for (const { context, contextFingerprint } of requestedContexts) {
    const candidate = candidates.get(context.candidateId)!;
    const latest = latestJobs.get(contextFingerprint);
    if (latest && !isTerminalTradeResearchStatus(latest.status)) {
      logTradeResearchDiagnostic({
        event: "batch_action_already_active",
        candidateId: context.candidateId,
        jobId: latest.id,
        status: latest.status,
      });
      return { outcome: "already_active", message: `${candidate.companyName} already has active trade research.` };
    }
    // TH07 DEFECT 05A-R1 — terminal rerun contract.
    //
    // When the predecessor exists but is in a terminal status
    // (completed / partial / needs_review / failed / cancelled per
    // `isTerminalTradeResearchStatus`), the new job proceeds. The DB
    // partial unique index `buyer_trade_research_jobs_one_active_context_idx`
    // (migration 0029) only applies to active statuses, so a new
    // 'queued' row with the SAME context_fingerprint is accepted; the
    // old terminal row remains immutable (migration 0029
    // __trade_research_job_guard rejects any UPDATE to terminal
    // rows, so history is preserved).
    //
    // Diagnostic marks the decision so production logs show the exact
    // predecessor + the supersedes_job_id wired into the new row.
    // This diagnostic is READ-ONLY — it does not change behavior.
    if (latest) {
      logTradeResearchDiagnostic({
        event: "batch_action_terminal_rerun",
        candidateId: context.candidateId,
        jobId: latest.id,
        status: latest.status,
        reason: "terminal_predecessor_supersede",
      });
    }
    // Phase 2B — evaluate BOTH FDA FSVP and Canada CID descriptors
    // for every candidate. `planTradeResearch` refuses the wrong-
    // country provider (`wrong_country` reason), so US candidates get
    // exactly one FDA-eligible plan and Canadian candidates get
    // exactly one Canada-CID-eligible plan. Never both eligible in
    // the same batch — Phase 2B does NOT ship multi-provider
    // sequencing.
    const perProviderPlans = DEFAULT_TRADE_RESEARCH_DESCRIPTORS.map((descriptor) => {
      const [only] = planTradeResearch({
        candidate, context,
        hasFreshCache: freshCacheByProviderId.get(descriptor.id) ?? false,
        descriptors: [descriptor],
      });
      return only!;
    });
    jobs.push({
      candidateId: context.candidateId,
      productId: context.productId,
      countryCode: context.marketCountryCode,
      context,
      contextFingerprint,
      supersedesJobId: latest?.id ?? "",
      plans: perProviderPlans.map((plan, index) => ({
        providerId: plan.descriptor.id, providerDescriptorVersion: plan.descriptor.version,
        role: plan.role, sequence: index + 1, eligibility: plan.eligible ? "eligible" : "ineligible",
        decisionReason: plan.reason, costClass: plan.descriptor.costClass,
        termsVersion: plan.descriptor.termsVersion, datasetVersion: "",
        cacheKey: plan.cacheHit ? `${plan.descriptor.id}:current` : "",
      })),
    });
  }
  // TH07 DEFECT 03 — defensive invariant. If the per-context loop
  // somehow finishes with zero jobs for a non-empty request set (a
  // path that would otherwise reach createBatch with an empty jobs
  // array and silently 500 against the validator), surface it as
  // an observable server-side failure instead of a mystery.
  if (jobs.length === 0) {
    logTradeResearchDiagnostic({
      event: "batch_action_zero_jobs_invariant",
      reason: "planning_loop_produced_zero_jobs",
      requestCount: normalizedRequests.length,
    });
    throw new Error("TRADE_RESEARCH_BATCH_INVARIANT_ZERO_JOBS");
  }
  let batch: TradeResearchBatchSnapshot;
  try {
    const singleProduct = new Set(jobs.map((job) => job.productId));
    const singleCountry = new Set(jobs.map((job) => job.countryCode));
    // TH07 DEFECT 02 — the batch-level plannerVersion must equal the
    // canonical context's providerPlanVersion, which `canonicalizeResearchContext`
    // may rewrite via MARKET_PROVIDER_PLAN_OVERRIDES (e.g. TH →
    // "thailand-provider-plan-v1"). Both the client-side contract
    // validator (`assertCreateBatchInput`) and the SQL RPC
    // `create_trade_research_batch` (migration 0029) require this
    // equality; prior to this fix the client passed the raw
    // TRADE_RESEARCH_PLANNER_VERSION ("trade-planner-v1") which only
    // matched for non-overridden markets (US/CA), making TH submissions
    // throw `authoritative_field_mismatch`. All jobs in a batch share
    // a `countryCode` (singleCountry check above and `fingerprint` →
    // dedupe keys include market), so their canonical contexts share
    // `providerPlanVersion`; defensively assert that invariant here.
    const providerPlanVersions = new Set(jobs.map((job) => job.context.providerPlanVersion));
    if (providerPlanVersions.size !== 1) {
      throw new Error("TRADE_RESEARCH_BATCH_INVARIANT_PROVIDER_PLAN_VERSION_MIXED");
    }
    const canonicalPlannerVersion = jobs[0]!.context.providerPlanVersion;
    batch = await writer.createBatch({
      workspaceId: session.membership.workspaceId, createdBy: session.userId,
      requestedGoal: "screen_trade_activity",
      productId: singleProduct.size === 1 ? jobs[0]!.productId : "",
      countryCode: singleCountry.size === 1 ? jobs[0]!.countryCode : "",
      plannerVersion: canonicalPlannerVersion, jobs,
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "23505") {
      logTradeResearchDiagnostic({
        event: "batch_action_duplicate_23505",
        reason: "db_unique_violation",
      });
      return { outcome: "already_active", message: "One or more candidates already have active trade research." };
    }
    // TH07 DEFECT 03 — do not swallow any other createBatch error.
    // Re-throwing surfaces it to the Next.js server-action error
    // path (visible in Vercel logs with an error digest) instead
    // of silently returning null. Prior behavior already re-threw;
    // we additionally log the branch so the pre-throw record exists.
    logTradeResearchDiagnostic({
      event: "batch_action_invalid_input",
      reason: "create_batch_rejected",
      safeErrorCode: safeTradeResearchErrorCode(error),
    });
    throw error;
  }
  // T14 Stage 1 — env-driven kick strategy.
  //
  // Historically (Vercel Hobby / Pro), we awaited a bounded 50 s
  // inline drain here so the first job normally reached a terminal
  // state before the button un-froze. That is safe on Vercel where
  // server actions ride the 60 s function ceiling.
  //
  // On Netlify Free (Starter), synchronous functions cap at ~10 s.
  // A 50 s awaited drain would time out. Instead, when the deploy is
  // configured for the Netlify Background Function path
  // (`NETLIFY_BG_DRAIN_URL` set), we perform a server-to-server
  // POST to that URL with the drain secret; the Background Function
  // returns 202 immediately and completes the drain asynchronously
  // inside its own extended timeout. UX becomes "batch queued now,
  // progress observed via existing polling", identical to the daily
  // cron sweeper behavior.
  //
  // On Vercel (no `NETLIFY_BG_DRAIN_URL`), we keep the awaited inline
  // kick exactly as before — zero behavioral change during migration.
  // The secret NEVER leaves the server; the fetch is server-side.
  await invokeTradeResearchDrainStrategy(writer, read, batch.id);
  revalidatePath("/buyer-finder");
  // TH07 DEFECT 03 — enriched return. `jobCount` is persisted-truth
  // from the batch snapshot the RPC returned, so the client (and any
  // RSC flight reader) can confirm "action completed AND N jobs were
  // committed" rather than guessing from an opaque success value.
  logTradeResearchDiagnostic({
    event: "batch_action_created",
    batchId: batch.id,
    requestCount: normalizedRequests.length,
    jobCount: batch.totalJobs,
  });
  return { outcome: "created", batch, jobCount: batch.totalJobs };
}

async function invokeTradeResearchDrainStrategy(
  writer: TradeResearchWriter,
  read: ReturnType<typeof createTradeResearchReadRepository>,
  batchId: string,
): Promise<void> {
  const bgUrl = process.env.NETLIFY_BG_DRAIN_URL?.trim();
  const secret = process.env.TRADE_RESEARCH_DRAIN_SECRET?.trim();
  if (bgUrl && secret) {
    await fireNetlifyBackgroundDrain(bgUrl, secret, batchId);
    return;
  }
  await kickTradeResearchDrain(writer, read, batchId);
}

/**
 * Server-to-server POST to the Netlify Background Function. Awaits
 * only the network round-trip (Netlify returns 202 immediately),
 * NOT the full drain — the drain continues asynchronously on the
 * platform. Absorbs failures so a Background Function outage never
 * regresses a successful batch create; the daily cron sweeper and
 * Supabase Cron (T14 Stage 4) both pick the batch up on the next
 * tick regardless.
 */
async function fireNetlifyBackgroundDrain(url: string, secret: string, batchId: string): Promise<void> {
  const started = Date.now();
  logTradeResearchDiagnostic({
    event: "inline_kick_started", batchId, jobsRequested: 0,
  });
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ trigger: "server_action", batch_id: batchId }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    logTradeResearchDiagnostic({
      event: "inline_kick_finished", batchId, elapsedMs: Date.now() - started,
    });
  } catch (error) {
    logTradeResearchDiagnostic({
      event: "inline_kick_failed", batchId,
      safeErrorCode: safeTradeResearchErrorCode(error),
      elapsedMs: Date.now() - started,
    });
  }
}

/**
 * Bounded server-side drain "kick" invoked at the tail of the create
 * action. Awaited, budget-checked, worker-authoritative. Reuses the
 * exact worker the daily cron reuses — no parallel implementation. If
 * the just-created batch's job hasn't reached a terminal status after
 * the first drain and we still have hard-ceiling headroom, calls drain
 * once more (handles the retry_wait release path where the first
 * attempt hit a transient FDA glitch, released the lease with a
 * next_attempt_at, and the second call reclaims on the cached snapshot).
 */
async function kickTradeResearchDrain(
  writer: TradeResearchWriter,
  read: ReturnType<typeof createTradeResearchReadRepository>,
  batchId: string,
): Promise<void> {
  const started = Date.now();
  logTradeResearchDiagnostic({
    event: "inline_kick_started", batchId, jobsRequested: INLINE_KICK_JOBS,
  });
  try {
    for (let iteration = 1; iteration <= INLINE_KICK_MAX_ITERATIONS; iteration += 1) {
      const elapsed = Date.now() - started;
      const remaining = INLINE_KICK_HARD_CEILING_MS - elapsed;
      if (remaining < 5_000) {
        logTradeResearchDiagnostic({
          event: "inline_kick_budget_exhausted", batchId, iteration,
          elapsedMs: elapsed, remainingBudgetMs: remaining,
        });
        break;
      }
      const budget = Math.min(INLINE_KICK_BUDGET_MS, remaining);
      const result = await drainTradeResearch({
        writer,
        workerId: `inline-${randomUUID()}`,
        maxJobs: INLINE_KICK_JOBS,
        timeBudgetMs: budget,
        // BI4F 2A hard-deadline: single source of truth via the shared
        // `createTradeResearchDeadline(started)` helper. The claimed-job
        // path checkpoints (writer.release + next_attempt_at) before
        // Vercel Hobby's 60 s function ceiling can kill the invocation
        // mid-stage. The inline kick's own `INLINE_KICK_HARD_CEILING_MS`
        // is retained as a per-iteration budget for the outer loop and
        // matches the shared deadline (50 s).
        deadlineAt: createTradeResearchDeadline(started),
        log: logTradeResearchDiagnostic,
      });
      const batchNow = await read.getBatch(batchId);
      const stillActive = batchNow &&
        !isTerminalTradeResearchStatus(batchNow.status) &&
        batchNow.queuedCount + batchNow.runningCount > 0;
      if (!stillActive || result.noWork) break;
    }
    logTradeResearchDiagnostic({
      event: "inline_kick_finished", batchId,
      elapsedMs: Date.now() - started,
    });
  } catch (error) {
    const failure = error instanceof TradeResearchDrainExecutionError ? error : undefined;
    const safeErrorCode = failure?.safeErrorCode ?? safeTradeResearchErrorCode(error);
    logTradeResearchDiagnostic({
      event: "inline_kick_failed", batchId, safeErrorCode,
      elapsedMs: Date.now() - started,
    });
  }
}

export async function cancelTradeResearchBatchAction(batchId: string): Promise<{ outcome: "cancel_requested" | "not_found" | "forbidden"; batch?: TradeResearchBatchSnapshot }> {
  const session = await requireMdfSession();
  if (session.membership.role !== "owner") return { outcome: "forbidden" };
  if (!UUID.test(batchId)) return { outcome: "not_found" };
  const batch = await new TradeResearchWriter(getTradeResearchServiceRoleClient()).cancelBatch(batchId, session.membership.workspaceId);
  revalidatePath("/buyer-finder");
  return batch ? { outcome: "cancel_requested", batch } : { outcome: "not_found" };
}

export async function getTradeResearchBatchAction(batchId: string): Promise<TradeResearchBatchSnapshot | null> {
  const session = await requireMdfSession();
  if (!UUID.test(batchId)) return null;
  return await createTradeResearchReadRepository(createClient(cookies()), session.membership.workspaceId).getBatch(batchId) ?? null;
}

export async function getTradeResearchJobAction(jobId: string): Promise<TradeResearchJobSnapshot | null> {
  const session = await requireMdfSession();
  if (!UUID.test(jobId)) return null;
  return await createTradeResearchReadRepository(createClient(cookies()), session.membership.workspaceId).getJob(jobId) ?? null;
}

export async function getLatestTradeResearchJobForCandidateAction(candidateId: string): Promise<TradeResearchJobSnapshot | null> {
  const session = await requireMdfSession();
  if (!UUID.test(candidateId)) return null;
  return await createTradeResearchReadRepository(createClient(cookies()), session.membership.workspaceId).getLatestJobForCandidate(candidateId) ?? null;
}

export async function getLatestTradeResearchJobForContextAction(
  request: TradeResearchRequest,
): Promise<TradeResearchJobSnapshot | null> {
  const session = await requireMdfSession();
  const normalized = canonicalRequest(request);
  if (!normalized) return null;
  const context = serverResearchContext(normalized, session.membership.workspaceId);
  const contextFingerprint = fingerprintResearchContext(context);
  return await createTradeResearchReadRepository(
    createClient(cookies()),
    session.membership.workspaceId,
  ).getLatestJobForContext(context.candidateId, contextFingerprint) ?? null;
}
