-- MDF Outreach — BF3A: masked person-discovery metadata on contacts.
-- Additive only. Does NOT apply itself. Operator applies manually after review.
-- Does not edit historical migration files.
--
-- 1. Relax workspace-wide email uniqueness (same mailbox may appear on
--    different candidate companies) to (workspace, candidate, email).
-- 2. Add provider_ref + professional metadata for Hunter Multi-Domain
--    Search masked rows. Actual email / LinkedIn URL / phone stay NULL.
-- 3. Unique provider_ref per workspace+source for BF3A person identity.
-- 4. Candidate-level "people searched" markers so a zero-result search
--    is distinguishable from "not searched yet".

-- ---------------------------------------------------------------------------
-- buyer_candidate_contacts — masked person fields
-- ---------------------------------------------------------------------------
alter table public.buyer_candidate_contacts
  add column if not exists provider_ref text,
  add column if not exists department text,
  add column if not exists seniority text,
  add column if not exists is_decision_maker boolean,
  add column if not exists email_type text,
  add column if not exists verification_status text,
  add column if not exists full_name_available boolean,
  add column if not exists linkedin_available boolean,
  add column if not exists phone_available boolean,
  add column if not exists evidence jsonb not null default '[]'::jsonb;

do $$ begin
  alter table public.buyer_candidate_contacts
    add constraint buyer_candidate_contacts_provider_ref_not_blank
    check (provider_ref is null or provider_ref <> '');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.buyer_candidate_contacts
    add constraint buyer_candidate_contacts_email_type_allowed
    check (email_type is null or email_type in ('personal', 'generic'));
exception when duplicate_object then null; end $$;

-- Email uniqueness: was workspace-wide; now per candidate.
drop index if exists public.buyer_candidate_contacts_workspace_email_unique_idx;

create unique index if not exists buyer_candidate_contacts_candidate_email_unique_idx
  on public.buyer_candidate_contacts (workspace_id, candidate_id, lower(business_email))
  where business_email is not null;

create unique index if not exists buyer_candidate_contacts_provider_ref_unique_idx
  on public.buyer_candidate_contacts (workspace_id, source, provider_ref)
  where provider_ref is not null;

create index if not exists buyer_candidate_contacts_candidate_primary_idx
  on public.buyer_candidate_contacts (candidate_id, is_primary desc);

-- ---------------------------------------------------------------------------
-- buyer_candidates — person-search bookkeeping (not a Search Run table)
-- ---------------------------------------------------------------------------
alter table public.buyer_candidates
  add column if not exists people_searched_at timestamptz,
  add column if not exists people_has_more boolean not null default false;

-- Existing table already has workspace RLS + authenticated grants.
-- New columns inherit both. Reload PostgREST.

notify pgrst, 'reload schema';
