-- MUTATING TRANSACTIONAL REGRESSION TEST for migration 0024.
-- LOCAL / DISPOSABLE DATABASE ONLY. DO NOT RUN IN PRODUCTION.
--
-- Prerequisites: migrations 0022, 0023, and 0024 applied to an otherwise
-- empty public.product_trade_mappings table. Every write is rolled back.
--
-- Proves:
--   1. first full snapshot creates five rows;
--   2. identical replay (with a different generatedAt) is five unchanged;
--   3. one material field change is one updated + four unchanged;
--   4. omission deactivates without deleting;
--   5. restoration reactivates the same physical row.

begin;

do $$
declare
  v_snapshot jsonb := jsonb_build_object(
    'registryVersion', 'mi-product-map-v1',
    'generatedAt', '2026-09-20T00:00:00.000Z',
    'mappings', jsonb_build_array(
      jsonb_build_object(
        'mdf_product_id', 'banganapalli-mango',
        'hs_revision', 'HS17',
        'hs_level', 6,
        'hs_code', '080450',
        'trade_label', 'Guavas, mangoes and mangosteens, fresh or dried',
        'mapping_kind', 'composite',
        'mapping_confidence', 0.3,
        'fit_eligibility', 'insufficient_specificity',
        'scope_description', 'Composite mango test scope',
        'included_products_note', 'Mango test note',
        'weight', 0.6
      ),
      jsonb_build_object(
        'mdf_product_id', 'guntur-dry-red-chilli',
        'hs_revision', 'HS17',
        'hs_level', 6,
        'hs_code', '090421',
        'trade_label', 'Whole dried chillies',
        'mapping_kind', 'proxy',
        'mapping_confidence', 0.7,
        'fit_eligibility', 'proxy_allowed',
        'scope_description', 'Whole chilli proxy test scope',
        'included_products_note', 'Whole chilli test note',
        'weight', 1
      ),
      jsonb_build_object(
        'mdf_product_id', 'guntur-dry-red-chilli',
        'hs_revision', 'HS17',
        'hs_level', 6,
        'hs_code', '090422',
        'trade_label', 'Crushed or ground chillies',
        'mapping_kind', 'proxy',
        'mapping_confidence', 0.55,
        'fit_eligibility', 'proxy_allowed',
        'scope_description', 'Ground chilli proxy test scope',
        'included_products_note', 'Ground chilli test note',
        'weight', 0.5
      ),
      jsonb_build_object(
        'mdf_product_id', 'indian-apples',
        'hs_revision', 'HS17',
        'hs_level', 6,
        'hs_code', '080810',
        'trade_label', 'Fresh apples',
        'mapping_kind', 'exact',
        'mapping_confidence', 0.95,
        'fit_eligibility', 'exact',
        'scope_description', 'Apple exact test scope',
        'included_products_note', 'Apple test note',
        'weight', 1
      ),
      jsonb_build_object(
        'mdf_product_id', 'indian-pomegranate',
        'hs_revision', 'HS17',
        'hs_level', 6,
        'hs_code', '081090',
        'trade_label', 'Other fresh fruit',
        'mapping_kind', 'composite',
        'mapping_confidence', 0.25,
        'fit_eligibility', 'insufficient_specificity',
        'scope_description', 'Pomegranate composite test scope',
        'included_products_note', 'Pomegranate test note',
        'weight', 0.3
      )
    )
  );
  v_replay jsonb;
  v_changed jsonb;
  v_removed jsonb;
  v_result jsonb;
  v_persisted_weight text;
  v_count int;
  v_active_count int;
begin
  if exists (select 1 from public.product_trade_mappings) then
    raise exception '0024 regression test requires an empty disposable product_trade_mappings table';
  end if;

  v_result := public.sync_product_trade_mappings(v_snapshot);
  if (v_result->>'created')::int <> 5
    or (v_result->>'updated')::int <> 0
    or (v_result->>'reactivated')::int <> 0
    or (v_result->>'deactivated')::int <> 0
    or (v_result->>'unchanged')::int <> 0 then
    raise exception 'first snapshot classification failed: %', v_result;
  end if;

  -- Concrete root-cause evidence: JSON 0.6 persists at column scale 0.600.
  select weight::text into v_persisted_weight
  from public.product_trade_mappings
  where mdf_product_id = 'banganapalli-mango'
    and hs_revision = 'HS17'
    and hs_code = '080450';
  if v_persisted_weight <> '0.600' then
    raise exception 'unexpected persisted numeric representation: %', v_persisted_weight;
  end if;

  -- generatedAt is bookkeeping and is intentionally absent from material equality.
  v_replay := jsonb_set(v_snapshot, '{generatedAt}', '"2026-09-21T00:00:00.000Z"'::jsonb);
  v_result := public.sync_product_trade_mappings(v_replay);
  if (v_result->>'created')::int <> 0
    or (v_result->>'updated')::int <> 0
    or (v_result->>'reactivated')::int <> 0
    or (v_result->>'deactivated')::int <> 0
    or (v_result->>'unchanged')::int <> 5 then
    raise exception 'identical replay classification failed: %', v_result;
  end if;

  v_changed := jsonb_set(
    v_replay,
    '{mappings,0,trade_label}',
    '"Guavas, mangoes and mangosteens — materially revised"'::jsonb
  );
  v_result := public.sync_product_trade_mappings(v_changed);
  if (v_result->>'created')::int <> 0
    or (v_result->>'updated')::int <> 1
    or (v_result->>'reactivated')::int <> 0
    or (v_result->>'deactivated')::int <> 0
    or (v_result->>'unchanged')::int <> 4 then
    raise exception 'single material update classification failed: %', v_result;
  end if;

  v_removed := jsonb_set(
    v_changed,
    '{mappings}',
    (v_changed->'mappings') - 4
  );
  v_result := public.sync_product_trade_mappings(v_removed);
  if (v_result->>'created')::int <> 0
    or (v_result->>'updated')::int <> 0
    or (v_result->>'reactivated')::int <> 0
    or (v_result->>'deactivated')::int <> 1
    or (v_result->>'unchanged')::int <> 4 then
    raise exception 'deactivation classification failed: %', v_result;
  end if;

  select count(*), count(*) filter (where is_active)
    into v_count, v_active_count
  from public.product_trade_mappings;
  if v_count <> 5 or v_active_count <> 4 then
    raise exception 'deactivation physically deleted or misclassified rows: total=%, active=%', v_count, v_active_count;
  end if;

  v_result := public.sync_product_trade_mappings(v_changed);
  if (v_result->>'created')::int <> 0
    or (v_result->>'updated')::int <> 0
    or (v_result->>'reactivated')::int <> 1
    or (v_result->>'deactivated')::int <> 0
    or (v_result->>'unchanged')::int <> 4 then
    raise exception 'reactivation classification failed: %', v_result;
  end if;

  select count(*), count(*) filter (where is_active)
    into v_count, v_active_count
  from public.product_trade_mappings;
  if v_count <> 5 or v_active_count <> 5 then
    raise exception 'reactivation failed to reuse physical rows: total=%, active=%', v_count, v_active_count;
  end if;

  raise notice '0024 idempotency regression passed; transaction will be rolled back';
end;
$$;

rollback;
