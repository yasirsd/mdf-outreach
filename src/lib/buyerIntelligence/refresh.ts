import { isEntityUuid } from "@/lib/buyerFinder/ids";
import type { BuyerIntelligenceWriteRepository } from "@/lib/repositories/interfaces";
import type { BuyerIntelligenceViewModel } from "./types";

export interface BuyerIntelligenceRefreshDependencies {
  writer: Pick<BuyerIntelligenceWriteRepository, "refreshDerived">;
  loadReadModel(candidateId: string): Promise<BuyerIntelligenceViewModel>;
}

/**
 * Server orchestration boundary. The RPC performs every persistence mutation
 * in one database transaction; this wrapper then reloads the durable read model.
 */
export async function refreshBuyerIntelligence(
  candidateId: string,
  dependencies: BuyerIntelligenceRefreshDependencies,
): Promise<BuyerIntelligenceViewModel> {
  if (!isEntityUuid(candidateId)) throw new Error("Invalid Candidate id.");
  await dependencies.writer.refreshDerived(candidateId);
  return dependencies.loadReadModel(candidateId);
}
