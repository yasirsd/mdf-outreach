-- MDF Outreach — Phase D2/D3A: Gmail send-only integration.
--
-- Three narrow tables:
--   * gmail_connections — one Google Workspace / Gmail sender per workspace.
--     Access + refresh tokens are stored as AES-256-GCM ciphertexts
--     that the application encrypts/decrypts with APP_SESSION_SECRET.
--     They are NEVER returned to the browser, never exposed via
--     NEXT_PUBLIC_* env vars, and never rendered in server components
--     that stream to the client.
--   * email_test_recipients — the internal-only allowlist the server
--     enforces before permitting a real Gmail delivery. Buyer emails
--     can never be a delivery target during this phase.
--   * email_send_events — audit trail of every simulation / gmail-test
--     send, including the returned Gmail message + thread ids.
--
-- All three tables use the same workspace-membership RLS pattern as
-- migration 0003. There is no anonymous access whatsoever.

do $$ begin
  create type public.email_send_kind as enum ('simulation', 'gmail-test', 'buyer-send');
exception when duplicate_object then null; end $$;

create table if not exists public.gmail_connections (
  workspace_id            uuid primary key references public.workspaces(id) on delete cascade,
  google_user_email       text not null,
  access_token_ciphertext text not null,
  access_token_iv         text not null,
  access_token_tag        text not null,
  refresh_token_ciphertext text,
  refresh_token_iv        text,
  refresh_token_tag       text,
  scope                   text not null,
  expiry_at               timestamptz not null,
  connected_by            uuid not null references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table if not exists public.email_test_recipients (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  email         text not null,
  label         text,
  created_by    uuid not null references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create unique index if not exists email_test_recipients_workspace_email_unique_idx
  on public.email_test_recipients (workspace_id, lower(email));

create table if not exists public.email_send_events (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  campaign_id       uuid references public.campaigns(id) on delete set null,
  buyer_id          uuid references public.buyers(id) on delete set null,
  kind              public.email_send_kind not null,
  recipient_email   text not null,
  render_buyer_id   uuid references public.buyers(id) on delete set null,
  subject           text not null,
  from_name         text,
  gmail_message_id  text,
  gmail_thread_id   text,
  ok                boolean not null,
  error             text,
  created_by        uuid not null references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists email_send_events_workspace_at_idx
  on public.email_send_events (workspace_id, created_at desc);

create index if not exists email_send_events_campaign_idx
  on public.email_send_events (campaign_id);

-- Apply the standard workspace-membership RLS + explicit grants.
select mdf.__apply_workspace_rls('public.gmail_connections'::regclass);
select mdf.__apply_workspace_rls('public.email_test_recipients'::regclass);
select mdf.__apply_workspace_rls('public.email_send_events'::regclass);

do $$
declare t text;
begin
  for t in select unnest(array[
    'public.gmail_connections',
    'public.email_test_recipients',
    'public.email_send_events'
  ])
  loop
    execute format('revoke all on %s from anon, authenticated, public;', t);
    execute format('grant select, insert, update, delete on %s to authenticated;', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
