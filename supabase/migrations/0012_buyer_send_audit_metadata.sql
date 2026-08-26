-- MDF Outreach — Phase E5: audit-metadata columns for send events.
--
-- The campaign snapshot in public.campaigns.email_sections is the
-- source of truth for what a campaign LOOKS LIKE right now. That
-- snapshot can be edited after a send has already gone out. To
-- reconstruct exactly what a specific buyer received, we need three
-- immutable pieces of metadata stamped on the send-event row at send
-- time.
--
-- These columns are:
--
--   template_id       — which master template the campaign snapshot
--                        was created from (may be null if a legacy
--                        campaign predates the master-template pattern).
--   template_variant  — 'signature' | 'direct' snapshot at send time.
--   template_version  — integer version of the master template at
--                        send time.
--
-- All three are additive, nullable, and never overwritten. They give
-- the audit trail the ability to answer "reconstruct exactly the email
-- this buyer received" even if the campaign snapshot has changed
-- since.

alter table public.email_send_events
  add column if not exists template_id uuid,
  add column if not exists template_variant text,
  add column if not exists template_version integer;

-- Optional: bounded validation. Only two variants exist today.
do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'email_send_events_template_variant_check'
  ) then
    alter table public.email_send_events
      add constraint email_send_events_template_variant_check
      check (template_variant is null or template_variant in ('signature','direct'));
  end if;
end $$;

-- Index for "history of sends using a given template" — very cheap
-- because template_id is usually low cardinality.
create index if not exists email_send_events_template_idx
  on public.email_send_events (template_id)
  where template_id is not null;

notify pgrst, 'reload schema';

-- Verification SQL (run manually AFTER applying):
--
--   -- New columns exist with the right types.
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--     where table_schema='public' and table_name='email_send_events'
--       and column_name in ('template_id','template_variant','template_version');
--
--   -- Variant check-constraint is present.
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--     where conname='email_send_events_template_variant_check';
--
--   -- Historical rows are untouched (all NULL for the three new cols).
--   select
--     count(*) filter (where template_id is null)       as no_template_id,
--     count(*) filter (where template_variant is null)  as no_variant,
--     count(*) filter (where template_version is null)  as no_version,
--     count(*)                                          as total
--     from public.email_send_events;
--
--   -- RLS still on.
--   select relrowsecurity from pg_class where relname='email_send_events';
