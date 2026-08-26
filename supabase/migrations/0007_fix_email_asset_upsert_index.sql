-- MDF Outreach — Phase D1 hotfix.
--
-- Migration 0006 declared the (workspace_id, theme_key, slot) uniqueness
-- as a PARTIAL index (`WHERE theme_key IS NOT NULL`). The Supabase
-- repository does an upsert with `onConflict: "workspace_id,theme_key,slot"`
-- which PostgREST/PostgreSQL cannot infer against a partial index, so
-- every asset upload failed with error 42P10.
--
-- Recreate the index as a PLAIN unique index over the three columns.
-- Uniqueness is now enforced for every row regardless of theme_key —
-- that is correct: every asset in the pipeline has a theme_key by
-- construction, and any legacy row without one would still upsert into
-- distinct slots via `onConflict: "id"`.
--
-- Also reload PostgREST so the API layer picks up the change immediately.

drop index if exists public.email_assets_workspace_theme_slot_unique_idx;

create unique index if not exists email_assets_workspace_theme_slot_unique_idx
  on public.email_assets (workspace_id, theme_key, slot);

notify pgrst, 'reload schema';
