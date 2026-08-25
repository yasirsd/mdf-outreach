-- MDF Outreach — campaign-level email snapshot + template lineage.
--
-- Campaigns now hold their own email content snapshot so that editing a
-- campaign email NEVER mutates the shared MDF master template.
--
--   theme_key         → which product family the campaign belongs to
--                       (used to filter compatible templates).
--   template_variant  → 'signature' | 'direct' (lineage only).
--   email_sections    → the campaign's own copy of the section content.
--                       Null means "no template chosen yet, prompt user".
--
-- template_id is retained for lineage/display but is no longer authoritative
-- for what the campaign renders.

alter table public.campaigns
  add column if not exists theme_key text,
  add column if not exists template_variant public.template_variant,
  add column if not exists email_sections jsonb;

create index if not exists campaigns_workspace_theme_idx
  on public.campaigns (workspace_id, theme_key);
