# Market Intelligence MI0 — Country × Product Opportunity Engine

Status: architecture only. No migration, no live provider call, no
seeded data. MI0 introduces one new module tree under
`src/lib/marketIntelligence/` with pure calculation helpers and
domain types, plus this design document. MI1 will build on it to
wire the first free trade-data source.

## 1 · Scope and domain boundary

**Market Intelligence** answers *"Is this country a good market for
this MDF product?"* It is fundamentally different from **Buyer
Intelligence**, which answers *"Is this company a real buyer?"*. The
two domains must not share tables or reasoning paths.

| Aspect | Buyer Intelligence (BI0–BI3) | Market Intelligence (MI0+) |
| --- | --- | --- |
| Owner | `buyer_candidates.id` | `(country_alpha2, mdf_product_id)` |
| Question | Is this company real, active, importer? | Is this market attractive for MDF product X? |
| Provenance | BI2 `buyer_intelligence_sources` | MI-owned `market_intelligence_sources` |
| Verified facts | `buyer_trade_observations` (per Candidate) | `market_trade_observations` (per country/HS/period) |
| Score | Buyer legitimacy / potential / readiness | Market Fit + Data Confidence |
| Scope in DB | Workspace-scoped | Shared across workspaces (see §7) |

**Hard rules carried forward from earlier phases:**

- Company-website evidence and Hunter data must NEVER contribute to
  a country Market Fit score.
- Country-level statistics must NEVER be attributed to a specific
  company. "Malaysia imported $X from India" is not "Company ABC
  imported from India".
- `BUYER_SEND_ENABLED = false` and
  `BUYER_FINDER_HUNTER_REVEAL_ENABLED = false` remain in force.
  Market analysis has zero Buyer / campaign / Gmail side effects.
- No fabricated periods, no interpolated years, no invented
  quantities. Missing stays missing.

## 2 · Repository audit findings

- Nav: `src/app/(app)/layout.tsx` sits over `activity | buyer-finder |
  buyers | campaigns | settings | templates`. Adding a new
  `market-intelligence` route fits the existing pattern.
- Country identity: `src/lib/catalogue/countries.ts` is already ISO
  3166 alpha-2 with informal display overrides and aliases (UAE, USA,
  UK, KSA, …). MI0 reuses it verbatim through `country.ts` — no
  independent list.
- Product identity: `src/lib/catalogue/products.ts` is authoritative;
  MI0 references it through `product.ts` for the HS mapping.
- Buyer Finder search already has country + product selectors
  (`SearchableCombobox` + `activeProducts()`). The Market Explorer
  form reuses the same UX primitives.
- Chart library: none installed today. MI0 does not add one.
  MI1's chart contracts (§17) are transport-neutral; the visual
  library decision (recharts vs. inline SVG) belongs to MI2.
- Provider descriptors: BI already has
  `PROVIDER_DESCRIPTORS` in `src/lib/buyerFinder/providers/descriptors.ts`
  for Hunter and public_website. MI defines its own descriptors
  because capabilities and cost semantics differ.
- Supabase migration conventions: numbered `NNNN_purpose.sql`,
  additive-only, "Does NOT apply itself" preamble, RLS macro
  `mdf.__apply_workspace_rls`, narrow SECURITY DEFINER RPCs granted
  to `authenticated`, tables SELECT-only. MI's future migration will
  follow the same shape.

## 3 · Domain architecture

```
Market Explorer  ──►  Analyze Market  ──►  Market Detail
   country            (deterministic         Overview │ Import Trend │
   product             pipeline, no LLM)      India Position │ Suppliers │
                                              Growth │ Unit Value │
                                              Tariffs │ Data Sources │
                                              Methodology
                                                 │
                                                 ▼
                                          Find Buyers in <Country>
                                          → /buyer-finder pre-filled
                                            (no auto-discovery call)

MI subsystem (server-side, SECURITY DEFINER RPCs, MI1+):
  ingest_market_source     ingest_market_observation
  ingest_market_tariff     refresh_market_metrics
  refresh_market_score

MI subsystem (server-side, deterministic, MI0):
  country.ts / product.ts / series.ts / unitValue.ts / marketFit.ts
```

## 4 · Country identity

Internal: uppercase ISO 3166-1 alpha-2. Display: from the existing
catalogue. Aliases resolve to canonical alpha-2 (`toCountryAlpha2`).
Two-letter strings that are not assigned ISO codes return
`undefined` — MI never invents a country. See
[src/lib/marketIntelligence/country.ts](../src/lib/marketIntelligence/country.ts).

## 5 · Product ↔ HS mapping

MDF users pick a product; MI derives HS codes. Mapping lives in
[src/lib/marketIntelligence/product.ts](../src/lib/marketIntelligence/product.ts):

- One MDF product may map to more than one HS code (whole vs
  crushed chilli, basket lines for mango/pomegranate).
- Every mapping declares `hsRevision` explicitly — MI never
  compares codes across revisions blindly.
- `weight` is a documented coverage hint, never automatic
  aggregation. MI1's ingestion pipeline may combine codes only when
  their revisions match and their weight sums are explicit.

Initial MI0 mapping:

| MDF product | HS17 code | Coverage | Weight |
| --- | --- | --- | --- |
| Guntur Dry Red Chilli | 090421 (dried, whole) | exclusive | 1 |
| Guntur Dry Red Chilli | 090422 (crushed / ground) | shared | 0.5 |
| Banganapalli Mango | 080450 (guavas, mangoes, mangosteens) | shared | 0.6 |
| Indian Pomegranate | 081090 (other fresh fruit) | basket | 0.3 |
| Indian Apples | 080810 (fresh apples) | exclusive | 1 |

Validation: `validateProductTradeMappings()` runs on every test to
prevent mapping drift (unknown product ids, wrong digit count for a
declared level, empty labels, weight outside `(0, 1]`).

## 6 · Proposed database schema (MI1 migration 0022)

*Not yet applied. MI0 does not create it.* The names below are
proposals; MI1 will finalize.

```
public.market_intelligence_sources
public.market_trade_observations
public.market_tariff_observations         (optional; MI2 candidate)
public.market_trade_metrics
public.market_product_scores
public.market_product_score_components
public.product_trade_mappings             (mirror of the TS registry)
```

Common column patterns (mirror BI's discipline):

- `retrieved_at timestamptz not null`, `source_period text`,
  `metadata jsonb not null default '{}'`.
- Every observation carries the six-field trade identity
  `(reporter_country, partner_country, trade_flow, hs_revision,
  hs_code, period)` and its `provider_id` + `dataset_id`.
- Composite unique keys enforce identity so replay is a no-op:
  `(provider_id, dataset_id, reporter_country, partner_country,
  trade_flow, hs_revision, hs_code, period)`.
- Metric rows: `(reporter_country, mdf_product_id, hs_revision,
  metric_key, calculation_window)` unique.
- Score rows: `(reporter_country, mdf_product_id,
  calculation_version)` with a partial unique index on the current
  (non-superseded) row per country/product.

## 7 · Global-vs-workspace data — recommendation

**Recommendation:** Market observations, tariffs, product-trade
mappings, and metrics are **global** (workspace_id NULL, RLS grants
SELECT to `authenticated`). Only two things are workspace-scoped:

1. `market_analysis_events` (an activity trail: "kiran@ analyzed
   MY × Guntur Chilli at 2026-09-06T10:12Z").
2. `market_watchlist` (optional MI2 concept — operator's saved
   countries/products with alert thresholds).

**Why global for the trade data**:

- Official trade statistics for "Malaysia imports of HS 090421 in
  2024" are *identical* across every MDF workspace. Duplicating rows
  per workspace burns storage, doubles free-API quota consumption,
  and creates version-skew where operator A sees revised numbers
  operator B never got.
- MI never exposes company-private information at the country level;
  RLS is not defending anything Buyer-side by keeping this per-
  workspace.
- Global caching is the whole point of the free-quota discipline
  (§14): one workspace's `refresh_market_metrics(MY, chilli)` call
  hydrates the same cache every other workspace reads.

**Security implications**:

- Tables are still RLS-enabled; the policy is `for select to
  authenticated using (true)` on the observation and metric tables,
  and `insert/update/delete` is entirely blocked at the grant level
  (`revoke all … from anon, authenticated, public`). All writes go
  through SECURITY DEFINER RPCs.
- `market_analysis_events` uses the standard `mdf.__apply_workspace_rls`
  macro so the operator's activity trail stays private.
- No paid provider metadata (API keys, quota counts) is ever
  persisted; those live only in server env.

## 8 · Provider contract

```ts
interface MarketProviderDescriptor {
  providerId: string;
  displayName: string;
  costClass: "free" | "free_tier" | "paid";
  requiresKey: boolean;
  requiresCard: boolean;
  freeLimit?: string;
  coverage: string;
  latestPeriod?: string;
  frequency: ("annual" | "quarterly" | "monthly")[];
  capabilities: (
    | "import_series"
    | "partner_series"
    | "origin_breakdown"
    | "tariff_data"
    | "seasonality"
  )[];
  sourceTier: "A" | "B" | "C" | "D" | "E";
}
```

MI selects the cheapest configured provider whose declared
`capabilities` include the requested goal. A provider that did not
declare a capability is never called for it. `costClass = "paid"`
providers are never *required* dependencies and are never invoked as
an automatic fallback. See [types.ts](../src/lib/marketIntelligence/types.ts).

**MI1 provider shortlist (documentation only, none integrated):**

| Provider | Cost class | Requires key | Card | Notes |
| --- | --- | --- | --- | --- |
| UN Comtrade (public) | free_tier | free key | no | Rate-limited; annual data. Tier A. |
| BACI / OEC | free | no | no | Harmonized normalizations. Tier B. |
| World Bank WITS / UNCTAD TRAINS | free | no | no | Bilateral + tariff. Tier A/B. |
| US Census Trade API | free | free key | no | US-detail only. Tier A. |

Every listed provider ships a `MarketProviderDescriptor` at MI1
integration time; nothing else earns automatic usage.

## 9 · Zero-cost enforcement

- `PAID_MARKET_DATA_ENABLED` env flag defaults to `false`.
- A provider whose descriptor declares `costClass = "paid"` or
  `requiresCard = true` cannot become a *required* MDF dependency,
  even when the flag is on. It may be *offered* as an operator-
  triggered upgrade only after MI2 introduces an explicit opt-in.
- MI never chains providers automatically. If the free path fails
  (quota, timeout, no coverage), MI reports the failure and stops.
  The operator decides whether to try again later or upgrade
  manually.
- Provider adapters must fail closed: a missing key is a hard
  configuration error, not a silent downgrade.

## 10 · Provenance model

Every observation persists `provider_id`, `dataset_id`,
`reporter_country`, `partner_country`, `trade_flow`, `hs_revision`,
`hs_code`, `frequency`, `period`, `retrieved_at`, and optional
`source_period` / `source_url` / `safe_reference` / `metadata`.
`metadata` never carries API keys, cookies, or paid-provider raw
payloads (mirrors BI2's discipline; SQL-side check enforced when the
MI1 RPC lands).

## 11 · Raw observation model

`MarketTradeObservation` in [types.ts](../src/lib/marketIntelligence/types.ts):

- `tradeValueUsd` and `quantity` are optional; missing stays `null`.
- `quantityUnit` is a small controlled vocabulary
  (`kg | tonne | unit | litre | cubic_metre | other`). MI never
  converts between incompatible units silently.
- `netWeightKg` is preserved separately when the provider reports
  weight independently from quantity.
- Zero is a legitimate reported value and must never be masked.

## 12 · Metric model

`MarketMetric` rows are rebuildable projections, never primary
evidence. Each carries a `calculationWindow`, `supportCount`
(observations actually participating in the formula),
`observationWatermark` (retrieved_at max of contributing rows), and
`calculationVersion`.

Initial `mi-metrics-v1` metric keys:

| Metric key | Type | Formula sketch |
| --- | --- | --- |
| `total_market_import_value` | number (USD) | Σ `tradeValueUsd` for `partner=null` |
| `total_market_import_quantity` | number | Σ `quantity` where units align |
| `india_import_value` | number (USD) | Σ where `partner=IN` |
| `india_import_quantity` | number | Σ where `partner=IN` and units align |
| `india_share` | ratio | `india_import_value / total_market_import_value` |
| `india_rank` | integer | Rank of IN among origin countries by value |
| `origin_country_distribution` | json | Per-country value + share |
| `top_origin_countries` | json | Top-N ordered list |
| `supplier_concentration` | ratio | Sum of squared shares of top-N origins (HHI/1e4) |
| `derived_unit_value_usd_per_kg` | number | See §16 |
| `yoy_growth` | ratio | §14 |
| `cagr_3y` / `cagr_5y` | ratio | §14 |
| `stability_index` | 0..1 | §14 |
| `latest_period` | text | ISO period label |

## 13 · India-position calculations

- `india_share = india_import_value / total_market_import_value`
  when both are known and positive. Otherwise `null`.
- `india_rank`: sorted descending by value across the origin
  distribution for the period. Ties break on country code.
- `india_share_trend` is derived from
  `trendDirection(series of india_share by period)`.
- `india_cagr_3y` / `india_cagr_5y` are computed from the India
  bilateral series independently of the total-market series.

Every India metric is **market-level**. UI copy must read "Malaysia
imports from India" — never "Company X imports from India".

## 14 · Growth calculations

See [series.ts](../src/lib/marketIntelligence/series.ts). Pure
helpers with no fallbacks:

- `yearOverYear(series)` — last two known points; refuses zero base
  and non-finite input.
- `cagr(series, years)` — needs strictly positive base and
  fractional-year exponent from ordered points; returns `null`
  otherwise.
- `stabilityIndex(series)` — coefficient-of-variation-based 0..1
  score; requires ≥ 3 known points.
- `trendDirection(series)` — rising / falling / flat / unknown from
  the last three known points, with a ±5% flat band.

## 15 · Competitor analysis

Origin breakdown is stored as the raw partner rows; the metric layer
produces:

- `top_origin_countries` (top N by value; N defaults to 5, exposed
  for UI expansion).
- `supplier_concentration` (HHI-style — sum of squared shares of
  the top-N origins).
- `origin_share_change_1y` (each top origin's share now minus its
  share one year earlier) — only when both periods exist.

MI must not synthesise an "Other" bucket unless the provider
returned residual data or the sum of listed origins < 100 %.

## 16 · Unit value method

[unitValue.ts](../src/lib/marketIntelligence/unitValue.ts) computes
`derivedUnitValue` and refuses to output when quantity, value, or
unit is missing, unsupported, or non-positive. Labels are fixed to
`"Derived import unit value"` in `USD/kg | USD/tonne | USD/unit |
USD/litre | USD/cubic_metre`. Never "market price".

## 17 · Market Fit methodology

[marketFit.ts](../src/lib/marketIntelligence/marketFit.ts) defines
deterministic 0..100 primitives:

- `normalizeDemandSize(usd)` — log10 interpolation between 1 M and 5 B USD.
- `normalizeGrowth(pct)` — piecewise linear −20/0/+10/+20/+30% anchors.
- `normalizeIndiaPosition({indiaShare, shareTrend})`.
- `normalizeCompetitiveOpportunity(originConcentration)` — inverts
  origin concentration.
- `normalizePriceAttractiveness({unitValueTrend, hasUnitValue})`.
- `normalizeStability(index)`.

`composeMarketFit(components, calculatedAt)` produces a
`MarketFitScore` with:

- **Renormalization by supported weight**: missing components are
  neither zeroed nor silently inflate the score. The score is the
  weighted mean of what actually has evidence.
- **Minimum-evidence gate**: if supported weight < 55, the score is
  `null` and classification is `insufficient_evidence`. Publishing a
  25/25 score from a single component would mislead operators.
- **Deterministic reasons**: components scoring ≥ 70 land in
  `positiveReasons`; ≤ 40 in `negativeReasons`. UI renders them
  verbatim — no LLM generation.
- **Versioned**: `calculationVersion = "mi-fit-v1"` stamps every
  score. A future weight change ships a new version; historical
  scores stay traceable.

## 18 · Market Fit weights (proposed, not final)

| Component | Weight |
| --- | --- |
| Demand size | 25 |
| Demand growth | 20 |
| India position | 20 |
| Competitive opportunity | 15 |
| Price attractiveness | 10 |
| Demand stability | 10 |
| **Total** | **100** |

**Critical review** (to revisit at MI1 with real data):

- 25 for demand size is defensible — a tiny market at 100/100 growth
  still isn't a viable Buyer-Finder target. But this weight could
  be split into "size" + "size-per-capita" once we can support both.
- 20 for demand growth is high enough to reward emerging markets but
  low enough that a mature stable market can still classify strong.
- 20 for India position reflects MDF's supply reality; if MDF ever
  works with non-India suppliers, this component becomes
  "supply-side position" and the weight moves lower.
- 15 for competitive opportunity is a proxy — MI1 should validate
  against a handful of markets we already understand.
- Price attractiveness (10) starts small deliberately: without unit
  value, this component is null and the score renormalizes.
- Demand stability (10) prevents recommending a market whose imports
  ping between years.

Thresholds:

| Classification | Score range |
| --- | --- |
| Excellent opportunity | 85 – 100 |
| Strong opportunity | 70 – 84 |
| Moderate opportunity | 55 – 69 |
| Weak opportunity | 40 – 54 |
| Low opportunity | 0 – 39 |
| Insufficient evidence | null (supported weight < 55) |

## 19 · Missing-data behaviour

Codified across the helpers:

- Null observations remain null; helpers never coerce to zero.
- Growth helpers return `{ percent: null, reason }` when they can
  not compute, and the reason is one of
  `insufficient_periods | zero_base | invalid_value | ok`.
- Unit value returns `{ ok: false, reason }` when unit / value /
  quantity is missing or unsupported.
- Market Fit returns `insufficient_evidence` when supported weight
  falls below 55.
- Data Confidence renders every component even when overall
  confidence is low — the operator sees exactly which axis is thin.

## 20 · Data Confidence methodology

Seven components, each normalized to 0..100, weighted:

| Component | Weight |
| --- | --- |
| Source authority (from tier A..E) | 25 |
| Coverage completeness | 15 |
| Data recency | 15 |
| Period continuity | 15 |
| Quantity availability | 10 |
| Partner completeness | 10 |
| HS mapping certainty | 10 |

`calculationVersion = "mi-conf-v1"`. A Market Fit of 85 with a
Confidence of 52 is a legitimate, honest surface — the UI must
render both without hiding the discrepancy.

## 21 · Score versioning

Scores and metrics carry `calculationVersion`; component links carry
`(score_id, component_key)`. When methodology changes:

- Bump the version constant (`mi-fit-v2`, `mi-conf-v2`).
- The MI1+ score-refresh RPC marks the prior current row
  `superseded_at = now()` and inserts a new row. Nothing is
  silently rewritten.
- UI keeps the "as of methodology vN" annotation next to the score.

## 22 · Cache design

Caching lives at the *observation* layer, not the API-call layer:

- Free public annual trade series → **long cache** (e.g. 30 days
  for closed years, 24 hours for the current year).
- Monthly / quarterly series → shorter TTL (e.g. 12 hours for the
  current period).
- Tariff data → medium TTL (e.g. 7 days).
- Score / metric refresh is derived from the observation table
  under an advisory lock; no external call is required.

The observation table's composite unique key (§6) means a refresh
that finds the same underlying rows returns `existing` outcomes and
never re-queries the provider. Cache is the schema, not a
`Cache-Control` header.

## 23 · API budget strategy

Before every `analyze_market(country, product)` invocation, MI
estimates the free-API call count:

- 1 call: world imports of the product's HS code (annual).
- 1 call: bilateral imports from India.
- 1 call: origin breakdown for the latest period.
- Optionally 1 call: tariff.

Target ≤ 4 free-quota calls per analysis and less if any of the four
already sits in the observation cache. The MI1 orchestrator surfaces
the estimated + actual call count to the operator.

Circuit breakers:

- Per-provider daily quota tracker (in-process, opt-in persistence
  in MI2). Cross the threshold → soft-fail with `quota_exhausted`.
- Timeouts per adapter (target 8 s per call, mirror BF3A.5's fetch
  envelope).
- No parallel provider fan-out. One provider per capability, one
  call at a time, cache-first.

## 24 · UX information architecture

Proposed nav:

```
Overview │ Buyers │ Buyer Finder │ Market Intelligence │ Campaigns │ Templates │ Activity │ Settings
```

**Market Explorer** (`/market-intelligence`):

- Country combobox (reuses the Buyers-page `SearchableCombobox`).
- Product combobox (uses `activeProducts()`).
- Primary CTA: **Analyze Market**.
- Below: "Recent analyses" (from `market_analysis_events`), plus a
  "Compare Markets" entry point.

**Market Detail** (`/market-intelligence/[country]/[product]`):

Header:

```
Malaysia · Guntur Dry Red Chilli
Market Fit  82 / 100  Strong Opportunity
Confidence  91 / 100
Latest data 2024 · Source: BACI · Retrieved Sep 2026
```

Sections in order:

1. **Market Overview** — 4 fields (fit, confidence, latest, freq).
2. **Import Trend** — value + quantity line charts.
3. **India Position** — share over time + rank chip.
4. **Supplier Countries** — top-N horizontal bar + share table.
5. **Growth** — YoY, 3y CAGR, 5y CAGR, trend chip.
6. **Unit Value** — derived unit value line (only if computable).
7. **Tariffs** — if a tariff provider is configured; hidden otherwise.
8. **Data Sources** — every observation's provider + retrieved_at +
   "View source" link.
9. **Methodology** — score weights, missing-data policy, version.

Below the sections: **Find Buyers in Malaysia** CTA →
`/buyer-finder?country=MY&product=guntur-dry-red-chilli` (no
auto-discovery call; see §26).

## 25 · Chart data contracts (MI1+)

Charts consume typed contracts; a chart library is not chosen yet.

| Chart | Contract |
| --- | --- |
| A. Import value over time | `{ frequency, series: DatedPoint[], unit: "USD" }` |
| B. Import quantity over time | `{ frequency, series: DatedPoint[], unit: MarketQuantityUnit }` |
| C. India share over time | `{ frequency, series: DatedPoint[], unit: "ratio" }` |
| D. Top origin countries | `{ period, rows: { countryCode, share, value }[] }` |
| E. Country share composition | Same as D; renderer picks bar vs pie |
| F. Derived unit value | `{ frequency, series: DatedPoint[], unit: "USD/kg" \| … }` |
| G. Market Fit components | `MarketFitComponent[]` |
| H. Optional monthly seasonality | `{ frequency: "monthly", series: DatedPoint[] }` |

Every chart must render "No data" honestly when its contract is
empty. No zero-line fill for missing periods.

## 26 · Compare Markets architecture

`GET /market-intelligence/compare?product=<mdfProductId>&countries=MY,AE,SA,TH`

Server-side: `SELECT` the current score per (country, product) from
`market_product_scores`, join `market_trade_metrics` for headline
figures, order by `score DESC NULLS LAST, country`. UI table:

| Country | Fit | Confidence | Market size | Growth | India share | Competition | Latest |

Row hover reveals positive / negative reasons from the score.
Ranking is deterministic; ties break on country code.

## 27 · Buyer Finder integration

The Market Detail "Find Buyers in Malaysia" CTA navigates to
`/buyer-finder?country=<name>&product=<mdfProductId>`. Buyer Finder
pre-fills its Search form; the operator still has to click "Search"
to trigger any discovery call. Zero side effects, zero credit spend.

## 28 · Security / RLS strategy

- Global market tables: `revoke all … from anon, authenticated,
  public;` then `grant select … to authenticated;` — no direct DML.
  RLS: `for select to authenticated using (true);`.
- Workspace-scoped tables (`market_analysis_events`, future
  `market_watchlist`): `mdf.__apply_workspace_rls` macro.
- Every mutation flows through SECURITY DEFINER RPCs with fixed
  `search_path = public, mdf, pg_temp`, workspace resolved via
  `mdf.current_workspace_id()` for the activity trail, and never
  from a caller-supplied parameter.
- No provider secrets in the database. All API keys in server env
  only; rotated via `.env.local`.
- No paid provider requires a card for MDF's baseline flow.

## 29 · Proposed migration plan (MI1)

Migration 0022 (unapplied at MI0) will:

1. Create the six global market tables (§6) with composite unique
   keys, CHECK constraints on units / frequency / classification,
   and workspace-independent RLS.
2. Create the one workspace-scoped `market_analysis_events` table
   with the standard workspace RLS macro.
3. Create the narrow write RPCs (`ingest_market_source`,
   `ingest_market_observation`, `refresh_market_metrics`,
   `refresh_market_score`) — every one SECURITY DEFINER,
   `search_path = public, mdf, pg_temp`, `revoke all from public,
   anon`, `grant execute to authenticated`.
4. Notify PostgREST to reload.

MI0 explicitly does not create this migration.

## 30 · MI1 implementation plan (recommended)

1. **Apply migration 0022** after operator review (see §29).
2. **Wire one Tier B provider** — BACI or OEC — via a new
   `src/lib/marketIntelligence/providers/<id>` module implementing
   the `MarketProviderDescriptor` contract. Free, no key, no card.
3. **Implement the four ingestion RPCs** described in §29.
4. **Build `analyze_market(country, product)`** server orchestrator:
   check cache → fan out ≤ 4 provider calls → ingest → refresh
   metrics → refresh score → return sanitized summary.
5. **Wire the Market Explorer page** at `/market-intelligence` with
   the two comboboxes and the primary CTA. Persist analysis events.
6. **Wire the Market Detail page** rendering only from persisted
   observations, metrics, and scores. Zero client-side scoring.
7. **Add the "Find Buyers in <Country>" CTA** with URL prefill —
   no auto-search.
8. **Add MI2 candidates behind flags**: monthly frequency support,
   Compare Markets page, optional tariff provider.

MI1 must NOT:

- Introduce a chart library that binds MDF to a specific vendor
  without an operator decision.
- Call a paid provider.
- Persist market data per workspace.
- Fabricate any period MI does not have real evidence for.
- Route any market side-effect into `buyers` or
  `buyer_finder_candidate_conversions`.

## Appendix A — MI0 files added

- [src/lib/marketIntelligence/types.ts](../src/lib/marketIntelligence/types.ts)
- [src/lib/marketIntelligence/country.ts](../src/lib/marketIntelligence/country.ts)
- [src/lib/marketIntelligence/product.ts](../src/lib/marketIntelligence/product.ts)
- [src/lib/marketIntelligence/series.ts](../src/lib/marketIntelligence/series.ts)
- [src/lib/marketIntelligence/unitValue.ts](../src/lib/marketIntelligence/unitValue.ts)
- [src/lib/marketIntelligence/marketFit.ts](../src/lib/marketIntelligence/marketFit.ts)
- Tests co-located with each of the above.
- This document.

## Appendix B — non-goals for MI0

- No provider integration.
- No migration.
- No UI page.
- No live API call.
- No seeded market data.
- No LLM in scoring, ever.
