-- MDF Outreach — Phase E1: production Buyer Send foundation.
--
-- Three additive changes. No columns are dropped, no policies are
-- weakened, no existing rows are mutated by this migration.
--
--   1. Suppression columns on buyers ("Do not contact").
--   2. Partial unique index on email_send_events enforcing at DB level
--      that a given (workspace, campaign, buyer) can have AT MOST ONE
--      successful buyer-send audit row. Belt-and-suspenders on top of
--      the per-buyer idempotency claim in the app.
--   3. Composite index for readiness lookups ("has this buyer already
--      been sent for this campaign?").
--
-- The 'buyer-send' variant of email_send_kind is already defined in
-- migration 0008_gmail_send_only.sql — nothing to add to the enum here.

-- 1) Suppression on buyers ---------------------------------------------------

alter table public.buyers
  add column if not exists suppressed boolean not null default false,
  add column if not exists suppression_reason text,
  add column if not exists suppressed_at timestamptz;

-- Optional: partial index so "list suppressed buyers" is cheap when the
-- table grows. RLS still applies — the index does not leak rows.
create index if not exists buyers_workspace_suppressed_idx
  on public.buyers (workspace_id)
  where suppressed = true;

-- 2) Database-authoritative buyer-send dedup --------------------------------

-- The invariant enforced by this index:
--   "for any (workspace_id, campaign_id, buyer_id), at most ONE row in
--    email_send_events may exist with kind='buyer-send' and ok=true."
--
-- The application ALSO claims a per-buyer nonce in email_send_idempotency
-- before calling Gmail (see src/lib/gmail/buyerSendClaim.ts). This index
-- is the last-line defence: even if two racing requests both slipped
-- past the claim, only one can record a successful send.
create unique index if not exists email_send_events_buyer_send_success_unique_idx
  on public.email_send_events (workspace_id, campaign_id, buyer_id)
  where kind = 'buyer-send' and ok = true;

-- 3) Fast readiness lookups --------------------------------------------------

-- "Which buyers in this campaign have already been successfully sent?"
create index if not exists email_send_events_campaign_buyer_kind_ok_idx
  on public.email_send_events (campaign_id, buyer_id, kind, ok);

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verification SQL (run manually AFTER applying):
--
--   -- Suppression columns present with the right defaults / nullability.
--   select column_name, data_type, column_default, is_nullable
--     from information_schema.columns
--     where table_schema='public' and table_name='buyers'
--       and column_name in ('suppressed','suppression_reason','suppressed_at');
--
--   -- Partial unique index on email_send_events.
--   select indexdef from pg_indexes
--     where schemaname='public'
--       and indexname='email_send_events_buyer_send_success_unique_idx';
--
--   -- Composite readiness index.
--   select indexdef from pg_indexes
--     where schemaname='public'
--       and indexname='email_send_events_campaign_buyer_kind_ok_idx';
--
--   -- RLS still on for both impacted tables.
--   select relname, relrowsecurity
--     from pg_class
--     where relname in ('buyers','email_send_events');
--
--   -- Duplicate-success test (SHOULD raise 23505 unique_violation on the
--   -- second insert):
--   --   insert into email_send_events(workspace_id, campaign_id, buyer_id,
--   --     kind, recipient_email, subject, ok, created_by)
--   --     values ($ws, $c, $b, 'buyer-send', 'x@y.z', 's', true, $u);
--   --   insert into email_send_events(workspace_id, campaign_id, buyer_id,
--   --     kind, recipient_email, subject, ok, created_by)
--   --     values ($ws, $c, $b, 'buyer-send', 'x@y.z', 's', true, $u);
--
--   -- Anon zero access (must return 0 rows / permission denied):
--   --   set role anon; select count(*) from buyers; reset role;
-- ---------------------------------------------------------------------------
