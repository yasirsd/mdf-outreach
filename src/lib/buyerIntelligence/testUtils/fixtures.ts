import { calculateBasicLegitimacy } from "@/lib/buyerIntelligence/assessment";
import { calculateBasicTradeSummary } from "@/lib/buyerIntelligence/metrics";
import { buildBuyerIntelligenceViewModel } from "@/lib/buyerIntelligence/viewModel";
import type {
  BuyerIntelligenceClaim,
  BuyerIntelligenceSource,
  BuyerTradeObservation,
} from "@/lib/buyerIntelligence/types";

export const BI_FIXTURE_WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
export const BI_FIXTURE_CANDIDATE_ID = "20000000-0000-4000-8000-000000000001";

const CREATED_AT = "2026-08-01T09:00:00.000Z";
const RETRIEVED_AT = "2026-08-02T09:00:00.000Z";

export const buyerIntelligenceSourceFixtures: BuyerIntelligenceSource[] = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    workspaceId: BI_FIXTURE_WORKSPACE_ID,
    candidateId: BI_FIXTURE_CANDIDATE_ID,
    providerId: "controlled-trade-fixture",
    sourceType: "trade_record",
    sourceKey: "fixture:trade:mahmood-sons",
    safeSourceRef: "TRADE-FIXTURE-001",
    sourceUrl: "https://example.test/trade/TRADE-FIXTURE-001",
    accessClass: "manual",
    costClass: "free",
    observedAt: "2026-07-10T00:00:00.000Z",
    retrievedAt: RETRIEVED_AT,
    metadata: { fixture: true },
    createdAt: CREATED_AT,
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    workspaceId: BI_FIXTURE_WORKSPACE_ID,
    candidateId: BI_FIXTURE_CANDIDATE_ID,
    providerId: "company-website",
    sourceType: "company_website",
    sourceKey: "fixture:website:mahmood-sons",
    safeSourceRef: "about-page",
    sourceUrl: "https://example.test/about",
    accessClass: "public",
    costClass: "free",
    observedAt: "2026-07-30T00:00:00.000Z",
    retrievedAt: RETRIEVED_AT,
    metadata: { fixture: true },
    createdAt: CREATED_AT,
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    workspaceId: BI_FIXTURE_WORKSPACE_ID,
    candidateId: BI_FIXTURE_CANDIDATE_ID,
    providerId: "controlled-directory-fixture",
    sourceType: "business_directory",
    sourceKey: "fixture:directory:mahmood-sons",
    safeSourceRef: "DIR-FIXTURE-001",
    accessClass: "manual",
    costClass: "free",
    retrievedAt: RETRIEVED_AT,
    metadata: { fixture: true },
    createdAt: CREATED_AT,
  },
];

export const buyerIntelligenceClaimFixtures: BuyerIntelligenceClaim[] = [
  {
    id: "40000000-0000-4000-8000-000000000001",
    workspaceId: BI_FIXTURE_WORKSPACE_ID,
    candidateId: BI_FIXTURE_CANDIDATE_ID,
    sourceId: buyerIntelligenceSourceFixtures[1].id,
    sourceRecordRef: "website-importer-claim",
    claimType: "company_is_importer",
    evidenceType: "business_evidence",
    evidenceLevel: 2,
    confidence: "medium",
    rawValue: { text: "Importer and distributor of food ingredients" },
    normalizedValue: { isImporter: true },
    observedAt: "2026-07-30T00:00:00.000Z",
    retrievedAt: RETRIEVED_AT,
    normalizationVersion: "fixture-v1",
    createdAt: CREATED_AT,
  },
  {
    id: "40000000-0000-4000-8000-000000000002",
    workspaceId: BI_FIXTURE_WORKSPACE_ID,
    candidateId: BI_FIXTURE_CANDIDATE_ID,
    sourceId: buyerIntelligenceSourceFixtures[2].id,
    sourceRecordRef: "directory-category-claim",
    claimType: "directory_category",
    evidenceType: "discovery_signal",
    evidenceLevel: 3,
    confidence: "low",
    rawValue: { category: "Spice importer" },
    normalizedValue: { category: "spice_importer" },
    retrievedAt: RETRIEVED_AT,
    normalizationVersion: "fixture-v1",
    createdAt: CREATED_AT,
  },
];

export const buyerTradeObservationFixtures: BuyerTradeObservation[] = [
  {
    id: "50000000-0000-4000-8000-000000000001",
    workspaceId: BI_FIXTURE_WORKSPACE_ID,
    candidateId: BI_FIXTURE_CANDIDATE_ID,
    sourceId: buyerIntelligenceSourceFixtures[0].id,
    sourceRecordRef: "shipment-2026-07-10",
    granularity: "shipment",
    evidenceType: "verified_trade_evidence",
    evidenceLevel: 1,
    confidence: "verified",
    tradeDate: "2026-07-10",
    originCountryCode: "IN",
    destinationCountryCode: "AE",
    supplierNameRaw: "Example Indian Exporter Pvt Ltd",
    supplierNameNormalized: "Example Indian Exporter",
    supplierCountryCode: "IN",
    productDescriptionRaw: "Dried red chilli whole",
    normalizedProductCategory: "dry red chilli",
    mdfProductId: "guntur-dry-red-chilli",
    hsCodeRaw: "090421",
    quantity: 12000,
    quantityUnit: "kg",
    retrievedAt: RETRIEVED_AT,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: "50000000-0000-4000-8000-000000000002",
    workspaceId: BI_FIXTURE_WORKSPACE_ID,
    candidateId: BI_FIXTURE_CANDIDATE_ID,
    sourceId: buyerIntelligenceSourceFixtures[0].id,
    sourceRecordRef: "shipment-2026-05-12",
    granularity: "shipment",
    evidenceType: "verified_trade_evidence",
    evidenceLevel: 1,
    confidence: "verified",
    tradeDate: "2026-05-12",
    originCountryCode: "VN",
    destinationCountryCode: "AE",
    supplierNameRaw: "Example Vietnam Foods Co",
    supplierNameNormalized: "Example Vietnam Foods",
    supplierCountryCode: "VN",
    productDescriptionRaw: "Dried chilli pods",
    normalizedProductCategory: "dry red chilli",
    hsCodeRaw: "090421",
    retrievedAt: RETRIEVED_AT,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: "50000000-0000-4000-8000-000000000003",
    workspaceId: BI_FIXTURE_WORKSPACE_ID,
    candidateId: BI_FIXTURE_CANDIDATE_ID,
    sourceId: buyerIntelligenceSourceFixtures[2].id,
    sourceRecordRef: "directory-signal-001",
    granularity: "directory_signal",
    evidenceType: "discovery_signal",
    evidenceLevel: 3,
    confidence: "low",
    normalizedProductCategory: "dry red chilli",
    retrievedAt: RETRIEVED_AT,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
];

export function controlledBuyerIntelligenceViewModel() {
  return buildBuyerIntelligenceViewModel({
    sources: buyerIntelligenceSourceFixtures,
    claims: buyerIntelligenceClaimFixtures,
    trade: { rows: buyerTradeObservationFixtures },
    metrics: [],
    assessments: [],
    contactAccess: { contacts: [], publicEmails: [] },
  });
}

export const controlledTradeSummary = calculateBasicTradeSummary(
  buyerTradeObservationFixtures,
);
export const controlledLegitimacy = calculateBasicLegitimacy({
  claims: buyerIntelligenceClaimFixtures,
  observations: buyerTradeObservationFixtures,
});
