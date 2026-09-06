import { classifyContactAccess } from "./assessment";
import {
  basicSummaryMetricValues,
  calculateBasicTradeSummary,
  type CalculatedMetricValue,
} from "./metrics";
import { calculateBuyerPotential } from "./potential";
import { projectProducts, projectSuppliers } from "./projections";
import {
  calculateOutreachReadiness,
  type OutreachReadinessInput,
} from "./readiness";
import { calculateBasicLegitimacy } from "./assessment";
import type {
  AssessmentEvidenceReference,
  AssessmentComponent,
  BuyerIntelligenceClaim,
  BuyerIntelligenceSource,
  BuyerTradeObservation,
  ContactAccessInput,
  IntelligenceAssessmentType,
  AssessmentClassification,
} from "./types";

export interface DerivedAssessmentDraft {
  assessmentType: IntelligenceAssessmentType;
  classification: AssessmentClassification;
  summary: string;
  components: AssessmentComponent[];
  evidence: AssessmentEvidenceReference[];
  calculationVersion: string;
}

export interface DerivedBuyerIntelligence {
  metrics: CalculatedMetricValue[];
  assessments: DerivedAssessmentDraft[];
  suppliers: ReturnType<typeof projectSuppliers>;
  products: ReturnType<typeof projectProducts>;
}

export function contactAccessSummary(classification: ReturnType<typeof classifyContactAccess>): string {
  const summaries = {
    company_only: "Company intelligence exists, but no usable contact route or named person is recorded.",
    public_route: "A usable public company contact route is recorded.",
    named_contact: "A named person is recorded, but no usable direct email is available.",
    direct_contact: "A usable direct contact is recorded without paid-reveal provenance.",
    credit_enriched: "A usable personal contact from a historical paid reveal is recorded.",
  } as const;
  return summaries[classification];
}

export function calculateDerivedBuyerIntelligence(input: {
  sources: BuyerIntelligenceSource[];
  claims: BuyerIntelligenceClaim[];
  observations: BuyerTradeObservation[];
  contactAccess: ContactAccessInput;
  readiness: OutreachReadinessInput;
  asOf?: Date;
}): DerivedBuyerIntelligence {
  const summary = calculateBasicTradeSummary(input.observations, { asOf: input.asOf });
  const legitimacy = calculateBasicLegitimacy(input);
  const potential = calculateBuyerPotential(input.observations, { asOf: input.asOf });
  const readiness = calculateOutreachReadiness(input.readiness);
  const contactAccess = classifyContactAccess(input.contactAccess);
  const contactSummary = contactAccessSummary(contactAccess);

  return {
    metrics: basicSummaryMetricValues(summary, input.observations),
    assessments: [
      { assessmentType: "buyer_legitimacy", ...legitimacy, calculationVersion: "bi2-legitimacy-v1" },
      { assessmentType: "buyer_potential", ...potential, calculationVersion: "bi2-potential-v1" },
      {
        assessmentType: "contact_access",
        classification: contactAccess,
        summary: contactSummary,
        components: [{ key: "contact_access", explanation: contactSummary, evidenceCount: 0 }],
        evidence: [],
        calculationVersion: "bi2-contact-access-v1",
      },
      { assessmentType: "outreach_readiness", ...readiness, calculationVersion: "bi2-readiness-v1" },
    ],
    suppliers: projectSuppliers(input.observations),
    products: projectProducts(input.observations),
  };
}
