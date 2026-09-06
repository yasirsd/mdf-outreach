-- MDF Outreach — BF5B-final: email is mandatory to create a Buyer.
-- Additive only. Does NOT apply itself. Operator applies manually after review.
-- Does not edit historical migration files. Migration 0018 stays immutable.
--
-- Does NOT convert existing candidates.
-- Does NOT create Buyers.
-- Does NOT rewrite any Buyer row.
-- Does NOT modify existing conversion linkage rows.
-- Does NOT drop or replace any Buyers index.
-- Does NOT call Hunter, websites, or Gmail.
--
-- Permanent MDF rule as of BF5B-final:
--   Email is mandatory to create any public.buyers row. A Candidate without
--   a usable revealed personal email
--   or public company email stays inside Buyer Finder as a research record
--   (company info, website, phone, LinkedIn, contacts, products, trade
--   intelligence, shipment evidence, provenance) but MUST NOT enter
--   public.buyers.
--
-- What this migration does:
--   1. Add a NOT VALID CHECK requiring btrim(public.buyers.email) <> ''.
--      PostgreSQL enforces a NOT VALID CHECK for every future insert/update
--      without scanning or rewriting historical rows when it is added. The
--      operator must inspect historical rows before validating it later.
--   2. CREATE OR REPLACE public.convert_buyer_finder_candidate(uuid,text,
--      uuid,uuid,uuid) — same signature as 0018 — so that source_kind
--      'company_only' is now a hard invalid_selection and the RPC cannot
--      insert a Buyer with an empty email under any code path. Every
--      BF5A.1 authority + isolation invariant is preserved verbatim.
--   3. Add a NOT VALID CHECK on public.buyer_finder_candidate_conversions
--      restricting source_kind to the two email-bearing values. NOT VALID
--      avoids assuming that no historical company_only linkage exists, while
--      still rejecting any new company_only linkage immediately.
--
-- What this migration does NOT do (superseding the earlier draft of 0019):
--   * Does NOT drop buyers_workspace_email_unique_idx. That historical
--     full unique index (migration 0002) is unchanged. Non-empty email
--     uniqueness within a workspace stays enforced case-insensitively.
--   * Does NOT create a partial "non-empty email" unique index. The
--     rule that a workspace holds at most one empty-email Buyer stays
--     in force AT THE INDEX LEVEL, matched by the RPC refusing to
--     insert a Buyer with an empty email in the first place.
--   * Does NOT permit multiple empty-email Buyers.
--   * Does NOT delete or rewrite existing rows in public.buyers or
--     public.buyer_finder_candidate_conversions.
--
-- Preserved BF5A.1 invariants on the RPC (asserted by the migration test):
--   SECURITY DEFINER; fixed search_path = public, mdf, pg_temp; workspace
--   resolved via mdf.current_workspace_id() and never a caller-supplied
--   parameter; every lookup (candidate / contact / public email /
--   product match / existing Buyer / prior conversion) filtered by that
--   resolved workspace; product authority derived from a persisted
--   product-match row through a fixed SQL whitelist with
--   unsupported_product rejection; revealed_personal_contact requires
--   revealed_at IS NOT NULL AND email_type = 'personal'; workspace
--   advisory xact lock + unique_violation → already_converted recovery;
--   EXECUTE granted only to authenticated, public and anon revoked.
--
-- The conversion linkage's SELECT-only grant (0018) is untouched here.

-- ---------------------------------------------------------------------------
-- Step 1 — staged global Buyer email invariant.
--
-- NOT VALID is intentional: it does not scan or rewrite historical Buyers,
-- but PostgreSQL still enforces the CHECK for all future inserts and updates.
-- After the read-only preflight and any separately approved remediation, an
-- operator may VALIDATE CONSTRAINT in a later controlled change.
-- ---------------------------------------------------------------------------
do $$ begin
  alter table public.buyers
    add constraint buyers_email_not_blank
    check (btrim(email) <> '') not valid;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Step 2 — additive CHECK on buyer_finder_candidate_conversions.source_kind
-- restricting it to the two email-bearing kinds. The existing check from
-- 0018 (which also allows 'company_only') stays in place; the AND of both
-- CHECKs is the strict subset we want. NOT VALID avoids scanning or making
-- assumptions about historical linkage while enforcing the rule for new rows.
-- ---------------------------------------------------------------------------
do $$ begin
  alter table public.buyer_finder_candidate_conversions
    add constraint buyer_finder_candidate_conversions_source_kind_email_required
    check (source_kind in (
      'revealed_personal_contact',
      'public_company_email'
    )) not valid;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Step 3 — CREATE OR REPLACE the conversion RPC. Same 5-arg signature.
-- Only the source_kind whitelist and the company_only branch change;
-- every BF5A.1 gate is copied verbatim from 0018.
-- ---------------------------------------------------------------------------
create or replace function public.convert_buyer_finder_candidate(
  p_candidate_id uuid,
  p_source_kind text,
  p_contact_id uuid default null,
  p_public_email_id uuid default null,
  p_product_match_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, mdf, pg_temp
as $$
declare
  v_ws uuid;
  v_candidate public.buyer_candidates%rowtype;
  v_contact public.buyer_candidate_contacts%rowtype;
  v_public public.buyer_candidate_public_emails%rowtype;
  v_product public.buyer_candidate_product_matches%rowtype;
  v_product_interest text := null;
  v_existing public.buyer_finder_candidate_conversions%rowtype;
  v_buyer_id uuid;
  v_email text := '';
  v_first text := '';
  v_last text := '';
  v_phone text := null;
  v_website text := null;
  v_city text := null;
  v_domain text;
  v_company_norm text;
  v_dup public.buyers%rowtype;
  v_dup_class text;
begin
  v_ws := mdf.current_workspace_id();
  if v_ws is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;

  -- BF5B-final: email is mandatory to create a Buyer. 'company_only' is
  -- explicitly rejected. The two remaining kinds each require a usable
  -- persisted email; the branches below enforce that before any insert.
  if p_source_kind not in (
    'revealed_personal_contact',
    'public_company_email'
  ) then
    return jsonb_build_object('outcome', 'invalid_selection');
  end if;

  perform pg_advisory_xact_lock(hashtext('bf5a-convert'), hashtext(v_ws::text));

  select * into v_existing
  from public.buyer_finder_candidate_conversions
  where candidate_id = p_candidate_id
    and workspace_id = v_ws;
  if found then
    return jsonb_build_object(
      'outcome', 'already_converted',
      'buyer_id', v_existing.buyer_id,
      'conversion_id', v_existing.id
    );
  end if;

  select * into v_candidate
  from public.buyer_candidates
  where id = p_candidate_id
    and workspace_id = v_ws;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if v_candidate.discovery_status = 'archived' then
    return jsonb_build_object('outcome', 'not_eligible', 'reason', 'archived');
  end if;
  if v_candidate.review_status = 'rejected' then
    return jsonb_build_object('outcome', 'not_eligible', 'reason', 'rejected');
  end if;
  if v_candidate.review_status is distinct from 'approved' then
    return jsonb_build_object('outcome', 'not_eligible', 'reason', 'not_approved');
  end if;

  if p_source_kind = 'revealed_personal_contact' then
    if p_contact_id is null or p_public_email_id is not null then
      return jsonb_build_object('outcome', 'invalid_selection');
    end if;
    select * into v_contact
    from public.buyer_candidate_contacts
    where id = p_contact_id
      and candidate_id = p_candidate_id
      and workspace_id = v_ws;
    if not found then
      return jsonb_build_object('outcome', 'invalid_selection');
    end if;
    -- BF5A.1 revealed-personal proof gates preserved unchanged.
    if v_contact.revealed_at is null then
      return jsonb_build_object('outcome', 'invalid_selection');
    end if;
    if coalesce(v_contact.email_type, '') <> 'personal' then
      return jsonb_build_object('outcome', 'invalid_selection');
    end if;
    v_email := lower(btrim(coalesce(v_contact.business_email, '')));
    if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      return jsonb_build_object('outcome', 'invalid_selection');
    end if;
    v_first := btrim(coalesce(v_contact.first_name, ''));
    v_last := btrim(coalesce(v_contact.last_name, ''));
    v_phone := nullif(btrim(coalesce(v_contact.phone_number, '')), '');
  else
    -- public_company_email — email required.
    if p_public_email_id is null or p_contact_id is not null then
      return jsonb_build_object('outcome', 'invalid_selection');
    end if;
    select * into v_public
    from public.buyer_candidate_public_emails
    where id = p_public_email_id
      and candidate_id = p_candidate_id
      and workspace_id = v_ws;
    if not found then
      return jsonb_build_object('outcome', 'invalid_selection');
    end if;
    v_email := lower(btrim(coalesce(v_public.email, '')));
    if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      return jsonb_build_object('outcome', 'invalid_selection');
    end if;
  end if;

  -- BF5B-final: belt-and-braces guard. Every branch above establishes a
  -- structurally usable v_email, but a future refactor of the source-kind branches
  -- would otherwise be a footgun. Reject anything that reaches this line
  -- without a real @-bearing email.
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    return jsonb_build_object('outcome', 'invalid_selection');
  end if;

  v_website := nullif(btrim(coalesce(v_candidate.website, '')), '');
  v_city := nullif(btrim(coalesce(v_candidate.city, '')), '');
  v_domain := coalesce(
    mdf.normalize_host(v_candidate.domain),
    mdf.normalize_host(v_candidate.website)
  );
  v_company_norm := mdf.normalize_company_name(v_candidate.company_name);

  -- BF5A.1 product authority preserved verbatim.
  if p_product_match_id is not null then
    select * into v_product
    from public.buyer_candidate_product_matches
    where id = p_product_match_id
      and candidate_id = p_candidate_id
      and workspace_id = v_ws;
    if not found then
      return jsonb_build_object('outcome', 'invalid_selection');
    end if;
    v_product_interest := case v_product.product_key
      when 'guntur-dry-red-chilli' then 'Guntur Dry Red Chilli'
      when 'banganapalli-mango'    then 'Banganapalli Mango'
      when 'indian-pomegranate'    then 'Indian Pomegranate'
      when 'indian-apples'         then 'Indian Apples'
      else null
    end;
    if v_product_interest is null then
      return jsonb_build_object(
        'outcome', 'invalid_selection',
        'reason', 'unsupported_product'
      );
    end if;
  end if;

  -- Non-empty email dedupe (case- and whitespace-insensitive). The
  -- empty-email branch from 0018 is REMOVED — there is no such call
  -- path any more; v_email is guaranteed non-empty.
  select * into v_dup
  from public.buyers
  where workspace_id = v_ws
    and lower(btrim(email)) = v_email
  limit 1;
  if found then
    return jsonb_build_object(
      'outcome', 'duplicate',
      'class', 'definite',
      'reason', 'email',
      'buyer_id', v_dup.id,
      'company', v_dup.company,
      'email', v_dup.email
    );
  end if;

  if v_domain is not null then
    select * into v_dup
    from public.buyers
    where workspace_id = v_ws
      and mdf.normalize_host(website) = v_domain
    limit 1;
    if found then
      return jsonb_build_object(
        'outcome', 'duplicate',
        'class', 'definite',
        'reason', 'domain',
        'buyer_id', v_dup.id,
        'company', v_dup.company,
        'email', v_dup.email
      );
    end if;
  end if;

  if v_company_norm is not null then
    select * into v_dup
    from public.buyers
    where workspace_id = v_ws
      and mdf.normalize_company_name(company) = v_company_norm
    limit 1;
    if found then
      return jsonb_build_object(
        'outcome', 'duplicate',
        'class', 'possible',
        'reason', 'company_name',
        'buyer_id', v_dup.id,
        'company', v_dup.company,
        'email', v_dup.email
      );
    end if;
  end if;

  v_buyer_id := gen_random_uuid();

  insert into public.buyers (
    id,
    workspace_id,
    first_name,
    last_name,
    company,
    email,
    phone,
    website,
    country,
    city,
    buyer_type,
    product_interest,
    source,
    notes,
    status,
    suppressed
  ) values (
    v_buyer_id,
    v_ws,
    v_first,
    v_last,
    btrim(v_candidate.company_name),
    v_email,
    v_phone,
    v_website,
    btrim(v_candidate.country),
    v_city,
    null,
    v_product_interest,
    'Buyer Finder',
    null,
    'new',
    false
  );

  insert into public.buyer_finder_candidate_conversions (
    workspace_id,
    candidate_id,
    buyer_id,
    source_kind,
    contact_id,
    public_email_id
  ) values (
    v_ws,
    p_candidate_id,
    v_buyer_id,
    p_source_kind,
    case when p_source_kind = 'revealed_personal_contact' then p_contact_id else null end,
    case when p_source_kind = 'public_company_email' then p_public_email_id else null end
  )
  returning * into v_existing;

  return jsonb_build_object(
    'outcome', 'created',
    'buyer_id', v_buyer_id,
    'conversion_id', v_existing.id,
    'source_kind', p_source_kind
  );
exception
  when unique_violation then
    select * into v_existing
    from public.buyer_finder_candidate_conversions
    where candidate_id = p_candidate_id
      and workspace_id = v_ws;
    if found then
      return jsonb_build_object(
        'outcome', 'already_converted',
        'buyer_id', v_existing.buyer_id,
        'conversion_id', v_existing.id
      );
    end if;
    return jsonb_build_object('outcome', 'duplicate', 'class', 'definite', 'reason', 'email');
end;
$$;

-- Re-assert BF5A.1 execute permissions. CREATE OR REPLACE keeps prior
-- grants; running these again is idempotent and documents the intended
-- surface for the operator applying this migration.
revoke all on function public.convert_buyer_finder_candidate(uuid, text, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.convert_buyer_finder_candidate(uuid, text, uuid, uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';
