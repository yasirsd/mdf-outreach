"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireMdfSession } from "@/lib/auth/require";
import { codeForCountryName, findCountryByCode } from "@/lib/catalogue/countries";
import { serverRepositories } from "@/lib/repositories/server";
import { createClient } from "@/utils/supabase/server";
import { FDA_FSVP_DESCRIPTOR, planTradeResearch } from "@/lib/tradeResearch/providers";
import { createTradeResearchReadRepository, TradeResearchWriter } from "@/lib/tradeResearch/repository";
import { getTradeResearchServiceRoleClient } from "@/lib/tradeResearch/server/serviceRoleClient";
import { TRADE_RESEARCH_PLANNER_VERSION, isTerminalTradeResearchStatus, type TradeResearchBatchSnapshot, type TradeResearchJobSnapshot } from "@/lib/tradeResearch/types";

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
  try {
    const batch = await writer.createBatch({
      workspaceId: session.membership.workspaceId, createdBy: session.userId,
      requestedGoal: "screen_trade_activity", productId: "", countryCode: "",
      plannerVersion: TRADE_RESEARCH_PLANNER_VERSION, jobs,
    });
    revalidatePath("/buyer-finder");
    return { outcome: "created", batch };
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "23505") {
      return { outcome: "already_active", message: "One or more candidates already have active trade research." };
    }
    throw error;
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
