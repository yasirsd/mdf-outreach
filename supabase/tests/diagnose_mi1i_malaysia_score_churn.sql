-- MI1I.1 — READ-ONLY Malaysia score-churn diagnostic.
-- Run in the production Supabase SQL Editor and export the single result set.
-- This file intentionally contains SELECT/WITH only and performs no mutation.

with
score_ids(label, id) as (
  values
    ('first'::text,  'f48ca616-c3c6-4468-82fb-1fd21dbe2ec4'::uuid),
    ('second'::text, '845451c6-3511-4101-ab56-d0f3d9be1d85'::uuid)
),
scores as (
  select i.label, s.*
  from score_ids i
  left join public.market_product_scores s on s.id = i.id
),
score_pair as (
  select
    (max(id::text) filter (where label = 'first'))::uuid as first_id,
    (max(id::text) filter (where label = 'second'))::uuid as second_id,
    max(country_alpha2) filter (where label = 'first') as first_country_alpha2,
    max(country_alpha2) filter (where label = 'second') as second_country_alpha2,
    max(mdf_product_id) filter (where label = 'first') as first_mdf_product_id,
    max(mdf_product_id) filter (where label = 'second') as second_mdf_product_id,
    max(diagnostic_fit_score) filter (where label = 'first') as first_diagnostic_fit_score,
    max(diagnostic_fit_score) filter (where label = 'second') as second_diagnostic_fit_score,
    max(published_fit_score) filter (where label = 'first') as first_published_fit_score,
    max(published_fit_score) filter (where label = 'second') as second_published_fit_score,
    max(data_confidence_score) filter (where label = 'first') as first_data_confidence_score,
    max(data_confidence_score) filter (where label = 'second') as second_data_confidence_score,
    max(recommendation_status) filter (where label = 'first') as first_recommendation_status,
    max(recommendation_status) filter (where label = 'second') as second_recommendation_status,
    max(mapping_kind) filter (where label = 'first') as first_mapping_kind,
    max(mapping_kind) filter (where label = 'second') as second_mapping_kind,
    max(mapping_confidence) filter (where label = 'first') as first_mapping_confidence,
    max(mapping_confidence) filter (where label = 'second') as second_mapping_confidence,
    max(fit_eligibility) filter (where label = 'first') as first_fit_eligibility,
    max(fit_eligibility) filter (where label = 'second') as second_fit_eligibility,
    bool_or(is_trade_proxy) filter (where label = 'first') as first_is_trade_proxy,
    bool_or(is_trade_proxy) filter (where label = 'second') as second_is_trade_proxy,
    max(market_fit_version) filter (where label = 'first') as first_market_fit_version,
    max(market_fit_version) filter (where label = 'second') as second_market_fit_version,
    max(confidence_version) filter (where label = 'first') as first_confidence_version,
    max(confidence_version) filter (where label = 'second') as second_confidence_version,
    max(provider_selection_version) filter (where label = 'first') as first_provider_selection_version,
    max(provider_selection_version) filter (where label = 'second') as second_provider_selection_version,
    max(recommendation_reason) filter (where label = 'first') as first_recommendation_reason,
    max(recommendation_reason) filter (where label = 'second') as second_recommendation_reason,
    (max(positive_reasons::text) filter (where label = 'first'))::jsonb as first_positive_reasons,
    (max(positive_reasons::text) filter (where label = 'second'))::jsonb as second_positive_reasons,
    (max(negative_reasons::text) filter (where label = 'first'))::jsonb as first_negative_reasons,
    (max(negative_reasons::text) filter (where label = 'second'))::jsonb as second_negative_reasons,
    (max(source_coverage::text) filter (where label = 'first'))::jsonb as first_source_coverage,
    (max(source_coverage::text) filter (where label = 'second'))::jsonb as second_source_coverage,
    max(calculated_at) filter (where label = 'first') as first_calculated_at,
    max(calculated_at) filter (where label = 'second') as second_calculated_at,
    max(superseded_at) filter (where label = 'first') as first_superseded_at,
    max(superseded_at) filter (where label = 'second') as second_superseded_at,
    max(created_at) filter (where label = 'first') as first_created_at,
    max(created_at) filter (where label = 'second') as second_created_at
  from scores
),
component_rows as (
  select i.label, c.*
  from score_ids i
  left join public.market_product_score_components c on c.score_id = i.id
),
component_summary as (
  select
    label,
    coalesce(sum(weight) filter (where supported), 0) as supported_weight,
    coalesce(
      jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'component_key', component_key,
          'raw_metric_value', raw_metric_value::text,
          'normalized_score', normalized_score,
          'weight', weight,
          'supported', supported,
          'reason', reason,
          'metadata', metadata
        )) order by component_key
      ) filter (where component_key is not null),
      '[]'::jsonb
    ) as canonical_component_set
  from component_rows
  group by label
),
component_pair as (
  select
    max(supported_weight) filter (where label = 'first') as first_supported_weight,
    max(supported_weight) filter (where label = 'second') as second_supported_weight,
    (max(canonical_component_set::text) filter (where label = 'first'))::jsonb as first_component_set,
    (max(canonical_component_set::text) filter (where label = 'second'))::jsonb as second_component_set
  from component_summary
),
component_keys as (
  select distinct component_key
  from component_rows
  where component_key is not null
),
component_field_values as (
  select
    k.component_key,
    max(c.raw_metric_value) filter (where c.label = 'first') as first_raw_metric_value,
    max(c.raw_metric_value) filter (where c.label = 'second') as second_raw_metric_value,
    max(c.normalized_score) filter (where c.label = 'first') as first_normalized_score,
    max(c.normalized_score) filter (where c.label = 'second') as second_normalized_score,
    max(c.weight) filter (where c.label = 'first') as first_weight,
    max(c.weight) filter (where c.label = 'second') as second_weight,
    bool_or(c.supported) filter (where c.label = 'first') as first_supported,
    bool_or(c.supported) filter (where c.label = 'second') as second_supported,
    max(c.reason) filter (where c.label = 'first') as first_reason,
    max(c.reason) filter (where c.label = 'second') as second_reason,
    (max(c.metadata::text) filter (where c.label = 'first'))::jsonb as first_metadata,
    (max(c.metadata::text) filter (where c.label = 'second'))::jsonb as second_metadata,
    max(c.metadata->>'calculation_version') filter (where c.label = 'first') as first_calculation_version,
    max(c.metadata->>'calculation_version') filter (where c.label = 'second') as second_calculation_version,
    max(c.created_at) filter (where c.label = 'first') as first_created_at,
    max(c.created_at) filter (where c.label = 'second') as second_created_at
  from component_keys k
  left join component_rows c on c.component_key = k.component_key
  group by k.component_key
),
score_fields(scope, field_name, first_json, second_json, material) as (
  select 'score', 'id', to_jsonb(first_id), to_jsonb(second_id), false from score_pair union all
  select 'score', 'country_alpha2', to_jsonb(first_country_alpha2), to_jsonb(second_country_alpha2), true from score_pair union all
  select 'score', 'mdf_product_id', to_jsonb(first_mdf_product_id), to_jsonb(second_mdf_product_id), true from score_pair union all
  select 'score', 'diagnostic_fit_score', to_jsonb(first_diagnostic_fit_score), to_jsonb(second_diagnostic_fit_score), true from score_pair union all
  select 'score', 'published_fit_score', to_jsonb(first_published_fit_score), to_jsonb(second_published_fit_score), true from score_pair union all
  select 'score', 'data_confidence_score', to_jsonb(first_data_confidence_score), to_jsonb(second_data_confidence_score), true from score_pair union all
  select 'score', 'recommendation_status', to_jsonb(first_recommendation_status), to_jsonb(second_recommendation_status), true from score_pair union all
  select 'score', 'mapping_kind', to_jsonb(first_mapping_kind), to_jsonb(second_mapping_kind), true from score_pair union all
  select 'score', 'mapping_confidence', to_jsonb(first_mapping_confidence), to_jsonb(second_mapping_confidence), true from score_pair union all
  select 'score', 'fit_eligibility', to_jsonb(first_fit_eligibility), to_jsonb(second_fit_eligibility), true from score_pair union all
  select 'score', 'is_trade_proxy', to_jsonb(first_is_trade_proxy), to_jsonb(second_is_trade_proxy), true from score_pair union all
  select 'score', 'market_fit_version', to_jsonb(first_market_fit_version), to_jsonb(second_market_fit_version), true from score_pair union all
  select 'score', 'data_confidence_version (confidence_version)', to_jsonb(first_confidence_version), to_jsonb(second_confidence_version), true from score_pair union all
  select 'score', 'provider_selection_version', to_jsonb(first_provider_selection_version), to_jsonb(second_provider_selection_version), true from score_pair union all
  select 'score', 'recommendation_reason', to_jsonb(first_recommendation_reason), to_jsonb(second_recommendation_reason), true from score_pair union all
  select 'score', 'positive_reasons', first_positive_reasons, second_positive_reasons, true from score_pair union all
  select 'score', 'negative_reasons', first_negative_reasons, second_negative_reasons, true from score_pair union all
  select 'score', 'source_coverage', first_source_coverage, second_source_coverage, true from score_pair union all
  select 'score', 'evidence_watermark', to_jsonb(first_source_coverage->>'evidence_watermark'), to_jsonb(second_source_coverage->>'evidence_watermark'), true from score_pair union all
  select 'score', 'mapping_watermark', to_jsonb(first_source_coverage->>'mapping_watermark'), to_jsonb(second_source_coverage->>'mapping_watermark'), true from score_pair union all
  select 'score', 'mapping_registry_version', to_jsonb(first_source_coverage->>'mapping_registry_version'), to_jsonb(second_source_coverage->>'mapping_registry_version'), true from score_pair union all
  select 'score', 'persistence_fingerprint', to_jsonb(first_source_coverage->>'persistence_fingerprint'), to_jsonb(second_source_coverage->>'persistence_fingerprint'), true from score_pair union all
  select 'score', 'supported_weight (derived)', to_jsonb(first_supported_weight), to_jsonb(second_supported_weight), false from component_pair union all
  select 'score', 'canonical_component_set', first_component_set, second_component_set, true from component_pair union all
  select 'score', 'calculated_at', to_jsonb(first_calculated_at), to_jsonb(second_calculated_at), false from score_pair union all
  select 'score', 'superseded_at', to_jsonb(first_superseded_at), to_jsonb(second_superseded_at), false from score_pair union all
  select 'score', 'created_at', to_jsonb(first_created_at), to_jsonb(second_created_at), false from score_pair
),
component_fields(scope, field_name, first_json, second_json, material) as (
  select 'component', component_key || '.raw_metric_value', to_jsonb(first_raw_metric_value), to_jsonb(second_raw_metric_value), true from component_field_values union all
  select 'component', component_key || '.raw_metric_value_text', to_jsonb(first_raw_metric_value::text), to_jsonb(second_raw_metric_value::text), true from component_field_values union all
  select 'component', component_key || '.normalized_score', to_jsonb(first_normalized_score), to_jsonb(second_normalized_score), true from component_field_values union all
  select 'component', component_key || '.weight', to_jsonb(first_weight), to_jsonb(second_weight), true from component_field_values union all
  select 'component', component_key || '.supported', to_jsonb(first_supported), to_jsonb(second_supported), true from component_field_values union all
  select 'component', component_key || '.reason', to_jsonb(first_reason), to_jsonb(second_reason), true from component_field_values union all
  select 'component', component_key || '.calculation_version', to_jsonb(first_calculation_version), to_jsonb(second_calculation_version), true from component_field_values union all
  select 'component', component_key || '.metadata', first_metadata, second_metadata, true from component_field_values union all
  select 'component', component_key || '.created_at', to_jsonb(first_created_at), to_jsonb(second_created_at), false from component_field_values
),
all_fields as (
  select * from score_fields
  union all
  select * from component_fields
)
select
  scope,
  field_name,
  first_json as first_value,
  second_json as second_value,
  first_json is not distinct from second_json as equal,
  material
from all_fields
order by scope, field_name;
