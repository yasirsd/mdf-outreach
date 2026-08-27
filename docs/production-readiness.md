# MDF Outreach — Production Readiness

Internal launch checklist. **`BUYER_SEND_ENABLED` remains false until this document is signed off and a controlled internal Gmail Test has succeeded.**

This document does not contain secrets. Values (URLs, keys, tokens) live only in the deploy target's environment configuration.

---

## Authentication & workspace

- Every application route runs under `requireMdfSession` — Supabase user, MDF app-session cookie, and MDF workspace membership are all verified server-side (see `src/lib/auth/require.ts`, `src/utils/supabase/middleware.ts`).
- Auth cookies: HTTP-only, `SameSite=Lax`, `Secure` in production.
- App-session cookie is HMAC-signed with `APP_SESSION_SECRET` (min 32 characters). See `src/lib/auth/session.ts`.
- Workspace isolation is enforced by Supabase RLS policies on every business table (`buyers`, `campaigns`, `campaign_recipients`, `email_templates`, `email_assets`, `activity_events`, `workspace_settings`, `email_send_events`, `email_send_idempotency`). See migrations `0002_business_tables.sql` onwards.
- No unauthenticated route reaches business data. `/api/auth/sign-out` / `/api/app-session/touch` handle session lifecycle only.

## Gmail

- OAuth scope: **`https://www.googleapis.com/auth/gmail.send` only.** No inbox read. No message list. No thread read. See `src/lib/gmail/config.ts`.
- Tokens are AES-256-GCM encrypted at rest with `GMAIL_TOKEN_ENCRYPTION_KEY`. Key is server-only — never `NEXT_PUBLIC_`. Refresh tokens are re-encrypted on rotation.
- No tracking pixel, no click tracking, no read receipt.
- **Real Gmail Test**: sends only to workspace-approved internal test recipients maintained by an operator on the Settings page (`gmail_test_recipients`). Never sends to a buyer.

## Buyer Send

- **Feature gate:** `BUYER_SEND_ENABLED` env var. Parsed by `src/lib/env.ts#isBuyerSendEnabled` — accepts only `1`, `true`, `yes`, `on` (case-insensitive). Absent or any other value → false. Enforced server-side in `src/app/(app)/campaigns/buyerSendActions.ts`; UI state cannot bypass it.
- **Batch cap:** hard-coded server-side to 10 in `src/lib/gmail/buyerSendConfig.ts`. Every request is bounded before Gmail is called.
- **Suppression:** enforced server-side. `buyers.suppressed` is checked in the readiness classifier and re-checked immediately before the send. See `src/lib/gmail/buyerSendReadiness.ts`.
- **Idempotency:** per-buyer nonce claim on `email_send_idempotency` before Gmail call + partial unique index on `email_send_events (workspace_id, campaign_id, buyer_id) where kind='buyer-send' AND ok=true`. Concurrent duplicate requests raise 23505. See migration `0011_buyer_send.sql`.
- **Recipient destination:** always `buyer.email` resolved server-side by id. UI never supplies an arbitrary recipient. No CC, no BCC.
- **Preflight:** `fullPreflight` (in `src/lib/gmail/preflight.ts`) runs at UI review time AND immediately before the Gmail call. Blocks on: missing template snapshot, empty subject, missing required production assets, Base64 in HTML, unresolved personalization tokens, **and (F8) invalid CTA URLs** for any button that actually renders.

## Email

- **Campaign snapshot semantics:** on campaign creation, sections + subject + preheader + theme + variant + CTA URL are copied into the campaign row (`campaigns.email_sections`, `campaigns.subject`, `campaigns.preheader`). Later edits to the master template do NOT mutate existing campaigns. See `src/lib/email/effectiveSections.ts`.
- **Preheader ownership:** campaign-owned once present; workspace `settings.email.defaultPreheader` seeds the initial snapshot only.
- **CTA URL contract (F8):** `preflightCtaUrls` (in `src/lib/email/ctaUrl.ts`) validates any CTA that will actually render. Accepted: absolute `https://` / `http://`, `mailto:` with a valid address, `tel:` with a phone number. Rejected: empty, `#`, `javascript:`, `data:`, `blob:`, `vbscript:`, `file:`, `ftp:`, relative paths, localhost, `127.0.0.1`, malformed URLs. Hidden or unlabeled buttons don't trigger the check.
- **Required production assets:** derived from the sections the send renderer will actually emit for the campaign + variant. See `src/lib/email/sendPreflight.ts` and `sectionAssetRequirements.ts`. Hero / origin / packing / product-variants required only when their sections are visible. Decorative slots (`texture`, `divider`, `doodle`, `wave-band`) never block a send.
- **Send-mode asset gating:** in `mode: "send"`, assets without `status === "production"` and a hosted `productionUrl` render the placeholder — never Base64.
- **Renderer versioning:** the renderer is executable shared code. See "Renderer version" below.

## Data

- **RLS**: all business tables have per-workspace row-level security. Anon access returns 0 rows. Direct SQL access is available only via Supabase Dashboard to admins.
- **Workspace isolation**: `serverRepositories()` binds every repository to the caller's `workspace_id` — session-derived, never client-provided.
- **Activity events**: append-only, workspace-scoped. `/activity` is full-fidelity. Overview curates a small operator-meaningful subset.

## Configuration

The following env variables are required at runtime. Values live only in the deploy target's environment configuration.

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Supabase anon key (RLS-protected). |
| `APP_SESSION_SECRET` | yes | HMAC secret for the MDF app-session cookie. Minimum 32 characters. |
| `GOOGLE_CLIENT_ID` | yes | Google OAuth client id. |
| `GOOGLE_CLIENT_SECRET` | yes | Google OAuth client secret. |
| `GMAIL_TOKEN_ENCRYPTION_KEY` | yes | AES-256-GCM key (32 bytes, hex or base64). |
| `APP_BASE_URL` | yes | Absolute base URL (`https://…`) for OAuth callbacks + email `List-Unsubscribe` links. |
| `MDF_WORKSPACE_TIMEZONE` | no | IANA timezone for dashboard calendar anchoring. Defaults to `Asia/Kolkata`. Invalid values safely fall back. |
| `BUYER_SEND_ENABLED` | no | `true` / `1` / `yes` / `on` to enable Buyer Send. Absent or anything else → false. |

The diagnostic helper `describeEnvironment` (in `src/lib/env.ts`) reports the status of every entry without ever returning the raw value.

## Pre-launch checklist

- [ ] All env vars above set in the deploy target. Confirmed via `describeEnvironment` in a startup log or `/api` route (never expose to a client).
- [ ] `BUYER_SEND_ENABLED` is **absent or `false`**.
- [ ] `GMAIL_TOKEN_ENCRYPTION_KEY` was generated with a CSPRNG and is 32 bytes.
- [ ] `APP_SESSION_SECRET` is at least 32 characters and was generated with a CSPRNG.
- [ ] Google OAuth callback URL is set to `${APP_BASE_URL}/api/gmail/oauth/callback`.
- [ ] Supabase RLS spot-check: `set role anon; select count(*) from buyers;` returns permission denied / 0.
- [ ] All 8 email masters render without invalid-CTA blockers when a workspace `defaultCtaUrl` is configured.
- [ ] At least one campaign has been created and validated end-to-end with the composer.
- [ ] Approved production assets uploaded for every product family MDF is currently sending. Non-production statuses cannot escape into a send.
- [ ] Real Gmail Test succeeded to an approved internal recipient. Rendered result inspected in Gmail Web, Gmail Mobile, and one Outlook client.
- [ ] Workspace backup export downloaded and stored securely.
- [ ] Manual QA of Overview, Buyers, Campaigns, Templates, Settings against F4/F5/F6 design.
- [ ] Sign-off recorded internally. Only then is `BUYER_SEND_ENABLED` flipped to `true`.

## Renderer version

`src/lib/email/renderer.ts` is executable shared code. Campaign snapshots freeze CONTENT (sections, copy, theme, variant, subject, preheader, CTA URL) — they do NOT freeze the renderer. A renderer deployment after a send therefore changes how a HISTORICAL campaign would render if re-rendered, but does not alter what was actually delivered (Gmail archived that message).

Send audit metadata (`email_send_events.template_id`, `template_variant`, `template_version`) records which content snapshot produced each send. To reconstruct the visual rendering of a historical send with byte-level accuracy, we would also need to know which git commit of `renderer.ts` was live at that timestamp — currently derivable from deploy logs and the `template_version` audit column, but not from the DB alone.

**Decision (F8):** we accept this contract for now. If auditability ever requires reproducing the exact rendered HTML for a past send, an additional column `email_send_events.renderer_version` (short string, e.g. the git sha) is the minimal schema change required. **This is deliberately not applied in F8 — flagged here as a possible future migration.**

## What is NOT in scope

- Open / click / reply tracking. Not implemented and not planned.
- Inbox reading. Gmail scope is send-only.
- Marketing automation / drip flows. Not implemented and not planned.
- Third-party email provider fallback. Gmail is the single send path.
