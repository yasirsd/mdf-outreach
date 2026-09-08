-- MDF Outreach — MI1C: additive product_trade_mappings sync surface.
-- Does NOT apply itself. Operator applies manually after review.
-- Migrations 0018–0022 are immutable and are not modified here.
--
-- Purpose:
--   Give the SERVER-ONLY Market Intelligence writer a narrow,
--   SECURITY DEFINER sync target so the TypeScript authoritative
--   Product→HS registry (src/lib/marketIntelligence/product.ts)
--   can be mirrored into public.product_trade_mappings without
--   introducing a second manually-maintained SQL list and without
--   opening any general "write anywhere" back door.
--
-- What this migration ADDS:
--   1. Three lifecycle columns on product_trade_mappings:
--        is_active         boolean NOT NULL DEFAULT true
--        last_synced_at    timestamptz
--        registry_version  text
--      Existing 0022 rows (there are none — 0022 left the table
--      empty) continue to satisfy every existing constraint. Every
--      subsequent sync row carries the current registry version and
--      an `is_active` flag; superseded mappings are DEACTIVATED, not
--      deleted.
--   2. `mdf.__validate_product_trade_mapping_row(jsonb)` — pure
--      per-row validator, ungranted. Mirrors the TS
--      `validateProductTradeMappings()` shape and the existing
--      table-level CHECK bands.
--   3. `public.sync_product_trade_mappings(p_input jsonb)` —
--      SECURITY DEFINER, fixed search_path, service_role-only.
--      Accepts the FULL registry snapshot and applies it under a
--      global advisory lock: upserts current rows, deactivates rows
--      absent from the snapshot, reactivates returning rows,
--      preserves created_at, returns useful counts.
--
-- What this migration does NOT do:
--   * Never inserts seed rows. The TypeScript registry is the sole
--     source of truth; the sync action reads it and calls the RPC.
--   * Never modifies 0022 or any prior migration.
--   * Never grants EXECUTE to `authenticated` or `anon` on the new
--     RPC. The service-role trust boundary from MI1B.1 is preserved.
--   * Never physically DELETEs product_trade_mappings rows.
--   * Never widens grants on any existing table.
--   * Never fabricates market data.

begin;

-- ---------------------------------------------------------------------------
-- Additive lifecycle columns on product_trade_mappings
-- ---------------------------------------------------------------------------
alter table public.product_trade_mappings
  add column if not exists is_active boolean not null default true;
alter table public.product_trade_mappings
  add column if not exists last_synced_at timestamptz;
alter table public.product_trade_mappings
  add column if not exists registry_version text;

-- registry_version, when set, must be non-blank. NOT VALID so this
-- addition never scans historical rows (there are none in 0022; this
-- is a defence-in-depth for future rewrites).
do $$ begin
  alter table public.product_trade_mappings
    add constraint product_trade_mappings_registry_version_not_blank
    check (registry_version is null or btrim(registry_version) <> '') not valid;
exception when duplicate_object then null; end $$;

-- Query-shape index: sync-active mappings + latest per product.
create index if not exists product_trade_mappings_active_idx
  on public.product_trade_mappings (mdf_product_id, hs_revision, hs_code)
  where is_active = true;

-- ---------------------------------------------------------------------------
-- Internal per-row validator. Not granted.
-- Enforces the same fields + bands the TS validator checks, so a
-- malformed row from the writer is rejected BEFORE any INSERT.
-- ---------------------------------------------------------------------------
create or replace function mdf.__validate_product_trade_mapping_row(p_row jsonb)
returns void
language plpgsql
immutable
as $$
declare
  v_kind text;
  v_conf numeric;
  v_elig text;
  v_level int;
  v_code text;
begin
  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    raise exception 'mapping row must be a jsonb object';
  end if;
  if nullif(btrim(p_row->>'mdf_product_id'), '') is null then
    raise exception 'mapping row missing mdf_product_id';
  end if;
  if (p_row->>'hs_revision') not in ('HS92','HS96','HS02','HS07','HS12','HS17','HS22') then
    raise exception 'mapping row hs_revision invalid';
  end if;
  v_level := (p_row->>'hs_level')::int;
  if v_level not in (2,4,6) then raise exception 'mapping row hs_level invalid'; end if;
  v_code := p_row->>'hs_code';
  if v_code is null or v_code !~ '^[0-9]+$' then
    raise exception 'mapping row hs_code must be digits only';
  end if;
  if length(v_code) <> v_level then
    raise exception 'mapping row hs_code length must match hs_level';
  end if;
  if nullif(btrim(p_row->>'trade_label'), '') is null then
    raise exception 'mapping row missing trade_label';
  end if;
  v_kind := p_row->>'mapping_kind';
  if v_kind not in ('exact','proxy','composite') then
    raise exception 'mapping row mapping_kind invalid';
  end if;
  v_elig := p_row->>'fit_eligibility';
  if v_elig not in ('exact','proxy_allowed','insufficient_specificity') then
    raise exception 'mapping row fit_eligibility invalid';
  end if;
  v_conf := (p_row->>'mapping_confidence')::numeric;
  if v_conf is null or v_conf <= 0 or v_conf > 1 then
    raise exception 'mapping row mapping_confidence out of range';
  end if;
  -- Bands mirror product_trade_mappings_confidence_bands + eligibility_matches_kind.
  if v_kind = 'exact'     and (v_conf < 0.85 or v_elig <> 'exact') then
    raise exception 'exact mapping requires confidence >= 0.85 and fit_eligibility = exact';
  end if;
  if v_kind = 'proxy'     and (v_conf <= 0.40 or v_conf > 0.85 or v_elig <> 'proxy_allowed') then
    raise exception 'proxy mapping requires confidence in (0.40, 0.85] and fit_eligibility = proxy_allowed';
  end if;
  if v_kind = 'composite' and (v_conf > 0.40 or v_elig <> 'insufficient_specificity') then
    raise exception 'composite mapping requires confidence <= 0.40 and fit_eligibility = insufficient_specificity';
  end if;
  if nullif(btrim(p_row->>'scope_description'), '') is null then
    raise exception 'mapping row missing scope_description';
  end if;
end;
$$;
revoke all on function mdf.__validate_product_trade_mapping_row(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.sync_product_trade_mappings(p_input jsonb)
-- MI1B.1 trust boundary preserved: service_role only.
-- Full-snapshot semantics. Idempotent replay. History-safe (deactivate
-- rather than delete). Global advisory lock.
-- ---------------------------------------------------------------------------
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

  -- Pre-validate the FULL snapshot before touching any row. Rejects
  -- duplicate identities and any per-row invariant violation.
  for v_row in select * from jsonb_array_elements(v_mappings)
  loop
    perform mdf.__validate_product_trade_mapping_row(v_row);
    v_key := (v_row->>'mdf_product_id') || '::' || (v_row->>'hs_revision') || '::' || (v_row->>'hs_code');
    if v_key = any (v_snapshot_keys) then
      raise exception 'duplicate mapping identity in snapshot: %', v_key;
    end if;
    v_snapshot_keys := array_append(v_snapshot_keys, v_key);
  end loop;

  -- Apply the snapshot.
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

    -- Rows already exist. Determine reuse / reactivate / update.
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

    if v_existing.mapping_kind        = v_row->>'mapping_kind'
      and v_existing.mapping_confidence = (v_row->>'mapping_confidence')::numeric
      and v_existing.fit_eligibility    = v_row->>'fit_eligibility'
      and v_existing.trade_label        = v_row->>'trade_label'
      and v_existing.scope_description  = v_row->>'scope_description'
      and coalesce(v_existing.included_products_note, '') = coalesce(v_row->>'included_products_note', '')
      and coalesce(v_existing.weight::text, '') = coalesce(v_row->>'weight', '')
      and v_existing.hs_level          = (v_row->>'hs_level')::smallint
      and coalesce(v_existing.registry_version, '') = v_registry_version
    then
      -- Truly unchanged — mark the sync watermark but leave rest alone.
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

  -- Deactivate any active mapping absent from the snapshot. Never
  -- physically deleted — history is preserved for audit.
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

-- MI1B.1 trust boundary preserved: sync RPC is service_role only.
revoke all on function public.sync_product_trade_mappings(jsonb) from public, anon, authenticated;
grant execute on function public.sync_product_trade_mappings(jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
