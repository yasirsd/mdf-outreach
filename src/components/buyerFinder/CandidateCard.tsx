import type {
  BuyerCandidate,
  BuyerCandidateProductMatch,
} from "@/lib/buyerFinder/types";
import type { FreeEnrichmentJobStatus } from "@/lib/buyerFinder/freeEnrichmentJob";
import type { RevealPriorityTier } from "@/lib/buyerFinder/revealPriority";
import { CompanyIntelligenceCard } from "./CompanyIntelligenceCard";
import { PriorityContactRow } from "./PriorityContactRow";
import { AttentionResearchCard } from "./AttentionResearchCard";

export interface CandidateCardInput {
  candidate: BuyerCandidate;
  productMatches: BuyerCandidateProductMatch[];
  contactCount: number;
  bestContactTitle?: string;
  bestContactName?: string;
  bestHasLinkedin?: boolean;
  bestIsDecisionMaker?: boolean;
  priorityReason?: string;
  publicCompanyEmail?: string;
  revealPriority?: RevealPriorityTier;
  publicJobStatus?: FreeEnrichmentJobStatus;
  peopleJobStatus?: FreeEnrichmentJobStatus;
  roleRelevance?: number;
  contactQuality?: number;
  convertedBuyerId?: string;
}

export function CandidateCard({
  record,
  layout = "default",
  index = 0,
}: {
  record: CandidateCardInput;
  layout?: "default" | "priority" | "attention";
  index?: number;
}) {
  if (layout === "priority") return <PriorityContactRow record={record} index={index} />;
  if (layout === "attention") return <AttentionResearchCard record={record} />;
  return <CompanyIntelligenceCard record={record} />;
}
