-- MDF Outreach — BF3B: selective personal Hunter contact reveal.
-- Additive only. Does NOT apply itself. Operator applies manually after review.
-- Does not edit historical migration files.
--
-- 1. buyer_candidate_contacts.phone_number — actual phone from a reveal.
-- 2. buyer_candidate_contacts.revealed_at — when personal details were persisted.
-- 3. unique (id, candidate_id, workspace_id) so reveal events can prove the
--    contact belongs to that candidate in the same workspace.
-- 4. buyer_finder_contact_reveal_events — durable paid-operation claim/audit.
--    Does NOT store reveal_handle / provider_ref.
-- 5. At most one UNRESOLVED reveal event per workspace+contact, including
--    reconciliation_required (paid work may already have charged).
--
-- Revealed personal email continues to live in business_email.
-- Do not add revealed_email / personal_email.

-- ---------------------------------------------------------------------------
-- buyer_candidate_contacts — revealed personal details
-- ---------------------------------------------------------------------------
alter table public.buyer_candidate_contacts
  add column if not exists phone_number text,
  add column if not exists revealed_at timestamptz;

do $$ begin
  alter table public.buyer_candidate_contacts
    add constraint buyer_candidate_contacts_phone_number_not_blank
    check (phone_number is null or btrim(phone_number) <> '');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.buyer_candidate_contacts
    add constraint buyer_candidate_contacts_id_candidate_workspace_unique
    unique (id, candidate_id, workspace_id);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- buyer_finder_contact_reveal_events
-- Triple contact FK proves contact_id belongs to candidate_id in this workspace.
-- Candidate FK remains for explicit candidate/workspace integrity.
-- ---------------------------------------------------------------------------
create table if not exists public.buyer_finder_contact_reveal_events (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  candidate_id       uuid not null,
  contact_id         uuid not null,
  provider           text not null default 'hunter',
  status             text not null default 'pending',
  provider_outcome   text,
  credits_charged    integer,
  error_code         text,
  created_at         timestamptz not null default now(),
  started_at         timestamptz,
  completed_at       timestamptz,
  unique (id, workspace_id),
  foreign key (candidate_id, workspace_id)
    references public.buyer_candidates (id, workspace_id)
    on delete cascade,
  foreign key (contact_id, candidate_id, workspace_id)
    references public.buyer_candidate_contacts (id, candidate_id, workspace_id)
    on delete cascade,
  constraint buyer_finder_contact_reveal_events_provider_allowed
    check (provider = 'hunter'),
  constraint buyer_finder_contact_reveal_events_status_allowed
    check (status in (
      'pending',
      'processing',
      'succeeded',
      'failed',
      'reconciliation_required'
    )),
  constraint buyer_finder_contact_reveal_events_outcome_allowed
    check (provider_outcome is null or provider_outcome in (
      'revealed',
      'already_revealed',
      'not_found',
      'insufficient_credits',
      'invalid_response',
      'provider_error'
    )),
  constraint buyer_finder_contact_reveal_events_credits_range
    check (credits_charged is null or (credits_charged >= 0 and credits_charged <= 1)),
  constraint buyer_finder_contact_reveal_events_error_code_not_blank
    check (error_code is null or btrim(error_code) <> '')
);

create unique index if not exists buyer_finder_contact_reveal_events_active_contact_idx
  on public.buyer_finder_contact_reveal_events (workspace_id, contact_id)
  where status in (
    'pending',
    'processing',
    'reconciliation_required'
  );

create index if not exists buyer_finder_contact_reveal_events_contact_idx
  on public.buyer_finder_contact_reveal_events (workspace_id, contact_id, created_at desc);

create index if not exists buyer_finder_contact_reveal_events_workspace_idx
  on public.buyer_finder_contact_reveal_events (workspace_id, created_at desc);

select mdf.__apply_workspace_rls('public.buyer_finder_contact_reveal_events'::regclass);

revoke all on public.buyer_finder_contact_reveal_events from anon, authenticated, public;
grant select, insert, update, delete on public.buyer_finder_contact_reveal_events to authenticated;

notify pgrst, 'reload schema';
