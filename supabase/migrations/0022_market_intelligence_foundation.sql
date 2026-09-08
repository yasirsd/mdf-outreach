-- MDF Outreach — MI1B: Market Intelligence database foundation.
-- Additive only. Does NOT apply itself. Operator applies manually after review.
-- Does not edit historical migration files. Migrations 0018–0021 stay immutable.
--
-- Does NOT convert existing candidates.
-- Does NOT create Buyers.
-- Does NOT rewrite any Buyer / BI row.
-- Does NOT call Hunter, websites, Gmail, BACI, OEC, or any external service.
-- Does NOT seed market observations.
-- Does NOT seed market fit / confidence scores.
-- Does NOT seed product_trade_mappings (see synchronization note below).
--
-- Domain boundary reasserted:
--   * Market Intelligence is country × product; Buyer Intelligence is
--     Candidate. Market-level evidence MUST NEVER be written to any BI
--     table; no MI RPC in this migration ever touches buyer_candidates,
--     buyer_trade_observations, buyer_trade_metrics,
--     buyer_intelligence_claims, buyer_intelligence_assessments, buyers,
--     or buyer_finder_candidate_conversions.
--   * Country identity is ISO 3166-1 alpha-2 UPPERCASE only.
--   * Provider alpha-3 codes must never become canonical MI storage
--     identity — translation happens at the adapter boundary, not the
--     database.
--
-- Global vs. workspace scope:
--   * Seven tables are GLOBAL/shared across every MDF workspace.
--     Official market statistics are identical everywhere; duplicating
--     rows per workspace would burn free-API quota and create version
--     skew. Direct DML is REVOKED for `anon` and `authenticated`; the
--     narrow SECURITY DEFINER RPCs below are the sole writers. RLS is
--     enabled with `for select to authenticated using (true)` so any
--     authenticated MDF user can read.
--   * One table (market_analysis_events) is workspace-scoped through
--     the standard `mdf.__apply_workspace_rls` macro because the
--     operator activity trail is per-workspace.
--
-- Product-trade mapping synchronization (deliberate NO-SEED decision):
--   The TypeScript registry in src/lib/marketIntelligence/product.ts
--   is the source of truth for MDF product ↔ HS mappings; its banded
--   CHECK invariants (exact >= 0.85, proxy in (0.4, 0.85], composite
--   <= 0.4) are mirrored in SQL here. This migration deliberately does
--   NOT insert rows to avoid TS↔SQL drift. MI1C will introduce a
--   maintenance-only helper that reads the TS registry and writes it
--   through `mdf.__sync_product_trade_mappings(...)`. Until MI1C, the
--   MI subsystem reads mappings from TS (unchanged); the SQL table
--   exists so the MI1C sync target and future FK relationships are
--   ready.
--
-- Scoring authority boundary:
--   The TypeScript `marketFit.ts` module remains the ONE authoritative
--   scoring methodology. This migration does NOT re-implement it in
--   SQL. `refresh_market_intelligence(...)` accepts a fully-computed
--   score bundle from the server orchestrator and enforces publication
--   invariants (composite -> null published score; proxy -> not
--   actionable; actionable -> non-null published score AND exact
--   mapping). SQL is thus the invariant enforcer, not a second scorer.
--
-- MI1B.1 trust boundary (global writes):
--   Every RPC that mutates the SHARED/global MI tables (sources,
--   observations, ledger, metrics, scores, components, mappings) is
--   granted only to `service_role`. `public`, `anon`, and
--   `authenticated` are REVOKED. A browser-authenticated MDF user
--   MUST NOT be able to fabricate global market evidence by calling
--   PostgREST directly. MI1C will introduce a server-only writer
--   (Next.js server action → workspace-authenticated → service-role
--   Supabase client) that owns the sole call path to these RPCs. No
--   new service-role credential is added by this migration — the
--   built-in Supabase `service_role` is the trust anchor; MI1C wires
--   the writer that holds its key.
--
-- MI1B.2 — browser-vs-server refresh authority (invariant):
--   The four public RPCs below are NOT a browser-callable calculation
--   API even though `refresh_market_intelligence` accepts a
--   pre-computed score bundle. The browser / client supplies ONLY
--   operator intent (country + product). Every one of the following
--   fields on the refresh payload — metric rows, diagnostic_fit_score,
--   published_fit_score, data_confidence_score, recommendation_status,
--   score components, provider_selection_version, market_fit_version,
--   confidence_version, calculation_version, source_coverage — MUST
--   be derived server-side by MI1C from persisted verified market
--   observations and the current TypeScript MI domain modules.
--   Because the mutation RPCs are granted only to `service_role`,
--   PostgREST cannot deliver a browser-crafted payload here; this
--   comment records the design intent so a future maintainer never
--   mistakenly exposes the RPC to authenticated clients.
--
-- MI1B.2 — service_role isolation (MI1C wiring requirement):
--   The MI1C server-only writer must:
--     * live behind a `server-only` module boundary,
--     * read SUPABASE_SERVICE_ROLE_KEY only from server env,
--     * never be imported by client components,
--     * validate the MDF workspace session before calling any RPC
--       here (`requireMdfSession()` or equivalent),
--     * never become a generic unrestricted repository — expose only
--       the four MI mutation contracts and nothing else,
--     * never return the key or a service-role client to the browser.
--   MI1B does not wire this — it only establishes the DB boundary
--   MI1C will target.

begin;

-- ---------------------------------------------------------------------------
-- 1) public.market_intelligence_sources — durable provenance
-- ---------------------------------------------------------------------------
create table if not exists public.market_intelligence_sources (
  id                                uuid primary key default gen_random_uuid(),
  provider_id                       text not null,
  dataset_id                        text not null,
  source_tier                       text not null,
  dataset_source                    text not null,
  dataset_license_name              text,
  dataset_license_url               text,
  dataset_attribution_requirement   text,
  distribution_service              text not null,
  distribution_service_terms_url    text,
  distribution_catalog_license_name text,
  service_terms_verified            boolean not null default false,
  storage_allowed                   boolean,
  redistribution_allowed            boolean,
  licence_verified_at               timestamptz,
  licence_verification_note         text,
  source_url                        text,
  safe_reference                    text,
  retrieved_at                      timestamptz not null,
  metadata                          jsonb not null default '{}'::jsonb,
  created_at                        timestamptz not null default now(),
  constraint market_intelligence_sources_provider_not_blank
    check (btrim(provider_id) <> ''),
  constraint market_intelligence_sources_dataset_not_blank
    check (btrim(dataset_id) <> ''),
  constraint market_intelligence_sources_source_tier_allowed
    check (source_tier in ('A','B','C','D','E')),
  constraint market_intelligence_sources_dataset_source_not_blank
    check (btrim(dataset_source) <> ''),
  constraint market_intelligence_sources_distribution_service_not_blank
    check (btrim(distribution_service) <> ''),
  constraint market_intelligence_sources_source_url_shape
    check (source_url is null or source_url ~* '^https?://'),
  constraint market_intelligence_sources_metadata_object
    check (jsonb_typeof(metadata) = 'object'),
  -- Reject obvious secret-shaped metadata keys AND credential-bearing URLs.
  constraint market_intelligence_sources_metadata_no_secrets
    check (
      (metadata::text) !~* '"[^"]*(api.?key|secret|token|cookie|authorization|password|credential|bearer)[^"]*"\s*:'
    ),
  constraint market_intelligence_sources_source_url_no_credentials
    check (
      source_url is null or (
        source_url !~* '://[^/]*@'
        and source_url !~* '[?&](api.?key|key|secret|token|access_token|auth|authorization|signature|bearer)='
      )
    ),
  unique (provider_id, dataset_id)
);

comment on table public.market_intelligence_sources is
  'MI1B: durable provenance for market datasets/providers. Global/shared, SELECT-only for authenticated.';

-- ---------------------------------------------------------------------------
-- 2) public.product_trade_mappings — SQL mirror of the TS registry
--    (NO ROWS INSERTED HERE; see synchronization note in preface).
-- ---------------------------------------------------------------------------
create table if not exists public.product_trade_mappings (
  id                          uuid primary key default gen_random_uuid(),
  mdf_product_id              text not null,
  hs_revision                 text not null,
  hs_level                    smallint not null,
  hs_code                     text not null,
  trade_label                 text not null,
  mapping_kind                text not null,
  mapping_confidence          numeric(4,3) not null,
  fit_eligibility             text not null,
  scope_description           text not null,
  included_products_note      text,
  weight                      numeric(4,3),
  effective_from              date,
  effective_to                date,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint product_trade_mappings_product_not_blank
    check (btrim(mdf_product_id) <> ''),
  constraint product_trade_mappings_hs_revision_allowed
    check (hs_revision in ('HS92','HS96','HS02','HS07','HS12','HS17','HS22')),
  constraint product_trade_mappings_hs_level_allowed
    check (hs_level in (2,4,6)),
  constraint product_trade_mappings_hs_code_digits
    check (hs_code ~ '^[0-9]+$'),
  constraint product_trade_mappings_hs_code_length_matches_level
    check (length(hs_code) = hs_level),
  constraint product_trade_mappings_kind_allowed
    check (mapping_kind in ('exact','proxy','composite')),
  constraint product_trade_mappings_confidence_range
    check (mapping_confidence > 0 and mapping_confidence <= 1),
  -- Banded confidence mirrors the TS validator in product.ts:
  --   exact     >= 0.85
  --   proxy     in (0.4, 0.85]
  --   composite <= 0.4
  constraint product_trade_mappings_confidence_bands
    check (
      (mapping_kind = 'exact'     and mapping_confidence >= 0.85) or
      (mapping_kind = 'proxy'     and mapping_confidence > 0.40 and mapping_confidence <= 0.85) or
      (mapping_kind = 'composite' and mapping_confidence <= 0.40)
    ),
  constraint product_trade_mappings_eligibility_allowed
    check (fit_eligibility in ('exact','proxy_allowed','insufficient_specificity')),
  -- Fit eligibility is derived from mapping_kind and must stay compatible.
  constraint product_trade_mappings_eligibility_matches_kind
    check (
      (mapping_kind = 'exact'     and fit_eligibility = 'exact') or
      (mapping_kind = 'proxy'     and fit_eligibility = 'proxy_allowed') or
      (mapping_kind = 'composite' and fit_eligibility = 'insufficient_specificity')
    ),
  constraint product_trade_mappings_scope_not_blank
    check (btrim(scope_description) <> ''),
  constraint product_trade_mappings_weight_range
    check (weight is null or (weight > 0 and weight <= 1)),
  constraint product_trade_mappings_effective_period
    check (
      effective_from is null or effective_to is null or effective_to >= effective_from
    ),
  unique (mdf_product_id, hs_revision, hs_code)
);

comment on table public.product_trade_mappings is
  'MI1B: SQL mirror of src/lib/marketIntelligence/product.ts. NOT SEEDED here; MI1C sync helper will populate it.';

-- ---------------------------------------------------------------------------
-- 3) public.market_provider_fetch_ledger — cache/fetch coverage ledger
--    Append-only history of every attempt. The latest row per query
--    fingerprint drives the cache decision; earlier rows preserve
--    audit-of-failed-attempts so we can reconstruct why a provider
--    call happened (or did not).
-- ---------------------------------------------------------------------------
create table if not exists public.market_provider_fetch_ledger (
  id                            uuid primary key default gen_random_uuid(),
  provider_id                   text not null,
  dataset_id                    text not null,
  query_fingerprint             text not null,
  reporter_country              text not null,
  partner_country               text,
  trade_flow                    text not null,
  hs_revision                   text not null,
  hs_codes                      text[] not null,
  frequency                     text not null,
  coverage_start                text not null,
  coverage_end                  text not null,
  provider_selection_version    text not null,
  fetched_at                    timestamptz not null,
  fresh_until                   timestamptz not null,
  outcome                       text not null,
  rows_received                 integer not null default 0,
  safe_metadata                 jsonb not null default '{}'::jsonb,
  created_at                    timestamptz not null default now(),
  constraint market_provider_fetch_ledger_provider_not_blank
    check (btrim(provider_id) <> ''),
  constraint market_provider_fetch_ledger_reporter_alpha2
    check (reporter_country ~ '^[A-Z]{2}$'),
  constraint market_provider_fetch_ledger_partner_alpha2
    check (partner_country is null or partner_country ~ '^[A-Z]{2}$'),
  constraint market_provider_fetch_ledger_trade_flow_allowed
    check (trade_flow in ('import','export','re_import','re_export')),
  constraint market_provider_fetch_ledger_hs_revision_allowed
    check (hs_revision in ('HS92','HS96','HS02','HS07','HS12','HS17','HS22')),
  constraint market_provider_fetch_ledger_hs_codes_non_empty
    check (array_length(hs_codes, 1) > 0),
  constraint market_provider_fetch_ledger_frequency_allowed
    check (frequency in ('annual','quarterly','monthly')),
  constraint market_provider_fetch_ledger_outcome_allowed
    check (outcome in (
      'success','partial','empty','quota_exhausted',
      'timeout','provider_error','invalid_request','unavailable'
    )),
  constraint market_provider_fetch_ledger_rows_nonneg
    check (rows_received >= 0),
  constraint market_provider_fetch_ledger_fresh_after_fetch
    check (fresh_until >= fetched_at),
  constraint market_provider_fetch_ledger_query_fingerprint_not_blank
    check (btrim(query_fingerprint) <> ''),
  constraint market_provider_fetch_ledger_metadata_object
    check (jsonb_typeof(safe_metadata) = 'object'),
  constraint market_provider_fetch_ledger_metadata_no_secrets
    check (
      (safe_metadata::text) !~* '"[^"]*(api.?key|secret|token|cookie|authorization|password|credential|bearer)[^"]*"\s*:'
    )
);

create index if not exists market_provider_fetch_ledger_fingerprint_idx
  on public.market_provider_fetch_ledger (query_fingerprint, fetched_at desc);
create index if not exists market_provider_fetch_ledger_provider_idx
  on public.market_provider_fetch_ledger (provider_id, fetched_at desc);
create index if not exists market_provider_fetch_ledger_country_product_idx
  on public.market_provider_fetch_ledger (reporter_country, hs_revision, fetched_at desc);

comment on table public.market_provider_fetch_ledger is
  'MI1B: append-only cache/fetch coverage ledger. The latest row per query_fingerprint drives cache decisions; failed attempts are preserved for audit.';

-- ---------------------------------------------------------------------------
-- 4) public.market_trade_observations — normalized market trade rows
--    NULL partner_country = world / all-partners aggregate.
--    Idempotent identity honours that world variant via a generated
--    sentinel column (partner_key), so a duplicate world observation
--    for the same (provider, reporter, HS, period) collides on the
--    unique index just like a duplicate bilateral one would.
-- ---------------------------------------------------------------------------
create table if not exists public.market_trade_observations (
  id                          uuid primary key default gen_random_uuid(),
  source_id                   uuid not null references public.market_intelligence_sources(id) on delete restrict,
  provider_id                 text not null,
  dataset_id                  text not null,
  reporter_country            text not null,
  partner_country             text,
  -- Generated sentinel column so NULL partner participates in unique identity.
  partner_key                 text generated always as (coalesce(partner_country, '__WORLD__')) stored,
  trade_flow                  text not null,
  hs_revision                 text not null,
  hs_code                     text not null,
  frequency                   text not null,
  period                      text not null,
  trade_value_usd             numeric(20,2),
  quantity                    numeric(20,3),
  quantity_unit               text,
  net_weight_kg               numeric(20,3),
  source_period               text,
  retrieved_at                timestamptz not null,
  source_url                  text,
  safe_source_ref             text,
  metadata                    jsonb not null default '{}'::jsonb,
  created_at                  timestamptz not null default now(),
  constraint market_trade_observations_provider_not_blank
    check (btrim(provider_id) <> ''),
  constraint market_trade_observations_reporter_alpha2
    check (reporter_country ~ '^[A-Z]{2}$'),
  constraint market_trade_observations_partner_alpha2
    check (partner_country is null or partner_country ~ '^[A-Z]{2}$'),
  constraint market_trade_observations_partner_not_self
    check (partner_country is null or partner_country <> reporter_country),
  constraint market_trade_observations_trade_flow_allowed
    check (trade_flow in ('import','export','re_import','re_export')),
  constraint market_trade_observations_hs_revision_allowed
    check (hs_revision in ('HS92','HS96','HS02','HS07','HS12','HS17','HS22')),
  constraint market_trade_observations_hs_code_digits
    check (hs_code ~ '^[0-9]+$'),
  constraint market_trade_observations_hs_code_length_allowed
    check (length(hs_code) in (2,4,6)),
  constraint market_trade_observations_frequency_allowed
    check (frequency in ('annual','quarterly','monthly')),
  -- MI1B.1 — period shape MUST match frequency exactly.
  -- annual    : YYYY
  -- quarterly : YYYY-Q1..Q4
  -- monthly   : YYYY-01..12   (never 00, never 13..19)
  constraint market_trade_observations_period_shape_matches_frequency
    check (
      (frequency = 'annual'    and period ~ '^[0-9]{4}$') or
      (frequency = 'quarterly' and period ~ '^[0-9]{4}-Q[1-4]$') or
      (frequency = 'monthly'   and period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
    ),
  constraint market_trade_observations_trade_value_nonneg
    check (trade_value_usd is null or trade_value_usd >= 0),
  constraint market_trade_observations_quantity_nonneg
    check (quantity is null or quantity >= 0),
  constraint market_trade_observations_net_weight_nonneg
    check (net_weight_kg is null or net_weight_kg >= 0),
  constraint market_trade_observations_quantity_unit_allowed
    check (quantity_unit is null or quantity_unit in ('kg','tonne','unit','litre','cubic_metre','other')),
  constraint market_trade_observations_source_url_shape
    check (source_url is null or source_url ~* '^https?://'),
  constraint market_trade_observations_source_url_no_credentials
    check (
      source_url is null or (
        source_url !~* '://[^/]*@'
        and source_url !~* '[?&](api.?key|key|secret|token|access_token|auth|authorization|signature|bearer)='
      )
    ),
  constraint market_trade_observations_metadata_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint market_trade_observations_metadata_no_secrets
    check (
      (metadata::text) !~* '"[^"]*(api.?key|secret|token|cookie|authorization|password|credential|bearer)[^"]*"\s*:'
    )
);

-- Idempotent observation identity, honouring the world/all-partners variant.
create unique index if not exists market_trade_observations_identity_uidx
  on public.market_trade_observations (
    provider_id, dataset_id, reporter_country, partner_key,
    trade_flow, hs_revision, hs_code, frequency, period
  );

-- Query-shaped indexes: country + product + period; origin breakdown.
create index if not exists market_trade_observations_series_idx
  on public.market_trade_observations
    (reporter_country, hs_revision, hs_code, period desc)
  where partner_country is null;
create index if not exists market_trade_observations_origin_idx
  on public.market_trade_observations
    (reporter_country, hs_revision, hs_code, period desc, partner_country)
  where partner_country is not null;
create index if not exists market_trade_observations_source_idx
  on public.market_trade_observations (source_id);

comment on table public.market_trade_observations is
  'MI1B: normalized source-backed market trade observations. NULL partner_country = world/all-partners aggregate.';

-- ---------------------------------------------------------------------------
-- 5) public.market_trade_metrics — rebuildable projections
-- ---------------------------------------------------------------------------
create table if not exists public.market_trade_metrics (
  id                       uuid primary key default gen_random_uuid(),
  country_alpha2           text not null,
  mdf_product_id           text not null,
  metric_key               text not null,
  numeric_value            numeric(24,6),
  json_value               jsonb,
  text_value               text,
  unit                     text,
  calculation_window       text not null,
  support_count            integer not null default 0,
  observation_watermark    timestamptz,
  calculation_version      text not null,
  calculated_at            timestamptz not null,
  superseded_at            timestamptz,
  created_at               timestamptz not null default now(),
  constraint market_trade_metrics_country_alpha2
    check (country_alpha2 ~ '^[A-Z]{2}$'),
  constraint market_trade_metrics_product_not_blank
    check (btrim(mdf_product_id) <> ''),
  constraint market_trade_metrics_metric_key_not_blank
    check (btrim(metric_key) <> ''),
  constraint market_trade_metrics_calculation_version_not_blank
    check (btrim(calculation_version) <> ''),
  constraint market_trade_metrics_calculation_window_not_blank
    check (btrim(calculation_window) <> ''),
  constraint market_trade_metrics_support_nonneg
    check (support_count >= 0),
  -- Exactly one value representation set. text_value stays open-ended (dates).
  constraint market_trade_metrics_one_value_set
    check (
      (numeric_value is not null)::int
      + (json_value is not null)::int
      + (text_value is not null)::int
      = 1
    ),
  constraint market_trade_metrics_json_shape
    check (json_value is null or jsonb_typeof(json_value) in ('object','array','number','string','boolean')),
  -- MI1B.2 — defence-in-depth secret rejection for the metric JSON
  -- payload. A server bug must not be able to smuggle provider
  -- credentials into a metric row. Matches the MI-wide vocabulary.
  constraint market_trade_metrics_json_no_secrets
    check (
      json_value is null
      or (json_value::text) !~* '"[^"]*(api.?key|secret|token|cookie|authorization|password|credential|bearer)[^"]*"\s*:'
    )
);

-- One CURRENT metric row per (country, product, metric_key, window).
create unique index if not exists market_trade_metrics_current_uidx
  on public.market_trade_metrics
    (country_alpha2, mdf_product_id, metric_key, calculation_window)
  where superseded_at is null;
create index if not exists market_trade_metrics_history_idx
  on public.market_trade_metrics
    (country_alpha2, mdf_product_id, metric_key, calculated_at desc);

comment on table public.market_trade_metrics is
  'MI1B: rebuildable deterministic projections from market_trade_observations. One current row per (country, product, metric_key, window).';

-- ---------------------------------------------------------------------------
-- 6) public.market_product_scores — versioned Fit / Confidence / Recommendation
-- ---------------------------------------------------------------------------
create table if not exists public.market_product_scores (
  id                             uuid primary key default gen_random_uuid(),
  country_alpha2                 text not null,
  mdf_product_id                 text not null,
  diagnostic_fit_score           smallint,
  published_fit_score            smallint,
  data_confidence_score          smallint,
  recommendation_status          text not null,
  mapping_kind                   text not null,
  mapping_confidence             numeric(4,3) not null,
  fit_eligibility                text not null,
  is_trade_proxy                 boolean not null default false,
  market_fit_version             text not null,
  confidence_version             text not null,
  provider_selection_version     text not null,
  recommendation_reason          text,
  positive_reasons               jsonb not null default '[]'::jsonb,
  negative_reasons               jsonb not null default '[]'::jsonb,
  source_coverage                jsonb not null default '{}'::jsonb,
  calculated_at                  timestamptz not null,
  superseded_at                  timestamptz,
  created_at                     timestamptz not null default now(),
  constraint market_product_scores_country_alpha2
    check (country_alpha2 ~ '^[A-Z]{2}$'),
  constraint market_product_scores_product_not_blank
    check (btrim(mdf_product_id) <> ''),
  constraint market_product_scores_versions_not_blank
    check (
      btrim(market_fit_version) <> ''
      and btrim(confidence_version) <> ''
      and btrim(provider_selection_version) <> ''
    ),
  constraint market_product_scores_status_allowed
    check (recommendation_status in ('actionable','indicative','insufficient_evidence')),
  constraint market_product_scores_kind_allowed
    check (mapping_kind in ('exact','proxy','composite')),
  constraint market_product_scores_eligibility_allowed
    check (fit_eligibility in ('exact','proxy_allowed','insufficient_specificity')),
  constraint market_product_scores_confidence_range
    check (mapping_confidence > 0 and mapping_confidence <= 1),
  constraint market_product_scores_diagnostic_range
    check (diagnostic_fit_score is null or (diagnostic_fit_score between 0 and 100)),
  constraint market_product_scores_published_range
    check (published_fit_score is null or (published_fit_score between 0 and 100)),
  constraint market_product_scores_data_confidence_range
    check (data_confidence_score is null or (data_confidence_score between 0 and 100)),
  constraint market_product_scores_positive_reasons_array
    check (jsonb_typeof(positive_reasons) = 'array'),
  constraint market_product_scores_negative_reasons_array
    check (jsonb_typeof(negative_reasons) = 'array'),
  constraint market_product_scores_source_coverage_object
    check (jsonb_typeof(source_coverage) = 'object'),
  -- MI1B.1 — secret-shaped keys forbidden in score JSON payloads.
  constraint market_product_scores_source_coverage_no_secrets
    check (
      (source_coverage::text) !~* '"[^"]*(api.?key|secret|token|cookie|authorization|password|credential|bearer)[^"]*"\s*:'
    ),
  constraint market_product_scores_positive_reasons_no_secrets
    check (
      (positive_reasons::text) !~* '"[^"]*(api.?key|secret|token|cookie|authorization|password|credential|bearer)[^"]*"\s*:'
    ),
  constraint market_product_scores_negative_reasons_no_secrets
    check (
      (negative_reasons::text) !~* '"[^"]*(api.?key|secret|token|cookie|authorization|password|credential|bearer)[^"]*"\s*:'
    ),
  -- MI1B.1 — structural mapping invariants mirrored from product_trade_mappings.
  --   exact     : confidence >= 0.85, eligibility 'exact',       is_trade_proxy = false
  --   proxy     : confidence in (0.4, 0.85], eligibility 'proxy_allowed',
  --               is_trade_proxy = true, status <> 'actionable'
  --   composite : confidence <= 0.4, eligibility 'insufficient_specificity',
  --               published_fit_score IS NULL, status = 'insufficient_evidence'
  constraint market_product_scores_kind_matches_bands
    check (
      (mapping_kind = 'exact' and mapping_confidence >= 0.85
        and fit_eligibility = 'exact'
        and is_trade_proxy = false)
      or (mapping_kind = 'proxy' and mapping_confidence > 0.40 and mapping_confidence <= 0.85
        and fit_eligibility = 'proxy_allowed'
        and is_trade_proxy = true)
      or (mapping_kind = 'composite' and mapping_confidence <= 0.40
        and fit_eligibility = 'insufficient_specificity')
    ),
  -- BAND INVARIANTS enforced at the DB layer:
  --   * composite mapping MUST publish NO number AND status must be insufficient.
  --   * proxy mapping cannot be actionable AND must set is_trade_proxy.
  --   * actionable status requires a published number AND exact mapping.
  constraint market_product_scores_composite_no_publication
    check (
      mapping_kind <> 'composite'
      or (published_fit_score is null and recommendation_status = 'insufficient_evidence')
    ),
  constraint market_product_scores_proxy_not_actionable
    check (
      mapping_kind <> 'proxy'
      or (recommendation_status <> 'actionable' and is_trade_proxy = true)
    ),
  constraint market_product_scores_actionable_requires_publication
    check (
      recommendation_status <> 'actionable'
      or (published_fit_score is not null and mapping_kind = 'exact')
    )
);

-- One CURRENT score per (country, product); history preserved.
create unique index if not exists market_product_scores_current_uidx
  on public.market_product_scores (country_alpha2, mdf_product_id)
  where superseded_at is null;
create index if not exists market_product_scores_history_idx
  on public.market_product_scores (country_alpha2, mdf_product_id, calculated_at desc);

comment on table public.market_product_scores is
  'MI1B: versioned Market Fit / Confidence / Recommendation history. DB enforces composite/proxy/actionable publication invariants.';

-- ---------------------------------------------------------------------------
-- 7) public.market_product_score_components — explainable decomposition
-- ---------------------------------------------------------------------------
create table if not exists public.market_product_score_components (
  id                    uuid primary key default gen_random_uuid(),
  score_id              uuid not null references public.market_product_scores(id) on delete cascade,
  component_key         text not null,
  raw_metric_value      numeric(24,6),
  normalized_score      smallint,
  weight                smallint not null,
  supported             boolean not null,
  reason                text,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  constraint market_product_score_components_component_allowed
    check (component_key in (
      'demand_size',
      'demand_growth',
      'india_position',
      'competitive_opportunity',
      'price_attractiveness',
      'demand_stability'
    )),
  constraint market_product_score_components_normalized_range
    check (normalized_score is null or (normalized_score between 0 and 100)),
  constraint market_product_score_components_weight_range
    check (weight between 0 and 100),
  constraint market_product_score_components_metadata_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint market_product_score_components_metadata_no_secrets
    check (
      (metadata::text) !~* '"[^"]*(api.?key|secret|token|cookie|authorization|password|credential|bearer)[^"]*"\s*:'
    ),
  unique (score_id, component_key)
);

create index if not exists market_product_score_components_score_idx
  on public.market_product_score_components (score_id);

comment on table public.market_product_score_components is
  'MI1B: per-component score decomposition. One row per (score_id, component_key).';

-- ---------------------------------------------------------------------------
-- 8) public.market_analysis_events — workspace-scoped operator activity
-- ---------------------------------------------------------------------------
create table if not exists public.market_analysis_events (
  id                            uuid primary key default gen_random_uuid(),
  workspace_id                  uuid not null references public.workspaces(id) on delete cascade,
  user_id                       uuid,
  country_alpha2                text not null,
  mdf_product_id                text not null,
  provider_id                   text,
  outcome                       text not null,
  provider_calls_estimated      smallint,
  provider_calls_actual         smallint,
  used_cache                    boolean not null default false,
  score_id                      uuid references public.market_product_scores(id) on delete set null,
  created_at                    timestamptz not null default now(),
  constraint market_analysis_events_country_alpha2
    check (country_alpha2 ~ '^[A-Z]{2}$'),
  constraint market_analysis_events_product_not_blank
    check (btrim(mdf_product_id) <> ''),
  constraint market_analysis_events_outcome_allowed
    check (outcome in (
      'analyzed',
      'cache_reused',
      'no_provider',
      'quota_exhausted',
      'blocked',
      'provider_error',
      'invalid_request'
    )),
  constraint market_analysis_events_calls_estimated_nonneg
    check (provider_calls_estimated is null or provider_calls_estimated >= 0),
  constraint market_analysis_events_calls_actual_nonneg
    check (provider_calls_actual is null or provider_calls_actual >= 0)
);

create index if not exists market_analysis_events_workspace_idx
  on public.market_analysis_events (workspace_id, created_at desc);
create index if not exists market_analysis_events_country_product_idx
  on public.market_analysis_events (country_alpha2, mdf_product_id, created_at desc);

comment on table public.market_analysis_events is
  'MI1B: workspace-scoped operator activity trail. NOT market evidence.';

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------
-- Global/shared MI tables — SELECT-only to authenticated; no DML; anon locked out.
-- MI1B.1 — policy identifier is built as a bare, unqualified name
-- (`<table>_select`) so `format(... %I ...)` never quotes a
-- schema-qualified string. The table itself is referenced through
-- its fully-qualified `%s` form.
do $$
declare
  t text;
  qualified text;
  policy_name text;
begin
  for t in select unnest(array[
    'market_intelligence_sources',
    'product_trade_mappings',
    'market_provider_fetch_ledger',
    'market_trade_observations',
    'market_trade_metrics',
    'market_product_scores',
    'market_product_score_components'
  ]) loop
    qualified := format('public.%I', t);
    policy_name := t || '_select';
    execute format('alter table %s enable row level security;', qualified);
    execute format('drop policy if exists %I on %s;', policy_name, qualified);
    execute format(
      $p$create policy %I on %s for select to authenticated using (true);$p$,
      policy_name, qualified
    );
    execute format('revoke all on %s from anon, authenticated, public;', qualified);
    execute format('grant select on %s to authenticated;', qualified);
  end loop;
end $$;

-- Workspace-scoped operator activity uses the standard MDF macro.
select mdf.__apply_workspace_rls('public.market_analysis_events'::regclass);
revoke all on public.market_analysis_events from anon, authenticated, public;
grant select on public.market_analysis_events to authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers (ungranted; called only by SECURITY DEFINER RPCs below)
-- ---------------------------------------------------------------------------

-- Reject secret-shaped keys / cred-bearing URLs in caller-supplied jsonb.
create or replace function mdf.__market_reject_secrets(p jsonb)
returns void
language plpgsql
immutable
as $$
begin
  if p is null then return; end if;
  if (p::text) ~* '"[^"]*(api.?key|secret|token|cookie|authorization|password|credential|bearer)[^"]*"\s*:' then
    raise exception 'unsafe metadata: secret-shaped key';
  end if;
end;
$$;
revoke all on function mdf.__market_reject_secrets(jsonb) from public, anon, authenticated;

-- Internal write helper for metric rows. Not granted.
create or replace function mdf.__write_market_metric(
  p_country_alpha2 text,
  p_mdf_product_id text,
  p_metric_key text,
  p_numeric_value numeric,
  p_json_value jsonb,
  p_text_value text,
  p_unit text,
  p_calculation_window text,
  p_support_count integer,
  p_observation_watermark timestamptz,
  p_calculation_version text,
  p_calculated_at timestamptz
) returns uuid
language plpgsql
set search_path = public, mdf, pg_temp
as $$
declare
  v_current public.market_trade_metrics%rowtype;
  v_id uuid;
begin
  -- MI1B.2 — fail closed on missing calculation_version. Never
  -- silently stamp an obsolete algorithm version onto a fresh metric
  -- row. The MI1C server orchestrator MUST supply this explicitly.
  if nullif(btrim(p_calculation_version), '') is null then
    raise exception 'calculation_version is required (must be supplied by the MI server orchestrator)';
  end if;
  -- MI1B.2 — defence-in-depth secret rejection on the metric JSON.
  perform mdf.__market_reject_secrets(p_json_value);

  select * into v_current
  from public.market_trade_metrics
  where country_alpha2 = p_country_alpha2
    and mdf_product_id = p_mdf_product_id
    and metric_key = p_metric_key
    and calculation_window = p_calculation_window
    and superseded_at is null
  for update;

  -- MI1B.1 — observation_watermark participates in material identity.
  -- A metric whose visible value stayed the same but is now supported
  -- by fresher evidence MUST supersede, not silently keep stale
  -- provenance. calculated_at itself remains non-material.
  if v_current.id is not null
    and coalesce(v_current.numeric_value::text, '')          = coalesce(p_numeric_value::text, '')
    and coalesce(v_current.json_value::text, '')             = coalesce(p_json_value::text, '')
    and coalesce(v_current.text_value, '')                   = coalesce(p_text_value, '')
    and coalesce(v_current.unit, '')                         = coalesce(p_unit, '')
    and v_current.support_count                              = p_support_count
    and coalesce(v_current.calculation_version, '')          = coalesce(p_calculation_version, '')
    and coalesce(v_current.observation_watermark::text, '')  = coalesce(p_observation_watermark::text, '')
  then
    return v_current.id;
  end if;

  if v_current.id is not null then
    update public.market_trade_metrics
      set superseded_at = p_calculated_at
      where id = v_current.id;
  end if;

  insert into public.market_trade_metrics (
    country_alpha2, mdf_product_id, metric_key,
    numeric_value, json_value, text_value, unit,
    calculation_window, support_count, observation_watermark,
    calculation_version, calculated_at
  ) values (
    p_country_alpha2, p_mdf_product_id, p_metric_key,
    p_numeric_value, p_json_value, p_text_value, p_unit,
    p_calculation_window, p_support_count, p_observation_watermark,
    p_calculation_version, p_calculated_at
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function mdf.__write_market_metric(
  text, text, text, numeric, jsonb, text, text, text, integer, timestamptz, text, timestamptz
) from public, anon, authenticated;

-- Internal write helper for score + components. Not granted.
-- Publication invariants are enforced BOTH by table CHECKs and here for
-- fast, clear error messages.
create or replace function mdf.__write_market_score(
  p_country_alpha2 text,
  p_mdf_product_id text,
  p_mapping_kind text,
  p_mapping_confidence numeric,
  p_fit_eligibility text,
  p_diagnostic_fit_score integer,
  p_published_fit_score integer,
  p_data_confidence_score integer,
  p_recommendation_status text,
  p_is_trade_proxy boolean,
  p_market_fit_version text,
  p_confidence_version text,
  p_provider_selection_version text,
  p_recommendation_reason text,
  p_positive_reasons jsonb,
  p_negative_reasons jsonb,
  p_source_coverage jsonb,
  p_components jsonb,
  p_calculated_at timestamptz
) returns uuid
language plpgsql
set search_path = public, mdf, pg_temp
as $$
declare
  v_current public.market_product_scores%rowtype;
  v_id uuid;
begin
  -- MI1B.2 — fail closed on missing algorithm/version fields. The MI1C
  -- server orchestrator MUST supply all three explicitly so a future
  -- domain version bump can never be silently stamped as the old one.
  if nullif(btrim(p_market_fit_version), '') is null then
    raise exception 'market_fit_version is required';
  end if;
  if nullif(btrim(p_confidence_version), '') is null then
    raise exception 'confidence_version is required';
  end if;
  if nullif(btrim(p_provider_selection_version), '') is null then
    raise exception 'provider_selection_version is required';
  end if;
  -- MI1B.2 — defence-in-depth secret rejection on caller-supplied JSON.
  perform mdf.__market_reject_secrets(p_positive_reasons);
  perform mdf.__market_reject_secrets(p_negative_reasons);
  perform mdf.__market_reject_secrets(p_source_coverage);
  perform mdf.__market_reject_secrets(p_components);

  if p_mapping_kind = 'composite'
    and (p_published_fit_score is not null or p_recommendation_status <> 'insufficient_evidence')
  then
    raise exception 'composite mapping must not publish a numeric score';
  end if;
  if p_mapping_kind = 'proxy'
    and (p_recommendation_status = 'actionable' or p_is_trade_proxy = false)
  then
    raise exception 'proxy mapping cannot be actionable and must set is_trade_proxy';
  end if;
  if p_recommendation_status = 'actionable'
    and (p_published_fit_score is null or p_mapping_kind <> 'exact')
  then
    raise exception 'actionable recommendation requires a published score and exact mapping';
  end if;
  if jsonb_typeof(p_components) <> 'array' then
    raise exception 'components must be a jsonb array';
  end if;

  select * into v_current
  from public.market_product_scores
  where country_alpha2 = p_country_alpha2
    and mdf_product_id = p_mdf_product_id
    and superseded_at is null
  for update;

  -- MI1B.1 — idempotent reuse of the current score row when the
  -- material result is unchanged (mirrors BI2 assessment behaviour).
  -- Component set is compared as a canonical sorted jsonb so key
  -- order does not matter.
  if v_current.id is not null
    and v_current.mapping_kind                              = p_mapping_kind
    and v_current.mapping_confidence                        = p_mapping_confidence
    and v_current.fit_eligibility                           = p_fit_eligibility
    and coalesce(v_current.diagnostic_fit_score, -1)        = coalesce(p_diagnostic_fit_score, -1)
    and coalesce(v_current.published_fit_score, -1)         = coalesce(p_published_fit_score, -1)
    and coalesce(v_current.data_confidence_score, -1)       = coalesce(p_data_confidence_score, -1)
    and v_current.recommendation_status                     = p_recommendation_status
    and v_current.is_trade_proxy                            = coalesce(p_is_trade_proxy, false)
    and v_current.market_fit_version                        = p_market_fit_version
    and v_current.confidence_version                        = p_confidence_version
    and v_current.provider_selection_version                = p_provider_selection_version
    and coalesce(v_current.recommendation_reason, '')       = coalesce(p_recommendation_reason, '')
    and v_current.positive_reasons                          = coalesce(p_positive_reasons, '[]'::jsonb)
    and v_current.negative_reasons                          = coalesce(p_negative_reasons, '[]'::jsonb)
    and v_current.source_coverage                           = coalesce(p_source_coverage, '{}'::jsonb)
    and (
      select coalesce(
        jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'component_key',    c.component_key,
          'raw_metric_value', c.raw_metric_value::text,
          'normalized_score', c.normalized_score,
          'weight',           c.weight,
          'supported',        c.supported,
          'reason',           c.reason,
          'metadata',         c.metadata
        )) order by c.component_key),
        '[]'::jsonb
      )
      from public.market_product_score_components c
      where c.score_id = v_current.id
    ) = (
      select coalesce(
        jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'component_key',    e->>'component_key',
          'raw_metric_value', e->>'raw_metric_value',
          'normalized_score', nullif(e->>'normalized_score', '')::integer,
          'weight',           (e->>'weight')::integer,
          'supported',        coalesce((e->>'supported')::boolean, false),
          'reason',           e->>'reason',
          'metadata',         coalesce(e->'metadata', '{}'::jsonb)
        )) order by e->>'component_key'),
        '[]'::jsonb
      )
      from jsonb_array_elements(p_components) e
    )
  then
    return v_current.id;
  end if;

  if v_current.id is not null then
    update public.market_product_scores
      set superseded_at = p_calculated_at
      where id = v_current.id;
  end if;

  insert into public.market_product_scores (
    country_alpha2, mdf_product_id,
    diagnostic_fit_score, published_fit_score, data_confidence_score,
    recommendation_status, mapping_kind, mapping_confidence, fit_eligibility,
    is_trade_proxy,
    market_fit_version, confidence_version, provider_selection_version,
    recommendation_reason, positive_reasons, negative_reasons, source_coverage,
    calculated_at
  ) values (
    p_country_alpha2, p_mdf_product_id,
    p_diagnostic_fit_score, p_published_fit_score, p_data_confidence_score,
    p_recommendation_status, p_mapping_kind, p_mapping_confidence, p_fit_eligibility,
    coalesce(p_is_trade_proxy, false),
    p_market_fit_version, p_confidence_version, p_provider_selection_version,
    p_recommendation_reason,
    coalesce(p_positive_reasons, '[]'::jsonb),
    coalesce(p_negative_reasons, '[]'::jsonb),
    coalesce(p_source_coverage, '{}'::jsonb),
    p_calculated_at
  )
  returning id into v_id;

  insert into public.market_product_score_components (
    score_id, component_key, raw_metric_value, normalized_score, weight,
    supported, reason, metadata
  )
  select
    v_id,
    e->>'component_key',
    nullif(e->>'raw_metric_value', '')::numeric,
    nullif(e->>'normalized_score', '')::integer,
    (e->>'weight')::integer,
    coalesce((e->>'supported')::boolean, false),
    e->>'reason',
    coalesce(e->'metadata', '{}'::jsonb)
  from jsonb_array_elements(p_components) e;

  return v_id;
end;
$$;
revoke all on function mdf.__write_market_score(
  text, text, text, numeric, text,
  integer, integer, integer, text, boolean,
  text, text, text, text, jsonb, jsonb, jsonb, jsonb, timestamptz
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public narrow SECURITY DEFINER RPCs
-- ---------------------------------------------------------------------------

-- 1) ingest_market_intelligence_source(p_input jsonb) — idempotent source register.
-- MI1B.1: global-write RPC. No workspace context required; execution
-- is gated at grant time (service_role only). Called by the server-only
-- MI writer that MI1C will introduce.
create or replace function public.ingest_market_intelligence_source(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, mdf, pg_temp
as $$
declare
  v_existing public.market_intelligence_sources%rowtype;
  v_id uuid;
  v_material jsonb;
begin
  if jsonb_typeof(p_input) <> 'object'
    or nullif(btrim(p_input->>'provider_id'), '') is null
    or nullif(btrim(p_input->>'dataset_id'), '') is null
    or nullif(btrim(p_input->>'source_tier'), '') is null
    or nullif(btrim(p_input->>'dataset_source'), '') is null
    or nullif(btrim(p_input->>'distribution_service'), '') is null
    or p_input->>'retrieved_at' is null
  then
    raise exception 'invalid market source input';
  end if;
  perform mdf.__market_reject_secrets(p_input->'metadata');

  -- Idempotent identity: provider + dataset.
  select * into v_existing
  from public.market_intelligence_sources
  where provider_id = btrim(p_input->>'provider_id')
    and dataset_id = btrim(p_input->>'dataset_id');

  v_material := jsonb_strip_nulls(jsonb_build_object(
    'source_tier',                     p_input->>'source_tier',
    'dataset_source',                  p_input->>'dataset_source',
    'dataset_license_name',            p_input->>'dataset_license_name',
    'dataset_license_url',             p_input->>'dataset_license_url',
    'dataset_attribution_requirement', p_input->>'dataset_attribution_requirement',
    'distribution_service',            p_input->>'distribution_service',
    'distribution_service_terms_url',  p_input->>'distribution_service_terms_url',
    'distribution_catalog_license_name', p_input->>'distribution_catalog_license_name',
    'service_terms_verified',          coalesce((p_input->>'service_terms_verified')::boolean, false),
    'storage_allowed',                 (p_input->>'storage_allowed')::boolean,
    'redistribution_allowed',          (p_input->>'redistribution_allowed')::boolean,
    'licence_verified_at',             (p_input->>'licence_verified_at')::timestamptz,
    'licence_verification_note',       p_input->>'licence_verification_note',
    'source_url',                      p_input->>'source_url',
    'safe_reference',                  p_input->>'safe_reference'
  ));

  if v_existing.id is not null then
    if jsonb_strip_nulls(jsonb_build_object(
        'source_tier',                     v_existing.source_tier,
        'dataset_source',                  v_existing.dataset_source,
        'dataset_license_name',            v_existing.dataset_license_name,
        'dataset_license_url',             v_existing.dataset_license_url,
        'dataset_attribution_requirement', v_existing.dataset_attribution_requirement,
        'distribution_service',            v_existing.distribution_service,
        'distribution_service_terms_url',  v_existing.distribution_service_terms_url,
        'distribution_catalog_license_name', v_existing.distribution_catalog_license_name,
        'service_terms_verified',          v_existing.service_terms_verified,
        'storage_allowed',                 v_existing.storage_allowed,
        'redistribution_allowed',          v_existing.redistribution_allowed,
        'licence_verified_at',             v_existing.licence_verified_at,
        'licence_verification_note',       v_existing.licence_verification_note,
        'source_url',                      v_existing.source_url,
        'safe_reference',                  v_existing.safe_reference
      )) = v_material
    then
      return jsonb_build_object('outcome', 'existing', 'id', v_existing.id);
    end if;
    return jsonb_build_object('outcome', 'conflict', 'id', v_existing.id, 'reason', 'material_mismatch');
  end if;

  insert into public.market_intelligence_sources (
    provider_id, dataset_id, source_tier,
    dataset_source, dataset_license_name, dataset_license_url, dataset_attribution_requirement,
    distribution_service, distribution_service_terms_url, distribution_catalog_license_name,
    service_terms_verified, storage_allowed, redistribution_allowed,
    licence_verified_at, licence_verification_note,
    source_url, safe_reference, retrieved_at, metadata
  ) values (
    btrim(p_input->>'provider_id'), btrim(p_input->>'dataset_id'),
    p_input->>'source_tier',
    p_input->>'dataset_source',
    p_input->>'dataset_license_name',
    p_input->>'dataset_license_url',
    p_input->>'dataset_attribution_requirement',
    p_input->>'distribution_service',
    p_input->>'distribution_service_terms_url',
    p_input->>'distribution_catalog_license_name',
    coalesce((p_input->>'service_terms_verified')::boolean, false),
    (p_input->>'storage_allowed')::boolean,
    (p_input->>'redistribution_allowed')::boolean,
    (p_input->>'licence_verified_at')::timestamptz,
    p_input->>'licence_verification_note',
    p_input->>'source_url', p_input->>'safe_reference',
    (p_input->>'retrieved_at')::timestamptz,
    coalesce(p_input->'metadata', '{}'::jsonb)
  ) returning id into v_id;

  return jsonb_build_object('outcome', 'created', 'id', v_id);
end;
$$;

-- 2) ingest_market_trade_observation(p_source_id uuid, p_input jsonb)
create or replace function public.ingest_market_trade_observation(
  p_source_id uuid,
  p_input jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, mdf, pg_temp
as $$
declare
  v_source public.market_intelligence_sources%rowtype;
  v_existing public.market_trade_observations%rowtype;
  v_id uuid;
  v_material jsonb;
  v_partner_key text;
begin
  select * into v_source from public.market_intelligence_sources where id = p_source_id;
  if v_source.id is null then raise exception 'source not found'; end if;
  -- MI1B.1: storage-rights defense-in-depth. Even under service_role
  -- execution, a trade observation may not persist unless its source
  -- carries an explicit, verified storage right. Unverified/planning
  -- sources may exist but never produce persisted observations.
  if coalesce(v_source.service_terms_verified, false) = false
    or coalesce(v_source.storage_allowed, false) = false
    or v_source.licence_verified_at is null
  then
    raise exception 'storage rights not verified for source %', p_source_id
      using hint = 'run verify_market_intelligence_source with service_terms_verified=true, storage_allowed=true, and a licence_verified_at timestamp before ingesting observations';
  end if;
  if jsonb_typeof(p_input) <> 'object' or p_input->>'retrieved_at' is null then
    raise exception 'invalid observation input';
  end if;
  perform mdf.__market_reject_secrets(p_input->'metadata');

  v_partner_key := coalesce(p_input->>'partner_country', '__WORLD__');

  perform pg_advisory_xact_lock(hashtextextended(
    v_source.provider_id || ':' || v_source.dataset_id || ':' ||
    (p_input->>'reporter_country') || ':' || v_partner_key || ':' ||
    (p_input->>'trade_flow') || ':' || (p_input->>'hs_revision') || ':' ||
    (p_input->>'hs_code') || ':' || (p_input->>'frequency') || ':' || (p_input->>'period'),
    0
  ));

  select * into v_existing
  from public.market_trade_observations
  where provider_id = v_source.provider_id
    and dataset_id = v_source.dataset_id
    and reporter_country = p_input->>'reporter_country'
    and partner_key = v_partner_key
    and trade_flow = p_input->>'trade_flow'
    and hs_revision = p_input->>'hs_revision'
    and hs_code = p_input->>'hs_code'
    and frequency = p_input->>'frequency'
    and period = p_input->>'period';

  v_material := jsonb_strip_nulls(jsonb_build_object(
    'trade_value_usd', (p_input->>'trade_value_usd')::numeric,
    'quantity',        (p_input->>'quantity')::numeric,
    'quantity_unit',   p_input->>'quantity_unit',
    'net_weight_kg',   (p_input->>'net_weight_kg')::numeric,
    'source_period',   p_input->>'source_period',
    'source_url',      p_input->>'source_url',
    'safe_source_ref', p_input->>'safe_source_ref'
  ));

  if v_existing.id is not null then
    if jsonb_strip_nulls(jsonb_build_object(
        'trade_value_usd', v_existing.trade_value_usd,
        'quantity',        v_existing.quantity,
        'quantity_unit',   v_existing.quantity_unit,
        'net_weight_kg',   v_existing.net_weight_kg,
        'source_period',   v_existing.source_period,
        'source_url',      v_existing.source_url,
        'safe_source_ref', v_existing.safe_source_ref
      )) = v_material
    then
      return jsonb_build_object('outcome', 'existing', 'id', v_existing.id);
    end if;
    return jsonb_build_object('outcome', 'conflict', 'id', v_existing.id, 'reason', 'material_mismatch');
  end if;

  insert into public.market_trade_observations (
    source_id, provider_id, dataset_id,
    reporter_country, partner_country,
    trade_flow, hs_revision, hs_code, frequency, period,
    trade_value_usd, quantity, quantity_unit, net_weight_kg,
    source_period, retrieved_at, source_url, safe_source_ref, metadata
  ) values (
    p_source_id, v_source.provider_id, v_source.dataset_id,
    p_input->>'reporter_country', p_input->>'partner_country',
    p_input->>'trade_flow', p_input->>'hs_revision', p_input->>'hs_code',
    p_input->>'frequency', p_input->>'period',
    (p_input->>'trade_value_usd')::numeric,
    (p_input->>'quantity')::numeric,
    p_input->>'quantity_unit',
    (p_input->>'net_weight_kg')::numeric,
    p_input->>'source_period',
    (p_input->>'retrieved_at')::timestamptz,
    p_input->>'source_url', p_input->>'safe_source_ref',
    coalesce(p_input->'metadata', '{}'::jsonb)
  ) returning id into v_id;

  return jsonb_build_object('outcome', 'created', 'id', v_id);
end;
$$;

-- 3) record_market_fetch_result(p_input jsonb) — append-only ledger writer.
create or replace function public.record_market_fetch_result(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, mdf, pg_temp
as $$
declare
  v_id uuid;
begin
  if jsonb_typeof(p_input) <> 'object'
    or nullif(btrim(p_input->>'provider_id'), '') is null
    or nullif(btrim(p_input->>'dataset_id'), '') is null
    or nullif(btrim(p_input->>'query_fingerprint'), '') is null
    or nullif(btrim(p_input->>'provider_selection_version'), '') is null
    or p_input->>'fetched_at' is null
    or p_input->>'fresh_until' is null
    or p_input->>'outcome' is null
  then
    raise exception 'invalid fetch-ledger input';
  end if;
  perform mdf.__market_reject_secrets(p_input->'safe_metadata');

  insert into public.market_provider_fetch_ledger (
    provider_id, dataset_id, query_fingerprint,
    reporter_country, partner_country, trade_flow,
    hs_revision, hs_codes, frequency,
    coverage_start, coverage_end, provider_selection_version,
    fetched_at, fresh_until, outcome, rows_received, safe_metadata
  ) values (
    btrim(p_input->>'provider_id'),
    btrim(p_input->>'dataset_id'),
    btrim(p_input->>'query_fingerprint'),
    p_input->>'reporter_country',
    p_input->>'partner_country',
    coalesce(p_input->>'trade_flow', 'import'),
    p_input->>'hs_revision',
    (
      select coalesce(array_agg(x order by x), array[]::text[])
      from jsonb_array_elements_text(p_input->'hs_codes') x
    ),
    p_input->>'frequency',
    p_input->>'coverage_start',
    p_input->>'coverage_end',
    p_input->>'provider_selection_version',
    (p_input->>'fetched_at')::timestamptz,
    (p_input->>'fresh_until')::timestamptz,
    p_input->>'outcome',
    coalesce((p_input->>'rows_received')::integer, 0),
    coalesce(p_input->'safe_metadata', '{}'::jsonb)
  ) returning id into v_id;

  return jsonb_build_object('outcome', 'recorded', 'id', v_id);
end;
$$;

-- 3b) verify_market_intelligence_source(p_source_id uuid, p_verification jsonb)
--     MI1B.1 — narrow rights-only updater. Splits legal/licence
--     verification from data ingestion so a source may exist first
--     (planning), then get storage rights later without triggering a
--     material-mismatch conflict. Only these five fields may change:
--     service_terms_verified, storage_allowed, redistribution_allowed,
--     licence_verified_at, licence_verification_note. Everything else
--     stays immutable. Not a generic update RPC.
create or replace function public.verify_market_intelligence_source(
  p_source_id uuid,
  p_verification jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, mdf, pg_temp
as $$
declare
  v_source public.market_intelligence_sources%rowtype;
begin
  select * into v_source from public.market_intelligence_sources where id = p_source_id;
  if v_source.id is null then raise exception 'source not found'; end if;
  if jsonb_typeof(p_verification) <> 'object' then
    raise exception 'invalid verification input';
  end if;

  update public.market_intelligence_sources set
    service_terms_verified    = coalesce(
      (p_verification->>'service_terms_verified')::boolean,
      service_terms_verified
    ),
    storage_allowed           = coalesce(
      (p_verification->>'storage_allowed')::boolean,
      storage_allowed
    ),
    redistribution_allowed    = coalesce(
      (p_verification->>'redistribution_allowed')::boolean,
      redistribution_allowed
    ),
    licence_verified_at       = coalesce(
      (p_verification->>'licence_verified_at')::timestamptz,
      licence_verified_at
    ),
    licence_verification_note = coalesce(
      p_verification->>'licence_verification_note',
      licence_verification_note
    )
  where id = p_source_id;

  return jsonb_build_object('outcome', 'verified', 'id', p_source_id);
end;
$$;

-- 4) refresh_market_intelligence(p_country text, p_product_id text, p_input jsonb)
--    Accepts the pre-computed score bundle from the TS domain and writes
--    both metric rows and the score+components through the internal
--    helpers. TS remains the ONE scoring authority; this RPC enforces
--    the publication invariants at the SQL layer.
create or replace function public.refresh_market_intelligence(
  p_country_alpha2 text,
  p_mdf_product_id text,
  p_input jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, mdf, pg_temp
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_score jsonb;
  v_metrics jsonb;
  v_score_id uuid;
  v_metric jsonb;
begin
  if p_country_alpha2 !~ '^[A-Z]{2}$' then raise exception 'reporter must be ISO alpha-2'; end if;
  if nullif(btrim(p_mdf_product_id), '') is null then raise exception 'product required'; end if;
  if jsonb_typeof(p_input) <> 'object' then raise exception 'invalid refresh input'; end if;

  -- MI1B.1 — GLOBAL advisory lock. Market rows are shared across
  -- every workspace; the lock key MUST NOT include workspace_id or
  -- two workspaces could race the same (country, product) rows.
  perform pg_advisory_xact_lock(
    hashtextextended('mi-refresh:' || p_country_alpha2 || ':' || p_mdf_product_id, 0)
  );

  v_metrics := coalesce(p_input->'metrics', '[]'::jsonb);
  if jsonb_typeof(v_metrics) <> 'array' then raise exception 'metrics must be a jsonb array'; end if;
  for v_metric in select * from jsonb_array_elements(v_metrics)
  loop
    -- MI1B.2 — calculation_window and calculation_version are
    -- REQUIRED. Server orchestrator supplies them explicitly; the
    -- helper below fails closed if either is blank.
    perform mdf.__write_market_metric(
      p_country_alpha2,
      p_mdf_product_id,
      v_metric->>'metric_key',
      nullif(v_metric->>'numeric_value', '')::numeric,
      v_metric->'json_value',
      v_metric->>'text_value',
      v_metric->>'unit',
      v_metric->>'calculation_window',
      coalesce((v_metric->>'support_count')::integer, 0),
      (v_metric->>'observation_watermark')::timestamptz,
      v_metric->>'calculation_version',
      v_now
    );
  end loop;

  v_score := p_input->'score';
  if v_score is not null and jsonb_typeof(v_score) = 'object' then
    -- MI1B.2 — market_fit_version, confidence_version, and
    -- provider_selection_version are REQUIRED; server orchestrator
    -- supplies each explicitly. The helper raises on any blank
    -- version so a stale value can never be silently stamped.
    v_score_id := mdf.__write_market_score(
      p_country_alpha2,
      p_mdf_product_id,
      v_score->>'mapping_kind',
      (v_score->>'mapping_confidence')::numeric,
      v_score->>'fit_eligibility',
      nullif(v_score->>'diagnostic_fit_score', '')::integer,
      nullif(v_score->>'published_fit_score', '')::integer,
      nullif(v_score->>'data_confidence_score', '')::integer,
      v_score->>'recommendation_status',
      coalesce((v_score->>'is_trade_proxy')::boolean, false),
      v_score->>'market_fit_version',
      v_score->>'confidence_version',
      v_score->>'provider_selection_version',
      v_score->>'recommendation_reason',
      coalesce(v_score->'positive_reasons', '[]'::jsonb),
      coalesce(v_score->'negative_reasons', '[]'::jsonb),
      coalesce(v_score->'source_coverage', '{}'::jsonb),
      coalesce(v_score->'components', '[]'::jsonb),
      v_now
    );
  end if;

  return jsonb_build_object(
    'outcome', 'refreshed',
    'country_alpha2', p_country_alpha2,
    'mdf_product_id', p_mdf_product_id,
    'score_id', v_score_id
  );
end;
$$;

-- MI1B.1 — trust boundary. Every global mutation RPC is executable
-- ONLY by `service_role`. The Next.js server layer holds the
-- service-role key; browsers never do. `public`, `anon`, and
-- `authenticated` are hard-revoked so a compromised browser session
-- cannot forge global market evidence through PostgREST.
revoke all on function public.ingest_market_intelligence_source(jsonb) from public, anon, authenticated;
revoke all on function public.verify_market_intelligence_source(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ingest_market_trade_observation(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.record_market_fetch_result(jsonb) from public, anon, authenticated;
revoke all on function public.refresh_market_intelligence(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_market_intelligence_source(jsonb) to service_role;
grant execute on function public.verify_market_intelligence_source(uuid, jsonb) to service_role;
grant execute on function public.ingest_market_trade_observation(uuid, jsonb) to service_role;
grant execute on function public.record_market_fetch_result(jsonb) to service_role;
grant execute on function public.refresh_market_intelligence(text, text, jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
