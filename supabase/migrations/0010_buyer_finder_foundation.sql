-- MDF Outreach — Phase 2: Buyer Finder persistence foundation.
-- Additive only. Does not alter buyers, campaigns, templates, Gmail, or RLS helpers.
--
-- One candidate = one company.
-- Contacts and product matches are child rows, never flattened onto the company.

do $$ begin
  create type public.buyer_candidate_discovery_status as enum (
    'new', 'enriching', 'ready', 'archived'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.buyer_candidate_review_status as enum (
    'pending', 'approved', 'rejected', 'needs_another_contact'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.buyer_candidate_email_status as enum (
    'unverified', 'valid', 'invalid', 'accept_all'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- buyer_candidates — one company per row
-- ---------------------------------------------------------------------------
create table if not exists public.buyer_candidates (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references public.workspaces(id) on delete cascade,
  company_name           text not null default '',
  website                text,
  domain                 text,
  country                text not null default '',
  city                   text,
  address                text,
  phone                  text,
  general_email          text,
  company_linkedin_url   text,
  industry               text,
  buyer_type             text,
  source                 text,
  source_url             text,
  is_importer            boolean,
  is_distributor         boolean,
  evidence               jsonb not null default '[]'::jsonb,
  buyer_score            integer,
  discovery_status       public.buyer_candidate_discovery_status not null default 'new',
  review_status          public.buyer_candidate_review_status not null default 'pending',
  rejection_reason       text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (id, workspace_id),
  constraint buyer_candidates_buyer_score_range
    check (buyer_score is null or (buyer_score >= 0 and buyer_score <= 100)),
  constraint buyer_candidates_domain_not_blank
    check (domain is null or domain <> ''),
  constraint buyer_candidates_general_email_not_blank
    check (general_email is null or general_email <> '')
);

create unique index if not exists buyer_candidates_workspace_domain_unique_idx
  on public.buyer_candidates (workspace_id, lower(domain))
  where domain is not null;

create index if not exists buyer_candidates_workspace_updated_idx
  on public.buyer_candidates (workspace_id, updated_at desc);

create index if not exists buyer_candidates_workspace_review_idx
  on public.buyer_candidates (workspace_id, review_status);

create index if not exists buyer_candidates_workspace_discovery_idx
  on public.buyer_candidates (workspace_id, discovery_status);

-- ---------------------------------------------------------------------------
-- buyer_candidate_contacts — 0..N people per company
-- Composite FK (candidate_id, workspace_id) prevents cross-workspace linkage.
-- ---------------------------------------------------------------------------
create table if not exists public.buyer_candidate_contacts (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  candidate_id       uuid not null,
  first_name         text,
  last_name          text,
  full_name          text,
  job_title          text,
  business_email     text,
  email_status       public.buyer_candidate_email_status,
  email_confidence   integer,
  linkedin_url       text,
  contact_score      integer,
  is_primary         boolean not null default false,
  source             text,
  discovered_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (candidate_id, workspace_id)
    references public.buyer_candidates (id, workspace_id)
    on delete cascade,
  constraint buyer_candidate_contacts_email_confidence_range
    check (email_confidence is null or (email_confidence >= 0 and email_confidence <= 100)),
  constraint buyer_candidate_contacts_contact_score_range
    check (contact_score is null or (contact_score >= 0 and contact_score <= 100)),
  constraint buyer_candidate_contacts_email_not_blank
    check (business_email is null or business_email <> '')
);

create unique index if not exists buyer_candidate_contacts_one_primary_idx
  on public.buyer_candidate_contacts (candidate_id)
  where is_primary = true;

create unique index if not exists buyer_candidate_contacts_workspace_email_unique_idx
  on public.buyer_candidate_contacts (workspace_id, lower(business_email))
  where business_email is not null;

create index if not exists buyer_candidate_contacts_candidate_idx
  on public.buyer_candidate_contacts (candidate_id);

create index if not exists buyer_candidate_contacts_workspace_idx
  on public.buyer_candidate_contacts (workspace_id);

-- ---------------------------------------------------------------------------
-- buyer_candidate_product_matches — 0..N MDF products per company
-- product_key is text; application code enforces existing ProductKey values.
-- ---------------------------------------------------------------------------
create table if not exists public.buyer_candidate_product_matches (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  candidate_id   uuid not null,
  product_key    text not null,
  country        text,
  query          text,
  relevance      integer,
  evidence       jsonb not null default '[]'::jsonb,
  source         text,
  discovered_at  timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (candidate_id, workspace_id)
    references public.buyer_candidates (id, workspace_id)
    on delete cascade,
  constraint buyer_candidate_product_matches_relevance_range
    check (relevance is null or (relevance >= 0 and relevance <= 100)),
  constraint buyer_candidate_product_matches_product_key_not_blank
    check (product_key <> '')
);

create unique index if not exists buyer_candidate_product_matches_unique_idx
  on public.buyer_candidate_product_matches (workspace_id, candidate_id, product_key);

create index if not exists buyer_candidate_product_matches_candidate_idx
  on public.buyer_candidate_product_matches (candidate_id);

create index if not exists buyer_candidate_product_matches_workspace_product_idx
  on public.buyer_candidate_product_matches (workspace_id, product_key);

-- updated_at — reuse existing trigger function; do not create another.
drop trigger if exists buyer_candidates_set_updated_at on public.buyer_candidates;
create trigger buyer_candidates_set_updated_at
  before update on public.buyer_candidates
  for each row execute function public.set_updated_at();

drop trigger if exists buyer_candidate_contacts_set_updated_at on public.buyer_candidate_contacts;
create trigger buyer_candidate_contacts_set_updated_at
  before update on public.buyer_candidate_contacts
  for each row execute function public.set_updated_at();

drop trigger if exists buyer_candidate_product_matches_set_updated_at on public.buyer_candidate_product_matches;
create trigger buyer_candidate_product_matches_set_updated_at
  before update on public.buyer_candidate_product_matches
  for each row execute function public.set_updated_at();

-- Workspace-membership RLS — same macro as migration 0003.
select mdf.__apply_workspace_rls('public.buyer_candidates'::regclass);
select mdf.__apply_workspace_rls('public.buyer_candidate_contacts'::regclass);
select mdf.__apply_workspace_rls('public.buyer_candidate_product_matches'::regclass);

do $$
declare t text;
begin
  for t in select unnest(array[
    'public.buyer_candidates',
    'public.buyer_candidate_contacts',
    'public.buyer_candidate_product_matches'
  ])
  loop
    execute format('revoke all on %s from anon, authenticated, public;', t);
    execute format('grant select, insert, update, delete on %s to authenticated;', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
