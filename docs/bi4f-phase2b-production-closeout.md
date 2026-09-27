# BI4F Phase 2B — Production Closeout

Status: **CLOSED / PRODUCTION VALIDATED**
Closeout date: 2026-09-28
Automatic monetary spend: **₹0 hard limit — preserved**
Migrations 0025, 0026: **live and immutable**
Phase 2B introduces **no new migration**.

---

## 1. Executive summary

Phase 2B extends the durable, resumable, zero-cost trade-research engine established in Phase 2A with a Canadian evidence path. **Canadian Importers Database (CID)** from Innovation, Science and Economic Development Canada (ISED) is added as a second official/public/free provider. It is planner-eligible only for Canadian candidates, produces company-specific product + origin evidence at the (HS6, origin-country, importer-company) row grain, and never claims shipment-level facts. FDA FSVP behaviour is byte-identical to Phase 2A. The engine now dispatches by `plan.provider_id` and shares every worker safety mechanism: shared `deadlineAt`, checkpoint gates, resume-safe attempt reuse, lease + heartbeat, and now stale-attempt reconciliation.

---

## 2. Source legitimacy

- **Publisher**: Innovation, Science and Economic Development Canada (ISED), using data collected by the Canada Border Services Agency (CBSA).
- **Licence**: Open Government Licence – Canada, v2.0.
- **Attribution string emitted on every result**: `Contains information licensed under the Open Government Licence – Canada.`
- **Cost**: free / public.
- **Automation**: explicitly permitted under OGL.
- **Investigation record**: [docs/bi4f-phase2b-canada-cid-legitimacy.md](bi4f-phase2b-canada-cid-legitimacy.md).

---

## 3. Source-year decision

**`CANADA_CID_SUPPORTED_YEAR = 2020`** (see [src/lib/tradeResearch/providers.ts](../src/lib/tradeResearch/providers.ts)).

- 2024 and 2023 CID releases publish the "Major Importers by HS6, by country" resource only as XLSB, disqualified by the runtime constraints (see §4).
- 2022 CSV is an empty ISED placeholder (`content-length: 0`).
- 2021 CSV is 42 MB — over `CANADA_CID_MAX_BYTES = 40 MB`.
- **2020 CSV is 37.6 MB — fits, published as bilingual UTF-8 CSV with the exact (HS6, importer_company, origin_country) row grain, and preserves company + HS6 + origin-country evidence at legitimate row granularity.**

Trade-off: 2020 evidence is historical (~5 years old at closeout). Documented as a Phase 2B limitation (see §20).

---

## 4. XLSB investigation

**Production symptom (pre-fix)**: `provider_attempt_started providerId=canada-cid → state=failed_terminal, safe_error_code=PARSER_INCOMPATIBLE, duration_ms≈3074, ₹0`.

**Byte-level probe** of the official 2024 URL revealed:
- HTTP 200, `content-type: application/vnd.ms-excel`, `content-length: 22 664 154 (21.6 MB)`.
- First bytes `50 4B 03 04` — **PK\x03\x04 ZIP magic** (Office Open XML container).
- `unzip -l` listing showed `xl/workbook.bin`, `xl/worksheets/sheet1.bin` (**219 MB uncompressed**), `xl/styles.bin`, `binaryIndex1.bin` — **XLSB (Excel Binary Workbook / BIFF12)** file layout, not XLSX-XML.

XLSB adoption was rejected for Phase 2B because:
- The lightweight XML-XLSX parser cannot read BIFF12 binary sheet records.
- The uncompressed 219 MB sheet is a poor fit for Vercel Hobby memory + 60 s function ceiling.
- Adding a heavyweight XLSB dependency (SheetJS ~1.5 MB) was intentionally avoided under the "prefer application-only fix, no new heavy deps" guidance.

Production adopted the **2020 CSV** instead, published under the same ISED resource family and licence.

---

## 5. Streaming architecture

Cold-path pipeline in [src/lib/tradeResearch/canadaCid.ts](../src/lib/tradeResearch/canadaCid.ts) (`fetchAndParseCanadaCidStream`):

1. Fetch `response.body` as a `ReadableStream` — never `response.arrayBuffer()`.
2. First chunk is classified via magic-byte sniff (`classifyCanadaCidBody`); HTML / XLSB / XLS / oversized responses are rejected at the boundary with specific safe error codes (`CID_SOURCE_HTML`, `CID_XLSB_UNSUPPORTED`, `CID_LEGACY_XLS_UNSUPPORTED`, `CID_OVERSIZE`).
3. Each chunk is fed to a streaming `TextDecoder("utf-8", { stream: true })` — buffers UTF-8 multi-byte characters split across chunks.
4. Each decoded chunk is fed to an incremental CSV state machine: quoted fields, `""` escape, CR/LF and CRLF endings, quoted commas, and rows split across chunks are all handled at boundaries.
5. Full-source SHA-256 is computed incrementally via `createHash("sha256").update(chunk)`.
6. **Filter during parse**: only rows whose HS6 is in `CANONICAL_MDF_HS6` (derived from `PRODUCT_TRADE_MAPPINGS.hsLevel === 6`) are normalized and retained.
7. Between chunks: `input.onProgress?.()` (heartbeat opportunity) → `await setImmediate` (event-loop yield so `withHeartbeat`'s `setInterval` fires) → `budgetCheck()` (deadline-vs-now).
8. On budget breach → `CanadaCidRuntimeBudgetError` with `code: "CID_RUNTIME_BUDGET_CHECKPOINT"`.
9. `saveSnapshot` runs only after complete parse — no partial snapshot ever persisted.

Benchmark against the real 2020 CSV: 371 246 source rows → **718 canonical retained rows** (0.19 %). JSON serialized size ~70 KB vs ~40 MB raw source.

Test coverage: [src/lib/tradeResearch/canadaCidStreaming.test.ts](../src/lib/tradeResearch/canadaCidStreaming.test.ts) — 17 tests including chunk-boundary-in-quote, CRLF-across-chunks, UTF-8-multi-byte-across-chunks, deadline-during-parse, oversize-during-streaming, HTML/XLSB/XLS rejection.

---

## 6. Cache contract

`public.buyer_trade_source_snapshots` (migration 0025) — unchanged schema; JSONB coverage widened:

```
provider_id     = 'canada-cid'
dataset_id      = 'cid-major-importers-by-hs6-by-country'
published_period = '2020'
parse_version   = 'canada-cid-csv-v2'
row_count       = 684    (production observed)
material_hash   = SHA-256 of FULL 37 579 037-byte source
coverage        = {
  fields:        ['hs6','origin_country','importer_company','province','city'],
  semantics:     'company_hs_origin_directory_only',
  attribution:   'Contains information licensed under the Open Government Licence – Canada.',
  shipmentLevel: false,
  cachedSubset:  'canonical-mdf-hs6-only',
  sourceBytes:   37 579 037,
  sourceDataRows: 371 246
}
safe_metadata   = { malformedRowCount, year, totalDataRows, retainedRows }
normalized_rows = <MDF-canonical-HS6 subset only>
```

`normalized_rows` is deliberately an **MDF-relevant subset**, not the full CID dataset. `material_hash` guarantees the subset was derived from a specific full-source byte stream and did not silently drift. Warm-cache hits skip fetch + parse + save entirely and return `state='skipped_cached'` on the attempt.

---

## 7. Material-hash semantics

`material_hash` = `SHA-256(full source bytes as delivered by ISED)`. Computed incrementally from each streamed chunk before any filtering. Two runs against the same official file always produce the same hash regardless of what `normalized_rows` retains. `(provider_id, dataset_id, material_hash)` is a unique index in migration 0025 — FDA snapshots can never satisfy a Canada CID lookup and vice versa.

---

## 8. Provider routing

Single provider per candidate (Phase 2B does NOT introduce multi-provider sequencing):

| Candidate country | Descriptor | Reason |
|---|---|---|
| US | FDA FSVP | Canada CID `wrong_country` |
| CA | Canada CID | FDA FSVP `wrong_country` |
| Other | (none eligible) | Both descriptors `wrong_country` → `unsupported_coverage` |

`DEFAULT_TRADE_RESEARCH_DESCRIPTORS = [FDA_FSVP_DESCRIPTOR, CANADA_CID_DESCRIPTOR]` in [src/lib/tradeResearch/providers.ts](../src/lib/tradeResearch/providers.ts). The batch action plans against both; the planner refuses the wrong-country one so only ONE plan per candidate is `eligibility='eligible'`.

Worker dispatch in [src/lib/tradeResearch/server/worker.ts](../src/lib/tradeResearch/server/worker.ts):

```ts
switch (plan.provider_id) {
  case "fda-fsvp":   return processFdaFsvpPlan(...);
  case "canada-cid": return processCanadaCidPlan(...);
  default:           finalize as unsupported_coverage
}
```

FDA path is byte-identical to the Phase 2A body.

---

## 9. Evidence semantics

`TradeResearchResultSummary` in [src/lib/tradeResearch/types.ts](../src/lib/tradeResearch/types.ts) is JSONB-safe widened:

| Field | Type | FDA fills | Canada CID fills |
|---|---|---|---|
| `officialProgramEvidence` | `verified \| needs_review \| no_verified_match \| not_checked` | Verified when identity strong; needs_review when ambiguous; no_verified_match when none | Same shape; UI label swapped (see §15) |
| `productEvidence` | `verified \| supporting \| no_verified_match \| not_available` | `not_available` always | `verified` only if exact HS mapping + strong identity; `supporting` for proxy/composite + strong/ambiguous; `no_verified_match` for none |
| `originEvidence` | `verified \| supporting \| no_verified_match \| not_available \| not_verified` | `not_available` always | Reads matched-row origin countries; `verified`/`supporting` when set |
| `indiaOrigin` | `verified \| supporting \| not_verified` | `not_verified` always | `verified`/`supporting` only when `IN` appears on same matched (company, HS6) rows |
| `shipmentEvidence` | `not_verified` | Always | Always |
| `sourcesChecked` | integer | 0 or 1 | 0 or 1 |
| `automaticSpendRupees` | 0 | Always | Always |
| `evidence.source` | `"FDA FSVP" \| "Canadian Importers Database"` | FDA FSVP | Canadian Importers Database |

Canada CID **may** establish: company identity corroboration (via CID entry), company + HS6 product evidence (subject to mapping-kind cap), company + origin-country evidence (from same row).

Canada CID **does NOT** establish: shipment date, per-company quantity, per-company value, supplier, shipment record, customs importer-of-record status.

---

## 10. Product mapping rules

`canonicalHs6ForProduct(productId)` in [src/lib/tradeResearch/providers.ts](../src/lib/tradeResearch/providers.ts) returns `{ hs6, kind: "exact" | "proxy" | "composite" }` from `PRODUCT_TRADE_MAPPINGS` (canonical MI0.1 registry in [src/lib/marketIntelligence/product.ts](../src/lib/marketIntelligence/product.ts)):

| MDF product | HS6 | Mapping kind | Max `productEvidence` |
|---|---|---|---|
| `guntur-dry-red-chilli` | `090421` | proxy | supporting |
| `guntur-dry-red-chilli` | `090422` | proxy (crushed/ground) | supporting |
| `banganapalli-mango` | `080450` | composite (guava + mango + mangosteen) | supporting |
| `indian-pomegranate` | `081090` | composite (basket "other fresh fruit") | supporting |
| `indian-apples` | `080810` | exact | verified |

Worker rule in `processCanadaCidPlan`:
```ts
const productEvidence =
  noneMatch ? "no_verified_match" :
  strong && hs.kind === "exact" ? "verified" :
  (strong || ambiguous) ? "supporting" : "not_available";
```
`proxy` and `composite` HS mappings **never** produce `"verified"` product evidence even under strong identity.

---

## 11. India-origin rule

`indiaOriginVerified = match.originCountries.includes("IN")` — where `match.originCountries` is derived strictly from CID rows whose normalized company name matched AND whose HS6 equals the target. Cross-company or cross-HS origin leakage is impossible: the matcher filters by `(normalizedCompany, targetHs6)` before extracting origins.

Rules:
- India present + strong identity → `indiaOrigin = "verified"`, `originEvidence = "verified"`.
- India present + ambiguous identity → `indiaOrigin = "supporting"`, `originEvidence = "supporting"`.
- India NOT in matched origins → `indiaOrigin = "not_verified"` (regardless of what any OTHER company's row says).

Static test coverage: `origin from a DIFFERENT company row never leaks into candidate evidence` in [src/lib/tradeResearch/server/canadaCidWorker.test.ts](../src/lib/tradeResearch/server/canadaCidWorker.test.ts).

---

## 12. Runtime / deadline behaviour

Constants (server-only, in [src/lib/tradeResearch/server/worker.ts](../src/lib/tradeResearch/server/worker.ts)):

- `VERCEL_FUNCTION_MAX_MS = 60_000`
- `TRADE_RESEARCH_SAFE_EXECUTION_MS = 50_000`
- `WORKER_CLEANUP_RESERVE_MS = 8_000`
- `FDA_COLD_PATH_WORST_CASE_MS = 25_000`
- `CANADA_CID_COLD_PATH_WORST_CASE_MS = 30_000`

Every serverless entrypoint (inline action, cron GET, manual drain POST) passes `deadlineAt = createTradeResearchDeadline(started)` = `now + 50 s` into the worker. Both provider paths check the deadline before entering the cold path AND while streaming/parsing. On breach → `writer.release(job, worker, now + 2 s)` + return `"retry"`. No stale lease is ever left under normal checkpoint behaviour because the streaming loader yields to the event loop between chunks so `withHeartbeat`'s 15 s `setInterval` fires reliably.

---

## 13. Bounded retry

`MAX_CID_ATTEMPTS = 3` (matches migration 0025 `check (attempt_number between 1 and 3)`). After **three** consecutive `CID_RUNTIME_BUDGET_CHECKPOINT` retries the worker refuses to start attempt #4 and finalizes the job as `failed / failed` with safe error code `CID_RUNTIME_BUDGET_EXHAUSTED`, `sourcesChecked = 0`, `automaticSpendRupees = 0`, no fabricated snapshot. This closes the "retry-from-zero infinite loop" correctness gap even under pathological network conditions.

Test coverage: [src/lib/tradeResearch/server/canadaCidBoundedRetry.test.ts](../src/lib/tradeResearch/server/canadaCidBoundedRetry.test.ts).

---

## 14. Stale-attempt reconciliation

Before creating a new attempt, both `processFdaFsvpPlan` and `processCanadaCidPlan` check `latestAttempt(planId).state`. If it is `"running"` — meaning a prior worker was hard-killed mid-fetch and the job-level reclaim path left the attempt row orphaned — the worker calls `writer.reconcileStaleAttempt(prevId, "STALE_LEASE_RECOVERED")`, which atomically transitions the stale row via a single UPDATE with a `WHERE state='running'` idempotency guard:

- `state: 'running' → 'failed_retryable'` (allowed by `mdf.__trade_research_attempt_guard`)
- `safe_error_code: null → 'STALE_LEASE_RECOVERED'`
- `lease_owner → null`, `lease_expires_at → null`, `finished_at → now()`

History (`attempt_number`, `started_at`, `heartbeat_at`, `provider_plan_id`, `job_id`, `workspace_id`) is preserved. The stale row is NEVER rewritten as `completed`. Historical two production rows were repaired via a controlled one-time owner SQL action using the same semantics. Post-repair verification: `stale_on_terminal_jobs = 0`.

Test coverage: [src/lib/tradeResearch/server/staleAttemptReconciliation.test.ts](../src/lib/tradeResearch/server/staleAttemptReconciliation.test.ts) (10 tests, including "old stale attempt is never changed to completed").

---

## 15. UI semantics

[src/components/buyerFinder/TradeResearchPanel.tsx](../src/components/buyerFinder/TradeResearchPanel.tsx) now drives every label from `result_summary.evidence.source` and the widened literals. Zero backend contract change.

| UI element | FDA | Canada CID |
|---|---|---|
| Top-row label | `Official importer-program evidence` | `Official importer-directory evidence` |
| Source (View Evidence) | `FDA FSVP` (fallback for legacy rows) | `Canadian Importers Database` |
| Matched-location label | `Matched state` | `Matched province` |
| `productEvidence` mapping | `verified → Verified`, `supporting → Supporting evidence`, `no_verified_match → No verified match found`, `not_available → Not available from this source` |
| `originEvidence` mapping | same shape + `not_verified → Not verified` |
| `indiaOrigin` mapping | `verified → Verified`, `supporting → Supporting evidence`, `not_verified → Not verified` |
| Coverage explanation | FDA participant-list + state coverage note | Full CID coverage note + HS mapping-quality (`proxy` / `composite`) + shipment-absence + OGL attribution verbatim |

Test coverage: 11 new UI tests in [src/components/buyerFinder/TradeResearchPanel.test.tsx](../src/components/buyerFinder/TradeResearchPanel.test.tsx).

---

## 16. Production QA cohort

Validated Canadian candidates (all `automatic_spend_rupees = 0`, `sourcesChecked = 1`, `evidence.source = "Canadian Importers Database"`, `shipmentEvidence = "not_verified"`):

| # | Candidate | Outcome |
|---|---|---|
| 1 | Super Asia Foods | no_verified_evidence / no verified match found |
| 2 | Altius Spices & Seasonings | no_verified_evidence |
| 3 | Worlee.net | no_verified_evidence |
| 4 | CELL FOODS | no_verified_evidence |
| 5 | A Spice Affair | no_verified_evidence |
| 6 | Aurora Importing | no_verified_evidence |

Cohort outcome `no_verified_evidence / no verified match found` is **legitimate** and does NOT constitute evidence that these companies do not import — it means no match was found in CID's major-importer directory at HS6 090421 for 2020. Small importers, importers absent from CID confidentiality thresholds (< 3 per city, > 80 % concentration suppression), and non-2020 activity are all outside the source's grain.

---

## 17. Warm-cache proof

```
select provider_id, count(*) from buyer_trade_source_snapshots group by provider_id;
```
Result during and after the six-candidate Canada cohort:
```
fda-fsvp   = 1
canada-cid = 1
```
Canada snapshot timestamp did NOT change across warm-cache candidates. Attempts split as:
- 1 × `state='completed', record_count=684` (cold-fetch attempt)
- 5+ × `state='skipped_cached', record_count=684, safe_error_code=null` (warm-cache attempts)

This is the exact expected pattern: one download, one parse, one snapshot, N reuses.

---

## 18. ₹0 contract

Same as Phase 2A, extended:
- `CANADA_CID_DESCRIPTOR.costClass = "free"`. `isAutomaticallyExecutable` allows only `free`.
- Planner emits `automaticSpendRupees: 0` on every plan; the worker throws `PROVIDER_COST_POLICY_VIOLATION` if the persisted plan reports non-zero.
- `TradeResearchWriter.finalize` throws `AUTOMATIC_SPEND_MUST_REMAIN_ZERO` if `result.automaticSpendRupees !== 0`.
- DB CHECK on every trade_research table + `mdf.__trade_research_job_guard` + `mdf.__trade_research_attempt_guard` triggers still enforce `automatic_spend_rupees = 0`.
- Every production Canada CID row wrote `automatic_spend_rupees = 0`. Every attempt row: `automatic_spend_rupees = 0`. Every event row: `automatic_spend_rupees = 0`.

---

## 19. Security model

- **RLS** enabled on all trade_research tables + `buyer_candidates` — unchanged.
- **Service-role mutation only** on trade_research tables (migration 0025) + `buyer_candidates` SELECT-only via migration 0026 — unchanged.
- **RPC EXECUTE** granted to `service_role` only for all 8 RPCs in migration 0025.
- **`worker.ts` opens with `import "server-only"`** — no client component can import the streaming loader or the CID adapter.
- **Static-scan tests** ([src/lib/tradeResearch/server/deadlineCallSites.test.ts](../src/lib/tradeResearch/server/deadlineCallSites.test.ts)) still enforce that every production `drainTradeResearch(...)` call passes `deadlineAt = createTradeResearchDeadline(started)`.
- **`CRON_SECRET` / `TRADE_RESEARCH_DRAIN_SECRET`** server-only, timing-safe compare — unchanged.
- **Feature flags** `BUYER_SEND_ENABLED=false`, `BUYER_FINDER_HUNTER_REVEAL_ENABLED=false` — unchanged.
- **No BI ingestion**: no `ingest_buyer_intelligence_*` / `refresh_buyer_intelligence` reference anywhere in Phase 2B.

---

## 20. Known limitations

1. **Canada CID production year = 2020.** Historical evidence, not current-year proof.
2. CID publishes only **major importers** (up to ~80 % of imports per HS6/city). Small importers are absent by design.
3. CID confidentiality suppresses cities with fewer than 3 importers and single-company ≥ 80 % concentrations. Some products / cities may have zero disclosed rows.
4. **No-match is weak negative evidence only.** A `no_verified_match` result is not proof the company does not import.
5. **Guntur mapping uses HS6 proxy `090421`.** `productEvidence` for Guntur can never rise above `supporting`.
6. **No shipment-level facts.** Shipment date, quantity, value, supplier, port, customs-importer-of-record are permanently outside CID's grain.
7. **Canada provider is country-specific.** US candidates never route through it.
8. **One eligible provider per candidate.** No multi-provider corroboration on the same candidate scope in Phase 2B.
9. **Cache is MDF-canonical-HS6 subset**, not the full CID dataset. Adding a new MDF product with a new HS6 requires cache re-warm before it becomes queryable.
10. Cold-path retries **restart the download from byte 0**. Bounded at 3 attempts. Byte-level Range/If-Range resume is available on the ISED endpoint but was deliberately not implemented in Phase 2B (see [Phase 2C plan](./bi4f-phase2c-plan.md#f-byte-range-resume-for-cid-cold-path)).

---

## 21. Phase 2C preserved invariants

Any Phase 2C change must NOT touch:

- Migrations 0025 and 0026 (immutable).
- `AUTOMATIC_SPEND_RUPEES = 0` invariant at every layer.
- `worker.ts` server-only boundary.
- The three feature flags (`BUYER_SEND_ENABLED`, `BUYER_FINDER_HUNTER_REVEAL_ENABLED`, and any future automatic-paid-provider gate).
- FDA FSVP planner eligibility, worker path, or outcome mapping.
- Canada CID's HS6-scoped matcher, evidence-join rule, mapping-kind cap on `productEvidence`, or India-origin same-row rule.
- The `TradeResearchResultSummary` field literals for currently-populated fields. New provider evidence must add new fields, not overload existing ones.
- `buyer_trade_source_snapshots.material_hash` semantics (SHA-256 over full source).
- Buyer Intelligence write path (still deferred).
- Buyer conversion contract (Candidate ≠ Buyer, email still mandatory).

Any Phase 2C additive migration (`0027`+) must be additive-only, must not widen `authenticated` or `anon`, must not remove RLS, must not add mutation privileges on `buyer_candidates`, and must not add or widen BI-ingestion RPCs.

---

## 22. Final status

**PHASE 2B = CLOSED / PRODUCTION VALIDATED**

- Test suite (2026-09-28, closeout run): `npx vitest run --pool=forks --poolOptions.forks.singleFork=true` → **264 files passed / 2 skipped, 2506 tests passed / 2 skipped**.
- Type check: `npx tsc --noEmit --incremental false` → **exit 0**.
- Build: `npm run build` → **success**.
- Cache invariant: `fda-fsvp = 1`, `canada-cid = 1`; snapshot timestamps stable.
- ₹0 end-to-end. No BI writes. No paid providers.
