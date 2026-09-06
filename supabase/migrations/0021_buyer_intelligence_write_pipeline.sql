-- MDF Outreach — BI2: narrow Buyer Intelligence write/calculation authority.
-- DO NOT apply automatically. Applied migrations 0018/0019/0020 are immutable.
-- This migration grants no direct DML on BI1 tables and performs no network work.

-- Internal versioning helper. It is deliberately not granted to app roles.
create or replace function mdf.__write_bi_assessment(
  p_workspace_id uuid,
  p_candidate_id uuid,
  p_assessment_type text,
  p_classification text,
  p_summary text,
  p_components jsonb,
  p_calculation_version text,
  p_evidence jsonb,
  p_calculated_at timestamptz
) returns uuid
language plpgsql
set search_path = public, mdf, pg_temp
as $$
declare
  v_current public.buyer_intelligence_assessments%rowtype;
  v_id uuid;
  v_links_match boolean := false;
begin
  if jsonb_typeof(p_components) <> 'array' or jsonb_typeof(p_evidence) <> 'array' then
    raise exception 'invalid assessment payload';
  end if;

  select * into v_current
  from public.buyer_intelligence_assessments
  where workspace_id = p_workspace_id and candidate_id = p_candidate_id
    and assessment_type = p_assessment_type and superseded_at is null
  for update;

  if v_current.id is not null then
    select
      count(*) = jsonb_array_length(p_evidence)
      and not exists (
        select 1 from jsonb_array_elements(p_evidence) e
        where not exists (
          select 1 from public.buyer_intelligence_assessment_evidence l
          where l.assessment_id = v_current.id
            and l.candidate_id = p_candidate_id and l.workspace_id = p_workspace_id
            and l.component_key = e->>'component_key'
            and ((e->>'kind' = 'claim' and l.claim_id = (e->>'id')::uuid)
              or (e->>'kind' = 'observation' and l.observation_id = (e->>'id')::uuid)
              or (e->>'kind' = 'metric' and l.metric_id = (e->>'id')::uuid))
        )
      ) into v_links_match
    from public.buyer_intelligence_assessment_evidence
    where assessment_id = v_current.id;

    if v_current.classification = p_classification
      and v_current.summary = p_summary
      and v_current.components = p_components
      and v_current.calculation_version = p_calculation_version
      and v_links_match then
      return v_current.id;
    end if;

    update public.buyer_intelligence_assessments
      set superseded_at = p_calculated_at
      where id = v_current.id;
  end if;

  insert into public.buyer_intelligence_assessments (
    workspace_id, candidate_id, assessment_type, classification, summary,
    components, calculated_at, calculation_version
  ) values (
    p_workspace_id, p_candidate_id, p_assessment_type, p_classification, p_summary,
    p_components, p_calculated_at, p_calculation_version
  ) returning id into v_id;

  insert into public.buyer_intelligence_assessment_evidence (
    workspace_id, candidate_id, assessment_id, component_key,
    claim_id, observation_id, metric_id
  )
  select p_workspace_id, p_candidate_id, v_id, e->>'component_key',
    case when e->>'kind' = 'claim' then (e->>'id')::uuid end,
    case when e->>'kind' = 'observation' then (e->>'id')::uuid end,
    case when e->>'kind' = 'metric' then (e->>'id')::uuid end
  from jsonb_array_elements(p_evidence) e;

  if p_assessment_type = 'buyer_legitimacy'
    and p_classification in ('verified', 'strong_evidence')
    and jsonb_array_length(p_evidence) = 0 then
    raise exception 'supporting evidence links required';
  end if;
  return v_id;
end;
$$;
revoke all on function mdf.__write_bi_assessment(uuid,uuid,text,text,text,jsonb,text,jsonb,timestamptz) from public, anon, authenticated;

-- Rebuild every deterministic metric and assessment in one transaction.
create or replace function public.refresh_buyer_intelligence(p_candidate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, mdf, pg_temp
as $$
declare
  v_workspace_id uuid := mdf.current_workspace_id();
  v_candidate public.buyer_candidates%rowtype;
  v_now timestamptz := statement_timestamp();
  v_as_of date := statement_timestamp()::date;
  v_total integer; v_verified integer; v_shipments integer; v_recent integer; v_india integer;
  v_india_shipments integer; v_known_origin integer; v_supplier_support integer; v_suppliers integer;
  v_dated_verified integer; v_dated_india integer;
  v_last date; v_last_india date; v_watermark timestamptz;
  v_origins jsonb; v_supplier_ranking jsonb;
  v_level2 integer; v_level3 integer; v_mdf integer;
  v_recent_verified integer; v_india_verified integer;
  v_class text; v_summary text; v_components jsonb; v_evidence jsonb;
  v_contact text; v_contact_summary text; v_readiness text; v_readiness_summary text;
  v_conversion public.buyer_finder_candidate_conversions%rowtype;
  v_buyer public.buyers%rowtype;
begin
  if v_workspace_id is null then raise exception 'workspace context required'; end if;
  select * into v_candidate from public.buyer_candidates
    where id = p_candidate_id and workspace_id = v_workspace_id;
  if not found then raise exception 'candidate not found in workspace'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text || ':' || p_candidate_id::text, 0));

  select count(*),
    count(*) filter (where evidence_level=1 and granularity in ('shipment','transaction')),
    count(*) filter (where evidence_level=1 and granularity='shipment'),
    count(*) filter (where evidence_level=1 and granularity in ('shipment','transaction') and trade_date between v_as_of-364 and v_as_of),
    count(*) filter (where evidence_level=1 and granularity in ('shipment','transaction') and origin_country_code='IN'),
    count(*) filter (where evidence_level=1 and granularity='shipment' and origin_country_code='IN'),
    count(*) filter (where evidence_level=1 and granularity='shipment' and origin_country_code is not null),
    count(*) filter (where evidence_level=1 and granularity='shipment' and coalesce(nullif(btrim(supplier_name_normalized),''),nullif(btrim(supplier_name_raw),'')) is not null),
    count(distinct lower(coalesce(nullif(btrim(supplier_name_normalized),''),nullif(btrim(supplier_name_raw),''))))
      filter (where evidence_level=1 and granularity='shipment' and coalesce(nullif(btrim(supplier_name_normalized),''),nullif(btrim(supplier_name_raw),'')) is not null),
    count(*) filter (where evidence_level=1 and granularity in ('shipment','transaction') and trade_date is not null),
    count(*) filter (where evidence_level=1 and granularity in ('shipment','transaction') and origin_country_code='IN' and trade_date is not null),
    max(trade_date) filter (where evidence_level=1 and granularity in ('shipment','transaction')),
    max(trade_date) filter (where evidence_level=1 and granularity in ('shipment','transaction') and origin_country_code='IN'),
    max(retrieved_at)
  into v_total,v_verified,v_shipments,v_recent,v_india,v_india_shipments,v_known_origin,v_supplier_support,v_suppliers,v_dated_verified,v_dated_india,v_last,v_last_india,v_watermark
  from public.buyer_trade_observations where workspace_id=v_workspace_id and candidate_id=p_candidate_id;

  select coalesce(jsonb_agg(jsonb_build_object('countryCode',origin_country_code,'count',n) order by n desc,origin_country_code),'[]'::jsonb)
    into v_origins from (
      select origin_country_code,count(*) n from public.buyer_trade_observations
      where workspace_id=v_workspace_id and candidate_id=p_candidate_id and evidence_level=1
        and granularity='shipment' and origin_country_code is not null group by origin_country_code
    ) q;
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('supplier',supplier,'countryCode',country_code,'count',n)) order by n desc,supplier),'[]'::jsonb)
    into v_supplier_ranking from (
      select coalesce(nullif(btrim(supplier_name_normalized),''),btrim(supplier_name_raw)) supplier,
        min(supplier_country_code) country_code,count(*) n
      from public.buyer_trade_observations where workspace_id=v_workspace_id and candidate_id=p_candidate_id
        and evidence_level=1 and granularity='shipment'
        and coalesce(nullif(btrim(supplier_name_normalized),''),nullif(btrim(supplier_name_raw),'')) is not null
      group by lower(coalesce(nullif(btrim(supplier_name_normalized),''),btrim(supplier_name_raw))),
        coalesce(nullif(btrim(supplier_name_normalized),''),btrim(supplier_name_raw))
    ) q;

  insert into public.buyer_trade_metrics (
    workspace_id,candidate_id,metric_key,value_type,numeric_value,text_value,structured_value,
    unit,calculation_window,supporting_observation_count,observation_watermark,calculated_at,calculation_version
  )
  select v_workspace_id,p_candidate_id,x.metric_key,x.value_type,x.numeric_value,x.text_value,x.structured_value,
    x.unit,'lifetime',x.support_count,v_watermark,v_now,'bi2-metrics-v1'
  from (values
    ('trade_observation_count','number',v_total::numeric,null::text,null::jsonb,'count',v_total),
    ('shipment_count','number',v_shipments::numeric,null,null,'count',v_shipments),
    ('activity_last_12_months','number',v_recent::numeric,null,null,'count',v_recent),
    ('india_observation_count','number',v_india::numeric,null,null,'count',v_india),
    ('india_shipment_count','number',v_india_shipments::numeric,null,null,'count',v_india_shipments),
    ('origin_country_distribution','json',null,null,v_origins,'none',v_known_origin),
    ('supplier_count','number',v_suppliers::numeric,null,null,'count',v_supplier_support),
    ('supplier_ranking','json',null,null,v_supplier_ranking,'none',v_supplier_support),
    ('last_observed_trade','text',null,v_last::text,null,'date',v_dated_verified),
    ('india_observation_share','number',case when v_known_origin>0 then v_india_shipments::numeric/v_known_origin end,null,null,'ratio',v_known_origin),
    ('last_observed_india_trade','text',null,v_last_india::text,null,'date',v_dated_india)
  ) x(metric_key,value_type,numeric_value,text_value,structured_value,unit,support_count)
  where x.numeric_value is not null or x.text_value is not null or x.structured_value is not null
  on conflict (workspace_id,candidate_id,metric_key,calculation_window) do update set
    value_type=excluded.value_type,numeric_value=excluded.numeric_value,text_value=excluded.text_value,
    structured_value=excluded.structured_value,unit=excluded.unit,
    supporting_observation_count=excluded.supporting_observation_count,
    observation_watermark=excluded.observation_watermark,calculated_at=excluded.calculated_at,
    calculation_version=excluded.calculation_version;

  -- Legitimacy: provider_id, not row count, is the independence boundary.
  select count(distinct s.provider_id) into v_level2 from public.buyer_intelligence_sources s where s.workspace_id=v_workspace_id and s.candidate_id=p_candidate_id and exists (
    select 1 from public.buyer_intelligence_claims c where c.source_id=s.id and c.evidence_level=2
    union all select 1 from public.buyer_trade_observations o where o.source_id=s.id and o.evidence_level=2);
  select (select count(*) from public.buyer_intelligence_claims where workspace_id=v_workspace_id and candidate_id=p_candidate_id and evidence_level=3)
       + (select count(*) from public.buyer_trade_observations where workspace_id=v_workspace_id and candidate_id=p_candidate_id and evidence_level=3) into v_level3;
  if v_verified>0 then v_class:='verified'; v_summary:='Verified company-specific trade evidence is recorded.';
    v_components:=jsonb_build_array(jsonb_build_object('key','verified_trade','explanation',v_verified||' verified shipment or transaction record'||case when v_verified=1 then '.' else 's.' end,'evidenceCount',v_verified));
    select coalesce(jsonb_agg(jsonb_build_object('kind','observation','id',id,'component_key','verified_trade')),'[]') into v_evidence from public.buyer_trade_observations where workspace_id=v_workspace_id and candidate_id=p_candidate_id and evidence_level=1 and granularity in ('shipment','transaction');
  elsif v_level2>=2 then v_class:='strong_evidence'; v_summary:='Multiple independent business sources corroborate this company.';
    v_components:=jsonb_build_array(jsonb_build_object('key','business_corroboration','explanation',v_level2||' independent business-evidence sources.','evidenceCount',v_level2));
    select coalesce(jsonb_agg(e),'[]') into v_evidence from (
      select jsonb_build_object('kind','claim','id',c.id,'component_key','business_corroboration') e from public.buyer_intelligence_claims c where c.workspace_id=v_workspace_id and c.candidate_id=p_candidate_id and c.evidence_level=2
      union all select jsonb_build_object('kind','observation','id',o.id,'component_key','business_corroboration') from public.buyer_trade_observations o where o.workspace_id=v_workspace_id and o.candidate_id=p_candidate_id and o.evidence_level=2) q;
  elsif v_level2=1 then v_class:='moderate_evidence'; v_summary:='Business evidence exists, but verified trade evidence was not found.';
    v_components:=jsonb_build_array(jsonb_build_object('key','business_evidence','explanation','One qualifying provider supplies Level 2 business evidence.','evidenceCount',1));
    select coalesce(jsonb_agg(e),'[]') into v_evidence from (
      select jsonb_build_object('kind','claim','id',c.id,'component_key','business_evidence') e from public.buyer_intelligence_claims c where c.workspace_id=v_workspace_id and c.candidate_id=p_candidate_id and c.evidence_level=2
      union all select jsonb_build_object('kind','observation','id',o.id,'component_key','business_evidence') from public.buyer_trade_observations o where o.workspace_id=v_workspace_id and o.candidate_id=p_candidate_id and o.evidence_level=2) q;
  elsif v_level3>0 then v_class:='weak_signal'; v_summary:='Only discovery signals are recorded; trade activity is not verified.';
    v_components:=jsonb_build_array(jsonb_build_object('key','discovery_signal','explanation','Level 3 discovery evidence requires corroboration.','evidenceCount',v_level3));
    select coalesce(jsonb_agg(e),'[]') into v_evidence from (
      select jsonb_build_object('kind','claim','id',c.id,'component_key','discovery_signal') e from public.buyer_intelligence_claims c where c.workspace_id=v_workspace_id and c.candidate_id=p_candidate_id and c.evidence_level=3
      union all select jsonb_build_object('kind','observation','id',o.id,'component_key','discovery_signal') from public.buyer_trade_observations o where o.workspace_id=v_workspace_id and o.candidate_id=p_candidate_id and o.evidence_level=3) q;
  else v_class:='no_evidence_found'; v_summary:='No Buyer Intelligence evidence has been recorded yet.'; v_components:='[]'; v_evidence:='[]'; end if;
  perform mdf.__write_bi_assessment(v_workspace_id,p_candidate_id,'buyer_legitimacy',v_class,v_summary,v_components,'bi2-legitimacy-v1',v_evidence,v_now);

  -- Potential uses only verified company-specific trade observations.
  select count(*) filter(where mdf_product_id is not null),
    count(*) filter(where trade_date between v_as_of-364 and v_as_of),
    count(*) filter(where origin_country_code='IN') into v_mdf,v_recent_verified,v_india_verified
  from public.buyer_trade_observations where workspace_id=v_workspace_id and candidate_id=p_candidate_id and evidence_level=1 and granularity in ('shipment','transaction');
  if v_verified=0 then v_class:='insufficient_evidence'; v_summary:='Verified trade evidence is insufficient to assess Buyer potential.'; v_components:='[]'; v_evidence:='[]';
  elsif v_mdf>0 and (v_recent_verified>0 or v_india_verified>0) then v_class:='high'; v_summary:='Verified trade includes authoritative MDF product overlap and recent or India-origin activity.';
  elsif exists(select 1 from public.buyer_trade_observations where workspace_id=v_workspace_id and candidate_id=p_candidate_id and evidence_level=1 and granularity in ('shipment','transaction') and (mdf_product_id is not null or normalized_product_category is not null or hs_code_raw is not null or trade_date between v_as_of-364 and v_as_of or origin_country_code='IN')) then v_class:='medium'; v_summary:='Verified trade has at least one relevant product, recency, or India-origin signal.';
  else v_class:='low'; v_summary:='Verified trade exists, but MDF relevance and recent activity are not established.'; end if;
  if v_verified>0 then
    v_components:=jsonb_build_array(jsonb_build_object('key','verified_activity','explanation',v_verified||' verified trade observation'||case when v_verified=1 then '.' else 's.' end,'evidenceCount',v_verified),jsonb_build_object('key','mdf_product_overlap','explanation',v_mdf||' authoritative MDF product match observations.','evidenceCount',v_mdf),jsonb_build_object('key','recent_activity','explanation',v_recent_verified||' trailing-12-month observations.','evidenceCount',v_recent_verified),jsonb_build_object('key','india_sourcing','explanation',v_india_verified||' India-origin observations.','evidenceCount',v_india_verified));
    select coalesce(jsonb_agg(e),'[]') into v_evidence from (
      select jsonb_build_object('kind','observation','id',id,'component_key','verified_activity') e from public.buyer_trade_observations where workspace_id=v_workspace_id and candidate_id=p_candidate_id and evidence_level=1 and granularity in ('shipment','transaction')
      union all select jsonb_build_object('kind','observation','id',id,'component_key','mdf_product_overlap') from public.buyer_trade_observations where workspace_id=v_workspace_id and candidate_id=p_candidate_id and evidence_level=1 and granularity in ('shipment','transaction') and mdf_product_id is not null
      union all select jsonb_build_object('kind','observation','id',id,'component_key','recent_activity') from public.buyer_trade_observations where workspace_id=v_workspace_id and candidate_id=p_candidate_id and evidence_level=1 and granularity in ('shipment','transaction') and trade_date between v_as_of-364 and v_as_of
      union all select jsonb_build_object('kind','observation','id',id,'component_key','india_sourcing') from public.buyer_trade_observations where workspace_id=v_workspace_id and candidate_id=p_candidate_id and evidence_level=1 and granularity in ('shipment','transaction') and origin_country_code='IN'
    ) q;
  end if;
  perform mdf.__write_bi_assessment(v_workspace_id,p_candidate_id,'buyer_potential',v_class,v_summary,v_components,'bi2-potential-v1',v_evidence,v_now);

  -- Contact access is descriptive only; it never creates Buyer eligibility.
  if exists(select 1 from public.buyer_candidate_contacts where workspace_id=v_workspace_id and candidate_id=p_candidate_id and revealed_at is not null and lower(coalesce(source,''))='hunter' and email_type='personal' and business_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then v_contact:='credit_enriched'; v_contact_summary:='A usable personal contact from a historical paid reveal is recorded.';
  elsif exists(select 1 from public.buyer_candidate_contacts where workspace_id=v_workspace_id and candidate_id=p_candidate_id and business_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then v_contact:='direct_contact'; v_contact_summary:='A usable direct contact is recorded without paid-reveal provenance.';
  elsif exists(select 1 from public.buyer_candidate_contacts where workspace_id=v_workspace_id and candidate_id=p_candidate_id and coalesce(nullif(btrim(full_name),''),nullif(btrim(first_name),''),nullif(btrim(last_name),''),nullif(btrim(job_title),'')) is not null) then v_contact:='named_contact'; v_contact_summary:='A named person is recorded, but no usable direct email is available.';
  elsif v_candidate.general_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or exists(select 1 from public.buyer_candidate_public_emails where workspace_id=v_workspace_id and candidate_id=p_candidate_id and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then v_contact:='public_route'; v_contact_summary:='A usable public company contact route is recorded.';
  else v_contact:='company_only'; v_contact_summary:='Company intelligence exists, but no usable contact route or named person is recorded.'; end if;
  perform mdf.__write_bi_assessment(v_workspace_id,p_candidate_id,'contact_access',v_contact,v_contact_summary,jsonb_build_array(jsonb_build_object('key','contact_access','explanation',v_contact_summary,'evidenceCount',0)),'bi2-contact-access-v1','[]',v_now);

  select * into v_conversion from public.buyer_finder_candidate_conversions where workspace_id=v_workspace_id and candidate_id=p_candidate_id;
  if v_conversion.id is not null then select * into v_buyer from public.buyers where workspace_id=v_workspace_id and id=v_conversion.buyer_id;
    if v_buyer.id is null then v_readiness:='needs_contact'; v_readiness_summary:='The converted Buyer record could not be loaded.';
    elsif v_buyer.suppressed then v_readiness:='suppressed'; v_readiness_summary:='The linked Buyer is suppressed from outreach.';
    elsif v_buyer.email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then v_readiness:='ready_for_outreach'; v_readiness_summary:='The linked Buyer has a usable email and is not suppressed; sending remains separately gated.';
    else v_readiness:='needs_contact'; v_readiness_summary:='The linked Buyer has no structurally usable email.'; end if;
  elsif v_candidate.review_status='rejected' or v_candidate.discovery_status='archived' then v_readiness:='not_eligible'; v_readiness_summary:='The Candidate is rejected or its research record is archived.';
  elsif v_candidate.review_status<>'approved' then v_readiness:='needs_review'; v_readiness_summary:='The Candidate has not been approved for Buyer review.';
  elsif exists(select 1 from public.buyer_candidate_contacts where workspace_id=v_workspace_id and candidate_id=p_candidate_id and revealed_at is not null and email_type='personal' and business_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') or exists(select 1 from public.buyer_candidate_public_emails where workspace_id=v_workspace_id and candidate_id=p_candidate_id and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then v_readiness:='ready_for_conversion'; v_readiness_summary:='The approved Candidate has a BF5B-eligible persisted email source and has not been converted.';
  else v_readiness:='needs_contact'; v_readiness_summary:='The approved Candidate has no usable persisted email route.'; end if;
  perform mdf.__write_bi_assessment(v_workspace_id,p_candidate_id,'outreach_readiness',v_readiness,v_readiness_summary,jsonb_build_array(jsonb_build_object('key','lifecycle','explanation',v_readiness_summary,'evidenceCount',0)),'bi2-readiness-v1','[]',v_now);
  return jsonb_build_object('outcome','refreshed','candidate_id',p_candidate_id);
end;
$$;

create or replace function public.ingest_buyer_intelligence_source(p_candidate_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public,mdf,pg_temp as $$
declare v_workspace_id uuid:=mdf.current_workspace_id(); v_existing public.buyer_intelligence_sources%rowtype; v_id uuid; v_material jsonb;
begin
  if v_workspace_id is null or not exists(select 1 from public.buyer_candidates where id=p_candidate_id and workspace_id=v_workspace_id) then raise exception 'candidate not found in workspace'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text||':'||p_candidate_id::text||':source:'||coalesce(p_input->>'provider_id','')||':'||coalesce(p_input->>'source_key',''),0));
  if jsonb_typeof(p_input)<>'object' or p_input->>'retrieved_at' is null or nullif(btrim(p_input->>'provider_id'),'') is null or length(p_input->>'provider_id')>120 or nullif(btrim(p_input->>'source_type'),'') is null or length(p_input->>'source_type')>120 or nullif(btrim(p_input->>'source_key'),'') is null or length(p_input->>'source_key')>500 or p_input->>'access_class' not in ('public','authorized_api','manual','internal') or p_input->>'cost_class' not in ('free','paid','unknown') or coalesce(jsonb_typeof(p_input->'metadata'),'object')<>'object' or octet_length(coalesce((p_input->'metadata')::text,'{}'))>4096 or coalesce((p_input->'metadata')::text,'') ~* '"[^"]*(api.?key|secret|token|cookie|authorization|password|credential)[^"]*"\s*:' then raise exception 'invalid source input'; end if;
  if p_input->>'source_url' is not null and ((p_input->>'source_url') !~* '^https?://' or (p_input->>'source_url') ~* '://[^/]*@' or (p_input->>'source_url') ~* '[?&](api.?key|key|secret|token|access_token|auth|authorization|signature)=') then raise exception 'unsafe source url'; end if;
  v_material:=jsonb_strip_nulls(jsonb_build_object('provider_id',btrim(p_input->>'provider_id'),'source_type',btrim(p_input->>'source_type'),'source_key',btrim(p_input->>'source_key'),'safe_source_ref',p_input->>'safe_source_ref','source_url',p_input->>'source_url','access_class',p_input->>'access_class','cost_class',p_input->>'cost_class','observed_at',(p_input->>'observed_at')::timestamptz,'metadata',coalesce(p_input->'metadata','{}')));
  select * into v_existing from public.buyer_intelligence_sources where workspace_id=v_workspace_id and candidate_id=p_candidate_id and provider_id=btrim(p_input->>'provider_id') and source_key=btrim(p_input->>'source_key');
  if v_existing.id is not null then
    if jsonb_strip_nulls(jsonb_build_object('provider_id',v_existing.provider_id,'source_type',v_existing.source_type,'source_key',v_existing.source_key,'safe_source_ref',v_existing.safe_source_ref,'source_url',v_existing.source_url,'access_class',v_existing.access_class,'cost_class',v_existing.cost_class,'observed_at',v_existing.observed_at,'metadata',v_existing.metadata))=v_material then return jsonb_build_object('outcome','existing','id',v_existing.id); end if;
    return jsonb_build_object('outcome','conflict','id',v_existing.id,'reason','material_mismatch');
  end if;
  insert into public.buyer_intelligence_sources(workspace_id,candidate_id,provider_id,source_type,source_key,safe_source_ref,source_url,access_class,cost_class,observed_at,retrieved_at,metadata) values(v_workspace_id,p_candidate_id,btrim(p_input->>'provider_id'),btrim(p_input->>'source_type'),btrim(p_input->>'source_key'),p_input->>'safe_source_ref',p_input->>'source_url',p_input->>'access_class',p_input->>'cost_class',(p_input->>'observed_at')::timestamptz,(p_input->>'retrieved_at')::timestamptz,coalesce(p_input->'metadata','{}')) returning id into v_id;
  return jsonb_build_object('outcome','created','id',v_id);
end; $$;

create or replace function public.ingest_buyer_intelligence_claim(p_candidate_id uuid,p_source_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public,mdf,pg_temp as $$
declare v_workspace_id uuid:=mdf.current_workspace_id(); v_existing public.buyer_intelligence_claims%rowtype; v_id uuid; v_material jsonb;
begin
  if not exists(select 1 from public.buyer_candidates where id=p_candidate_id and workspace_id=v_workspace_id) then raise exception 'candidate not found in workspace'; end if;
  if not exists(select 1 from public.buyer_intelligence_sources where id=p_source_id and candidate_id=p_candidate_id and workspace_id=v_workspace_id) then raise exception 'source not owned by candidate'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_source_id::text||':claim:'||coalesce(p_input->>'source_record_ref','')||':'||coalesce(p_input->>'claim_type',''),0));
  if jsonb_typeof(p_input)<>'object' or not (p_input ? 'raw_value') or p_input->>'retrieved_at' is null or octet_length(coalesce((p_input->'raw_value')::text,''))>32768 or octet_length(coalesce((p_input->'normalized_value')::text,''))>32768 then raise exception 'invalid claim input'; end if;
  v_material:=jsonb_strip_nulls(jsonb_build_object('source_record_ref',p_input->>'source_record_ref','claim_type',p_input->>'claim_type','evidence_type',p_input->>'evidence_type','evidence_level',(p_input->>'evidence_level')::smallint,'confidence',p_input->>'confidence','raw_value',p_input->'raw_value','normalized_value',p_input->'normalized_value','observed_at',(p_input->>'observed_at')::timestamptz,'normalization_version',p_input->>'normalization_version'));
  select * into v_existing from public.buyer_intelligence_claims where source_id=p_source_id and source_record_ref=p_input->>'source_record_ref' and claim_type=p_input->>'claim_type';
  if v_existing.id is not null then
    if jsonb_strip_nulls(jsonb_build_object('source_record_ref',v_existing.source_record_ref,'claim_type',v_existing.claim_type,'evidence_type',v_existing.evidence_type,'evidence_level',v_existing.evidence_level,'confidence',v_existing.confidence,'raw_value',v_existing.raw_value,'normalized_value',v_existing.normalized_value,'observed_at',v_existing.observed_at,'normalization_version',v_existing.normalization_version))=v_material then return jsonb_build_object('outcome','existing','id',v_existing.id); end if;
    return jsonb_build_object('outcome','conflict','id',v_existing.id,'reason','material_mismatch'); end if;
  insert into public.buyer_intelligence_claims(workspace_id,candidate_id,source_id,source_record_ref,claim_type,evidence_type,evidence_level,confidence,raw_value,normalized_value,observed_at,retrieved_at,normalization_version) values(v_workspace_id,p_candidate_id,p_source_id,p_input->>'source_record_ref',p_input->>'claim_type',p_input->>'evidence_type',(p_input->>'evidence_level')::smallint,p_input->>'confidence',p_input->'raw_value',p_input->'normalized_value',(p_input->>'observed_at')::timestamptz,(p_input->>'retrieved_at')::timestamptz,p_input->>'normalization_version') returning id into v_id;
  perform public.refresh_buyer_intelligence(p_candidate_id);
  return jsonb_build_object('outcome','created','id',v_id);
end; $$;

create or replace function public.ingest_buyer_trade_observation(p_candidate_id uuid,p_source_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public,mdf,pg_temp as $$
declare v_workspace_id uuid:=mdf.current_workspace_id(); v_existing public.buyer_trade_observations%rowtype; v_id uuid; v_material jsonb; v_allowed text[]:=array['guntur-dry-red-chilli','banganapalli-mango','indian-pomegranate','indian-apples'];
begin
  if not exists(select 1 from public.buyer_candidates where id=p_candidate_id and workspace_id=v_workspace_id) then raise exception 'candidate not found in workspace'; end if;
  if not exists(select 1 from public.buyer_intelligence_sources where id=p_source_id and candidate_id=p_candidate_id and workspace_id=v_workspace_id) then raise exception 'source not owned by candidate'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_source_id::text||':observation:'||coalesce(p_input->>'source_record_ref',''),0));
  if jsonb_typeof(p_input)<>'object' or p_input->>'retrieved_at' is null or (p_input->>'mdf_product_id' is not null and not (p_input->>'mdf_product_id'=any(v_allowed))) then raise exception 'invalid observation input'; end if;
  v_material:=jsonb_strip_nulls(jsonb_build_object('source_record_ref',p_input->>'source_record_ref','granularity',p_input->>'granularity','evidence_type',p_input->>'evidence_type','evidence_level',(p_input->>'evidence_level')::smallint,'confidence',p_input->>'confidence','trade_date',(p_input->>'trade_date')::date,'period_start',(p_input->>'period_start')::date,'period_end',(p_input->>'period_end')::date,'origin_country_code',p_input->>'origin_country_code','destination_country_code',p_input->>'destination_country_code','supplier_name_raw',p_input->>'supplier_name_raw','supplier_name_normalized',p_input->>'supplier_name_normalized','supplier_country_code',p_input->>'supplier_country_code','product_description_raw',p_input->>'product_description_raw','normalized_product_category',p_input->>'normalized_product_category','mdf_product_id',p_input->>'mdf_product_id','hs_code_raw',p_input->>'hs_code_raw','quantity',(p_input->>'quantity')::numeric,'quantity_unit',p_input->>'quantity_unit','gross_weight_kg',(p_input->>'gross_weight_kg')::numeric,'net_weight_kg',(p_input->>'net_weight_kg')::numeric,'trade_value',(p_input->>'trade_value')::numeric,'currency_code',p_input->>'currency_code','origin_port_raw',p_input->>'origin_port_raw','destination_port_raw',p_input->>'destination_port_raw','reported_record_count',(p_input->>'reported_record_count')::integer,'observed_at',(p_input->>'observed_at')::timestamptz,'normalization_version',p_input->>'normalization_version'));
  select * into v_existing from public.buyer_trade_observations where source_id=p_source_id and source_record_ref=p_input->>'source_record_ref';
  if v_existing.id is not null then
    if jsonb_strip_nulls(to_jsonb(v_existing)-array['id','workspace_id','candidate_id','source_id','retrieved_at','created_at','updated_at'])=v_material then return jsonb_build_object('outcome','existing','id',v_existing.id); end if;
    return jsonb_build_object('outcome','conflict','id',v_existing.id,'reason','material_mismatch'); end if;
  insert into public.buyer_trade_observations(workspace_id,candidate_id,source_id,source_record_ref,granularity,evidence_type,evidence_level,confidence,trade_date,period_start,period_end,origin_country_code,destination_country_code,supplier_name_raw,supplier_name_normalized,supplier_country_code,product_description_raw,normalized_product_category,mdf_product_id,hs_code_raw,quantity,quantity_unit,gross_weight_kg,net_weight_kg,trade_value,currency_code,origin_port_raw,destination_port_raw,reported_record_count,observed_at,retrieved_at,normalization_version) values(v_workspace_id,p_candidate_id,p_source_id,p_input->>'source_record_ref',p_input->>'granularity',p_input->>'evidence_type',(p_input->>'evidence_level')::smallint,p_input->>'confidence',(p_input->>'trade_date')::date,(p_input->>'period_start')::date,(p_input->>'period_end')::date,p_input->>'origin_country_code',p_input->>'destination_country_code',p_input->>'supplier_name_raw',p_input->>'supplier_name_normalized',p_input->>'supplier_country_code',p_input->>'product_description_raw',p_input->>'normalized_product_category',p_input->>'mdf_product_id',p_input->>'hs_code_raw',(p_input->>'quantity')::numeric,p_input->>'quantity_unit',(p_input->>'gross_weight_kg')::numeric,(p_input->>'net_weight_kg')::numeric,(p_input->>'trade_value')::numeric,p_input->>'currency_code',p_input->>'origin_port_raw',p_input->>'destination_port_raw',(p_input->>'reported_record_count')::integer,(p_input->>'observed_at')::timestamptz,(p_input->>'retrieved_at')::timestamptz,p_input->>'normalization_version') returning id into v_id;
  perform public.refresh_buyer_intelligence(p_candidate_id);
  return jsonb_build_object('outcome','created','id',v_id);
end; $$;

-- BI1 tables remain SELECT-only. Only these four validated entry points execute.
revoke all on public.buyer_intelligence_sources,public.buyer_intelligence_claims,public.buyer_trade_observations,public.buyer_trade_metrics,public.buyer_intelligence_assessments,public.buyer_intelligence_assessment_evidence from anon,authenticated,public;
grant select on public.buyer_intelligence_sources,public.buyer_intelligence_claims,public.buyer_trade_observations,public.buyer_trade_metrics,public.buyer_intelligence_assessments,public.buyer_intelligence_assessment_evidence to authenticated;
revoke all on function public.refresh_buyer_intelligence(uuid) from public,anon;
revoke all on function public.ingest_buyer_intelligence_source(uuid,jsonb) from public,anon;
revoke all on function public.ingest_buyer_intelligence_claim(uuid,uuid,jsonb) from public,anon;
revoke all on function public.ingest_buyer_trade_observation(uuid,uuid,jsonb) from public,anon;
grant execute on function public.refresh_buyer_intelligence(uuid) to authenticated;
grant execute on function public.ingest_buyer_intelligence_source(uuid,jsonb) to authenticated;
grant execute on function public.ingest_buyer_intelligence_claim(uuid,uuid,jsonb) to authenticated;
grant execute on function public.ingest_buyer_trade_observation(uuid,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
