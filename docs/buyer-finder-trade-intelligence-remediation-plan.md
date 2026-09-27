# MDF Outreach — Buyer Finder and Trade Intelligence remediation plan

**Date:** 27 September 2026 · **Baseline:** `5cd96ac` plus pre-existing untracked targeted action/test · **Status:** implementation proposal only.

This plan accompanies the [full audit and evidence register](<C:/Users/samin/Documents/GitHub/mdf-outreach/docs/buyer-finder-trade-intelligence-astra-audit.md>)). Issue IDs refer to that document. No fixes, migrations, provider activations, production writes or deployment changes were made during the audit.

## 1. Intended result and boundaries

Deliver a reliable internal workflow that answers: which real companies may buy MDF's products, what evidence supports that possibility, and what legitimate contact route is available? Deliver source-specific trade corroboration with clear age, scope and uncertainty. Do not promise complete shipment intelligence.

At most three ordinary searches per day: acquire up to 100 unique seeds/run, validate40, deeply research/top-screen20, preserve all remaining hits for later work. Use only approved free endpoints and shared public datasets. The budget is a configurable ceiling, not a requirement to spend every request.

The invariants remain:

- Candidate ≠ Buyer and approval ≠ conversion.
- A controlled, legitimate email is mandatory for conversion. Do not add source kinds by accident.
- `BUYER_SEND_ENABLED=false`; `BUYER_FINDER_HUNTER_REVEAL_ENABLED=false`.
- No guessed contacts/emails, LinkedIn scraping, fabricated imports/shipments, trial rotation or paid fallback.
- Search intent contributes no positive evidence; market data cannot become company evidence.
- Unknown remains unknown. Each claim retains subject, scope, provenance and evidence period.
- Provider automation, commercial use, caching, quota and cost entitlement are certified before activation.

A later implementation task should work in small reviewable changes. Preserve unrelated untracked work. Database changes require a concrete contract, migration/backfill/rollback design and Supabase/Postgres guidance; no schema overhaul is a prerequisite for the first pure correctness fixes.

## 2. Execution principles

1. Correct interpretation before expanding coverage. New providers multiply errors in identity, scope and aggregation.
2. Persist independent provider outcomes before aggregation; failure is not a negative evidence result.
3. Separate dataset acquisition from company matching. Download a bulk source once per version, not once per candidate.
4. Resume at a completed hit/provider boundary. Never solve lease failures by dropping revision fences.
5. Unify broad and targeted research behind one identity and enrichment pipeline.
6. Reuse the existing BI sources/claims/observations model. Add narrowly justified concepts, not another evidence framework.
7. Design for the actual authorized hosting environment. Vercel Hobby commercial eligibility and daily-drain capacity are blockers to an unconditional ₹0 production promise. [Vercel plan terms](https://vercel.com/docs/plans/hobby).
8. Keep a supported-market pilot small enough to inspect manually. Report quality denominators, not a universal score.

## 3. Wave 0 — correctness and operating-model blockers

**Issues:** TI-01, TI-03, TI-06, BF-14, SEC-01, OPS-01; immediate containment for BF-01/BF-07/TI-02/TI-05.

**Outcome:** no rejected entity can produce positive origin/product evidence; trade context is explicit; conversion preview agrees with authoritative SQL; selected workspace is respected; one lease revision survives heartbeats; misleading labels/claims are contained. Establish an eligible operating environment before increasing automatic workload.

**Prerequisites:** inspect current branch/state and existing targeted files; reproduce the audit fixtures; document deployed plan/runtime and environment gates without printing secrets. The audit did not verify production settings, so do not treat them as established facts.

**Work:**

- Fix CID rejected/none projection before adding any new data. Preserve the conflicting row for review only.
- Fix heartbeat propagation in both provider-only paths; use a strict revision fake plus integration RPC tests in an isolated database.
- Require explicit product/market context for trade requests and retrieval. Handle legacy context as unknown rather than selecting a product heuristically.
- Make all selected-workspace repository reads explicit; test a user who belongs to two workspaces.
- Align UI conversion eligibility with the existing RPC, without relaxing its email/provenance constraints.
- Remove positive ranking from intent and suppress known-invalid regex interpretations while the fuller evidence model is prepared. Change bare verification wording only where the current result can support a more precise label.
- Record the hosting decision: eligible existing cloud plan, or an existing local machine with accepted availability limits. No deployment or paid subscription is implied by this plan.

**Tests:** ON-vs-BC India fixture; same name/HS with conflicting provinces; rejected source cannot elevate any aggregate; slow fetch crossing heartbeat boundary; stale worker cannot mutate; mango/chilli context separation; cross-workspace same domain; masked/unrevealed email preview rejected; approval without email remains nonconvertible.

**Production QA for later authorized rollout:** inspect existing result contexts and versions read-only first. Identify exactly which results used the defective interpretation; recompute those under a new calculation version while retaining old provenance/history. Do not mass-delete historical evidence. Confirm both send/reveal gates remain false and compare displayed summaries with source rows.

**Exit gate:** all invariant fixtures pass, no unsupported positive evidence remains in the corrected paths, workspace tests pass, lease tests reflect SQL semantics, and hosting assumptions are explicit. New providers stay disabled.

## 4. Wave 1 — durable research and shared evidence contracts

**Issues:** TI-02, TI-04, TI-05, TI-09, TI-11, TI-12, BF-11, BF-12, BF-16, OPS-02; trust-boundary design for SEC-02.

**Outcome:** searches survive browser closure; provider results survive deadlines/cancellation; partial coverage is truthful; two, three and five sources use one execution policy. Source data and interpretation versions are reproducible.

**Prerequisites:** Wave 0 lease/context fixes; hosting choice; documented minimal schemas/status contracts. Separate provider execution state from evidence strength and review state.

**Work:**

- Version provider-result payloads with status, source/record IDs, period, timestamps, match decision, supported fields, mapping scope, safe errors and attribution.
- Define the context fingerprint and idempotency keys. Preserve workspace/entity/product/form/market/goal/provider-plan version.
- Persist completed provider results independently and resume remaining providers. Cancellation keeps completed evidence with incomplete coverage.
- Replace positive-max aggregation with dimensional identity/product/origin/program/coverage summaries. Preserve potential conflicts and distinguish genuine absence from contradiction.
- Introduce a small typed adapter registry; unknown planned provider becomes explicit unsupported/blocked, not silently skipped.
- Apply one bounded retry/deadline policy. Request-entry deadline, Retry-After, jitter, cap, terminal schema classification, cleanup reserve and one lease context.
- Make snapshot interpretation identity include material hash, parser/schema version, period and filter/mapping version. A 304 does not certify an incompatible old parse.
- Persist broad-run hits/dispositions/cursor before enrichment. Use durable pending-work/reconciliation instead of swallowed enqueue failures.
- Size the unattended scheduler for the chosen environment; browser pump becomes a convenience. Separate global scheduler authorization from workspace-owner triggers.

**Tests:** provider A succeeds/B fails; A no-match/B fails; both fail; cancelled after A; deadline after A; restart before finalization; five providers with one unsupported and one429; stale lease fencing; repeated enqueue and duplicate run; identical bytes/new parser; 304/new parser; retry exhaustion; browser closes before execute; scheduler handles a full daily queue without UI activity.

**Production QA:** use a small controlled candidate batch on an authorized environment; observe run/job/provider counters and compare retries to persisted outcomes. Simulate safe provider unavailability in staging, not by breaking production endpoints. Measure queue age, no duplicate contacts/candidates, actual drain cadence and recovery after process restart.

**Exit gate:** every planned provider has a durable outcome, all terminal summaries expose partial coverage, completed work is not repeated except an explicitly idempotent reconciliation, and no queued work relies solely on an open browser.

## 5. Wave 2 — Buyer Finder identity, relevance and contacts

**Issues:** BF-01 through BF-10, BF-13, BF-15, BF-16; remaining BF-12; SEC-02.

**Outcome:** broad and targeted research share one reliable path; ranking describes observed fit; real contact routes and procurement relevance are separate; queue completeness no longer depends on latest100.

**Prerequisites:** durable run-hit lifecycle; evidence/contact contracts; shared crawler boundary; owner/member capability decision. No new commercial provider is necessary.

**Work:**

- Preserve all provider hits, resolve entities before applying validation budget, and prioritize novel/changed hits. Respect rejected, archived and already-Buyer dispositions.
- Implement source-preserving identity validation: resolvable domain, site identity, market presence, active/parked/unknown state, aliases and corporate relationships.
- Unify normalizers while retaining original/native-script names. Use legal identifier+jurisdiction where available; domain/name alone cannot override a location conflict.
- Route targeted input into the same pipeline. Domain-only names remain provisional. Resolve conflicts before reuse; do not silently cross countries.
- Separate target product/role from possible fit and observed evidence. Keep category/variety/form distinctions through every display and calculation.
- Replace known unsafe importer extraction with conservative subject/negation/context rules. Record exact excerpt and a low-confidence/needs-review state where interpretation is uncertain.
- Implement procurement-role taxonomy and exclusions; size-aware owner/MD fallback. Keep masked named contact distinct from contactable email route.
- Use documented free, domain-bound people lookup where available; never substitute a paid endpoint because its name sounds similar.
- Share robots, page cache and extraction between website contacts and business research. Fix homepage ordering, rules and registrable-domain handling before enabling deeper crawling.
- Track per-email first/last observed, source URL and unsuccessful/absent/expired distinctions. No automatic guessing, no SMTP validation dependency.
- Replace slice-before-rank with filtered, paginated queries and stable ordering. Show unprocessed hits and excluded dispositions with counts.

**Tests:** repeat100-hit response yields new work after existing20; already rejected/Buyer remains excluded unless explicitly reopened; parent domain/two subsidiaries; different-country namesake; legal suffix and native-script names; parked/dead/blocked site; query-only candidate receives no evidence points; “not importers” and third-party customer sentence; generic mango cannot become Banganapalli; finance/marketing/sales roles; masked person plus real public mailbox; email disappears vs crawler fails; robots wildcard/Allow and public-suffix domains; highest-priority older candidate beyond 100; relation counts beyond API page size.

**Production QA:** run fixed targeted cases and two broad market/product cohorts at reduced concurrency. Human-review top 20, all automatic merges and new public-email sources. Compare before/after source diversity, incremental useful yield, false merges and contact-role correctness. Do not use improved total candidate counts as a quality proxy.

**Exit gate:** every ready candidate has recorded identity status and sourced relevance; targeted and broad have the same downstream lifecycle; ranking explanations contain no intent-as-proof; no false merge in the adversarial set; no silent candidate/contact truncation; conversion rules unchanged.

## 6. Wave 3 — source quality, Canada recency and approved fan-out

**Issues:** TI-07, TI-08, TI-10, TI-13, TI-15, OPP-01; onboarding controls from OPS-04.

**Outcome:** newer Canadian category/origin evidence, better preserved source identity, bounded shared dataset ingestion, and useful UK company/commodity activity. FDA sources remain narrow corroboration.

**Prerequisites:** provider contract, immutable dataset versions, context/mapping model, parser health checks, source-licence manifests, hosting/runtime decision. No provider can be marked active merely because its descriptor compiles.

**Work:**

- Preserve CID location rows; deduplicate only source-identical records. Test namesakes and multiple branches before importing a new year.
- Certify a full 2024 XLSB sample/parse with bounded memory and exact source hash; record year, schema, row count, retained HS scope and parser version. Compare sampled rows to official views. Store a compact derived dataset, not an unbounded workbook in per-candidate JSON.
- Keep raw material available only as permitted and necessary for reproducibility; separate its retention from derived evidence. Publish a new version atomically after validation.
- Add row-count/schema/period gates to FDA and Canada. Quarantine zero/unexpected datasets; keep last-good evidence explicitly dated.
- Preserve VQIP source address/domain and published contact fields as research evidence. Do not make VQIP email a new conversion-eligible source without an explicit later policy decision.
- Move bulk refresh out of candidate jobs; single-flight refresh, conditional fetch, small matching reads, measured bytes.
- Add HMRC as both a discovery seed and month/commodity activity source using the same evidence record. Preserve direction/month/code and suppressed coverage. Do not infer partner country, supplier, quantity or value.
- Keep Hunter optional; tune query variants only using the measured labelled cohort.

**Tests:** 2024 actual-format golden fixture; XLS/HTML/empty/changed-header/oversize/corrupt archive; inflated-workbook memory bound; multiple provinces retained; source-year mismatch; leading-zero HS; mango composite vs apples exact commodity; parser upgrade on unchanged bytes; stale FY VQIP; HMRC pagination/nextLink/429; no origin from aggregate country data; source removal; concurrent refresh creates one certified version.

**Production QA:** publish new source versions in staging first, then shadow-compare a small read-only company cohort. Record differences between 2020 and2024 rather than treating changed membership as proof of cessation. For HMRC, manually verify a sample of trader+commodity+month results and show no transaction count. Roll out one source at a time with source-health and byte budgets.

**Exit gate:** certified source manifests, no source-grain loss, publication period visible, no directory-to-shipment metric inflation, and incremental useful yield demonstrated. A source with unresolved licence/schema remains disabled without blocking the core product.

## 7. Wave 4 — professional research UX

**Issues:** BF-05 UX completion, BF-10 presentation, TI-14, OPS-02 wording; shared journey issues throughout the audit.

**Outcome:** one clear dark-first research workspace for market discovery and known-company research, with actionable evidence and minimal competing controls.

**Prerequisites:** truthful statuses and provider outcomes; explicit context; accessible UI components; stable pagination/ranking. Design work can begin earlier, but do not ship mock progress or unsupported labels while backend states remain ambiguous.

**Work:**

- Permanent mode switch: Discover market / Research known company. Keep search intent clear and reuse existing company results deliberately.
- Durable run page with actual counters, failed/unsupported source coverage, remaining hit pool and resume action.
- Results table with company/website, validated location, one scoped relevance reason, contact route, research state and next action. Keep filters visible but secondary.
- Company detail organized into Company / Product fit / Contact / Trade evidence. Default summary shows source period and limitations; details show original links, record fields and reasoning.
- Replace bare Verified with specific corroboration. Translate customs category/proxy/program jargon; retain technical detail on demand.
- Distinguish approve, reject, archive, refresh and convert. Display why conversion is unavailable. Keep send/reveal disabled controls secondary.
- Show unsupported-country coverage as a first-class explanation with a manual research path, not an empty failed screen.
- Check keyboard navigation, focus, contrast, narrow layouts and long company/native-script text.

**Tests:** user can identify what is known/unknown/source/age/next step without expanding every detail; one failed source is visible even when only one source succeeded; same company two products cannot mix; old CID result visibly historical; approved/no-email candidate cannot convert; long names/320px/768px/desktop layouts; accessibility interactions.

**Production QA:** five representative tasks with the actual MDF operator: broad market search, targeted namesake, blocked website, mixed trade result and conversion with a public email. Record confusion/clicks rather than subjective premium-style ratings. Inspect live screenshots after implementation; audit screenshots were historical fixtures only.

**Exit gate:** operator can complete all five tasks without SQL/DevTools and can correctly explain the evidence's limitations. No fake progress or verification badges remain.

## 8. Wave 5 — health, retention and acceptance

**Issues:** OPS-03, OPS-04, residual SEC-02; measured follow-up OPP-02/OPP-03.

**Outcome:** normal failures are diagnosable inside the app; free-tier usage and data freshness are bounded; quality is measured before declaring production readiness.

**Prerequisites:** stable events/outcome contracts and selected hosting environment. Minimal instrumentation begins in Wave 1; this wave completes the operator surface and validation.

**Work:**

- One owner-only Research health view: recent runs, providers, queue age, retries, last scheduler tick, stale leases, dataset periods, parser/schema changes, quota/reset, bytes and safe failures.
- Correlation IDs across run/job/plan/attempt/source version; redacted diagnostic export; actionable alerts only.
- Measure table/index/artifact sizes and egress. Apply reviewed retention to raw artifacts, events, stale contacts and rejected candidates while preserving provenance needed by active claims and suppression records.
- Confirm endpoint allowlist and billing controls. A constant `automaticSpendRupees:0` is insufficient: verify that only free calls can leave the application.
- Complete role-based and two-workspace tests; test client bundle/response/logs for secret exposure without printing secrets.
- Run the labelled quality cohort and 24-hour unattended recovery exercise. Report precision/contact coverage by market and source; do not conceal unsupported regions.
- Only then run Korea/Saudi/Thailand feasibility investigations and multilingual calibration as separate small projects. No automatic connector until its terms and data semantics pass.

**Tests:** expired dataset, empty source, parser change, quota exhausted, scheduler absent, repeated transient/terminal failure, protected health routes, redacted errors, source/contact suppression, retention preserving active evidence references, budgets at three runs/day, accidental paid-endpoint request rejected.

**Production QA:** seven-day pilot at intended usage; review spend/quota daily, queue age and source freshness; sample all positive origin claims and a representative contact/relevance cohort. Back up or export needed internal data according to the chosen environment's policy. Free-tier availability is not a guarantee of backups or SLA. [Supabase plan limits](https://supabase.com/pricing).

**Exit gate:** the definition of done below is met or an explicit limitation remains visible. Do not mark the whole project complete because all unit tests pass.

## 9. Codex execution order

These are bounded task names, purposes and dependencies, not giant implementation prompts. Each task should include its corresponding regression fixtures, concise documentation and review of only its affected contracts. Schema and UI tasks may need separate PRs; do not combine unrelated changes to save a branch.

| Order / task | Purpose and deliverable | Dependencies |
|---|---|---|
| T01 — Reject mismatched CID origin | Fix TI-01; adversarial identity/origin fixtures; identify result-version remediation needs | None |
| T02 — Preserve trade lease revisions | Fix TI-03 using strict revision behavior; prove stale workers remain fenced | None |
| T03 — Enforce selected-workspace reads | Fix SEC-01 in candidate lookup/list/reuse; two-workspace tests | None |
| T04 — Align conversion eligibility | Fix BF-14 without changing allowed source kinds or SQL protection | None |
| T05 — Contain intent and extractor false claims | Stop query/default points and known negation/third-party/cultivar promotions; version calculations | T01; audit evidence contract draft |
| T06 — Specify research context and result contract | Small design/change: context fingerprint, typed provider outcomes, dimensional aggregate and legacy policy | T01–T05 |
| T07 — Bind trade requests/results to context | Explicit selected product/form/market and latest-result filtering | T06 |
| T08 — Preserve every provider outcome | Persist failure/no-match/unsupported statuses; fix partial-completion projection | T06/T07 |
| T09 — Make aggregation conservative | Preserve conflict/absence distinction and source families; remove legal-identity overclaim | T08 |
| T10 — Resume completed provider work | Durable provider checkpoints, cancellation retention, idempotency and restart tests | T02/T08 |
| T11 — Unify provider execution policy | Generic registry; one deadline/retry policy;2/3/5-source contract tests | T10 |
| T12 — Version and certify snapshots | Immutable material/interpretation identity, parser/filter compatibility and quarantine | T06/T11 |
| T13 — Decide eligible hosting and runner | Document actual plan, commercial eligibility, runtime and ₹0 incremental option; concrete deployment design, no automatic purchase | None; before unattended rollout |
| T14 — Deliver unattended scheduling | Adequate worker cadence, browser-independent progress, scoped triggers, last-tick health | T02/T10/T11/T13 |
| T15 — Persist discovery hits and novelty | Store raw hit references/dispositions/cursor; cap after dedupe; repair pending enrichment | T03/T06/T14 |
| T16 — Unify entity resolution | Shared normalizers, source country/domain/identity rules, aliases and reviewable conflicts | T03/T06/T15 |
| T17 — Share safe website research | Robots-first, PSL-aware boundaries, shared page cache, bounded resume; preserve SSRF controls | T14/T16 |
| T18 — Model observed role and product fit | Target intent separate, category/form specificity, conservative business extraction | T05/T06/T17 |
| T19 — Correct contact ranking and freshness | Procurement roles, executive fallback, masked/access split, per-email last-observed state | T16/T17/T18 |
| T20 — Harden free people endpoint use | Domain-bound free query, entitlement/rate controls, bounded results, no paid fallback | T19/provider manifest |
| T21 — Integrate targeted company research | Shared pipeline, provisional names, conflict-safe reuse and research lifecycle | T15–T20 |
| T22 — Paginate and rank the full queue | Server filtering/keyset pages, relation pagination, explainable versioned ranking | T18/T19/T21 |
| T23 — Preserve official source row grain | CID locations and VQIP address/domain/contact; no new conversion source | T12/T16 |
| T24 — Separate and bound bulk refresh | Single-flight dataset jobs, smaller candidate matching reads, byte/memory instrumentation | T12/T14/T23 |
| T25 — Certify Canada 2024 XLSB | Offline/scheduled parser, official row checks, manifest and versioned publication | T23/T24/licence check |
| T26 — Add HMRC discovery/activity | Approved open API, trader/commodity/month, pagination and no country inference | T11/T12/T16/T24/licence manifest |
| T27 — Build dual-mode research UX | Permanent broad/known-company modes and true run progress | T21/T22 |
| T28 — Present scoped trade evidence | Source/period/coverage/conflicts/links visible; plain language and next actions | T07–T12/T27 |
| T29 — Close member/provenance permissions | Consistent owner/member write authority, drain bounds, safe client/server diagnostics | T03/T14/T19/policy decision |
| T30 — Build research health and retention | Operator health, source drift, quotas/bytes, redacted export and measured retention | T12/T14/T24/T29 |
| T31 — Run quality and unattended acceptance | Fixed human-labelled cohort, seven-day budget pilot,24-hour absence, invariants and published limits | T25–T30 |
| T32 — Certify regional opportunities | Separate Korea/Saudi/Thailand rights/schema/sample investigations; deliver go/no-go per source | T31 |
| T33 — Calibrate multilingual relevance | Labelled role/product language dictionaries and controlled query experiments | T18/T19/T31 |

Execution is ordered by dependencies, not by a mandate to wait on cosmetic work. T13 can be investigated early, but implementation of a new deployment is a distinct authorized action. T32/T33 are optional expansion after the core is accepted; they are not needed to correct today's evidence errors.

## 10. Minimal contract decisions before schema work

Write short architecture decisions for these questions. Avoid migrations until each has a chosen answer and a compatibility/backfill plan.

| Decision | Recommended answer | Why it matters |
|---|---|---|
| What is a company? | Legal/operating entity with jurisdiction and source identifiers; domain can relate to many entities | Prevents country-subsidiary merges |
| What is a product match? | Separate requested interest from observed category/product/form | Prevents intent becoming proof |
| What is one research result? | Entity + market + product/form + goal + interpretation/provider-plan version | Prevents reuse across unrelated contexts |
| What is a provider outcome? | Durable execution state plus scoped evidence; failures retained | Enables partial success and resume |
| What is one source version? | Source material hash + period + parser/schema + filter/mapping version | Supports replay and parser upgrades |
| What may members write? | Ordinary edits explicitly distinguished from authoritative provenance/review transitions | Aligns action guards and RLS |
| How long is data retained? | Source-specific minimal data and contact policy; active provenance references survive cleanup | Keeps costs/privacy bounded |
| Where does background work run? | Eligible host with measured scheduler capacity; local availability stated if selected | Prevents browser/cron liveness fiction |

Reuse existing BI claim/source structures where compatible. Never backfill a provenance gap by assigning a guessed source, country, cultivar, date or email status. Legacy uncertainty should be visible.

## 11. Concrete acceptance scenarios

| Scenario | Required result |
|---|---|
| Ontario candidate, same-name BC CID India row | Identity conflict/rejected match; no positive company product/origin conclusion |
| Exact apple category, no origin field | Apple-category evidence; India unknown |
| Broad080450 row | Composite fruit-category evidence; mango and cultivar unproven |
| Search target Guntur, website says spices | Possible category fit only; no import/India/Guntur proof |
| Website says “we are not importers” | No positive importer assertion |
| Website supplies importers with packaging | No company importer/product-import assertion |
| Same parent domain used by two country entities | Reviewable relationship; no automatic legal-entity merge |
| FSVP positive, VQIP absent | FSVP corroboration; VQIP no evidence in that period, not contradiction |
| FSVP positive CA, VQIP rejectedNY | Possible identity conflict visible; do not silently choose positive |
| FSVP no-match, VQIP timeout | Partial coverage with timeout; no global “does not import” conclusion |
| Deadline/cancellation after one provider | Completed evidence retained; remaining work pending/cancelled explicitly |
| Fetch takes longer than heartbeat interval | Lease revision propagated; legitimate worker completes or checkpoints |
| New parser on unchanged bytes/304 | Old parse not reused as compatible without explicit version match |
| Dataset unexpectedly empty | Quarantined source; last-good evidence retains original period |
| Three searches repeat same provider100 | New/changed candidates scheduled beyond first 20; counts/dispositions inspectable |
| Strong old candidate outside newest 100 | Discoverable in priority pagination |
| Procurement person masked; company public email available | Named role context plus real route shown separately; no fabricated personal email |
| Old email absent from successful current crawl | Last observed unchanged; absence/staleness recorded; failed crawl differs |
| Approved candidate lacks controlled email | Remains candidate; conversion blocked clearly |
| User closes browser for24hours | Queue progresses/retries under chosen availability contract |
| Unsupported country/provider quota exhausted | Explicit coverage limit; no paid fallback |
| Member belongs to two workspaces | Selected workspace bounds reads/reuse and UI; no mixed candidate list |

## 12. Definition of DONE

The core project is done only when all of the following hold:

1. P0 and P1 correctness/usefulness issues are resolved or a genuinely unavailable source/host capability is explicitly excluded from the supported product; exclusion cannot hide a defect in an enabled path.
2. Each displayed intelligence claim has an inspectable source, subject, period, retrieval time and scope. Intent, company claim, official corroboration and transaction/shipment evidence are distinguishable.
3. All adversarial fixtures above pass, including identity/origin scope, negation, cultivar specificity, partial failure and workspace isolation.
4. Broad and targeted research share validation, enrichment, provenance and review lifecycle. Duplicate/previously rejected/already-Buyer behavior is explicit and reversible where appropriate.
5. Ranking is deterministic, versioned and explainable; intent and duplicated source notes earn no evidence points. Human evaluation reports sample sizes and supported-market precision.
6. Suggested pilot target: ≥80% human-relevant businesses in the top 20 within supported-market cohorts. This is a proposed quality bar, not an observed baseline. Contact yield and role precision are measured honestly by market; no universal email promise.
7. Every provider plan has an execution outcome. Unsupported, failed, blocked and not-started work cannot vanish. Partial results survive retry, restart, deadline and cancellation.
8. The chosen host is permitted for the actual commercial use and has adequate unattended capacity. Queue completion and recovery succeed during a 24-hour no-browser exercise within that host's stated availability.
9. Dataset drift is detected before publication; cache age is separate from evidence age; parser/period/filter versions reproduce the result. Canada 2020 never appears current merely after a refresh.
10. Three-run/day pilot stays within explicit request/byte/storage budgets. Charged endpoints and auto-purchases are impossible through the automatic path. Automatic monetary provider spend is ₹0.
11. Send/reveal gates remain false; Candidate/approval/conversion contracts remain intact; no credentials in client responses or diagnostic exports.
12. Operator can troubleshoot normal failures and complete the five UX tasks without SQL/DevTools. Accessibility and responsive layouts have been inspected in the actual application.
13. Final documentation states the remaining coverage limits: no comprehensive free shipment feed, no universal procurement email, no guarantee of active buying demand, and no paid-tier SLA assumed.

## 13. What to remove or avoid during implementation

Deprecate separate targeted ingestion, provider-specific copies of the worker lifecycle, first 20-before-dedupe, browser-only liveness, ambiguous Verified badges, single preferred source as the entire provenance model, and period-independent freshness labels. Retain the useful guarded SQL conversion, server-only secrets, public-IP crawler transport, source snapshots, attempts/events and explicit non-shipment semantics.

Do not add an opaque AI ranking service, paid verifier, headless scraping fleet, general commercial shipment connector, trial-account rotation or a second evidence warehouse. Do not widen conversion email sources to improve a metric. Do not postpone reliability until after provider expansion.

## 14. Final recommendation

**PARTIALLY, with a clear path to a professional internal research product.** The source budget is feasible at this usage level; excellent global shipment coverage is not. Current evidence bugs, fragmented ingestion and background scheduling need repair before more fan-out. Canada 2024 and HMRC provide the strongest justified next gains. Regional/manual research remains valuable when the UI accurately states what is and is not known.

The next implementation should start with **T01**, followed by the dependency order above. This audit ends with these documents; it does not implement or authorize a deployment, migration, provider gate change or paid service.
