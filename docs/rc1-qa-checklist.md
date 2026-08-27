# MDF Outreach — RC 1 Manual QA Checklist

Concise operator-run QA. Complements [production-readiness.md](production-readiness.md); does not duplicate its content.

**Precondition:** `BUYER_SEND_ENABLED` remains **false** for every step below. No live external outreach.

---

## Auth & sidebar

- [ ] Sign in as an MDF workspace member — redirects to Overview.
- [ ] Sign out — auth cookie cleared; protected routes redirect to `/login`.
- [ ] Sidebar shows MDF logo, orange active indicator, `Cloud · Supabase` footer.

## Overview

- [ ] Metric cards populate (Total buyers · Active campaigns · Emails sent · Follow-ups).
- [ ] Range selector `7D / 30D / 90D` updates the outreach activity chart, the emails-sent trend, and the buyers-added sparkline. Other metrics do not react.
- [ ] Empty workspace state renders the calm "Set up your first outreach" panel without broken zero labels.
- [ ] Buyer pipeline segmented bar sums to totalBuyers.
- [ ] Campaign progress shows up to 5 rows, active-first, with Delivered / Remaining / Suppressed labels.
- [ ] Needs attention lists overdue follow-ups, follow-ups today, suppressed recipients per active campaign, and Gmail-disconnected when applicable.
- [ ] Recent activity shows curated events (no `campaign.updated`, `settings.updated`, `email.prepared` noise).

## Buyers

- [ ] `/buyers` loads the first 25 rows; the header shows `1–25 of N`.
- [ ] Search debounces (~300 ms), updates the URL, and returns server-filtered results. Long searches (> 128 chars) are safely truncated.
- [ ] Status / Country / Product filters each reset page to 1 and re-fetch from the server.
- [ ] `?country=UAE` renders "UAE · Legacy" in the country chip; results are exact-matched.
- [ ] `?product=Cardamom` renders "Cardamom · Legacy"; results are exact-matched.
- [ ] BuyerForm's country and product remain canonical-only — no free-text creation.
- [ ] Pagination Prev/Next disable at boundaries; page-size 25/50/100 updates the URL and resets to page 1.
- [ ] A bookmarked `?page=99` on a smaller filter lands on the last valid page — no broken empty screen.
- [ ] Add buyer / edit buyer / delete buyer / suppress buyer round-trip refreshes the current filter.
- [ ] CSV import — imported rows appear in the filtered list.

## CSV export

- [ ] Apply a filter, click Export. Downloaded CSV contains **every** row across all pages, not just the visible page.
- [ ] Filename is `mdf-buyers-YYYY-MM-DD.csv`.
- [ ] Success toast reads `Exported N buyers`.
- [ ] On a > 25,000-row filter, operator sees the "safety limit — refine the filter" toast; no truncated file downloads.
- [ ] Buyer whose company is `=cmd|calc` — open the CSV in Excel or Google Sheets: cell shows literal text, no formula runs.
- [ ] Buyer with commas, quotes, or newlines in notes — CSV round-trips correctly.

## Campaigns

- [ ] Create a new campaign — the workspace `defaultCtaUrl` is seeded into hero / packing / cta section snapshots that ship without a URL.
- [ ] Editing a master template does NOT alter an existing campaign's snapshot.
- [ ] Composer preheader is campaign-owned; Settings `defaultPreheader` seeds only new campaigns.
- [ ] Campaign preview renders exactly the same HTML that Send/Gmail Test would produce.

## Recipients

- [ ] `/campaigns/<id>/recipients` opens without downloading the full buyer roster (verify via Network panel — no `list` request returning hundreds of buyer rows).
- [ ] Add Buyers modal shows "Start typing…" initially.
- [ ] Search debounces, returns up to 25 eligible rows, and never contains a buyer already on the campaign.
- [ ] Regression check: create a campaign where the first 50 matching buyers are recipients, then search — the modal still returns eligible rows from position 51+.
- [ ] Very common search on a large workspace triggers "Too many matches to scan. Refine your search." rather than a false empty.
- [ ] Multi-select persists across successive searches. "Selected: X, Y, +Z more" summary is truthful.
- [ ] Adding recipients closes the modal and refreshes the campaign list.

## Templates / Preview

- [ ] Templates gallery uses `LazyEmailPreview` — iframes do not eagerly mount.
- [ ] Every of the 8 masters renders in the gallery (4 products × Signature/Direct).
- [ ] Per-product decorative SVG mark visible in the hero card top-right.
- [ ] Editorial masthead visible above the hero.
- [ ] Direct variant is visibly shorter and structurally different from Signature.
- [ ] Hidden Signature `hero` / `packing` / `heritage` / `cta` sections do not render.
- [ ] Hidden Direct `hero` / `cta` still respect the F1 visibility contract.

## Preflight (CTA URL contract)

- [ ] Composer with a visible CTA whose URL is `#` — Gmail Test dry-run shows "…not a valid absolute web, email, or telephone link." blocker.
- [ ] Hidden CTA → no CTA-URL blocker even when URL is empty.
- [ ] Direct campaign with no CTA label anywhere → no CTA-URL blocker.
- [ ] Absolute `https://…`, `mailto:hello@…`, and `tel:+…` URLs all pass preflight.
- [ ] `javascript:` / relative / localhost URLs all block preflight.

## Gmail Test

- [ ] Real Gmail Test succeeds only to a workspace-approved test recipient. Attempts to alter the `to:` field client-side do not change server behaviour.
- [ ] Test recipients list is managed on Settings → Email; adding/removing emits audit events.
- [ ] Rendered result in Gmail Web + Gmail Mobile + one Outlook client — no layout breakage.

## Buyer Send safety (audit only — do NOT enable)

- [ ] `BUYER_SEND_ENABLED` is absent or false in the deploy target.
- [ ] Attempting to send from the UI without the gate flipped surfaces the server-side "not enabled on this server" message.
- [ ] No CC / BCC control exists in the UI or in the server action.
- [ ] Batch cap 10 is enforced server-side (attempting to submit > 10 ids returns a bounded batch).

## Settings → Developer → Production readiness

- [ ] Panel renders `Ready` / `Missing` / `Invalid` badges per required env var. No raw secret values displayed anywhere.
- [ ] Refresh button re-invokes the auth-gated action.
- [ ] `Buyer Send` row reads `false (safe default)` and the copy explicitly says the panel cannot enable it.
- [ ] Workspace timezone shows `Ready` when set (or the "defaults to Asia/Kolkata" note when unset).

## Global sanity

- [ ] `/activity` renders full-fidelity events, up to 500 rows, grouped by day.
- [ ] Login/logout works cleanly across a full Overview → Buyers → Campaigns → Templates → Settings round trip.
- [ ] Responsive: 1440, 1280, 1024, 768, 390 — no horizontal page overflow on Overview / Buyers / Recipients modal.
- [ ] Accessibility: pagination controls, filter combos, and modal candidate list are keyboard-navigable and announce state via `aria-live` / `aria-busy`.
- [ ] No console errors on any of the routes above.

## Sign-off

- Manual QA operator: _______________  Date: _______
- Real Gmail Test operator: _______________ Date: _______  Test recipient: _______________
- Production launch approver (only once every box above is green + Real Gmail Test succeeded): _______________ Date: _______

Only after this document is fully signed off may `BUYER_SEND_ENABLED=true` be set in the deploy target.
