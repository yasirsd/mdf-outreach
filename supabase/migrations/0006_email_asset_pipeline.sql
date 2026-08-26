-- MDF Outreach — Phase D1: production email asset pipeline.
--
-- Extends email_assets so each asset carries product-theme lineage, a
-- storage path in the dedicated `email-assets` bucket, a lifecycle
-- status, and the metadata needed to preflight-validate a live send.
-- The bucket + Storage RLS policies are created via the Dashboard —
-- see docs/supabase-storage-setup.md.

do $$ begin
  create type public.email_asset_status as enum ('missing', 'draft', 'approved', 'production');
exception when duplicate_object then null; end $$;

alter table public.email_assets
  add column if not exists theme_key       text,
  add column if not exists status          public.email_asset_status not null default 'draft',
  add column if not exists storage_path    text,
  add column if not exists alt_text        text,
  add column if not exists mime_type       text,
  add column if not exists file_size       integer,
  add column if not exists is_decorative   boolean not null default false;

create index if not exists email_assets_workspace_theme_idx
  on public.email_assets (workspace_id, theme_key);

create index if not exists email_assets_workspace_status_idx
  on public.email_assets (workspace_id, status);

-- A single asset may be uploaded per (workspace, theme_key, slot). Older
-- rows without a theme_key are unaffected and can be migrated later.
do $$ begin
  alter table public.email_assets
    drop constraint if exists email_assets_workspace_id_slot_key;
exception when others then null; end $$;

create unique index if not exists email_assets_workspace_theme_slot_unique_idx
  on public.email_assets (workspace_id, theme_key, slot)
  where theme_key is not null;
