# BI4F Phase 2C — Plan (no implementation)

Status: **PLANNING**
Author date: 2026-09-28
Automatic monetary spend limit: **₹0 hard limit — preserved**
Migrations 0025, 0026: **immutable**
This document does not authorize any implementation. It selects the smallest next scope worth building and lays out the acceptance rules.

---

## 1. Phase 2A / 2B baseline

**Phase 2A** ([closeout](./bi4f-phase2a-production-closeout.md)) — durable, resumable, zero-cost trade-research engine backed by migration 0025; single provider = FDA FSVP; US-only; company + FSVP participant-list corroboration; no product/origin/shipment evidence.

**Phase 2B** ([closeout](./bi4f-phase2b-production-closeout.md)) — added Canada CID as a second official provider under the same engine; provider-dispatch by `plan.provider_id`; per-provider snapshot lookup; streaming CSV loader with MDF-HS-scoped filter; SHA-256 over full source; bounded retry (3 attempts, `CID_RUNTIME_BUDGET_EXHAUSTED`); stale-attempt reconciliation (`STALE_LEASE_RECOVERED`); widened `TradeResearchResultSummary` (`productEvidence`, `originEvidence`, `indiaOrigin` literals); source-aware UI labels; **no migration**.

Production behaviour today:
- US candidate → FDA FSVP path (company-match against quarterly FSVP list).
- CA candidate → Canada CID path (company + HS6 + origin-country match against 2020 CID CSV).
- Any other country → `unsupported_coverage`, sourcesChecked 0.

---

## 2. Unresolved evidence gaps

| Gap | Phase 2A | Phase 2B | Still open |
|---|---|---|---|
| US company + FSVP identity | ✅ | ✅ | — |
| US company + product | ❌ | ❌ | ⚠️ |
| US company + origin | ❌ | ❌ | ⚠️ |
| US company + supplier / refusal risk | ❌ | ❌ | ⚠️ |
| CA company + HS6 + origin | ❌ | ✅ (2020, `supporting` cap for Guntur) | Recency |
| CA company + shipment | ❌ | ❌ (impossible from CID) | ⚠️ (need different source) |
| Any country's real-time shipment | ❌ | ❌ | ⚠️ (no legitimate free source found) |
| Second official-source corroboration for the SAME candidate | ❌ | ❌ | ⚠️ |
| Non-US / non-CA markets | ❌ | ❌ | ⚠️ (limited legitimate free sources) |
| Evidence recency (Canada = 2020) | — | ⚠️ | ⚠️ |
| Buyer-Intelligence ingestion from research | Off | Off | Deferred |

---

## 3. Candidate Phase 2C directions

Evaluating the six directions from the brief plus one addition surfaced during Phase 2B's XLSB investigation.

### A. Same-candidate multi-source corroboration

Extend the worker to plan + execute **more than one eligible provider per candidate**, then aggregate the evidence.

- **Benefit** — Corroborated identity (a company appearing in BOTH FSVP AND VQIP is a stronger signal than one alone). Failure of one provider doesn't kill the batch.
- **Cost** — Worker sequencing, source-count semantics, evidence aggregation model, conflict handling, per-provider deadline allocation, UI complexity.
- **Legitimate second-source candidates** — FDA VQIP (Voluntary Qualified Importer Program public list; annual; short; opt-in universe); FDA Import Refusal Report (monthly public data; foreign manufacturer/product/refusal-risk — negative evidence only). Both US-only.
- **Recommended?** Yes as the primary Phase 2C direction, scoped narrowly. See §11.

### B. New country official sources

Investigated Phase-1.5-referenced markets. Legitimate free-and-automation-eligible company-level import data is scarce beyond US + Canada.

| Market | Best public source | Company-level? | HS + origin? | Free / automation | Verdict |
|---|---|---|---|---|---|
| UAE | FCSC Federal Competitiveness & Statistics — aggregate trade tables | ❌ | product only | free, but aggregate | Not eligible (market-level only) |
| Saudi Arabia | GaStat trade statistics | ❌ | product only | free, aggregate | Not eligible |
| Qatar, Oman, Kuwait, Bahrain | national stats agencies | ❌ | mostly aggregate | free | Not eligible |
| Thailand | Ministry of Commerce trade stats | ❌ | aggregate | free | Not eligible |
| Vietnam | GSO / Customs annual reports | ❌ | aggregate | free | Not eligible |
| Sri Lanka | Sri Lanka Customs Trade Info | ❌ | aggregate | free | Not eligible |
| South Korea | KITA / KCS aggregates | ❌ | aggregate | free | Not eligible |
| EU (all) | Eurostat Comext / national customs | ❌ | aggregate | free | Not eligible |
| UK | HMRC UK Trade Info | ❌ | aggregate | free | Not eligible |
| China | GACC customs statistics | ❌ | aggregate | free | Not eligible |
| Switzerland | swiss-impex | ❌ | aggregate | free | Not eligible |

None of the surveyed non-US, non-CA markets publish an official, free, automation-eligible, company-level import directory at the CID grain. Aggregate market data (already covered by MDF's Market Intelligence path) is not company-level and is therefore out of scope for the Buyer Finder trade-research engine.

- **Recommended?** No as Phase 2C primary. **Defer** until a legitimate country-level source with company grain surfaces.

### C. Current / recent trade evidence

Two sources materially fresher than Canada 2020:

- **FDA Import Refusal Report** — monthly public CSV/ZIP downloadable via `www.accessdata.fda.gov`. Foreign manufacturer + FDA product code + refusal date + refusal charges. Public data structure inspected in Phase 1.5. **US-only, negative evidence only.**
- **FDA VQIP participant list** — annual/FY public list. **US-only.** Small.
- Canada CID XLSB (2023 / 2024) — same source family as 2B, but the 2024 sheet is 219 MB uncompressed BIFF12 → runtime concerns (see §H below).

- **Recommended?** FDA Import Refusal Report is a strong recency win for US candidates but is negative evidence (refused entries), not positive corroboration. **Include as a scoped secondary provider** IF Phase 2C picks direction A.

### D. Zero-cost deep-evidence fallback (ImportYeti / others)

Phase 1.5 study concluded ImportYeti API is `free_quota, DISABLED` until entitlement / recurring credit / storage rights / API access-tier are proven. **No re-verification has been done since**. Terms specify Purchased Data covenant, human-only free plans, and API credit ambiguity.

- **Recommended?** No. Continues to fail-closed under the `quota_state = unknown → refuse` rule of Phase 2A's `isAutomaticallyExecutable` guard.

### E. Buyer evidence aggregation / scoring foundation

A **deterministic** evidence summary — sources count, per-provider decisions, mapping-kind, recency, provenance — surfaced on the candidate view. No opaque score. This is a natural companion to direction A: if we plan against two providers, we need aggregation semantics anyway.

- **Recommended?** Bundle with direction A as the aggregation model. Do NOT introduce a Buyer score.

### F. BI ingestion

BI ingestion pipelines (`ingest_buyer_intelligence_source`, `_claim`, `_observation`, `refresh_buyer_intelligence`) remain OFF. Current trade-research evidence is directory-level (no shipment date/quantity/value/supplier) and the BI schema expects shipment-shaped observations.

- **Recommended?** **Later, not Phase 2C.** Defer until Phase 2C's multi-source aggregation is in place and evidence maturity justifies ingestion.

### G. Byte-range resume for CID cold path

Not on the brief's canonical list; surfaced during Phase 2B's `retry-from-zero` review. The ISED endpoint supports HTTP 206 + stable ETag + `If-Range`. Persisting `{ bytes_downloaded, running_hash_state, partial_csv_state, last_etag }` in the attempt row's `safe_metadata` JSONB (no schema change) would give byte-level durable forward progress.

- **Recommended?** **No for Phase 2C.** Production evidence to date shows warm-Varnish + Vercel network fits the 42 s window comfortably; the 3-bounded-retry cap prevents pathological loops. Reserve byte-range for a Phase 2D if `CID_RUNTIME_BUDGET_EXHAUSTED` starts showing in the logs.

### H. XLSB support (unlock CID 2023 / 2024)

Rejected in Phase 2B due to 219 MB uncompressed sheet + heavyweight BIFF12 parser dependency. Same concerns apply to Phase 2C:

- SheetJS (`xlsx`) supports XLSB but adds ~1.5 MB to the deployed bundle.
- 219 MB in-memory sheet is a poor fit for Vercel Hobby memory + 60 s ceiling.
- MDF-HS filtering during parse (as done for CSV) is achievable but the streaming boundary for BIFF12 is per-record, not per-line — more complex.
- Recency win is real (5-year data freshness gap) but not clearly the highest-value next step.

- **Recommended?** **No for Phase 2C.** Reserve for Phase 2D or later once Vercel plan / infrastructure headroom is settled.

---

## 4. Source research table

Consolidated snapshot of every source considered:

| Source | Publisher | Country | Cost | Auto | Access | Cadence | Company | Product | HS | Origin | Ship. | Dates | Qty | Value | Supplier | Cache | Runtime | Recommendation for 2C |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FDA FSVP participant list | FDA | US | Free | ✅ | XLSX download | Quarterly | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | Small | **In use (Phase 2A)** |
| Canada CID `by-HS6-by-country` 2020 CSV | ISED / CBSA | CA | Free | ✅ (OGL) | CSV download | Annual | ✅ major | HS6/HS10 | HS6 | ✅ (row) | ❌ | year only | ❌ | ❌ | ❌ | ✅ | Medium | **In use (Phase 2B)** |
| Canada CID 2024 XLSB | ISED / CBSA | CA | Free | ✅ (OGL) | XLSB download | Annual | ✅ major | HS6/HS10 | HS6 | ✅ (row) | ❌ | year only | ❌ | ❌ | ❌ | ✅ | High (219 MB sheet) | Defer |
| FDA Import Refusal Report | FDA | US (foreign supplier grain) | Free | ✅ | Public CSV/ZIP monthly | Monthly | foreign mfr | FDA product code | ❌ (not HS) | mfr country | ❌ (refused, not shipped) | ✅ refusal date | ❌ | ❌ | mfr | ✅ | Small | **Candidate — negative evidence only** |
| FDA VQIP public list | FDA | US | Free | ✅ | Public list page | Annual/FY | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | Small | **Candidate — small positive corroboration** |
| FDA alerts / recalls / warnings | FDA | US | Free | ✅ where documented | Public feeds | Event-driven | Y | Y | L | L | ❌ | Y | ❌ | ❌ | Y | ✅ | Small | Candidate — negative/risk |
| CBP manifest | CBP | US | FOIA / paid | ❌ | Request | Request | ✅ when disclosed | Y | L | Y | Y | Y | Y | Y | Y | — | High | Rejected |
| ImportYeti API | Commercial | US/MX | Credits | ❌ (unknown) | API | Rolling | Y | Y | L/Y | Y | Y | Y | Y | Y | Y | ? | — | Fail closed (Phase 1.5 rule) |
| Panjiva / ImportGenius / Volza / Trademo | Commercial | Various | Paid | ❌ | API | Rolling | Y | Y | Y | Y | Y | Y | Y | Y | Y | — | — | Rejected (₹0 contract) |
| UAE FCSC / KSA GaStat / Vietnam GSO / etc. | National statistics | Various | Free | Aggregate only | Web / bulk | Various | ❌ | aggregate | Y | aggregate | ❌ | period | aggregate | aggregate | ❌ | N/A | — | Not eligible (market-level) |
| Eurostat Comext / HMRC UK / GACC / KITA | National / regional statistics | EU / UK / CN / KR | Free | Aggregate only | Bulk | Monthly | ❌ | aggregate | Y | aggregate | ❌ | month | aggregate | aggregate | ❌ | N/A | — | Not eligible |

---

## 5. Evidence-grain comparison

| Grain | FSVP | CID 2020 | FDA VQIP (candidate) | FDA Refusals (candidate) |
|---|---|---|---|---|
| Company identity | ✅ US importer | ✅ CA major importer | ✅ US voluntary participant | ⚠️ foreign manufacturer only |
| Product | ❌ | HS6/HS10 | ❌ | FDA product code (not HS) |
| Origin | ❌ | ✅ same row | ❌ | mfr country |
| Shipment | ❌ | ❌ | ❌ | ❌ (refused, not shipped) |
| Positive/negative | Positive (program participant) | Positive (major-importer directory) | Positive (voluntary program participant) | Negative (refused entry) |
| Dates | Quarterly period | Annual (2020) | Annual/FY | ✅ refusal date |
| Grain risk | Low | Medium (proxy HS caps evidence) | Low (small universe) | High if promoted to positive evidence |

---

## 6. Currentness / recency

| Provider | Latest evidence date | Freshness |
|---|---|---|
| FSVP | Current quarter | ✅ |
| CID | 2020 | ⚠️ 5 years |
| VQIP (candidate) | Current FY | ✅ |
| FDA Refusals (candidate) | Current month | ✅ |

VQIP + Refusals would materially close the recency gap for US candidates. Neither addresses the CA recency gap (CID XLSB is the only current-year option and is deferred).

---

## 7. Architecture options

**Option 1 — Keep one provider per candidate.**
- Cheapest change: no worker refactor, no aggregation model.
- Precludes corroboration.
- Excludes VQIP + Refusals from adding value even where they could.

**Option 2 — Real multi-provider execution (recommended for Phase 2C).**
- Extend the existing `getEligiblePlan` → planner returns an *ordered array* of eligible plans; worker iterates.
- Each provider gets its own attempt row (already supported by schema: attempt rows are keyed by `(provider_plan_id, attempt_number)` and each plan is a distinct row).
- Deadline allocation: split remaining budget across providers with per-provider `requiredMs` caps; late providers are gated by `checkpointIfBudgetLow` and released cleanly.
- Cache reuse: each provider has its own `(provider_id, dataset_id)` snapshot lookup.
- Aggregation: sum `sourcesChecked` across providers evaluated; carry each provider's evidence as an array element in `evidence.sources[]`; overall outcome is derived from the highest-confidence signal.
- Cancellation: cancel-mid-provider is a checkpoint, same as today.
- Failure isolation: one provider failing doesn't kill the batch; the batch's `outcome` becomes `partial` if some providers succeed and some fail.

---

## 8. Multi-provider analysis

- **Result-summary shape** — add `sources[]` to `evidence`, where each entry carries `{ source, datasetPeriod, retrievedAt, identityDecision, matchReason, coverageExplanation, productEvidence, originEvidence, indiaOrigin }`. `evidence.source` (singular) stays for backwards compat with FDA-shape rows.
- **Per-provider `sourcesChecked` increment** — evaluated (cold path) = +1, cache-hit = +1, wrong-country/skipped-cost/quota_unknown = +0. Global `sourcesChecked` is the sum across evaluated providers.
- **Attempt semantics** — each provider owns its own `buyer_trade_research_provider_plans` row and its own `attempt_number` sequence.
- **Deadline allocation strategy** — first-come reservation: worker starts with `deadlineAt`, subtracts each provider's actual duration, gates the next with `checkpointIfBudgetLow(remainingMs)`. If provider N can't fit, it's released as `retry_wait` for the next drain; earlier providers' results are still saved.
- **Aggregation of `officialProgramEvidence`** — take the strongest positive across providers; needs_review + verified → verified with `evidence.sources[]` listing both.
- **Conflict handling** — if two providers disagree on `originEvidence` for the same company + HS6, mark the aggregate `no_verified_match` with reason `conflicting_source_evidence`. Never silently resolve conflict.
- **Migration** — none required. Both `result_summary` and `evidence.coverage` are JSONB. The change is purely additive at the TypeScript literal + rendering layer.

---

## 9. BI-ingestion analysis

- **Current maturity** — CID and FSVP produce identity + product + origin evidence at directory grain. No shipment observations. BI's observation model expects shipment-shaped rows.
- **Provenance mapping** — a straightforward `ingest_buyer_intelligence_source` insertion is technically possible for CID rows (as `official_directory` claim, not `shipment_observation`), but it would broaden BI's semantic surface and create ambiguity between "we saw this company in a directory" and "we observed a shipment".
- **Recommended** — **keep BI ingestion OFF** for Phase 2C. Re-evaluate after Phase 2C multi-source evidence lands and a proper `official_directory` claim type is scoped for BI. Any Phase 2C+ BI change requires a separate reviewed brief.

---

## 10. Zero-cost analysis

Every proposed Phase 2C source (VQIP, Refusals) is:

- Officially published by FDA.
- No API key, no login, no captcha, no rate limit.
- Downloaded as public bulk data.
- Cacheable via `buyer_trade_source_snapshots` with new `provider_id` + `dataset_id`.
- Cost class = `free`.

Automatic monetary spend contract (`₹0`) is preserved unchanged.

---

## 11. Runtime / serverless analysis

| Provider | Source size | Streaming needed? | Deadline fit? | Bounded retry needed? |
|---|---|---|---|---|
| FSVP | ~5 MB XLSX | No (existing path OK) | Yes | Existing 30 s FDA_COLD gate |
| CID 2020 | 37 MB CSV | Yes (already implemented) | Yes | 30 s CID_COLD gate + 3-attempt cap |
| VQIP | tiny list page | No | Trivially yes | Not needed |
| FDA Refusals | ~6 MB monthly ZIP | Optional (fits comfortably) | Yes | Not needed |

Every provider fits inside a single 50 s safe-execution window on Vercel Hobby with warm-cache reuse thereafter.

---

## 12. Recommended Phase 2C scope

**Scope**: **Same-candidate multi-source corroboration for US candidates, adding FDA VQIP as a second free provider, plus the multi-provider execution scaffolding and deterministic evidence aggregation model.**

Explicitly:

1. New provider descriptor `FDA_VQIP_DESCRIPTOR` with `countries: ["US"]`, `roles: ["COMPANY_MATCH", "OFFICIAL_CORROBORATION"]`, `datasetCadence: "annual"`.
2. New adapter [src/lib/tradeResearch/fdaVqip.ts](../src/lib/tradeResearch/fdaVqip.ts) modelled on `fdaFsvp.ts`.
3. New worker branch `processFdaVqipPlan` reusing existing preamble + `checkpointIfBudgetLow` + attempt reuse + stale-attempt reconciliation.
4. `TradeResearchWriter.getEligiblePlan` extended to return **all** eligible plans (ordered by `sequence`), not just the first.
5. `processTradeResearchJob` iterates plans; each plan advances its own stage/attempt; global `sourcesChecked` is summed.
6. `TradeResearchResultSummary.evidence.sources[]` new array; `evidence.source` (singular) stays as the primary provider label for legacy compat.
7. UI: extend `TradeResearchPanel` to render an evidence-per-source list under "View evidence" when `sources.length > 1`.
8. Aggregation rules: highest-confidence identity wins for `officialProgramEvidence`; product/origin/indiaOrigin aggregate as `verified > supporting > no_verified_match > not_available` (strongest wins). Conflicts across providers → `officialProgramEvidence = needs_review` with reason `conflicting_source_evidence`.
9. Bounded per-provider budget allocation: `remaining = deadlineAt - now`; each provider's cold gate uses its own `requiredMs`.
10. Documentation update.

## 12a. Why this scope

- **Smallest change that materially improves buyer discovery**: US candidates today get FSVP-only. Adding VQIP:
  - Adds a real second official-source corroboration path.
  - Establishes the multi-provider execution scaffolding needed for every future addition.
  - Uses an already-vetted publisher (FDA) with the same legitimacy profile.
- **Doesn't repeat the XLSB / 219 MB / cold-path mistakes**: VQIP + Refusals are small public files.
- **Preserves every current invariant**: ₹0, no BI writes, no paid providers, no Buyer conversion.
- **Non-blocking for CA**: CID stays exactly as it is today.
- **Aggregation model is prerequisite work** for any future provider addition — building it now on the two-US-provider case is cheaper than retrofitting later.

---

## 13. Explicit non-goals

Phase 2C must NOT:

- Add a new country.
- Implement byte-range resume for CID (reserve for Phase 2D if needed).
- Add XLSB parser support (reserve for Phase 2D).
- Enable BI ingestion.
- Enable any paid provider.
- Change FDA FSVP behaviour.
- Change Canada CID behaviour.
- Change `AUTOMATIC_SPEND_RUPEES = 0`.
- Change `BUYER_SEND_ENABLED` / `BUYER_FINDER_HUNTER_REVEAL_ENABLED`.
- Introduce a Buyer score.
- Mutate `buyer_candidates` from the worker.
- Promote refusal (negative) evidence to positive.
- Add ImportYeti / ImportGenius / Panjiva / Volza / Trademo automation.

---

## 14. Migration expectation

**NO new migration expected.** All changes fit in existing JSONB `result_summary` + `coverage` + `safe_metadata` shapes. If Phase 2C investigation uncovers a genuine schema requirement (e.g., a new source-type enum constrained at the DB level), STOP and propose additive migration 0027 as a separate reviewed brief. Do not create 0027 casually.

---

## 15. Estimated implementation complexity

| Component | Complexity | Notes |
|---|---|---|
| `FDA_VQIP_DESCRIPTOR` | Low | Copy FSVP shape, adjust roles + countries. |
| `fdaVqip.ts` adapter | Low–Medium | HTML page or public list — needs one-time source-shape verification. |
| `processFdaVqipPlan` in worker | Low | Copy `processFdaFsvpPlan`, swap loader + matcher. |
| Multi-plan `getEligiblePlan` | Low | Return array instead of first-eligible. |
| Multi-plan iteration in `processTradeResearchJob` | Medium | Preserve deadline allocation, cancellation, stale-attempt reconciliation across per-provider attempts. |
| `evidence.sources[]` type widening | Low | JSONB-safe. |
| Aggregation rules | Medium | Deterministic; needs tests for every conflict combination. |
| UI multi-source view | Low | Extend the existing `<details>` block. |
| Tests | Medium | ~40–60 new tests across planner, worker, aggregation, UI. |
| **Overall** | **Medium** | Similar footprint to Phase 2B without the streaming/XLSB investigation. |

---

## 16. Proposed implementation sequence

1. **Legitimacy verification** — download-inspect VQIP source page + FDA Refusals structure via safe HEAD/first-16-byte probe. Confirm content-type, cache-headers, licence attribution requirement. Document in `docs/bi4f-phase2c-vqip-legitimacy.md`.
2. **Descriptor scaffold** — add `FDA_VQIP_DESCRIPTOR` behind `costClass: "unsupported"` first; add planner routing tests.
3. **Adapter** — `fdaVqip.ts` fetch + parse + normalized-company match; unit tests for parse, match, deadline, HTML rejection.
4. **Worker branch** — add `processFdaVqipPlan` alongside FDA + CID; unit tests for cache hit / cold path / retry / stale attempt.
5. **Multi-plan execution** — change `getEligiblePlan` return type to array (or add `getEligiblePlans`); update `processTradeResearchJob` to iterate; tests for two-provider execution, deadline allocation, partial success.
6. **Aggregation** — `evidence.sources[]`; deterministic aggregation for `officialProgramEvidence`, `productEvidence`, `originEvidence`, `indiaOrigin`; unit tests for every conflict matrix.
7. **UI** — extend `TradeResearchPanel` for `sources.length > 1`; regression tests.
8. **Gate flip** — flip `FDA_VQIP_DESCRIPTOR.costClass` to `"free"` in the SAME reviewed change as the completed adapter + worker + aggregation.
9. **Controlled QA** — one US candidate confirmed to appear in both FSVP + VQIP → strong identity, evidence.sources length = 2, sourcesChecked = 2.
10. **Documentation** — `docs/bi4f-phase2c-production-closeout.md` on green.

---

## 17. QA plan

Before flip:
- Full vitest suite green.
- `tsc --noEmit` green.
- `next build` green.
- Static-scan test: every production `drainTradeResearch(...)` call still plumbs `deadlineAt`.
- New static-scan test: aggregation module is server-only (`import "server-only"`).

After deploy:
- Owner runs `POST /api/internal/trade-research/drain` from DevTools; observe `automatic_spend_rupees: 0`, `sourcesChecked ∈ {0,1,2}`, no BI writes.
- Snapshots table shows `fda-fsvp = 1`, `canada-cid = 1`, `fda-vqip = 1`; each `record_count` > 0; each `material_hash` non-empty.
- Attempt table: for each two-provider job, two attempt rows, both terminated as `completed` or `skipped_cached`.
- Result payload: `evidence.source = "FDA FSVP"` OR `"Canadian Importers Database"` (backwards-compat singular), `evidence.sources` array present with length 2 for US candidates.

---

## 18. Rollback plan

- **Gate reversal**: flip `FDA_VQIP_DESCRIPTOR.costClass` from `"free"` back to `"unsupported"` in a hot-fix. Planner refuses; production reverts to Phase 2B behaviour for US candidates (FSVP only). No historical data mutation.
- **Aggregation reversal**: `evidence.sources[]` field is additive; downgrading to Phase 2B UI code renders only `evidence.source` (singular) — no data loss, no error.
- **Snapshot cleanup**: `fda-vqip` snapshots are static, JSONB-only, and never referenced by non-VQIP code paths. They can be left in place or deleted with a single SELECT-then-DELETE by owner.

---

## 19. Exit criteria

Phase 2C is closable when:

1. VQIP legitimacy documented + owner-approved.
2. VQIP descriptor + adapter + worker branch shipped with full test coverage (unit + integration).
3. Multi-plan execution live; deadline allocation preserves cleanup reserve.
4. Aggregation rules cover every conflict combination with deterministic outputs.
5. UI renders `evidence.sources[]` for two-provider results with correct labels + per-provider provenance.
6. Cache invariant: `fda-fsvp = 1`, `canada-cid = 1`, `fda-vqip = 1`; snapshot timestamps stable across warm-cache reruns.
7. At least one US candidate with genuine both-provider corroboration validates end-to-end in production.
8. All Phase 2A + 2B regressions still green.
9. ₹0 end-to-end.
10. BI writes = 0.
11. Documentation: `docs/bi4f-phase2c-vqip-legitimacy.md` + `docs/bi4f-phase2c-production-closeout.md`.

READY TO BEGIN PHASE 2C IMPLEMENTATION: **YES — pending owner approval of this plan**.
