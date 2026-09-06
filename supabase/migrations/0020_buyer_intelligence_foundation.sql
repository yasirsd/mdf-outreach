-- MDF Outreach — BI1: Buyer Intelligence provenance foundation.
-- Additive only. Does NOT apply itself. Operator applies manually after review.
--
-- Creates six Candidate-owned, workspace-scoped intelligence concepts.
-- Does NOT mutate or backfill buyer_candidates, buyers, conversions, campaigns,
-- or any historical table. Does NOT perform network/provider work.

-- ---------------------------------------------------------------------------
-- Sources — WHERE intelligence came from. No credentials or raw payloads.
-- ---------------------------------------------------------------------------
create table if not exists public.buyer_intelligence_sources (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  candidate_id        uuid not null,
  provider_id         text not null,
  source_type         text not null,
  source_key          text not null,
  safe_source_ref     text,
  source_url          text,
  access_class        text not null,
  cost_class          text not null default 'free',
  observed_at         timestamptz,
  retrieved_at        timestamptz not null,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  unique (id, candidate_id, workspace_id),
  unique (workspace_id, candidate_id, provider_id, source_key),
  foreign key (candidate_id, workspace_id)
    references public.buyer_candidates (id, workspace_id)
    on delete restrict,
  constraint buyer_intelligence_sources_provider_not_blank
    check (btrim(provider_id) <> ''),
  constraint buyer_intelligence_sources_type_not_blank
    check (btrim(source_type) <> ''),
  constraint buyer_intelligence_sources_key_not_blank
    check (btrim(source_key) <> ''),
  constraint buyer_intelligence_sources_ref_not_blank
    check (safe_source_ref is null or btrim(safe_source_ref) <> ''),
  constraint buyer_intelligence_sources_url_not_blank
    check (source_url is null or btrim(source_url) <> ''),
  constraint buyer_intelligence_sources_access_allowed
    check (access_class in ('public', 'authorized_api', 'manual', 'internal')),
  constraint buyer_intelligence_sources_cost_allowed
    check (cost_class in ('free', 'paid', 'unknown')),
  constraint buyer_intelligence_sources_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

-- ---------------------------------------------------------------------------
-- Claims — normalized non-trade facts. Raw and normalized values coexist.
-- The triple source FK prevents same-workspace cross-Candidate provenance.
-- ---------------------------------------------------------------------------
create table if not exists public.buyer_intelligence_claims (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  candidate_id        uuid not null,
  source_id           uuid not null,
  source_record_ref   text not null,
  claim_type          text not null,
  evidence_type       text not null,
  evidence_level      smallint not null,
  confidence          text not null default 'unknown',
  raw_value           jsonb not null,
  normalized_value    jsonb,
  observed_at         timestamptz,
  retrieved_at        timestamptz not null,
  normalization_version text,
  created_at          timestamptz not null default now(),
  unique (id, candidate_id, workspace_id),
  unique (source_id, source_record_ref, claim_type),
  foreign key (candidate_id, workspace_id)
    references public.buyer_candidates (id, workspace_id)
    on delete restrict,
  foreign key (source_id, candidate_id, workspace_id)
    references public.buyer_intelligence_sources (id, candidate_id, workspace_id)
    on delete restrict,
  constraint buyer_intelligence_claims_record_ref_not_blank
    check (btrim(source_record_ref) <> ''),
  constraint buyer_intelligence_claims_type_allowed
    check (claim_type in (
      'company_is_importer',
      'company_is_distributor',
      'imports_product',
      'observed_origin_country',
      'observed_destination_country',
      'supplier_relationship',
      'india_sourcing',
      'website_business_description',
      'directory_category'
    )),
  constraint buyer_intelligence_claims_evidence_type_allowed
    check (evidence_type in (
      'verified_trade_evidence', 'business_evidence', 'discovery_signal'
    )),
  constraint buyer_intelligence_claims_evidence_level_allowed
    check (evidence_level between 1 and 3),
  constraint buyer_intelligence_claims_evidence_mapping
    check (
      (evidence_level = 1 and evidence_type = 'verified_trade_evidence') or
      (evidence_level = 2 and evidence_type = 'business_evidence') or
      (evidence_level = 3 and evidence_type = 'discovery_signal')
    ),
  constraint buyer_intelligence_claims_confidence_allowed
    check (confidence in ('verified', 'high', 'medium', 'low', 'unknown')),
  constraint buyer_intelligence_claims_normalization_version_not_blank
    check (normalization_version is null or btrim(normalization_version) <> '')
);

-- ---------------------------------------------------------------------------
-- Trade observations — what one company-specific source actually supports.
-- Missing source fields remain NULL; no candidate-country fallback exists.
-- ---------------------------------------------------------------------------
create table if not exists public.buyer_trade_observations (
  id                          uuid primary key default gen_random_uuid(),
  workspace_id                uuid not null references public.workspaces(id) on delete cascade,
  candidate_id                uuid not null,
  source_id                   uuid not null,
  source_record_ref           text not null,
  granularity                 text not null,
  evidence_type               text not null,
  evidence_level              smallint not null,
  confidence                  text not null default 'unknown',
  trade_date                  date,
  period_start                date,
  period_end                  date,
  origin_country_code         text,
  destination_country_code    text,
  supplier_name_raw           text,
  supplier_name_normalized    text,
  supplier_country_code       text,
  product_description_raw     text,
  normalized_product_category text,
  mdf_product_id              text,
  hs_code_raw                 text,
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
  normalization_version       text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (id, candidate_id, workspace_id),
  unique (source_id, source_record_ref),
  foreign key (candidate_id, workspace_id)
    references public.buyer_candidates (id, workspace_id)
    on delete restrict,
  foreign key (source_id, candidate_id, workspace_id)
    references public.buyer_intelligence_sources (id, candidate_id, workspace_id)
    on delete restrict,
  constraint buyer_trade_observations_record_ref_not_blank
    check (btrim(source_record_ref) <> ''),
  constraint buyer_trade_observations_granularity_allowed
    check (granularity in (
      'shipment', 'transaction', 'aggregate_period',
      'buyer_supplier_relation', 'company_claim', 'directory_signal'
    )),
  constraint buyer_trade_observations_evidence_type_allowed
    check (evidence_type in (
      'verified_trade_evidence', 'business_evidence', 'discovery_signal'
    )),
  constraint buyer_trade_observations_evidence_level_allowed
    check (evidence_level between 1 and 3),
  constraint buyer_trade_observations_evidence_mapping
    check (
      (evidence_level = 1 and evidence_type = 'verified_trade_evidence') or
      (evidence_level = 2 and evidence_type = 'business_evidence') or
      (evidence_level = 3 and evidence_type = 'discovery_signal')
    ),
  constraint buyer_trade_observations_granularity_level
    check (
      (granularity not in ('shipment', 'transaction') or evidence_level = 1) and
      (granularity <> 'company_claim' or evidence_level = 2) and
      (granularity <> 'directory_signal' or evidence_level = 3)
    ),
  constraint buyer_trade_observations_confidence_allowed
    check (confidence in ('verified', 'high', 'medium', 'low', 'unknown')),
  constraint buyer_trade_observations_period_order
    check (period_start is null or period_end is null or period_end >= period_start),
  constraint buyer_trade_observations_nonnegative_values
    check (
      (quantity is null or quantity >= 0) and
      (gross_weight_kg is null or gross_weight_kg >= 0) and
      (net_weight_kg is null or net_weight_kg >= 0) and
      (trade_value is null or trade_value >= 0) and
      (reported_record_count is null or reported_record_count >= 0)
    ),
  constraint buyer_trade_observations_country_codes
    check (
      (origin_country_code is null or origin_country_code ~ '^[A-Z]{2}$') and
      (destination_country_code is null or destination_country_code ~ '^[A-Z]{2}$') and
      (supplier_country_code is null or supplier_country_code ~ '^[A-Z]{2}$')
    ),
  constraint buyer_trade_observations_currency_code
    check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  constraint buyer_trade_observations_normalization_version_not_blank
    check (normalization_version is null or btrim(normalization_version) <> '')
);

-- ---------------------------------------------------------------------------
-- Metrics — normalized deterministic/cache rows, never primary evidence.
-- Exactly one typed value is present. `calculation_window` is a stable scope
-- key such as `lifetime` or `2025-09-03/2026-09-02`.
-- ---------------------------------------------------------------------------
create table if not exists public.buyer_trade_metrics (
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
    references public.buyer_candidates (id, workspace_id)
    on delete restrict,
  constraint buyer_trade_metrics_key_allowed
    check (metric_key in (
      'last_observed_trade',
      'trade_observation_count',
      'shipment_count',
      'activity_last_12_months',
      'import_frequency',
      'india_observation_count',
      'india_shipment_count',
      'india_observation_share',
      'last_observed_india_trade',
      'origin_country_distribution',
      'supplier_count',
      'supplier_ranking',
      'supplier_concentration',
      'trade_momentum'
    )),
  constraint buyer_trade_metrics_value_type_allowed
    check (value_type in ('number', 'text', 'json')),
  constraint buyer_trade_metrics_typed_value
    check (
      num_nonnulls(numeric_value, text_value, structured_value) = 1 and
      ((value_type = 'number' and numeric_value is not null) or
       (value_type = 'text' and text_value is not null) or
       (value_type = 'json' and structured_value is not null))
    ),
  constraint buyer_trade_metrics_unit_allowed
    check (unit in ('count', 'ratio', 'date', 'months', 'index', 'none')),
  constraint buyer_trade_metrics_window_not_blank
    check (btrim(calculation_window) <> ''),
  constraint buyer_trade_metrics_window_order
    check (window_start is null or window_end is null or window_end >= window_start),
  constraint buyer_trade_metrics_support_nonnegative
    check (supporting_observation_count >= 0),
  constraint buyer_trade_metrics_ratio_range
    check (unit <> 'ratio' or (numeric_value is not null and numeric_value between 0 and 1)),
  constraint buyer_trade_metrics_version_not_blank
    check (btrim(calculation_version) <> '')
);

-- ---------------------------------------------------------------------------
-- Assessments — versioned, deterministic explanations. No opaque AI score.
-- ---------------------------------------------------------------------------
create table if not exists public.buyer_intelligence_assessments (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  candidate_id        uuid not null,
  assessment_type     text not null,
  classification      text not null,
  summary             text not null,
  components          jsonb not null default '[]'::jsonb,
  calculated_at       timestamptz not null,
  calculation_version text not null,
  superseded_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, candidate_id, workspace_id),
  foreign key (candidate_id, workspace_id)
    references public.buyer_candidates (id, workspace_id)
    on delete restrict,
  constraint buyer_intelligence_assessments_type_allowed
    check (assessment_type in (
      'buyer_legitimacy', 'buyer_potential', 'contact_access', 'outreach_readiness'
    )),
  constraint buyer_intelligence_assessments_classification_allowed
    check (
      (assessment_type = 'buyer_legitimacy' and classification in (
        'verified', 'strong_evidence', 'moderate_evidence',
        'weak_signal', 'no_evidence_found'
      )) or
      (assessment_type = 'buyer_potential' and classification in (
        'high', 'medium', 'low', 'insufficient_evidence'
      )) or
      (assessment_type = 'contact_access' and classification in (
        'company_only', 'public_route', 'named_contact',
        'direct_contact', 'credit_enriched'
      )) or
      (assessment_type = 'outreach_readiness' and classification in (
        'needs_review', 'needs_contact', 'ready_for_conversion',
        'ready_for_outreach', 'suppressed', 'not_eligible'
      ))
    ),
  constraint buyer_intelligence_assessments_summary_not_blank
    check (btrim(summary) <> ''),
  constraint buyer_intelligence_assessments_components_array
    check (jsonb_typeof(components) = 'array'),
  constraint buyer_intelligence_assessments_version_not_blank
    check (btrim(calculation_version) <> '')
);

-- ---------------------------------------------------------------------------
-- Assessment evidence — approved BI1 integrity correction.
-- candidate_id participates in every FK so an assessment for Candidate A
-- cannot reference Candidate B evidence inside the same workspace.
-- ---------------------------------------------------------------------------
create table if not exists public.buyer_intelligence_assessment_evidence (
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
    references public.buyer_candidates (id, workspace_id)
    on delete restrict,
  foreign key (assessment_id, candidate_id, workspace_id)
    references public.buyer_intelligence_assessments (id, candidate_id, workspace_id)
    on delete cascade,
  foreign key (claim_id, candidate_id, workspace_id)
    references public.buyer_intelligence_claims (id, candidate_id, workspace_id)
    on delete restrict,
  foreign key (observation_id, candidate_id, workspace_id)
    references public.buyer_trade_observations (id, candidate_id, workspace_id)
    on delete restrict,
  foreign key (metric_id, candidate_id, workspace_id)
    references public.buyer_trade_metrics (id, candidate_id, workspace_id)
    on delete restrict,
  constraint buyer_intelligence_assessment_evidence_exactly_one_target
    check (num_nonnulls(claim_id, observation_id, metric_id) = 1),
  constraint buyer_intelligence_assessment_evidence_component_not_blank
    check (btrim(component_key) <> '')
);

-- ---------------------------------------------------------------------------
-- Query-shaped indexes. Queue pages use metrics/assessments; detail history
-- uses candidate + date keyset pagination and bounded filters.
-- ---------------------------------------------------------------------------
create index if not exists buyer_intelligence_sources_candidate_retrieved_idx
  on public.buyer_intelligence_sources (workspace_id, candidate_id, retrieved_at desc, id desc);

create index if not exists buyer_intelligence_claims_candidate_type_idx
  on public.buyer_intelligence_claims
  (workspace_id, candidate_id, claim_type, evidence_type, created_at desc);
create index if not exists buyer_intelligence_claims_candidate_source_idx
  on public.buyer_intelligence_claims (workspace_id, candidate_id, source_id);

create index if not exists buyer_trade_observations_candidate_date_idx
  on public.buyer_trade_observations
  (workspace_id, candidate_id, trade_date desc nulls last, id desc);
create index if not exists buyer_trade_observations_candidate_source_idx
  on public.buyer_trade_observations (workspace_id, candidate_id, source_id);
create index if not exists buyer_trade_observations_candidate_evidence_idx
  on public.buyer_trade_observations (workspace_id, candidate_id, evidence_type);
create index if not exists buyer_trade_observations_candidate_origin_idx
  on public.buyer_trade_observations
  (workspace_id, candidate_id, origin_country_code, trade_date desc)
  where origin_country_code is not null;
create index if not exists buyer_trade_observations_candidate_destination_idx
  on public.buyer_trade_observations
  (workspace_id, candidate_id, destination_country_code, trade_date desc)
  where destination_country_code is not null;
create index if not exists buyer_trade_observations_candidate_hs_idx
  on public.buyer_trade_observations
  (workspace_id, candidate_id, hs_code_raw, trade_date desc)
  where hs_code_raw is not null;
create index if not exists buyer_trade_observations_candidate_product_idx
  on public.buyer_trade_observations
  (workspace_id, candidate_id, normalized_product_category, trade_date desc)
  where normalized_product_category is not null;
create index if not exists buyer_trade_observations_candidate_mdf_product_idx
  on public.buyer_trade_observations
  (workspace_id, candidate_id, mdf_product_id, trade_date desc)
  where mdf_product_id is not null;
create index if not exists buyer_trade_observations_candidate_supplier_idx
  on public.buyer_trade_observations
  (workspace_id, candidate_id, supplier_name_normalized, trade_date desc)
  where supplier_name_normalized is not null;

create index if not exists buyer_trade_metrics_candidate_key_idx
  on public.buyer_trade_metrics (workspace_id, candidate_id, metric_key, calculated_at desc);

create unique index if not exists buyer_intelligence_assessments_one_current_idx
  on public.buyer_intelligence_assessments (workspace_id, candidate_id, assessment_type)
  where superseded_at is null;
create index if not exists buyer_intelligence_assessments_candidate_type_idx
  on public.buyer_intelligence_assessments
  (workspace_id, candidate_id, assessment_type, calculated_at desc);

create index if not exists buyer_intelligence_assessment_evidence_assessment_idx
  on public.buyer_intelligence_assessment_evidence
  (workspace_id, candidate_id, assessment_id);
create unique index if not exists buyer_intelligence_assessment_evidence_claim_unique_idx
  on public.buyer_intelligence_assessment_evidence
  (assessment_id, candidate_id, workspace_id, component_key, claim_id)
  where claim_id is not null;
create unique index if not exists buyer_intelligence_assessment_evidence_observation_unique_idx
  on public.buyer_intelligence_assessment_evidence
  (assessment_id, candidate_id, workspace_id, component_key, observation_id)
  where observation_id is not null;
create unique index if not exists buyer_intelligence_assessment_evidence_metric_unique_idx
  on public.buyer_intelligence_assessment_evidence
  (assessment_id, candidate_id, workspace_id, component_key, metric_id)
  where metric_id is not null;

-- Reuse the established updated_at trigger; immutable source/claim/link rows
-- intentionally have no update trigger.
drop trigger if exists buyer_trade_observations_set_updated_at on public.buyer_trade_observations;
create trigger buyer_trade_observations_set_updated_at
  before update on public.buyer_trade_observations
  for each row execute function public.set_updated_at();

drop trigger if exists buyer_trade_metrics_set_updated_at on public.buyer_trade_metrics;
create trigger buyer_trade_metrics_set_updated_at
  before update on public.buyer_trade_metrics
  for each row execute function public.set_updated_at();

drop trigger if exists buyer_intelligence_assessments_set_updated_at on public.buyer_intelligence_assessments;
create trigger buyer_intelligence_assessments_set_updated_at
  before update on public.buyer_intelligence_assessments
  for each row execute function public.set_updated_at();

-- Workspace-membership RLS. BI1 UI is read-only; no authenticated DML grant.
select mdf.__apply_workspace_rls('public.buyer_intelligence_sources'::regclass);
select mdf.__apply_workspace_rls('public.buyer_intelligence_claims'::regclass);
select mdf.__apply_workspace_rls('public.buyer_trade_observations'::regclass);
select mdf.__apply_workspace_rls('public.buyer_trade_metrics'::regclass);
select mdf.__apply_workspace_rls('public.buyer_intelligence_assessments'::regclass);
select mdf.__apply_workspace_rls('public.buyer_intelligence_assessment_evidence'::regclass);

revoke all on public.buyer_intelligence_sources from anon, authenticated, public;
revoke all on public.buyer_intelligence_claims from anon, authenticated, public;
revoke all on public.buyer_trade_observations from anon, authenticated, public;
revoke all on public.buyer_trade_metrics from anon, authenticated, public;
revoke all on public.buyer_intelligence_assessments from anon, authenticated, public;
revoke all on public.buyer_intelligence_assessment_evidence from anon, authenticated, public;

grant select on public.buyer_intelligence_sources to authenticated;
grant select on public.buyer_intelligence_claims to authenticated;
grant select on public.buyer_trade_observations to authenticated;
grant select on public.buyer_trade_metrics to authenticated;
grant select on public.buyer_intelligence_assessments to authenticated;
grant select on public.buyer_intelligence_assessment_evidence to authenticated;

notify pgrst, 'reload schema';
