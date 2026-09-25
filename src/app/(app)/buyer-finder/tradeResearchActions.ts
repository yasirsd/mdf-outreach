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
import { drainTradeResearch, TradeResearchDrainExecutionError } from "@/lib/tradeResearch/server/worker";
import { TRADE_RESEARCH_PLANNER_VERSION, isTerminalTradeResearchStatus, type TradeResearchBatchSnapshot, type TradeResearchJobSnapshot } from "@/lib/tradeResearch/types";

/**
 * BI4F 2A Hobby-plan adaptation. After a batch is committed, the server
 * action awaits ONE bounded drain execution so the first job normally
 * advances within a few seconds — no browser cron, no unawaited
 * background promise, no HTTP hop back into the same deployment. The
 * daily Vercel Hobby cron remains a stale/queued sweeper only.
 *
 *   INLINE_KICK_JOBS  = 1  — advance exactly one job per user click.
 *   INLINE_KICK_MS    = 12_000 — bounded, keeps server-action latency
 *                        well under Vercel's 60s function ceiling even
 *                        on a cold FDA XLSX fetch.
 *
 * If the drain fails or times out the batch stays safely queued; the
 * daily cron sweeper reclaims it. The server action NEVER surfaces a
 * drain failure to the caller — the job was created safely.
 */
const INLINE_KICK_JOBS = 1;
const INLINE_KICK_MS = 12_000;

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
  // Await a single bounded drain execution so the first job normally
  // starts advancing before the button un-freezes. Failures are
  // absorbed — the batch is safely queued and the daily cron sweeper
  // will still pick it up. NEVER an unawaited background promise.
  await kickTradeResearchDrain(writer);
  revalidatePath("/buyer-finder");
  return { outcome: "created", batch };
}

/**
 * Bounded server-side drain "kick" invoked at the tail of the create
 * action. Awaited but capped by INLINE_KICK_MS. The drain worker itself
 * is idempotent (SKIP LOCKED + lease + CAS + terminal immutability),
 * so overlapping user clicks cannot double-process the same job. The
 * kick reuses the exact worker the daily cron reuses — no parallel
 * worker code path exists.
 */
async function kickTradeResearchDrain(writer: TradeResearchWriter): Promise<void> {
  try {
    await drainTradeResearch({
      writer,
      workerId: `inline-${randomUUID()}`,
      maxJobs: INLINE_KICK_JOBS,
      timeBudgetMs: INLINE_KICK_MS,
      log: logTradeResearchDiagnostic,
    });
  } catch (error) {
    const failure = error instanceof TradeResearchDrainExecutionError ? error : undefined;
    const safeErrorCode = failure?.safeErrorCode ?? safeTradeResearchErrorCode(error);
    // The batch/job commit already succeeded; the drain kick is a
    // best-effort accelerator. Never propagate its failure to the UI.
    logTradeResearchDiagnostic({ event: "route_failed", jobsClaimed: 0, safeErrorCode });
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
