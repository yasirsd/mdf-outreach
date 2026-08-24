-- MDF Outreach — business tables.
-- Every row belongs to exactly one workspace. RLS is added in 0003.

create table if not exists public.workspace_settings (
  workspace_id       uuid primary key references public.workspaces(id) on delete cascade,
  company            jsonb not null default '{}'::jsonb,
  brand              jsonb not null default '{}'::jsonb,
  email              jsonb not null default '{}'::jsonb,
  onboarding_complete boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

do $$ begin
  create type public.buyer_status as enum (
    'new', 'qualified', 'ready', 'contacted', 'replied',
    'interested', 'quotation-sent', 'negotiating', 'converted', 'not-interested'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.campaign_status as enum ('draft', 'active', 'paused', 'completed');
exception when duplicate_object then null; end $$;

create table if not exists public.buyers (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  first_name        text not null default '',
  last_name         text not null default '',
  company           text not null default '',
  email             text not null,
  phone             text,
  whatsapp          text,
  website           text,
  country           text not null default '',
  city              text,
  buyer_type        text,
  product_interest  text,
  source            text,
  notes             text,
  status            public.buyer_status not null default 'new',
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Case-insensitive email uniqueness within a workspace. Postgres does not
-- allow expressions (lower(email)) inside a table-level UNIQUE constraint;
-- it must be a functional unique index.
create unique index if not exists buyers_workspace_email_unique_idx
  on public.buyers (workspace_id, lower(email));

create index if not exists buyers_workspace_updated_idx
  on public.buyers (workspace_id, updated_at desc);
create index if not exists buyers_workspace_status_idx
  on public.buyers (workspace_id, status);

create table if not exists public.email_templates (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null,
  label         text,
  sections      jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists email_templates_workspace_idx
  on public.email_templates (workspace_id);

create table if not exists public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null,
  country       text not null default '',
  product       text not null default '',
  description   text,
  template_id   uuid references public.email_templates(id) on delete set null,
  status        public.campaign_status not null default 'draft',
  subject       text not null default '',
  preheader     text not null default '',
  from_name     text not null default '',
  reply_to      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists campaigns_workspace_updated_idx
  on public.campaigns (workspace_id, updated_at desc);

create table if not exists public.campaign_recipients (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  campaign_id        uuid not null references public.campaigns(id) on delete cascade,
  buyer_id           uuid not null references public.buyers(id) on delete cascade,
  status             public.buyer_status not null default 'new',
  prepared_at        timestamptz,
  simulated_sent_at  timestamptz,
  created_at         timestamptz not null default now(),
  unique (campaign_id, buyer_id)
);

create index if not exists campaign_recipients_campaign_idx
  on public.campaign_recipients (campaign_id);
create index if not exists campaign_recipients_workspace_idx
  on public.campaign_recipients (workspace_id);

create table if not exists public.email_assets (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  slot              text not null,
  name              text not null default '',
  production_url    text,
  local_data_url    text,
  updated_at        timestamptz not null default now(),
  unique (workspace_id, slot)
);

create table if not exists public.activity_events (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  at            timestamptz not null default now(),
  kind          text not null,
  message       text not null,
  entity_type   text,
  entity_id     text
);

create index if not exists activity_events_workspace_at_idx
  on public.activity_events (workspace_id, at desc);

-- updated_at triggers.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t record;
begin
  for t in select unnest(array[
    'workspace_settings',
    'buyers',
    'email_templates',
    'campaigns',
    'workspaces'
  ]) as name
  loop
    execute format(
      'drop trigger if exists %I_set_updated_at on public.%I;',
      t.name, t.name
    );
    execute format(
      'create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at();',
      t.name, t.name
    );
  end loop;
end $$;
