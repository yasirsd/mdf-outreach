# Trade research context and result contract (T06–T07)

## Scope

T06 defines the semantic boundary for a trade-research result. T07 binds new
requests, jobs, reads, deduplication and finalization to that context. It does
not resume providers, rewrite the Phase 2C aggregate, or add a provider.

The TypeScript contract lives in `src/lib/tradeResearch/types.ts`; canonical
context, matching and compatibility readers live in
`src/lib/tradeResearch/context.ts`.

## Research context

`ResearchContext` contains exactly:

1. `workspaceId`
2. `candidateId`
3. `marketCountryCode`
4. `productId`
5. `productForm` (`string | null`)
6. `researchGoal`
7. `providerPlanVersion`
8. `interpretationVersion`

The context does not contain a job ID, batch ID, request time, retrieval time,
random UUID, display name or UI label. A result belongs to all eight semantic
fields together. Candidate identity alone is insufficient.

## Canonical fingerprint

`fingerprintResearchContext` first canonicalizes the context:

- workspace and candidate UUIDs: Unicode NFKC, trim, collapse whitespace,
  lowercase, then UUID validation;
- country code: Unicode NFKC, trim, collapse whitespace, uppercase, then
  two-letter validation;
- product ID, product form, research goal, provider-plan version and
  interpretation version: Unicode NFKC, trim, collapse whitespace and
  lowercase;
- an empty product form becomes `null`.

It serializes a JSON object in this fixed key order:

```text
workspaceId, candidateId, marketCountryCode, productId, productForm,
researchGoal, providerPlanVersion, interpretationVersion
```

The idempotency fingerprint is
`trctx-v1:` plus the lowercase hexadecimal SHA-256 digest of that UTF-8 JSON.
The prefix versions the canonicalization algorithm. Extra object properties,
including timestamps and display names, are ignored.

Two requests are the same idempotency context only when all eight canonical
fields match. Different products, forms, markets, goals, provider plans or
interpretations are distinct. Migration 0029 enforces active typed-job
uniqueness on `(workspace_id, context_fingerprint)`.

## Stored and legacy context

New typed jobs store `research_context` and `context_fingerprint` as an
immutable pair on `buyer_trade_research_jobs`. Those columns are authoritative.
Finalization copies them into `result_summary.context` and
`result_summary.contextFingerprint`; worker input cannot replace them.
Repository readers recompute the fingerprint and reject a conflicting stored
pair.

When `result_summary.context` is absent, the state is `legacy_unknown`. Readers
must not infer a product, form, market or goal from the current UI selection or
from the job being the latest row for a candidate. Malformed or tampered context
is `invalid_context`. Only an `exact` result from
`compareTradeResearchResultContext`/`canReuseTradeResearchResultForContext` is
automatically reusable.

## Provider result

Every provider has one durable `TradeResearchProviderResult`. It keeps:

- provider and dataset IDs;
- dataset/source version, parser version, source period, retrieval time and
  source record identifiers;
- execution status and a safe error code;
- an independent evidence object with match decision, company, product,
  origin, shipment and program assessments, coverage, limitations,
  attribution, mapping scope, interpretation version and source-local
  conflicts.

The discriminated union requires evidence for `completed`, `no_match` and
`cached`. It allows evidence to be absent or partial for `not_started`,
`failed_retryable`, `failed_terminal`, `unsupported`, `blocked` and
`cancelled`. These states cannot be represented as `no_match` accidentally.
A cached result retains its full evidence and source metadata.

Each dimension has its own state and explanation. Strong company identity does
not change product or origin states. Product evidence does not change shipment
evidence. Mapping scope records the actual company, product, origin, shipment
and program grain supported by the source.

## Aggregate draft

`TradeResearchAggregateResult` extends the current Phase 2C aggregate with:

- `identitySummary`
- `productSummary`
- `originSummary`
- `shipmentSummary`
- `programSummary`
- `coverageSummary`
- `conflicts`
- `sourcesEvaluated`
- `sourcesCorroborating`

Each summary reports a categorical state, explanation, supporting provider IDs
and conflicting provider IDs. There is no opaque numeric score. T06 does not
change the current aggregation algorithm or worker output.

## Version meanings

- **Provider-plan version** selects the provider set and planning policy. It is
  part of `ResearchContext` and therefore part of idempotency.
- **Dataset/source version** identifies the publisher release evaluated by one
  provider. It belongs to that provider result.
- **Parser version** identifies the code that decoded the source release. It
  belongs to that provider result.
- **Interpretation version** identifies how source facts were mapped to MDF
  evidence semantics. It is part of the context and repeated on provider
  evidence for provenance.

Provider descriptor versions such as `canada-cid-v2` must not stand in for a
dataset year, parser version or interpretation version.

## Compatibility and reader precedence

The existing Phase 2A/2B `result_summary.evidence`, Phase 2C
`result_summary.sources`, and Phase 2C aggregate remain unchanged.
`selectTradeResearchEvidenceForRead` uses this order:

1. `providerResults` when the typed field is present;
2. existing Phase 2C `sources` when non-empty;
3. existing singular `evidence`;
4. no evidence.

The helper does not convert legacy evidence into a typed provider result because
doing so would invent dataset IDs, parser versions, mapping scope or context.
The current `TradeResearchPanel` can continue rendering the legacy shapes while
a later task adopts the typed provider presentation.

## Integration trace

- `createTradeResearchBatchAction` accepts an explicit browser-safe request.
  The server injects the selected workspace and both version constants, checks
  Candidate and product-context ownership, canonicalizes once, and persists the
  resulting context and fingerprint.
- `planTradeResearch` receives that `ResearchContext` directly. Provider source
  snapshot reuse remains governed by provider cache rules.
- `mapTradeResearchJob` treats the two job columns as authoritative and ignores
  conflicting context fields inside legacy JSON.
- current-result reads and polling use Candidate plus exact fingerprint.
  Candidate-only latest reads remain available for history/navigation.
- historical rows with both context columns null remain `legacy_unknown` and
  cannot satisfy an exact-context read or typed active-job dedupe.
- the worker still writes the proven Phase 2A/2B/2C evidence shapes. Typed
  provider execution and aggregate presentation remain later work.

Migration 0029 adds the nullable paired columns, immutability, split active-job
indexes, exact-context read index, creation validation and authoritative
finalization. It does not backfill historical context.
