# Buyer Intelligence architecture and CRM blueprint

Status: BI0 blueprint aligned through BI2. Migration `0020_buyer_intelligence_foundation.sql` is applied and live-verified. BI2 authors the narrow, unapplied `0021_buyer_intelligence_write_pipeline.sql`. No trade provider, crawler, or CRM pipeline is integrated.

## BI1 integrity and extensibility corrections

Implementation review exposed two gaps in the original BI0 SQL sketch. Both corrections were approved during BI1 and are now part of the architecture:

1. `buyer_intelligence_assessment_evidence` includes `candidate_id`. Its assessment, claim, observation, and metric references are all composite `(id, candidate_id, workspace_id)` foreign keys. Consequently, an assessment for Candidate A cannot link to evidence owned by Candidate B, even when both Candidates are in the same workspace.
2. `buyer_trade_metrics` is normalized to one row per `metric_key` and calculation window instead of using one wide row with a column for every metric. It stores exactly one typed value (`numeric_value`, `text_value`, or `structured_value`), a controlled unit, the support count, calculation time/version, and optional window/watermark. Metric vocabulary remains controlled in the TypeScript domain and is also constrained in migration 0020.

These are integrity/extensibility corrections discovered during BI1 implementation, not a change to the permanent Candidate/Buyer lifecycle or evidence rules.

## Product vision

MDF Outreach should support a traceable path from company discovery to a durable commercial relationship:

```text
Buyer discovery
  -> company research
  -> company-specific trade intelligence
  -> legitimacy and opportunity evaluation
  -> contact discovery
  -> usable email found
  -> explicit Candidate-to-Buyer conversion
  -> reviewed, personalized outreach
  -> relationship and deal lifecycle
```

The goal is not to recreate a trade-data vendor. It is to give an operator one coherent, evidence-led view of a potential buyer while retaining links to the lawful source of every important fact.

The permanent boundary is:

- Buyer Finder / Buyer Intelligence may contain companies with no email. It owns research, contacts, trade evidence, prioritization, and provenance.
- Buyers / CRM contains contactable entities. A structurally usable email is mandatory for every Buyer.
- Candidate approval is a review decision. It is not conversion.
- Conversion is explicit, creates one Buyer through the controlled RPC, preserves the Candidate, and does not send email.
- `BUYER_SEND_ENABLED` remains false. Paid Hunter reveal remains dormant behind `BUYER_FINDER_HUNTER_REVEAL_ENABLED=false`.

## Repository and schema audit

This audit describes the repository schema and code contracts at BI0. It does not assert remote deployment state; BI0 makes no Supabase call.

| Existing area | Current responsibility | BI0 recommendation |
| --- | --- | --- |
| `buyer_candidates` | One discovered company, basic profile, discovery/review state, shallow evidence JSON, search timestamps, and an explainable finder score | Keep unchanged. It is the durable owner of company-specific intelligence for now; do not add a wide set of trade columns. |
| `buyer_candidate_contacts` | Zero or more people per Candidate, including masked directory attributes, optional revealed details, source, and shallow evidence JSON | Keep unchanged. New normalized provenance may reference equivalent facts without rewriting historical rows. |
| `buyer_candidate_public_emails` | Zero or more company-site email routes, each with mailbox class and source URL | Keep unchanged. It remains an eligible conversion source when the email is usable. |
| `buyer_candidate_product_matches` | Candidate-to-MDF product discovery match with relevance and evidence | Keep unchanged. A match is product-fit discovery evidence, not proof of a shipment or import. |
| `buyer_finder_candidate_conversions` | Immutable one-Candidate-to-one-Buyer linkage, written only by the conversion RPC | Keep unchanged. It is the bridge by which a converted Buyer can display Candidate-owned intelligence. |
| `buyer_finder_search_runs` | Operator search inputs, provider/run lifecycle, progress counters, cost class, and safe errors | Keep for company discovery only. Do not overload it with trade-observation ingestion. |
| `buyer_finder_free_enrichment_jobs` | Current-state jobs for free public-company-contact and masked-decision-maker capabilities | Keep unchanged. A later migration may add intelligence capabilities only after their independent retry/cost semantics are designed. |
| `buyers` | Contactable CRM entity, status/follow-up fields, suppression state, and mandatory email | Keep free of trade-intelligence columns. Resolve intelligence through the conversion linkage. |
| `campaigns`, `campaign_recipients`, `email_send_events` | Outreach configuration, audience membership, snapshots, and send audit | Keep Buyer-scoped. Candidate research must not create recipients or sends. |
| `activity_events` | Workspace-scoped generic activity with optional entity type/id | Reuse for auditable operator milestones, preserving whether an event belongs to a Candidate, Buyer, campaign, or future opportunity. |
| `src/lib/catalogue/products.ts` | Canonical MDF business-product catalogue; `businessCatalogue.ts` is the Buyer Finder bridge | Keep as product authority. Persist its business product id for normalized matches; never replace raw trade descriptions or HS codes with the catalogue label. |

Existing `evidence` JSON arrays contain URL/note/confidence and are useful historical discovery evidence, but they cannot enforce complete provenance, evidence class, source retrieval time, or referential integrity. They should remain readable. New intelligence ingestion should write the normalized model below rather than expanding those arrays.

The current database column `buyer_candidate_product_matches.product_key` is exposed in domain code as a business `productId`. The application catalogue is authoritative, while the conversion RPC has a matching SQL whitelist. BI1 must test that those identifiers stay synchronized; the SQL whitelist must not become an independent catalogue.

## Domain ownership and Candidate-to-Buyer survival

### Recommendation: Candidate owns intelligence

Use `candidate_id` as the durable owner of company-specific intelligence through the first intelligence phases.

This is the smallest design that fits the current system:

- a Candidate already represents one company and is workspace-scoped;
- contacts, public routes, and product matches already hang from it;
- conversion preserves the Candidate instead of transforming or deleting it;
- the conversion foreign key uses `ON DELETE RESTRICT`, so a converted Candidate cannot be casually removed;
- Buyer detail can resolve the conversion in reverse and load the same research without copying it into `buyers`;
- multiple contacts, sources, facts, and observations naturally remain child records.

Archive is the normal research-retention operation. Proposed intelligence children use restrictive deletion so a Candidate with recorded intelligence must be explicitly purged through a future audited operation, rather than losing research by accident.

### When a separate company entity becomes justified

Do not introduce one in BI1. Add a durable `company_profiles` identity only if MDF needs to merge multiple Candidates into one legal company, share a company across discovery programmes, retain aliases/legal entities, or attach Buyers from several workspaces/teams to a common mastered record.

The migration path would be additive: create `company_profiles`, add a Candidate-to-company mapping, backfill one company per Candidate, dual-read, move intelligence ownership after verification, then make Candidate a discovery occurrence. No trade fact should be copied into Buyers during that migration.

## Entity model

```text
buyer_candidates (durable company research owner)
  |-- buyer_candidate_contacts
  |-- buyer_candidate_public_emails
  |-- buyer_candidate_product_matches
  |-- buyer_intelligence_sources
  |     |-- buyer_intelligence_claims
  |     `-- buyer_trade_observations
  |-- buyer_trade_metrics                 (rebuildable projection)
  |-- buyer_intelligence_assessments      (versioned, explainable)
  |     `-- buyer_intelligence_assessment_evidence
  `-- buyer_finder_candidate_conversions -- public.buyers

public.buyers
  |-- campaign_recipients -- campaigns
  |-- activity_events
  `-- future opportunities / commercial milestones
```

`buyer_intelligence_sources`, claims, and trade observations are evidence records. Metrics and assessments are derived projections. A projection may be rebuilt; it must never silently become the source of an observed fact.

## Evidence and provenance

### Evidence levels

| Level | Label | Meaning | Examples |
| --- | --- | --- | --- |
| 1 | Verified trade evidence | Company-specific record from an actual shipment, customs/trade record, or equivalent authoritative trade record | Shipment or transaction tied unambiguously to the Candidate |
| 2 | Business evidence | Direct or established evidence about the company, but not a verified shipment | Company website importer claim, product catalogue, government registry, established directory |
| 3 | Discovery signal | A lead suggesting relevance and requiring corroboration | Search keyword, category match, general directory listing |

Level 3 must always display as “Discovery signal”; it must never use shipment/import-verification language. A `company_claim` is normally Level 2. A `directory_signal` is Level 3. Only genuinely company-specific trade records can establish Level 1.

### Provenance envelope

Every stored claim or trade observation joins to a required source row and exposes:

- provider/source identifier;
- source kind and lawful access basis;
- public URL or safe provider reference when available;
- a stable, non-secret source-record key for idempotency;
- evidence type and evidence level;
- observed date or period, when provided by the source;
- retrieval date;
- confidence classification;
- free/paid classification;
- sanitized raw source identity/reference;
- raw value and normalized interpretation side by side.

Provider keys, session cookies, signed URLs, authorization headers, and complete proprietary payloads are forbidden in intelligence rows. URLs shown in the UI must have sensitive query parameters removed. Raw identity JSON is bounded metadata, not a payload archive.

If the source does not provide a date, quantity, value, supplier, country, or HS code, the field remains `NULL`. Unknown is not zero. No normalization process may manufacture a missing raw value.

## Trade observations

One observation represents what a particular source actually supports. `granularity` prevents every record from being mislabeled a shipment:

- `shipment`: one actual shipment record;
- `transaction`: a transaction that may not map one-to-one to a shipment;
- `aggregate_period`: a source-reported total over a date range;
- `buyer_supplier_relation`: evidence of a relationship without an individual movement;
- `company_claim`: the company or an authoritative profile claims trade activity;
- `directory_signal`: a discovery/category signal only.

For a point event, `trade_date` is used. For an aggregate, `period_start` and `period_end` are used. A source-reported aggregate count may be stored in `reported_record_count`, but must not be expanded into fabricated rows.

### Origin and destination

`origin_country_code` and `destination_country_code` are independent nullable ISO 3166-1 alpha-2 values:

- destination/import country is where the importer receives the goods;
- origin country is the observed origin of the traded goods.

Candidate country is profile data and is not a fallback for either field. A Kuwait Candidate may have observed destination Kuwait and origins India, Vietnam, and China. A missing destination remains missing even if the company address is known.

### Products and HS codes

Four values remain distinct:

1. `product_description_raw`: exact source wording;
2. `hs_code_raw`: source-provided HS code, retained as text to preserve leading zeros and varying code lengths;
3. `normalized_product_category`: MDF's versioned interpretation;
4. `mdf_product_id`: optional match to the canonical business catalogue.

Normalization is additive. It records `normalization_version` and never overwrites the raw description or HS code. HS hierarchy/description reference data may later live in a separate reference dataset, but BI1 does not need a per-Candidate HS table.

A separate `buyer_trade_products` truth table is not recommended initially. Products are grouped projections over source-linked observations. If scale later demands persistence, create a rebuildable summary/materialized view, not another manually editable source of trade truth.

### Supplier relationships

Supplier identity starts with `supplier_name_raw`, optional normalized name/key, and optional country on observations. An explicit `buyer_supplier_relation` observation can represent a relationship when no shipment is supplied.

The Suppliers tab should group observations by normalized supplier key and calculate:

- display/raw aliases;
- first and last observed dates;
- verified shipment/transaction counts, where known;
- relevant products and HS codes;
- source-linked relationship evidence;
- Indian supplier exposure only when supplier country or company-specific origin evidence actually says India.

A separate writable `buyer_trade_suppliers` table is not recommended in BI1 because it would duplicate dates/counts and drift from observations. Start with a query projection. Persist a rebuildable supplier rollup only when measured query cost requires it. Weak directory evidence must remain visibly weak and cannot establish a verified supplier relationship.

## Deterministic metrics

Metrics are computed only from eligible, deduplicated observations. Each metric snapshot records its formula version, calculation time, input watermark, window, scope, and basis. The UI must distinguish:

- **observed/deterministic**: directly counted or calculated from source-supported observations;
- **source-reported**: a number explicitly supplied by a source aggregate;
- **estimated/inferred**: optional future value, labeled as such and never mixed into observed totals.

Initial metric definitions:

| Metric | Deterministic definition |
| --- | --- |
| Last observed trade | Maximum known `trade_date` among eligible Level 1 shipment/transaction observations; undated and aggregate-only rows do not fabricate an event date |
| Trade observations total | Count by granularity; never label the combined count “shipments” |
| Shipment count | Count only `granularity='shipment'`; source-reported aggregate counts appear separately |
| Last 12 months activity | Level 1 shipment/transaction count in the trailing 365 days; unknown dates excluded |
| Import frequency | Distinct active months divided by eligible months in the requested window; return insufficient evidence when the denominator is not meaningful |
| Origin distribution | Counts by known `origin_country_code`, with unknown count shown separately |
| India sourcing | Requires Level 1 company-specific observations with `origin_country_code='IN'` |
| India share | The existing `india_observation_share` key is defined as verified Level 1 India-origin shipments divided by verified Level 1 shipments with known origin. Transactions are excluded from this shipment-basis ratio. |
| Last India trade | Maximum known date among qualifying India-origin Level 1 records |
| Top suppliers/products | Ranked from eligible observations; disclose basis and unknown values |
| Supplier concentration | HHI or top-supplier share using one consistent basis; null when supplier identities or denominator are insufficient |
| Trade recency | Days since last verified observation, never since page retrieval |
| Momentum | Recent-window activity divided by the comparable preceding window; null rather than infinity or a fabricated trend when data is insufficient |

Cross-provider records can describe the same trade. Within-provider idempotency uses `(source_id, source_record_ref)`. Later cross-provider deduplication should use a documented fingerprint and retain all source links; uncertain matches are flagged, not silently merged.

## Legitimacy, potential, contact access, and readiness

These are four separate dimensions.

### Buyer legitimacy

Legitimacy answers “how strongly is this company and its business activity supported?” It uses inspectable rules:

- **Verified**: at least one unambiguous Level 1 company-specific trade record tied to the Candidate identity.
- **Strong evidence**: multiple independent Level 2 business sources corroborate identity and relevant activity, but no Level 1 trade record is available.
- **Moderate evidence**: one credible Level 2 source, or several concordant Level 3 signals.
- **Weak signal**: only one or uncorroborated Level 3 discovery signal.
- **No evidence found**: no eligible evidence; this does not mean the company is illegitimate.

If a numerical display is later useful, components must be deterministic and named (identity corroboration, verified activity, business-source corroboration, and evidence freshness). Each component stores its rule, awarded value, maximum, and supporting claim/observation IDs. There is no opaque AI score. Website or contact availability can be shown alongside legitimacy but does not turn a weak company signal into verified trade evidence.

### Buyer potential

Potential answers “how commercially promising is this company for MDF?” It can use product/HS overlap, verified recency, frequency, India sourcing history, destination fit, and supplier diversity. It is `high`, `medium`, `low`, or `insufficient_evidence`, with component reasons. High potential does not imply contactability.

### Contact access

Use the highest supported level:

- `company_only`: company intelligence exists but there is no usable email route;
- `public_route`: a usable public company mailbox exists;
- `named_contact`: a named/masked person is known but no usable direct email is persisted;
- `direct_contact`: a named person's usable direct email is persisted from a non-paid route;
- `credit_enriched`: usable personal details were historically obtained by an explicit paid reveal.

`company_only` is an intelligence classification only. It must never be accepted as a conversion source. `credit_enriched` records acquisition provenance; it never authorizes an automatic or current credit spend.

### Outreach readiness

Readiness is a rule result, not a score:

- `needs_review`: Candidate is not approved;
- `needs_contact`: approved but no BF5B-eligible conversion email source;
- `ready_for_conversion`: approved, not converted, and backed by either a Candidate/workspace-scoped public-company email or a usable revealed contact with `revealed_at` present and `email_type='personal'`;
- `ready_for_outreach`: converted Buyer has usable email and is not suppressed, while actual sending remains separately gated;
- `suppressed`: linked Buyer is suppressed;
- `not_eligible`: rejected or archived under the applicable workflow rule.

This produces the intended matrix: high potential plus direct contact is priority outreach; high potential plus no email is high-value Needs Contact; low potential plus direct contact remains a lower outreach priority.

## Provider-neutral, free-first architecture

BI0 integrates no provider. Future adapters should implement narrow server-only interfaces and return normalized envelopes:

```ts
type IntelligenceOutcome =
  | "success"
  | "no_result"
  | "rate_limited"
  | "temporarily_unavailable"
  | "blocked"
  | "not_supported"
  | "not_configured";

type CostClass = "free" | "paid";
type AccessClass = "public" | "authorized_api" | "authorized_export" | "manual";

interface IntelligenceResult<T> {
  outcome: IntelligenceOutcome;
  costClass: CostClass;
  accessClass: AccessClass;
  source: SourceEnvelope;
  records: T[];
  nextCursor?: string;
  safeWarnings?: string[];
}

interface CompanyIntelligenceProvider {
  researchCompany(input: CompanyIdentity): Promise<IntelligenceResult<CompanyClaim>>;
}

interface TradeIntelligenceProvider {
  findCompanyTrade(input: CompanyIdentity & PageRequest):
    Promise<IntelligenceResult<TradeObservation>>;
}

interface ShipmentIntelligenceProvider {
  findCompanyShipments(input: CompanyIdentity & PageRequest):
    Promise<IntelligenceResult<ShipmentObservation>>;
}

interface SupplierIntelligenceProvider {
  findCompanySuppliers(input: CompanyIdentity & PageRequest):
    Promise<IntelligenceResult<SupplierRelationObservation>>;
}

interface MarketTradeProvider {
  findMarketTrade(input: MarketQuery & PageRequest):
    Promise<IntelligenceResult<MarketTradeObservation>>;
}
```

The orchestrator validates candidate identity, cost class, capability, legal access, and record shape before persistence. Free/public providers are selected explicitly. A paid adapter is an optional future operator-selected capability, never an automatic fallback. Provider errors are mapped to safe outcomes and do not expose credentials or raw responses.

## Market intelligence is not company evidence

“Kuwait imports HS 0904 from India” is a market observation. It does not prove that a Kuwait company imported that product.

Enforce this distinction in four layers:

1. Market provider results use a different TypeScript union and cannot be passed to company-observation persistence.
2. Future market tables have market keys (destination, origin, HS/product, period) and deliberately have no `candidate_id`.
3. Company legitimacy and India-sourcing calculations read only `buyer_trade_observations` with company-specific evidence.
4. The UI uses “Market context” styling and never displays market facts under company Trade History or Verified evidence.

Market data may inform market selection or provide context on a Candidate page, but it cannot support a Candidate assessment without separate company-specific evidence.

## Proposed additive SQL design

This section now mirrors the authored, unapplied migration 0020. It remains intentionally limited to six company-intelligence tables. Product and supplier summaries are derived; market intelligence remains a later, physically separate schema. The migration file is the executable source of truth.

```sql
-- DESIGN ONLY. Do not apply in BI0.

create table public.buyer_intelligence_sources (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  candidate_id          uuid not null,
  provider_id           text not null,
  source_type           text not null,
  source_key            text not null,
  source_url            text,
  safe_source_ref       text,
  access_class          text not null,
  cost_class            text not null default 'free',
  observed_at           timestamptz,
  retrieved_at          timestamptz not null,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  unique (id, candidate_id, workspace_id),
  unique (workspace_id, candidate_id, provider_id, source_key),
  foreign key (candidate_id, workspace_id)
    references public.buyer_candidates (id, workspace_id) on delete restrict,
  check (btrim(provider_id) <> '' and btrim(source_type) <> '' and btrim(source_key) <> ''),
  check (access_class in ('public', 'authorized_api', 'manual', 'internal')),
  check (cost_class in ('free', 'paid', 'unknown')),
  check (jsonb_typeof(metadata) = 'object')
);

create table public.buyer_intelligence_claims (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  candidate_id          uuid not null,
  source_id             uuid not null,
  source_record_ref     text not null,
  claim_type            text not null,
  evidence_type         text not null,
  evidence_level        smallint not null,
  confidence            text not null default 'unknown',
  observed_at           timestamptz,
  raw_value             jsonb not null,
  normalized_value      jsonb,
  normalization_version text,
  retrieved_at          timestamptz not null,
  created_at            timestamptz not null default now(),
  unique (id, candidate_id, workspace_id),
  unique (source_id, source_record_ref, claim_type),
  foreign key (candidate_id, workspace_id)
    references public.buyer_candidates (id, workspace_id) on delete restrict,
  foreign key (source_id, candidate_id, workspace_id)
    references public.buyer_intelligence_sources (id, candidate_id, workspace_id)
    on delete restrict,
  check (evidence_level between 1 and 3),
  check (confidence in ('verified', 'high', 'medium', 'low', 'unknown')),
  check (btrim(source_record_ref) <> '' and btrim(claim_type) <> '' and btrim(evidence_type) <> '')
);

create table public.buyer_trade_observations (
  id                          uuid primary key default gen_random_uuid(),
  workspace_id                uuid not null references public.workspaces(id) on delete cascade,
  candidate_id                uuid not null,
  source_id                   uuid not null,
  source_record_ref           text not null,
  granularity                 text not null,
  evidence_type               text not null,
  evidence_level              smallint not null,
  confidence                  text not null default 'unknown',
  supplier_name_raw           text,
  supplier_name_normalized    text,
  supplier_country_code       text,
  trade_date                  date,
  period_start                date,
  period_end                  date,
  origin_country_code         text,
  destination_country_code    text,
  product_description_raw     text,
  hs_code_raw                 text,
  normalized_product_category text,
  mdf_product_id              text,
  normalization_version       text,
  quantity                    numeric,
  quantity_unit               text,
  gross_weight_kg             numeric,
  net_weight_kg               numeric,
  trade_value                 numeric,
  currency_code               text,
  origin_port_raw             text,
  destination_port_raw        text,
  reported_record_count       integer,
  observed_at                 timestamptz,
  retrieved_at                timestamptz not null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (id, candidate_id, workspace_id),
  unique (source_id, source_record_ref),
  foreign key (candidate_id, workspace_id)
    references public.buyer_candidates (id, workspace_id) on delete restrict,
  foreign key (source_id, candidate_id, workspace_id)
    references public.buyer_intelligence_sources (id, candidate_id, workspace_id)
    on delete restrict,
  check (granularity in (
    'shipment', 'transaction', 'aggregate_period',
    'buyer_supplier_relation', 'company_claim', 'directory_signal'
  )),
  check (evidence_level between 1 and 3),
  check (confidence in ('verified', 'high', 'medium', 'low', 'unknown')),
  check (granularity not in ('shipment', 'transaction') or evidence_level = 1),
  check (granularity <> 'company_claim' or evidence_level = 2),
  check (granularity <> 'directory_signal' or evidence_level = 3),
  check (period_end is null or period_start is null or period_end >= period_start),
  check (quantity is null or quantity >= 0),
  check (gross_weight_kg is null or gross_weight_kg >= 0),
  check (net_weight_kg is null or net_weight_kg >= 0),
  check (trade_value is null or trade_value >= 0),
  check (reported_record_count is null or reported_record_count >= 0),
  check (origin_country_code is null or origin_country_code ~ '^[A-Z]{2}$'),
  check (destination_country_code is null or destination_country_code ~ '^[A-Z]{2}$'),
  check (supplier_country_code is null or supplier_country_code ~ '^[A-Z]{2}$'),
  check (currency_code is null or currency_code ~ '^[A-Z]{3}$')
);

create table public.buyer_trade_metrics (
  id                           uuid primary key default gen_random_uuid(),
  workspace_id                 uuid not null references public.workspaces(id) on delete cascade,
  candidate_id                 uuid not null,
  metric_key                   text not null,
  value_type                   text not null,
  numeric_value                numeric,
  text_value                   text,
  structured_value             jsonb,
  unit                         text not null,
  calculation_window           text not null default 'lifetime',
  window_start                 date,
  window_end                   date,
  supporting_observation_count integer not null default 0,
  observation_watermark        timestamptz,
  calculated_at                timestamptz not null,
  calculation_version          text not null,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  unique (id, candidate_id, workspace_id),
  unique (workspace_id, candidate_id, metric_key, calculation_window),
  foreign key (candidate_id, workspace_id)
    references public.buyer_candidates (id, workspace_id) on delete restrict,
  check (metric_key in (
    'last_observed_trade', 'trade_observation_count', 'shipment_count',
    'activity_last_12_months', 'import_frequency', 'india_observation_count',
    'india_shipment_count', 'india_observation_share', 'last_observed_india_trade',
    'origin_country_distribution', 'supplier_count', 'supplier_ranking',
    'supplier_concentration', 'trade_momentum'
  )),
  check (value_type in ('number', 'text', 'json')),
  check (
    num_nonnulls(numeric_value, text_value, structured_value) = 1 and
    ((value_type = 'number' and numeric_value is not null) or
     (value_type = 'text' and text_value is not null) or
     (value_type = 'json' and structured_value is not null))
  ),
  check (unit in ('count', 'ratio', 'date', 'months', 'index', 'none')),
  check (btrim(calculation_window) <> ''),
  check (window_start is null or window_end is null or window_end >= window_start),
  check (supporting_observation_count >= 0),
  check (unit <> 'ratio' or (numeric_value is not null and numeric_value between 0 and 1)),
  check (btrim(calculation_version) <> '')
);

create table public.buyer_intelligence_assessments (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  candidate_id          uuid not null,
  assessment_type       text not null,
  classification        text not null,
  summary               text not null,
  components            jsonb not null default '[]'::jsonb,
  calculated_at         timestamptz not null,
  calculation_version   text not null,
  superseded_at         timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, candidate_id, workspace_id),
  foreign key (candidate_id, workspace_id)
    references public.buyer_candidates (id, workspace_id) on delete restrict,
  check (assessment_type in (
    'buyer_legitimacy', 'buyer_potential', 'contact_access', 'outreach_readiness'
  )),
  check (btrim(summary) <> ''),
  check (jsonb_typeof(components) = 'array')
);

create table public.buyer_intelligence_assessment_evidence (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  candidate_id       uuid not null,
  assessment_id      uuid not null,
  claim_id           uuid,
  observation_id     uuid,
  metric_id          uuid,
  component_key      text not null,
  created_at         timestamptz not null default now(),
  unique (id, candidate_id, workspace_id),
  foreign key (candidate_id, workspace_id)
    references public.buyer_candidates (id, workspace_id) on delete restrict,
  foreign key (assessment_id, candidate_id, workspace_id)
    references public.buyer_intelligence_assessments (id, candidate_id, workspace_id) on delete cascade,
  foreign key (claim_id, candidate_id, workspace_id)
    references public.buyer_intelligence_claims (id, candidate_id, workspace_id) on delete restrict,
  foreign key (observation_id, candidate_id, workspace_id)
    references public.buyer_trade_observations (id, candidate_id, workspace_id) on delete restrict,
  foreign key (metric_id, candidate_id, workspace_id)
    references public.buyer_trade_metrics (id, candidate_id, workspace_id) on delete restrict,
  check (num_nonnulls(claim_id, observation_id, metric_id) = 1),
  check (btrim(component_key) <> '')
);

create index buyer_intelligence_sources_candidate_retrieved_idx
  on public.buyer_intelligence_sources (workspace_id, candidate_id, retrieved_at desc, id desc);
create index buyer_intelligence_sources_provider_idx
  on public.buyer_intelligence_sources (workspace_id, provider_id, retrieved_at desc);

create index buyer_intelligence_claims_candidate_type_idx
  on public.buyer_intelligence_claims (workspace_id, candidate_id, claim_type, created_at desc);
create index buyer_intelligence_claims_source_idx
  on public.buyer_intelligence_claims (workspace_id, source_id);

create index buyer_trade_observations_history_idx
  on public.buyer_trade_observations
  (workspace_id, candidate_id, trade_date desc nulls last, id desc);
create index buyer_trade_observations_period_idx
  on public.buyer_trade_observations
  (workspace_id, candidate_id, period_end desc nulls last, id desc);
create index buyer_trade_observations_source_idx
  on public.buyer_trade_observations (workspace_id, source_id);
create index buyer_trade_observations_origin_idx
  on public.buyer_trade_observations (workspace_id, candidate_id, origin_country_code, trade_date desc)
  where origin_country_code is not null;
create index buyer_trade_observations_destination_idx
  on public.buyer_trade_observations (workspace_id, candidate_id, destination_country_code, trade_date desc)
  where destination_country_code is not null;
create index buyer_trade_observations_product_idx
  on public.buyer_trade_observations (workspace_id, candidate_id, normalized_product_category, trade_date desc)
  where normalized_product_category is not null;
create index buyer_trade_observations_mdf_product_idx
  on public.buyer_trade_observations (workspace_id, candidate_id, mdf_product_id, trade_date desc)
  where mdf_product_id is not null;
create index buyer_trade_observations_hs_idx
  on public.buyer_trade_observations (workspace_id, candidate_id, hs_code_raw, trade_date desc)
  where hs_code_raw is not null;
create index buyer_trade_observations_supplier_idx
  on public.buyer_trade_observations
  (workspace_id, candidate_id, supplier_name_normalized, trade_date desc)
  where supplier_name_normalized is not null;

create index buyer_trade_metrics_candidate_key_idx
  on public.buyer_trade_metrics (workspace_id, candidate_id, metric_key, calculated_at desc);

create unique index buyer_intelligence_assessments_one_current_idx
  on public.buyer_intelligence_assessments (workspace_id, candidate_id, assessment_type)
  where superseded_at is null;
create index buyer_intelligence_assessment_evidence_assessment_idx
  on public.buyer_intelligence_assessment_evidence (workspace_id, candidate_id, assessment_id);
create unique index buyer_intelligence_assessment_evidence_claim_unique_idx
  on public.buyer_intelligence_assessment_evidence
  (assessment_id, candidate_id, workspace_id, component_key, claim_id)
  where claim_id is not null;
create unique index buyer_intelligence_assessment_evidence_observation_unique_idx
  on public.buyer_intelligence_assessment_evidence
  (assessment_id, candidate_id, workspace_id, component_key, observation_id)
  where observation_id is not null;
create unique index buyer_intelligence_assessment_evidence_metric_unique_idx
  on public.buyer_intelligence_assessment_evidence
  (assessment_id, candidate_id, workspace_id, component_key, metric_id)
  where metric_id is not null;

-- Apply to every proposed table in the reviewed migration:
-- select mdf.__apply_workspace_rls('public.<table>'::regclass);
-- revoke all on public.<table> from anon, authenticated, public;
-- grant select on public.<immutable/derived table> to authenticated;
-- grant only the minimum required DML, preferably through narrow server-owned RPCs.
```

### Table behavior summary

| Table | Purpose and provenance | Uniqueness / deletion |
| --- | --- | --- |
| `buyer_intelligence_sources` | One lawful retrieval/document reference for one Candidate; stores provider, safe URL/ref, retrieval/access/cost, and non-secret metadata | Provider `source_key` is idempotent per Candidate. Candidate delete is restricted; a referenced source cannot be deleted. |
| `buyer_intelligence_claims` | Source-linked non-trade facts with raw and normalized values | Unique source item/type. Triple FK proves source and fact belong to the same Candidate/workspace. |
| `buyer_trade_observations` | Source-linked trade event, aggregate, relationship, claim, or signal | Unique source record. Nullable fields preserve source granularity; source deletion is restricted. |
| `buyer_trade_metrics` | Rebuildable normalized deterministic summary values for queue/detail reads | One typed row per Candidate/metric key/calculation window. Candidate deletion is restricted. |
| `buyer_intelligence_assessments` | Versioned legitimacy, potential, access, and readiness outputs | One unsuperseded assessment per type/Candidate. Old versions remain inspectable. |
| `buyer_intelligence_assessment_evidence` | Candidate-scoped referential links from each component to the exact claim, observation, or metric | Exactly one evidence target per row. Triple composite FKs forbid cross-Candidate links; assessment deletion cascades only its links; evidence deletion is restricted. |

All tables have `workspace_id` and `candidate_id`; every parent reference is composite where needed. Migration-level tests cover constraints, grants, RLS, cross-workspace and cross-Candidate ownership, historical migration hashes, and restrictive deletion. Migration 0020 is applied; BI2 does not alter it.

## Buyer Intelligence UI blueprint

The Candidate detail route can evolve into the intelligence workspace. A converted Buyer may open the same view through its conversion linkage. The header shows company, country/profile, review/conversion state, and four independent summaries: legitimacy, potential, contact access, and outreach readiness.

### Overview contract

The first screen must answer:

- Is the company supported by credible evidence?
- Is there verified trade or only a discovery signal?
- Does observed trade overlap an MDF product/HS category?
- Is activity recent and recurring?
- Is India sourcing actually evidenced?
- Is a usable email available, and who is the best contact?

Suggested response shape:

```ts
interface BuyerIntelligenceSummary {
  candidate: CompanySummary;
  conversion?: { buyerId: string; convertedAt: string };
  legitimacy: ExplainableAssessment;
  buyerPotential: ExplainableAssessment;
  contactAccess: ExplainableAssessment;
  outreachReadiness: ExplainableAssessment;
  metrics?: TradeMetricSummary;
  evidenceCounts: { level1: number; level2: number; level3: number };
  freshestRetrievedAt?: string;
}
```

Every headline opens its component rules and evidence. Empty states say “No evidence found” or “Not available from this source,” never zero activity.

### Tabs and interactions

| Tab | Contract |
| --- | --- |
| Overview | Summary contract, strongest evidence, product fit, recency/frequency, India sourcing, contact route, and clear unknowns |
| Contacts | Existing people and public routes; contact-access level; provenance; no automatic paid reveal |
| Trade Intelligence | Company-specific chronological records with evidence badges and source links; filters for dates, product/HS, source, granularity, and evidence level |
| Products | Grouped raw descriptions, HS codes, normalized categories, MDF matches, counts/basis, and supporting records |
| Suppliers | Derived relationships, aliases/country, first/last observed, basis-specific counts, product overlap, and supporting records |
| Outreach | For an unconverted Candidate, explain approval/email/conversion requirements. For a converted Buyer, link to Buyer/campaign workflows; never send from the intelligence page |
| Activity | Candidate research events and linked Buyer activity in one timeline with explicit entity-scope labels |
| Sources | Provider/source list, retrieval time, access/cost classification, coverage, safe reference/URL, and facts contributed |

Trade history uses keyset pagination with a default page size of 25 and a hard maximum of 100. Its cursor is based on effective observed date plus `id`; undated records have a separate stable tail. Queue/list pages load only assessment and metric summaries, never full observations.

Evidence visuals must use both text and styling: `Verified trade`, `Business evidence`, and `Discovery signal`. The word “shipment” appears only for shipment granularity. Market context, if later shown, is a separate panel and is never included in company metrics.

## CRM blueprint

CRM begins only after Buyer conversion. The desired commercial lifecycle is:

```text
New -> Contacted -> Replied -> Qualified
    -> Sample requested -> Sample sent
    -> Quotation -> Negotiation
    -> Won / Customer
    -> Lost (from any active commercial stage)
```

No lifecycle change is implemented in BI0. Existing Buyer statuses cover `new`, `contacted`, `replied`, `qualified`, `quotation-sent`, `negotiating`, `converted`, and `not-interested`, plus operational states `ready` and `interested`. They do not cleanly represent samples, loss reasons, or multiple opportunities.

Recommended future model:

- Buyer remains the contactable company/contact CRM record.
- A future `opportunities` table owns deal stage, product, target market, value/currency, probability, next action, owner, won/lost timestamps, and loss reason. One Buyer can have multiple opportunities.
- Sample requested/sent and quotation issuance are explicit opportunity milestones plus immutable activity events; they are not inferred from emails.
- `campaign_recipients` and `email_send_events` remain outreach/audit records and reference the Buyer. A later optional opportunity id can associate a send without making campaigns own the deal.
- `activity_events` records human-readable milestones with entity type/id. A unified timeline can join Candidate research, conversion, Buyer, campaign, and opportunity events while preserving their original scope.
- The ambiguous existing Buyer status `converted` should eventually map to `won/customer` or be deprecated carefully; it must not be confused with Candidate-to-Buyer conversion.
- `ready` remains an operational outreach state during compatibility; it should not be silently reinterpreted as a sales stage.

Direct decision-maker outreach is a later, low-volume, manually reviewed path. Copy may use verified company/product intelligence and role context, but cannot state unsupported shipment facts. BI0 adds no template and no send behavior.

## Scale and query plan

The design supports thousands of Candidates and tens/hundreds of observations per company initially:

- queue pages read one current assessment/metric row per Candidate;
- detail records use keyset pagination, not offset pagination or complete-history loads;
- candidate/date, source, origin, product, HS, and supplier indexes match the primary filters;
- source keys make repeated retrievals idempotent;
- normalized supplier/product fields are indexed only when non-null;
- metric and supplier/product projections are rebuilt asynchronously after ingestion, with formula/input watermarks;
- recalculation swaps the current assessment in one transaction and keeps prior versions;
- raw payloads are not stored in hot relational tables.

Do not partition initially. Re-evaluate monthly/range partitioning only after observation volume reaches millions and measured query/maintenance cost warrants it. At that point preserve the same Candidate/workspace keys and cursor contract.

## Security, workspace isolation, and source safety

- Apply `mdf.__apply_workspace_rls` to every intelligence table.
- Use `(id, workspace_id)` or `(id, candidate_id, workspace_id)` uniqueness to support composite foreign keys that reject cross-workspace/cross-Candidate linkage.
- Resolve workspace from the authenticated request; provider/browser payloads never choose the authoritative workspace.
- Provider clients and credentials remain server-only. No API key, token, cookie, signed query, or raw error is persisted or returned to the browser.
- Prefer append-only source/fact writes through narrow server-owned repository operations or RPCs. Derived assessment/metric writes are not open browser-authored facts.
- Treat source URLs and raw references as untrusted display data; sanitize links and escape text.
- Store only data that is public, legally accessible, permitted by the source, or obtained through an authorized API/export.
- Do not scrape LinkedIn, bypass authentication or paywalls, or copy paid proprietary databases without authorization.
- Retention and deletion must be auditable. Archive the Candidate for ordinary lifecycle changes; use an explicit future purge workflow for intelligence records.

## Phased implementation plan

### BI1: provenance foundation and manual fixtures

- Review and implement the six company-intelligence tables in one additive, unapplied migration with RLS/migration tests and a documented read-only preflight.
- Add domain types, workspace-pinned read-only Supabase repositories/mappings, and controlled in-memory unit fixtures.
- Ingest only controlled fixtures/manual authorized evidence; no external provider.
- Implement deterministic evidence labels, one summary loader, and read-only Overview/Sources/Trade skeletons behind existing Candidate detail.
- Add metric calculations for counts, last trade, origin distribution, and India evidence with fixture tests.
- Preserve existing Candidate/Buyer conversion behavior and both false safety gates.

### BI2: controlled write pipeline and derived assessments

- Implemented strict provider-neutral source/claim/observation input contracts and three narrow idempotent ingestion RPCs.
- Implemented one atomic refresh RPC for normalized metrics, four explainable/versioned assessments, and Candidate-scoped evidence links.
- Added deterministic product/supplier read projections without new truth tables and enhanced the existing read-only Candidate detail tabs.
- Authenticated table access remains SELECT-only. Workspace comes from session context; callers cannot submit it. Exact replays are no-ops and conflicting material under an existing source identity is not overwritten.
- Migration 0021 is authored and tested but remains unapplied. BI2 makes no external provider or live Supabase call.

### BI3: first reviewed free/public provider

- Select one legally permitted free/authorized source after a terms/data-quality review.
- Implement one server-only adapter, explicit manual run, safe outcomes, idempotency, rate limiting, and provenance completeness checks.
- Do not add automatic paid fallback.

### BI4: CRM opportunities and market context

- Design/migrate the opportunity pipeline and sample/quotation milestones separately from Buyer status compatibility.
- Add physically separate market sources/observations and a Market context UI that cannot feed company proof.
- Re-evaluate a durable company master only if real duplicate/legal-entity requirements appear.

BI2 stops here. It does not start BI3 or integrate a provider.
