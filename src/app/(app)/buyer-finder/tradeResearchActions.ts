"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireMdfSession } from "@/lib/auth/require";
import { codeForCountryName, findCountryByCode } from "@/lib/catalogue/countries";
import { serverRepositories } from "@/lib/repositories/server";
import { createClient } from "@/utils/supabase/server";
import { FDA_FSVP_DESCRIPTOR, planTradeResearch } from "@/lib/tradeResearch/providers";
import { createTradeResearchReadRepository, TradeResearchWriter } from "@/lib/tradeResearch/repository";
import { logTradeResearchDiagnostic, safeTradeResearchErrorCode } from "@/lib/tradeResearch/server/diagnostics";
import { getTradeResearchServiceRoleClient } from "@/lib/tradeResearch/server/serviceRoleClient";
import { createTradeResearchDeadline, drainTradeResearch, TradeResearchDrainExecutionError } from "@/lib/tradeResearch/server/worker";
import { TRADE_RESEARCH_PLANNER_VERSION, isTerminalTradeResearchStatus, type TradeResearchBatchSnapshot, type TradeResearchJobSnapshot } from "@/lib/tradeResearch/types";

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
  | { outcome: "created"; batch: TradeResearchBatchSnapshot }
  | { outcome: "forbidden" | "invalid_input" | "candidate_not_found" | "already_active"; message: string };

export async function createTradeResearchBatchAction(candidateIds: readonly string[]): Promise<CreateTradeResearchBatchResult> {
  const session = await requireMdfSession();
  if (session.membership.role !== "owner") return { outcome: "forbidden", message: "Only a workspace owner can start trade research." };
  const ids = [...new Set(candidateIds)].slice(0, 500);
  if (!ids.length || ids.some((id) => !UUID.test(id))) return { outcome: "invalid_input", message: "Select between 1 and 500 valid candidates." };
  const { repos } = await serverRepositories();
  const writer = new TradeResearchWriter(getTradeResearchServiceRoleClient());
  const read = createTradeResearchReadRepository(createClient(cookies()), session.membership.workspaceId);
  const [freshCache, allCandidates, productMatches, latestJobs] = await Promise.all([
    writer.getFreshSnapshot().then(Boolean),
    repos.buyerCandidates.list(),
    repos.buyerCandidateProductMatches.listByCandidateIds
      ? repos.buyerCandidateProductMatches.listByCandidateIds(ids)
      : Promise.all(ids.map((id) => repos.buyerCandidateProductMatches.listByCandidate(id))).then((rows) => rows.flat()),
    read.getLatestJobsForCandidates(ids),
  ]);
  const candidates = new Map(allCandidates.filter((candidate) => ids.includes(candidate.id)).map((candidate) => [candidate.id, candidate]));
  const jobs = [];
  for (const candidateId of ids) {
    const candidate = candidates.get(candidateId);
    const candidateProductMatches = productMatches.filter((match) => match.candidateId === candidateId);
    const latest = latestJobs.get(candidateId);
    if (!candidate) return { outcome: "candidate_not_found", message: "A selected candidate is not available in this workspace." };
    if (latest && !isTerminalTradeResearchStatus(latest.status)) return { outcome: "already_active", message: `${candidate.companyName} already has active trade research.` };
    const countryCode = findCountryByCode(candidate.country)?.code ?? codeForCountryName(candidate.country);
    if (!countryCode) return { outcome: "invalid_input", message: `${candidate.companyName} does not have a canonical country.` };
    const productId = candidateProductMatches[0]?.productId;
    const plans = planTradeResearch({ candidate, countryCode, goal: "screen_trade_activity", productId, hasFreshCache: freshCache });
    jobs.push({
      candidateId, productId: productId ?? "", countryCode, supersedesJobId: latest?.id ?? "",
      plans: plans.map((plan, index) => ({
        providerId: plan.descriptor.id, providerDescriptorVersion: plan.descriptor.version,
        role: plan.role, sequence: index + 1, eligibility: plan.eligible ? "eligible" : "ineligible",
        decisionReason: plan.reason, costClass: plan.descriptor.costClass,
        termsVersion: plan.descriptor.termsVersion, datasetVersion: "", cacheKey: plan.cacheHit ? `${FDA_FSVP_DESCRIPTOR.id}:current` : "",
      })),
    });
  }
  let batch: TradeResearchBatchSnapshot;
  try {
    batch = await writer.createBatch({
      workspaceId: session.membership.workspaceId, createdBy: session.userId,
      requestedGoal: "screen_trade_activity", productId: "", countryCode: "",
      plannerVersion: TRADE_RESEARCH_PLANNER_VERSION, jobs,
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "23505") {
      return { outcome: "already_active", message: "One or more candidates already have active trade research." };
    }
    throw error;
  }
  // Await a bounded drain execution so the first job normally reaches
  // terminal state before the button un-freezes. Failures are absorbed —
  // the batch is safely queued and the daily cron sweeper will still
  // pick it up. NEVER an unawaited background promise.
  await kickTradeResearchDrain(writer, read, batch.id);
  revalidatePath("/buyer-finder");
  return { outcome: "created", batch };
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
