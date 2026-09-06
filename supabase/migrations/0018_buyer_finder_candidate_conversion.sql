-- MDF Outreach — BF5A: durable Candidate → Buyer conversion linkage.
-- Additive only. Does NOT apply itself. Operator applies manually after review.
-- Does not edit historical migration files.
--
-- Does NOT convert existing candidates.
-- Does NOT create Buyers.
-- Does NOT call Hunter, websites, or Gmail.

-- ---------------------------------------------------------------------------
-- Additive uniqueness so conversion FKs can prove workspace membership
-- ---------------------------------------------------------------------------
do $$ begin
  alter table public.buyers
    add constraint buyers_id_workspace_unique unique (id, workspace_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.buyer_candidate_public_emails
    add constraint buyer_candidate_public_emails_id_candidate_workspace_unique
    unique (id, candidate_id, workspace_id);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- buyer_finder_candidate_conversions
-- One conversion per candidate. Buyer remains a normal Outreach Buyer.
-- ---------------------------------------------------------------------------
create table if not exists public.buyer_finder_candidate_conversions (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  candidate_id     uuid not null,
  buyer_id         uuid not null,
  source_kind      text not null,
  contact_id       uuid,
  public_email_id  uuid,
  created_at       timestamptz not null default now(),
  unique (id, workspace_id),
  unique (candidate_id),
  unique (workspace_id, candidate_id),
  foreign key (candidate_id, workspace_id)
    references public.buyer_candidates (id, workspace_id)
    on delete restrict,
  foreign key (buyer_id, workspace_id)
    references public.buyers (id, workspace_id)
    on delete restrict,
  foreign key (contact_id, candidate_id, workspace_id)
    references public.buyer_candidate_contacts (id, candidate_id, workspace_id)
    on delete restrict,
  foreign key (public_email_id, candidate_id, workspace_id)
    references public.buyer_candidate_public_emails (id, candidate_id, workspace_id)
    on delete restrict,
  constraint buyer_finder_candidate_conversions_source_kind_allowed
    check (source_kind in (
      'revealed_personal_contact',
      'public_company_email',
      'company_only'
    )),
  constraint buyer_finder_candidate_conversions_source_shape
    check (
      (source_kind = 'revealed_personal_contact'
        and contact_id is not null
        and public_email_id is null)
      or (source_kind = 'public_company_email'
        and public_email_id is not null
        and contact_id is null)
      or (source_kind = 'company_only'
        and contact_id is null
        and public_email_id is null)
    )
);

create index if not exists buyer_finder_candidate_conversions_buyer_idx
  on public.buyer_finder_candidate_conversions (workspace_id, buyer_id);

create index if not exists buyer_finder_candidate_conversions_workspace_idx
  on public.buyer_finder_candidate_conversions (workspace_id, created_at desc);

select mdf.__apply_workspace_rls('public.buyer_finder_candidate_conversions'::regclass);

revoke all on public.buyer_finder_candidate_conversions from anon, authenticated, public;
-- BF5A.1 — conversion linkage is durable and immutable from the app plane.
-- `authenticated` may only SELECT; the controlled conversion RPC (below,
-- SECURITY DEFINER) is the sole insertion path. There is no supported
-- normal UPDATE/DELETE from the app plane. RLS on the table still isolates
-- rows by workspace on SELECT.
grant select on public.buyer_finder_candidate_conversions to authenticated;

-- ---------------------------------------------------------------------------
-- Host / company compare helpers for transactional duplicate recheck.
-- Exact host after stripping scheme, path, and a leading www.
-- ---------------------------------------------------------------------------
create or replace function mdf.normalize_host(raw text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(btrim(coalesce(raw, ''))), '^https?://', ''),
        '[/?#].*$',
        ''
      ),
      '^www\.',
      ''
    ),
    ''
  );
$$;

create or replace function mdf.normalize_company_name(raw text)
returns text
language plpgsql
immutable
as $$
declare
  s text;
  tokens text[];
  last text;
begin
  s := lower(replace(coalesce(raw, ''), '&', ' and '));
  s := regexp_replace(s, '[^a-z0-9]+', ' ', 'g');
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'));
  if s = '' then
    return null;
  end if;
  tokens := regexp_split_to_array(s, ' ');
  if tokens[1] = 'the' then
    tokens := tokens[2:array_length(tokens, 1)];
  end if;
  if tokens is null or array_length(tokens, 1) is null then
    return null;
  end if;
  last := tokens[array_length(tokens, 1)];
  while array_length(tokens, 1) > 1 and last in (
    'ltd', 'limited', 'co', 'company', 'inc', 'incorporated',
    'llc', 'plc', 'corp', 'corporation', 'pvt', 'private', 'pte', 'lp', 'llp'
  ) loop
    tokens := tokens[1:array_length(tokens, 1) - 1];
    last := tokens[array_length(tokens, 1)];
  end loop;
  s := array_to_string(tokens, ' ');
  if s = '' then
    return null;
  end if;
  return s;
end;
$$;

revoke all on function mdf.normalize_host(text) from public, anon;
revoke all on function mdf.normalize_company_name(text) from public, anon;
grant execute on function mdf.normalize_host(text) to authenticated;
grant execute on function mdf.normalize_company_name(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Atomic conversion. Loads authoritative Candidate/contact rows.
-- Browser may pass only candidate id + source identity + a product-match
-- identity for the candidate. `buyers.product_interest` is derived here
-- from the persisted product match's `product_key` via a fixed business-id
-- whitelist — never from arbitrary browser text.
-- Never copies search-intent buyer_type. Never writes notes. Never sends mail.
--
-- SECURITY DEFINER: the app plane has no INSERT permission on
-- `buyer_finder_candidate_conversions` (BF5A.1 — Issue 2). All state
-- changes flow through this narrow function, which owns:
--   • strict source_kind whitelist,
--   • an explicit workspace lookup via mdf.current_workspace_id() (which
--     itself reads request-scoped auth.uid(), so DEFINER does not
--     escalate the caller's workspace),
--   • every candidate/contact/public-email/product-match query filtered
--     by that resolved workspace_id (never a caller-supplied one),
--   • Buyer INSERT + conversion INSERT inside a single advisory-locked
--     transaction, so a concurrent duplicate call resolves as
--     `already_converted` rather than a second Buyer.
-- `search_path` is fixed and cannot be re-pointed by a client.
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

  if p_source_kind not in (
    'revealed_personal_contact',
    'public_company_email',
    'company_only'
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
    -- BF5A.1 — Issue 3: a "revealed personal contact" must actually be
    -- revealed (a paid reveal or a directly persisted personal-email
    -- discovery stamps revealed_at) and must be a personal mailbox, not
    -- a shared/company one. Ahmed at Natureland (is_decision_maker=false
    -- but a genuinely revealed personal email) is a valid selection;
    -- decision-maker status is not required and must not gate this path.
    -- Phone is never required.
    if v_contact.revealed_at is null then
      return jsonb_build_object('outcome', 'invalid_selection');
    end if;
    if coalesce(v_contact.email_type, '') <> 'personal' then
      return jsonb_build_object('outcome', 'invalid_selection');
    end if;
    v_email := lower(btrim(coalesce(v_contact.business_email, '')));
    if v_email = '' or position('@' in v_email) = 0 then
      return jsonb_build_object('outcome', 'invalid_selection');
    end if;
    v_first := btrim(coalesce(v_contact.first_name, ''));
    v_last := btrim(coalesce(v_contact.last_name, ''));
    v_phone := nullif(btrim(coalesce(v_contact.phone_number, '')), '');
  elsif p_source_kind = 'public_company_email' then
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
    if v_email = '' or position('@' in v_email) = 0 then
      return jsonb_build_object('outcome', 'invalid_selection');
    end if;
  else
    if p_contact_id is not null or p_public_email_id is not null then
      return jsonb_build_object('outcome', 'invalid_selection');
    end if;
    v_email := '';
  end if;

  v_website := nullif(btrim(coalesce(v_candidate.website, '')), '');
  v_city := nullif(btrim(coalesce(v_candidate.city, '')), '');
  v_domain := coalesce(
    mdf.normalize_host(v_candidate.domain),
    mdf.normalize_host(v_candidate.website)
  );
  v_company_norm := mdf.normalize_company_name(v_candidate.company_name);

  -- BF5A.1 — Issue 1: derive Buyer product_interest from an authoritative
  -- persisted product match (buyer_candidate_product_matches.product_key
  -- is a MDF business product id, enforced by app code). The RPC never
  -- trusts arbitrary browser text and never reads search-intent
  -- (desired_buyer_types) here. If no product-match identity is supplied,
  -- product_interest stays null — matches the pre-BF5A convention that a
  -- Buyer may exist without a product interest.
  --
  -- The whitelist below mirrors src/lib/catalogue/products.ts. Adding a
  -- new business product means adding it there AND to this WHEN list;
  -- the isolation test in emailTheme.isolation.test.ts covers the id set.
  -- An unknown product_key falls through to null rather than being
  -- fabricated — the display label is authoritative, not the key.
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
    -- BF5A.1 final: an unknown product_key means the product exists in
    -- persisted candidate data but is not in the canonical whitelist above
    -- (and by extension not in src/lib/catalogue/products.ts). We must
    -- refuse rather than quietly create a Buyer with product_interest=null
    -- — the caller supplied an authoritative product identity, and we do
    -- not have a canonical label for it. Adding a new product means adding
    -- it BOTH to the canonical catalogue and to this whitelist.
    if v_product_interest is null then
      return jsonb_build_object(
        'outcome', 'invalid_selection',
        'reason', 'unsupported_product'
      );
    end if;
  end if;

  if v_email <> '' then
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
  else
    -- Unique (workspace_id, lower(email)) allows only one empty-email Buyer.
    select * into v_dup
    from public.buyers
    where workspace_id = v_ws
      and btrim(email) = ''
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

-- BF5A.1 — Issue 2: only `authenticated` may execute the narrow
-- conversion RPC. `public` and `anon` are explicitly revoked so an
-- unauthenticated caller (or a mistaken future GRANT) cannot invoke a
-- SECURITY DEFINER function.
revoke all on function public.convert_buyer_finder_candidate(uuid, text, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.convert_buyer_finder_candidate(uuid, text, uuid, uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';
