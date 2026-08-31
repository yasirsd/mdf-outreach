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
grant select, insert, update, delete on public.buyer_finder_candidate_conversions to authenticated;

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
-- Browser may pass only candidate id + source identity + catalogue product label.
-- Never copies search-intent buyer_type. Never writes notes. Never sends mail.
-- ---------------------------------------------------------------------------
create or replace function public.convert_buyer_finder_candidate(
  p_candidate_id uuid,
  p_source_kind text,
  p_contact_id uuid default null,
  p_public_email_id uuid default null,
  p_product_interest text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, mdf
as $$
declare
  v_ws uuid;
  v_candidate public.buyer_candidates%rowtype;
  v_contact public.buyer_candidate_contacts%rowtype;
  v_public public.buyer_candidate_public_emails%rowtype;
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
    nullif(btrim(coalesce(p_product_interest, '')), ''),
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

revoke all on function public.convert_buyer_finder_candidate(uuid, text, uuid, uuid, text)
  from public, anon;
grant execute on function public.convert_buyer_finder_candidate(uuid, text, uuid, uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
