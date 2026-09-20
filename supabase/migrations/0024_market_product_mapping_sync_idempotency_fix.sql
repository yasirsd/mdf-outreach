-- MDF Outreach — MI1C.2: product mapping sync idempotency fix.
-- Does NOT apply itself. Operator applies manually after review.
-- Applied migrations 0022 and 0023 are immutable and are not modified here.
--
-- Root cause fixed here:
--   0023 compared persisted numeric(4,3) weight as text against the JSON
--   number's textual representation. PostgreSQL renders persisted values with
--   the declared scale (for example 0.500), while JSON extraction renders the
--   canonical input as 0.5. Numerically equal weights therefore looked
--   different and every replay was classified as updated.
--
-- This migration replaces only public.sync_product_trade_mappings(jsonb).
-- The material contract, full-snapshot lifecycle, advisory lock, fixed
-- search_path, and service_role-only authority remain unchanged. The only
-- behavioral correction is NULL-safe numeric equality for weight.

begin;

create or replace function public.sync_product_trade_mappings(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, mdf, pg_temp
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_registry_version text;
  v_mappings jsonb;
  v_created int := 0;
  v_updated int := 0;
  v_reactivated int := 0;
  v_deactivated int := 0;
  v_unchanged int := 0;
  v_row jsonb;
  v_key text;
  v_existing public.product_trade_mappings%rowtype;
  v_snapshot_keys text[] := array[]::text[];
begin
  if jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid sync input';
  end if;
  v_registry_version := p_input->>'registryVersion';
  if nullif(btrim(v_registry_version), '') is null then
    raise exception 'registryVersion is required';
  end if;
  v_mappings := coalesce(p_input->'mappings', '[]'::jsonb);
  if jsonb_typeof(v_mappings) <> 'array' then
    raise exception 'mappings must be a jsonb array';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mi-product-trade-mapping-sync', 0));

  -- Validate the entire snapshot before touching persisted rows.
  for v_row in select * from jsonb_array_elements(v_mappings)
  loop
    perform mdf.__validate_product_trade_mapping_row(v_row);
    v_key := (v_row->>'mdf_product_id') || '::' || (v_row->>'hs_revision') || '::' || (v_row->>'hs_code');
    if v_key = any (v_snapshot_keys) then
      raise exception 'duplicate mapping identity in snapshot: %', v_key;
    end if;
    v_snapshot_keys := array_append(v_snapshot_keys, v_key);
  end loop;

  for v_row in select * from jsonb_array_elements(v_mappings)
  loop
    select * into v_existing
    from public.product_trade_mappings
    where mdf_product_id = v_row->>'mdf_product_id'
      and hs_revision = v_row->>'hs_revision'
      and hs_code = v_row->>'hs_code'
    for update;

    if v_existing.id is null then
      insert into public.product_trade_mappings (
        mdf_product_id, hs_revision, hs_level, hs_code,
        trade_label, mapping_kind, mapping_confidence, fit_eligibility,
        scope_description, included_products_note, weight,
        is_active, last_synced_at, registry_version
      ) values (
        v_row->>'mdf_product_id',
        v_row->>'hs_revision',
        (v_row->>'hs_level')::smallint,
        v_row->>'hs_code',
        v_row->>'trade_label',
        v_row->>'mapping_kind',
        (v_row->>'mapping_confidence')::numeric,
        v_row->>'fit_eligibility',
        v_row->>'scope_description',
        v_row->>'included_products_note',
        nullif(v_row->>'weight', '')::numeric,
        true,
        v_now,
        v_registry_version
      );
      v_created := v_created + 1;
      continue;
    end if;

    if v_existing.is_active = false then
      update public.product_trade_mappings
        set is_active         = true,
            trade_label       = v_row->>'trade_label',
            mapping_kind      = v_row->>'mapping_kind',
            mapping_confidence= (v_row->>'mapping_confidence')::numeric,
            fit_eligibility   = v_row->>'fit_eligibility',
            scope_description = v_row->>'scope_description',
            included_products_note = v_row->>'included_products_note',
            weight            = nullif(v_row->>'weight', '')::numeric,
            hs_level          = (v_row->>'hs_level')::smallint,
            last_synced_at    = v_now,
            registry_version  = v_registry_version,
            updated_at        = v_now
        where id = v_existing.id;
      v_reactivated := v_reactivated + 1;
      continue;
    end if;

    if v_existing.mapping_kind          = v_row->>'mapping_kind'
      and v_existing.mapping_confidence = (v_row->>'mapping_confidence')::numeric
      and v_existing.fit_eligibility    = v_row->>'fit_eligibility'
      and v_existing.trade_label        = v_row->>'trade_label'
      and v_existing.scope_description  = v_row->>'scope_description'
      and coalesce(v_existing.included_products_note, '') = coalesce(v_row->>'included_products_note', '')
      -- Compare numeric values as numeric values. IS NOT DISTINCT FROM is
      -- deliberately NULL-safe for optional weights; textual scale is not
      -- material (1 = 1.000 and 0.5 = 0.500).
      and v_existing.weight is not distinct from nullif(v_row->>'weight', '')::numeric
      and v_existing.hs_level            = (v_row->>'hs_level')::smallint
      -- Registry generation remains material: a deliberate v1 -> v2 bump is
      -- classified as updated even when mapping content is otherwise equal.
      and coalesce(v_existing.registry_version, '') = v_registry_version
    then
      -- Bookkeeping-only watermark refresh: not a material update.
      update public.product_trade_mappings
        set last_synced_at = v_now
        where id = v_existing.id;
      v_unchanged := v_unchanged + 1;
      continue;
    end if;

    update public.product_trade_mappings
      set trade_label       = v_row->>'trade_label',
          mapping_kind      = v_row->>'mapping_kind',
          mapping_confidence= (v_row->>'mapping_confidence')::numeric,
          fit_eligibility   = v_row->>'fit_eligibility',
          scope_description = v_row->>'scope_description',
          included_products_note = v_row->>'included_products_note',
          weight            = nullif(v_row->>'weight', '')::numeric,
          hs_level          = (v_row->>'hs_level')::smallint,
          last_synced_at    = v_now,
          registry_version  = v_registry_version,
          updated_at        = v_now
      where id = v_existing.id;
    v_updated := v_updated + 1;
  end loop;

  -- Full-snapshot history semantics: deactivate, never delete.
  update public.product_trade_mappings
    set is_active = false,
        last_synced_at = v_now,
        updated_at = v_now
    where is_active = true
      and (mdf_product_id || '::' || hs_revision || '::' || hs_code) <> all (v_snapshot_keys);
  get diagnostics v_deactivated = row_count;

  return jsonb_build_object(
    'outcome', 'synced',
    'registryVersion', v_registry_version,
    'created', v_created,
    'updated', v_updated,
    'reactivated', v_reactivated,
    'deactivated', v_deactivated,
    'unchanged', v_unchanged
  );
end;
$$;

-- Reassert the existing least-privilege boundary after replacement.
revoke all on function public.sync_product_trade_mappings(jsonb) from public, anon, authenticated;
grant execute on function public.sync_product_trade_mappings(jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
