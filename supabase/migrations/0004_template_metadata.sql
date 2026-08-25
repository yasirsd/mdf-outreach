-- MDF Outreach — email template metadata for the creative library.
-- Adds product/variant/version/status columns to public.email_templates
-- so genuine MDF master templates can be surfaced as a versioned library.

do $$ begin
  create type public.template_status as enum ('draft', 'approved', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.template_variant as enum ('signature', 'direct');
exception when duplicate_object then null; end $$;

alter table public.email_templates
  add column if not exists theme_key text,
  add column if not exists variant public.template_variant,
  add column if not exists version integer not null default 1,
  add column if not exists status public.template_status not null default 'draft';

create index if not exists email_templates_workspace_theme_variant_idx
  on public.email_templates (workspace_id, theme_key, variant);

-- Prevent two production templates for the same product+variant within a
-- workspace. Draft copies (variant null) are exempt because their theme_key
-- may be null. This mirrors the "one Signature + one Direct per product"
-- library layout.
create unique index if not exists email_templates_workspace_product_variant_unique
  on public.email_templates (workspace_id, theme_key, variant)
  where theme_key is not null and variant is not null;
