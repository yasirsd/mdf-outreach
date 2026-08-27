# MDF Outreach — Release Candidate 1

**RC date:** 2026-08-27
**Branch:** `feature/buyer-finder-hunter-discovery`
**HEAD commit:** `c692289` — *"Enhancements"* (F1–F9 changes are uncommitted in the working tree — see §Git state)
**Buyer Send state:** **`BUYER_SEND_ENABLED=false`. Not enabled. Real external outreach NOT approved.**

This document snapshots the state of the MDF Outreach main app as a Release Candidate while manual QA is still pending. It does not contain secrets and it does not authorise a production launch.

---

## Git state

Working tree at RC compilation contains all F1–F9 changes uncommitted (18 modified tracked files + 30 untracked new files). Nothing has been pushed, nothing has been tagged, and history has not been rewritten. Committing and tagging is a deliberate manual step and is out of scope for this checkpoint.

## F1–F9 summary

| Phase | Focus |
|---|---|
| **F1** | Section-visibility preflight · campaign-owned preheader · Settings cleanup · `defaultCtaUrl` seeding into snapshots |
| **F2** | Skeleton primitives · `AsyncButton` · NavigationProgress · route `loading.tsx` / `error.tsx` · Modal/Drawer busy prop · campaign fetch dedupe via `React.cache` |
| **F3** | `buyers.listByIds` · settings/gmail-connection caches · `loadCampaignSendBundle` · template server filter · `LazyEmailPreview` |
| **F4** | Canonical UI primitives (Field / FormSection / Badge / EmptyState / Divider) · legacy light-theme purge · logo alpha-crop |
| **F5** | Radix Popover + cmdk + react-day-picker (`SearchableCombobox`, `Select`, `DatePicker`) · full ISO-3166-1 catalogue (249 rows) · canonical products + buyer types · **date-only follow-up contract** with workspace-TZ helpers |
| **F6** | Premium Overview dashboard: metric cards + sparklines · outreach activity chart · buyer pipeline · campaign progress · needs-attention · follow-ups · curated recent activity · workspace TZ anchor · CTA URL validator + preflight integration |
| **F7** | Premium email creative refresh: per-product decorative SVG marks · editorial masthead · signature vs direct contrast preserved · zero new dependencies |
| **F8** | Operational hardening: `describeEnvironment` diagnostic + `isBuyerSendEnabled` explicit parser · `preflightCtaUrls` semantic contract · `docs/production-readiness.md` · Buyer Finder isolation guardrail · dead-code cleanup |
| **F9** | Buyers page + Campaign Recipients scalability: server-side pagination (`listPaginated`) · bounded recipient candidate search · Settings → Developer Production Readiness panel · **filtered CSV export with formula-injection protection** · legacy country/product filter passthrough |

## Test baseline (verified at RC compile)

- **88 test files** — 86 pass, 2 skipped (external Hunter live tests, only run under an opt-in flag).
- **800 tests** — 798 pass, 0 failing, 2 skipped.
- `tsc --noEmit` → **0 errors**.
- `next build` → **success**. All 20 routes generated. `BUYER_SEND_ENABLED` still gated.

## Major implemented capabilities

- **Auth** — Supabase user + MDF app-session cookie + workspace membership verified on every business request. RLS-scoped repositories throughout.
- **Buyers** — full CRUD, CSV import, filtered CSV export, server-side pagination with URL state, canonical + legacy filter values.
- **Campaigns** — snapshot-safe (masters cannot silently rewrite existing campaigns), premium composer, product / country / buyer-type controls, recipient management.
- **Recipients** — bounded server-search candidate picker (up to 25 eligible per query, ≤ 1,000 rows scanned per call, multi-select persists across searches).
- **Templates** — 4 products × 2 variants, lazy preview, campaign snapshot lineage tracked via `template_id`/`variant`/`version` on every send event.
- **Email** — email-safe renderer, section visibility contract, required vs decorative asset preflight, `preflightCtaUrls` blocks `href="#"` / `javascript:` / relative / localhost in production.
- **Gmail** — `gmail.send` scope only. AES-256-GCM token encryption. Real Gmail Test restricted server-side to workspace-approved test recipients.
- **Buyer Send** — server-gated on `BUYER_SEND_ENABLED`, batch cap 10, suppression + idempotency DB-backed, server-resolved destination (no CC/BCC).
- **Overview** — premium dashboard (workspace-TZ anchored metrics, activity chart, pipeline, campaign progress, needs-attention, follow-ups, curated activity).
- **Settings → Developer → Production readiness** — auth-gated diagnostic panel that surfaces environment readiness with no secret values, no enable-Buyer-Send control.

## Safety state — verified

- `BUYER_SEND_ENABLED` remains false. Explicit parser in `src/lib/env.ts` accepts only `1` / `true` / `yes` / `on` — anything else → false.
- Buyer Send server action re-checks the gate immediately before Gmail is called.
- Batch cap = 10 hard-coded server-side.
- Recipient `to:` field is `buyer.email` resolved server-side by buyer id. No client-supplied recipient path.
- No CC / BCC anywhere in `src/lib/gmail/**` (grep-verified).
- Gmail scope is `gmail.send` only. No `readonly`, no `compose`, no `modify`, no inbox / messages.list references.
- No tracking pixel, no click tracking, no reply detection in the codebase.
- Production Readiness panel exposes status only — `console.warn` diagnostic never leaks raw secret values (regression-tested against a `REVEAL_ME_*` sentinel).

## Known intentional limitations

- **Full-workspace CSV export capped at 25,000 rows** — beyond that the operator sees a "refine your filter" toast rather than a silently truncated file. If MDF ever needs > 25k row exports we'll build a signed background job.
- **Activity** — full-fidelity read is still bounded (500 rows). Cursor pagination deferred; not currently urgent.
- **Renderer version drift** — campaign snapshots freeze content, not `renderer.ts` bytecode. Gmail-archived messages remain authoritative for what was actually sent. A future `email_send_events.renderer_version` column is documented as an optional migration if byte-level historical reproduction is ever required.
- **Buyers UI export** — always uses the current filter; on massive filtered exports the operator's browser holds the CSV string in memory before the download. Well within 25k-row envelope.
- **Timezone contract** — workspace TZ defaults to `Asia/Kolkata`. Invalid `MDF_WORKSPACE_TIMEZONE` env values fall back safely with a server warning.

## Buyer Finder — separately developed

Buyer Finder (candidate discovery, Hunter provider) is developed on a separate Cursor stream. F1–F9 has NOT modified `src/app/(app)/buyer-finder/**`, `src/components/buyerFinder/**`, `src/lib/buyerFinder/**`, Buyer Finder migrations, or Hunter provider code. F8 introduced an isolation guardrail (`src/lib/_f8.isolation.test.ts`) and the F6 dashboard test suite carries its own isolation check (`src/lib/dashboard/isolation.test.ts`).

Cross-import check at RC compile:
- **Main app (F1–F9 files) → Buyer Finder:** only `src/lib/dashboard/isolation.test.ts` references the tokens, and only as a NEGATIVE assertion.
- **Buyer Finder → protected Gmail / Buyer Send / RLS paths:** no imports found.

Buyer Finder is out of scope for this RC.

## Production launch approval

**Not yet approved.** RC 1 is the working baseline against which manual QA runs. The Buyer Send env flag will remain false until:

1. Manual QA (this document + [production-readiness.md](production-readiness.md)) is signed off.
2. A controlled Real Gmail Test succeeds to an approved internal recipient.
3. An operator flips `BUYER_SEND_ENABLED=true` in the deploy target explicitly.

Manual QA is still required. See [rc1-qa-checklist.md](rc1-qa-checklist.md) for the RC-scoped checklist.
