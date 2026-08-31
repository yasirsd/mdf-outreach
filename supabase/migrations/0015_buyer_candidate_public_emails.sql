-- MDF Outreach — BF3A.5: public company emails discovered on the company's
-- own website. Additive only. Does NOT apply itself. Operator applies
-- manually after review. Does not edit historical migration files.
--
-- Provenance-only mailboxes (mailto / visible HTML). Never guessed.
-- Independent of Hunter. Consumes no enrichment credits.
--
-- 1. New table buyer_candidate_public_emails (0..N per candidate).
-- 2. Unique (workspace, candidate, lower(email)).
-- 3. At most one primary public email per candidate.
-- 4. Candidate-level public_contacts_searched_at so a zero-result crawl
--    is distinguishable from "not searched yet".

-- ---------------------------------------------------------------------------
-- buyer_candidates — public-contact bookkeeping (not a Search Run table)
-- ---------------------------------------------------------------------------
alter table public.buyer_candidates
  add column if not exists public_contacts_searched_at timestamptz;

-- ---------------------------------------------------------------------------
-- buyer_candidate_public_emails
-- Composite FK (candidate_id, workspace_id) prevents cross-workspace linkage.
-- ---------------------------------------------------------------------------
create table if not exists public.buyer_candidate_public_emails (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  candidate_id   uuid not null,
  email          text not null,
  mailbox_type   text not null,
  mailbox_kind   text not null,
  source         text not null default 'company_website',
  source_url     text not null,
  is_primary     boolean not null default false,
  discovered_at  timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (candidate_id, workspace_id)
    references public.buyer_candidates (id, workspace_id)
    on delete cascade,
  constraint buyer_candidate_public_emails_email_not_blank
    check (email <> ''),
  constraint buyer_candidate_public_emails_source_url_not_blank
    check (source_url <> ''),
  constraint buyer_candidate_public_emails_source_allowed
    check (source = 'company_website'),
  constraint buyer_candidate_public_emails_mailbox_type_allowed
    check (mailbox_type in (
      'procurement',
      'purchasing',
      'imports',
      'sourcing',
      'sales',
      'commercial',
      'general',
      'support',
      'named',
      'other'
    )),
  constraint buyer_candidate_public_emails_mailbox_kind_allowed
    check (mailbox_kind in ('corporate', 'external'))
);

create unique index if not exists buyer_candidate_public_emails_candidate_email_unique_idx
  on public.buyer_candidate_public_emails (workspace_id, candidate_id, lower(email));

create unique index if not exists buyer_candidate_public_emails_one_primary_per_candidate_idx
  on public.buyer_candidate_public_emails (workspace_id, candidate_id)
  where is_primary = true;

create index if not exists buyer_candidate_public_emails_candidate_idx
  on public.buyer_candidate_public_emails (candidate_id);

create index if not exists buyer_candidate_public_emails_workspace_idx
  on public.buyer_candidate_public_emails (workspace_id);

drop trigger if exists buyer_candidate_public_emails_set_updated_at on public.buyer_candidate_public_emails;
create trigger buyer_candidate_public_emails_set_updated_at
  before update on public.buyer_candidate_public_emails
  for each row execute function public.set_updated_at();

select mdf.__apply_workspace_rls('public.buyer_candidate_public_emails'::regclass);

revoke all on public.buyer_candidate_public_emails from anon, authenticated, public;
grant select, insert, update, delete on public.buyer_candidate_public_emails to authenticated;

notify pgrst, 'reload schema';
