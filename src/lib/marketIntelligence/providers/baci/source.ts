import "server-only";

import type {
  MarketSourceIngestionInput,
  MarketSourceVerificationInput,
  MarketTradeObservationBody,
} from "../../server/types";
import type { MarketTradeObservation } from "../../types";
import { BACI_OEC_PROVIDER } from "../../providers";
import { BACI_OEC_DATASET_ID, BACI_OEC_DATASET_PAGE } from "./contract";

const licence = BACI_OEC_PROVIDER.license!;

/** Immutable provenance registration; rights are enabled only by the narrow verification RPC. */
export function buildBaciSourceRegistration(retrievedAt: string): MarketSourceIngestionInput {
  return {
    provider_id: BACI_OEC_PROVIDER.providerId,
    dataset_id: BACI_OEC_DATASET_ID,
    source_tier: BACI_OEC_PROVIDER.sourceTier,
    dataset_source: licence.datasetSource,
    dataset_license_name: licence.datasetLicenseName,
    dataset_license_url: licence.datasetLicenseUrl,
    dataset_attribution_requirement: licence.datasetAttributionRequirement,
    distribution_service: licence.distributionService,
    distribution_service_terms_url: licence.distributionServiceTermsUrl,
    distribution_catalog_license_name: licence.distributionCatalogLicenseName,
    service_terms_verified: false,
    storage_allowed: false,
    redistribution_allowed: false,
    source_url: BACI_OEC_DATASET_PAGE,
    safe_reference: "CEPII BACI 202601 / OEC BotMarket baci-hs17",
    retrieved_at: retrievedAt,
    metadata: {
      dataset_release: "202601",
      dataset_updated_at: BACI_OEC_PROVIDER.datasetUpdatedAt,
      latest_period: BACI_OEC_PROVIDER.latestPeriod,
      internal_use_only: true,
    },
  };
}

export function buildBaciSourceVerification(sourceId: string): MarketSourceVerificationInput {
  return {
    sourceId,
    verification: {
      service_terms_verified: licence.serviceTermsVerified,
      storage_allowed: licence.storageAllowed,
      redistribution_allowed: licence.redistributionAllowed,
      licence_verified_at: licence.licenceVerifiedAt,
      licence_verification_note: licence.licenceVerificationNote,
    },
  };
}

export function toMarketTradeObservationBody(
  row: MarketTradeObservation,
): MarketTradeObservationBody {
  return {
    reporter_country: row.reporterCountry,
    partner_country: row.partnerCountry,
    trade_flow: row.tradeFlow,
    hs_revision: row.hsRevision,
    hs_code: row.hsCode,
    frequency: row.frequency,
    period: row.period,
    trade_value_usd: row.tradeValueUsd,
    quantity: row.quantity,
    quantity_unit: row.quantityUnit,
    net_weight_kg: row.netWeightKg,
    source_period: row.sourcePeriod,
    retrieved_at: row.retrievedAt,
    source_url: row.sourceUrl,
    safe_source_ref: row.safeReference,
    metadata: row.metadata,
  };
}
