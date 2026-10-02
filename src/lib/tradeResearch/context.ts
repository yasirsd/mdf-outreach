import { createHash } from "node:crypto";
import { THAILAND_PROVIDER_PLAN_VERSION } from "./thailand/versions";
import type {
  ResearchContext,
  ResearchContextField,
  TradeResearchGoal,
  TradeResearchProviderResult,
  TradeResearchResultSummary,
} from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const GOALS = new Set<TradeResearchGoal>([
  "screen_trade_activity",
  "find_target_product",
  "check_india_origin",
]);

export class ResearchContextValidationError extends Error {
  constructor(readonly field: ResearchContextField) {
    super(`INVALID_RESEARCH_CONTEXT_${field}`);
    this.name = "ResearchContextValidationError";
  }
}

/**
 * TH02 hardening — market-aware provider plan version resolver.
 *
 * Returns the AUTHORITATIVE provider plan version for the given
 * market, OR `undefined` when the market has no market-level
 * override and the caller-supplied `providerPlanVersion` on the
 * context remains authoritative.
 *
 *   US / CA / <any other market>  → undefined
 *       (preserves the historical semantics; the caller's
 *       `providerPlanVersion` value is used verbatim after
 *       canonicalization, so US and Canada context fingerprints are
 *       byte-identical to pre-TH02 state.)
 *
 *   TH                            → "thailand-provider-plan-v1"
 *       (Thailand's plan is market-dictated; any
 *       `providerPlanVersion` the caller supplies is ignored and
 *       the Thailand-plan version is substituted at canonicalization
 *       time, so Thailand context fingerprints include it as part
 *       of research identity per T06/T07 intent.)
 *
 * Bumping Thailand's plan version is a reviewed data change here —
 * every Thailand context fingerprint changes accordingly, which is
 * exactly the T06/T07 contract.
 */
const MARKET_PROVIDER_PLAN_OVERRIDES: Record<string, string> = {
  TH: THAILAND_PROVIDER_PLAN_VERSION,
};

export function resolveProviderPlanVersion(marketCountryCode: string): string | undefined {
  if (typeof marketCountryCode !== "string") return undefined;
  const code = marketCountryCode.toUpperCase();
  return MARKET_PROVIDER_PLAN_OVERRIDES[code];
}

function canonicalText(value: unknown, field: ResearchContextField): string {
  if (typeof value !== "string") throw new ResearchContextValidationError(field);
  const canonical = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  if (!canonical) throw new ResearchContextValidationError(field);
  return canonical;
}

/** Canonicalizes only semantic fields. Extra UI/run metadata is ignored. */
export function canonicalizeResearchContext(input: ResearchContext): ResearchContext {
  const workspaceId = canonicalText(input.workspaceId, "workspaceId");
  const candidateId = canonicalText(input.candidateId, "candidateId");
  if (!UUID_PATTERN.test(workspaceId)) throw new ResearchContextValidationError("workspaceId");
  if (!UUID_PATTERN.test(candidateId)) throw new ResearchContextValidationError("candidateId");

  const marketCountryCode = canonicalText(input.marketCountryCode, "marketCountryCode").toUpperCase();
  if (!COUNTRY_CODE_PATTERN.test(marketCountryCode)) {
    throw new ResearchContextValidationError("marketCountryCode");
  }

  const researchGoal = canonicalText(input.researchGoal, "researchGoal") as TradeResearchGoal;
  if (!GOALS.has(researchGoal)) throw new ResearchContextValidationError("researchGoal");

  const productForm = input.productForm === null || input.productForm === undefined
    ? null
    : input.productForm.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase() || null;

  // Validate the caller-supplied providerPlanVersion as a non-empty
  // canonical string, then let the market override win when the
  // market dictates a plan version (TH02 hardening). Markets without
  // an override keep the caller's canonical value verbatim, so US
  // and Canada context fingerprints are byte-identical to the
  // pre-TH02 baseline.
  const callerProviderPlanVersion = canonicalText(input.providerPlanVersion, "providerPlanVersion");
  const marketOverride = resolveProviderPlanVersion(marketCountryCode);
  const providerPlanVersion = marketOverride ?? callerProviderPlanVersion;

  return {
    workspaceId,
    candidateId,
    marketCountryCode,
    productId: canonicalText(input.productId, "productId"),
    productForm,
    researchGoal,
    providerPlanVersion,
    interpretationVersion: canonicalText(input.interpretationVersion, "interpretationVersion"),
  };
}

/**
 * Exact fingerprint input. JSON key order is intentionally fixed and forms
 * part of the versioned contract.
 */
export function canonicalResearchContextJson(input: ResearchContext): string {
  const context = canonicalizeResearchContext(input);
  return JSON.stringify({
    workspaceId: context.workspaceId,
    candidateId: context.candidateId,
    marketCountryCode: context.marketCountryCode,
    productId: context.productId,
    productForm: context.productForm,
    researchGoal: context.researchGoal,
    providerPlanVersion: context.providerPlanVersion,
    interpretationVersion: context.interpretationVersion,
  });
}

export function fingerprintResearchContext(input: ResearchContext): string {
  const digest = createHash("sha256").update(canonicalResearchContextJson(input), "utf8").digest("hex");
  return `trctx-v1:${digest}`;
}

export type StoredResearchContextState =
  | { status: "typed"; context: ResearchContext; fingerprint: string }
  | { status: "legacy_unknown" }
  | { status: "invalid_context" };

export function readStoredResearchContext(
  result: Pick<TradeResearchResultSummary, "context" | "contextFingerprint">,
): StoredResearchContextState {
  if (result.context === undefined) return { status: "legacy_unknown" };
  try {
    const context = canonicalizeResearchContext(result.context);
    const fingerprint = fingerprintResearchContext(context);
    if (result.contextFingerprint !== undefined && result.contextFingerprint !== fingerprint) {
      return { status: "invalid_context" };
    }
    return { status: "typed", context, fingerprint };
  } catch {
    return { status: "invalid_context" };
  }
}

export type ResearchContextComparison =
  | { status: "exact"; fingerprint: string; differingFields: [] }
  | { status: "mismatch"; fingerprint: string; requestedFingerprint: string; differingFields: ResearchContextField[] }
  | { status: "legacy_unknown"; differingFields: [] }
  | { status: "invalid_context"; differingFields: [] };

const MATERIAL_FIELDS: readonly ResearchContextField[] = [
  "workspaceId",
  "candidateId",
  "marketCountryCode",
  "productId",
  "productForm",
  "researchGoal",
  "providerPlanVersion",
  "interpretationVersion",
];

export function compareTradeResearchResultContext(
  result: Pick<TradeResearchResultSummary, "context" | "contextFingerprint">,
  requested: ResearchContext,
): ResearchContextComparison {
  const stored = readStoredResearchContext(result);
  if (stored.status !== "typed") return { status: stored.status, differingFields: [] };

  const requestedContext = canonicalizeResearchContext(requested);
  const requestedFingerprint = fingerprintResearchContext(requestedContext);
  const differingFields = MATERIAL_FIELDS.filter((field) => stored.context[field] !== requestedContext[field]);
  if (differingFields.length === 0) {
    return { status: "exact", fingerprint: stored.fingerprint, differingFields: [] };
  }
  return {
    status: "mismatch",
    fingerprint: stored.fingerprint,
    requestedFingerprint,
    differingFields,
  };
}

export function canReuseTradeResearchResultForContext(
  result: Pick<TradeResearchResultSummary, "context" | "contextFingerprint">,
  requested: ResearchContext,
): boolean {
  return compareTradeResearchResultContext(result, requested).status === "exact";
}

export type TradeResearchEvidenceReadSelection =
  | { kind: "typed_provider_results"; providerResults: readonly TradeResearchProviderResult[] }
  | { kind: "legacy_multi_source"; sources: NonNullable<TradeResearchResultSummary["sources"]> }
  | { kind: "legacy_single_source"; evidence: NonNullable<TradeResearchResultSummary["evidence"]> }
  | { kind: "none" };

/**
 * Reader precedence is explicit: typed provider results, then Phase 2C
 * sources, then the Phase 2A/2B singular block. It never invents context.
 */
export function selectTradeResearchEvidenceForRead(
  result: TradeResearchResultSummary,
): TradeResearchEvidenceReadSelection {
  if (Array.isArray(result.providerResults)) {
    return { kind: "typed_provider_results", providerResults: result.providerResults };
  }
  if (Array.isArray(result.sources) && result.sources.length > 0) {
    return { kind: "legacy_multi_source", sources: result.sources };
  }
  if (result.evidence) return { kind: "legacy_single_source", evidence: result.evidence };
  return { kind: "none" };
}
