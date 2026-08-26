# Buyer Send

Production Buyer Send is the controlled workflow that delivers real,
individually personalized outreach emails to MDF buyers via the connected
Gmail sender. It sits alongside Simulation and Real Gmail Test in the
Campaign → Send screen and is the only mode that will ever hand a buyer's
email address to Gmail.

This document is the reference for architecture, safety guarantees, and
QA procedure. Read it before enabling `BUYER_SEND_ENABLED`.

---

## Architecture at a glance

```
Client (Send page)
   │  select ready recipients (≤ 10)
   │  Confirm & Send
   ▼
sendBuyersAction(campaignId, buyerIds, batchNonce)     ← server action
   │
   ├── requireMdfSession()  — auth + MDF app-session
   ├── claim batch nonce    — email_send_idempotency (batch:nonce)
   ├── resolve campaign, template snapshot, settings, Gmail conn (server)
   ├── fetchAlreadySentBuyerIds  — from email_send_events
   │
   └── for each buyerId (sequential):
         · load buyer from repos.buyers.get(id)   ← workspace-scoped by RLS
         · verify recipient belongs to campaign
         · verify buyer not suppressed
         · verify buyer.email format
         · verify not already-sent
         · claim per-buyer nonce (buyer:campaignId:buyerId)
         · render SEND mode (Base64 forbidden) + personalize
         · fullPreflight(...)  — same check the review screen ran
         · gate: isBuyerSendEnabled() — false ⇒ refuse + audit
         · sendGmailMessage(...)   ← ONE call, ONE recipient
         · insert audit row (email_send_events, kind='buyer-send')
         · on success: promote buyer status (safely), touch recipient
```

The critical property: **each buyer is one Gmail message.** No CC, no
BCC, no shared recipients. This preserves personalization, privacy, and
buyer-level audit.

---

## Readiness

Every recipient of the selected campaign is classified into one of three
states by `src/lib/gmail/buyerSendReadiness.ts`:

| Status | Meaning |
|---|---|
| `ready` | All preconditions satisfied — eligible for selection |
| `blocked` | One or more preconditions failed — reason is shown |
| `already-sent` | A successful buyer-send event already exists for this (campaign, buyer) |

Ready requires ALL of the following:

- Buyer exists in this workspace (RLS enforced).
- Buyer is not suppressed.
- Buyer email is present and syntactically valid.
- Gmail sender is connected server-side.
- Campaign has a template snapshot.
- Campaign subject is present.
- Personalization resolves — no unresolved `{{tokens}}` in HTML or text.
- Every required production asset is present, in `production` status,
  with alt text (unless decorative).
- Rendered HTML contains **no Base64 / data-URL images.**
- Buyer has NOT been successfully sent this campaign before.

The same `fullPreflight()` runs on the review page *and* inside the send
action — what the operator sees is what the server enforces.

---

## Suppression ("Do not contact")

Suppression is a per-buyer flag with a required reason
(`manual` / `opted_out` / `invalid_email` / `other`) and a timestamp.
Enforcement is server-side: even if a suppressed buyer somehow reaches
`sendBuyersAction`, it is refused before Gmail is touched.

Actions:

- `suppressBuyerAction({ id, reason, note? })` — sets `suppressed=true`,
  writes an activity event `buyer.suppressed`, revalidates buyer pages.
- `unsuppressBuyerAction(id)` — clears the flags, writes
  `buyer.unsuppressed`.

Buyers are never deleted when suppressed.

---

## Batch limit

The first production version caps every batch at **10 buyers**. The cap is
a named constant so future phases can raise it deliberately:

- `BUYER_SEND_BATCH_MAX` in `src/lib/gmail/buyerSendConfig.ts`.
- Enforced client-side (the checkbox stops accepting selections at 10)
  AND server-side (a >10 batch is rejected outright — never reaches
  the loop).

---

## Duplicate protection

Duplicate protection is layered. Each layer is authoritative on its own,
but together they are the reason a browser refresh, double-click,
concurrent operator, or Vercel function retry cannot cause a second
delivery.

1. **Batch nonce** — every "Confirm & Send" click generates one UUID,
   claimed via `email_send_idempotency` (`batch:{uuid}`). A retry of the
   same nonce is refused before any Gmail call.

2. **Per-buyer claim** — each `(campaignId, buyerId)` is claimed
   BEFORE the Gmail call via `email_send_idempotency`
   (`buyer:{campaignId}:{buyerId}`). Two concurrent send loops targeting
   the same buyer collide at Postgres's unique constraint — the loser
   is refused and Gmail is called ONCE.

3. **Partial unique index** on `email_send_events (workspace_id,
   campaign_id, buyer_id) WHERE kind='buyer-send' AND ok=true`.
   Belt-and-suspenders: even if a race slipped past the claim, only
   one *successful* audit row can ever exist per buyer per campaign.

4. **Application check** — before each loop iteration we query
   `fetchAlreadySentBuyerIds` and refuse buyers that already have a
   successful event.

React state, disabled buttons, and Vercel instance memory are **not**
part of this defence. The database is the sole authority.

---

## Send lifecycle

Per buyer, in order:

1. Resolve recipient row (workspace-scoped via RLS).
2. Resolve buyer row.
3. Refuse if suppressed / invalid email / already sent / claim taken.
4. Personalize and render SEND-mode HTML + text.
5. `fullPreflight` — the exact HTML that would go to Gmail is checked.
6. Enforce `BUYER_SEND_ENABLED` gate.
7. `sendGmailMessage(...)` — one recipient, one call.
8. Record audit event in `email_send_events` (success OR failure).
9. On success: update buyer status safely and set
   `last_contacted_at`; mark the campaign recipient as `contacted`.

The loop is sequential — the first production version deliberately does
NOT run concurrent Gmail calls.

---

## Buyer status transitions

Governed by `src/lib/buyerStatus.ts`. After a successful send:

- `new` / `qualified` / `ready` → `contacted`.
- `contacted` → unchanged (still bump `last_contacted_at`).
- `replied` / `interested` / `quotation-sent` / `negotiating` /
  `converted` / `not-interested` → **never** modified.

`last_contacted_at` is always set to the send timestamp on success. It is
never set on failure.

---

## Failure handling

Each buyer's outcome is recorded independently.

- Gmail success ⇒ `email_send_events.ok=true`, buyer promoted,
  recipient contacted. Per-buyer claim retained.
- Gmail failure ⇒ `email_send_events.ok=false`, buyer/recipient
  **unchanged**, per-buyer claim released so a controlled retry is
  possible.
- Preflight failure (before Gmail is called) ⇒ per-buyer claim released,
  no audit row.
- Ambiguous Gmail response ⇒ conservative: audit as failure, claim
  released only if the Gmail call raised before HTTP send.

Failures for one buyer never invalidate successes for previous buyers.

---

## Audit records

Every buyer-send attempt writes one row to `email_send_events`:

- `workspace_id`, `campaign_id`, `buyer_id`, `kind='buyer-send'`,
  `recipient_email`, `subject`, `from_name`, `ok`, `error`,
  `gmail_message_id`, `gmail_thread_id`, `created_by`, `created_at`.

Refusals under the `BUYER_SEND_ENABLED=false` gate also write an
`ok=false` audit row with a descriptive `error` — this leaves a paper
trail during QA.

Activity events are logged too:

- `buyerSend.sent` — one per successful buyer.
- `buyerSend.failed` — one per failed/blocked buyer (except the "already
  sent" skip, which is silent).

---

## Safety gate — `BUYER_SEND_ENABLED`

Even after the workflow ships, real Gmail delivery is refused until this
env variable is explicitly set on the server:

- **Local development**: add `BUYER_SEND_ENABLED=true` to `.env.local`.
  Restart `next dev`.
- **Vercel (Production)**: Project → Settings → Environment Variables →
  add `BUYER_SEND_ENABLED=true` for the *Production* environment (do NOT
  select Preview or Development unless you want gated staging). Then
  redeploy — env vars only apply to fresh deployments.

**Do NOT prefix with `NEXT_PUBLIC_`.** The check is server-only, and any
client-visible flag would defeat the point.

Anything other than the literal string `"true"` (case-insensitive) or
`"1"` is treated as false.

---

## How to QA before enabling production

1. Confirm all env vars are set:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `APP_SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GMAIL_TOKEN_ENCRYPTION_KEY`, `APP_BASE_URL`. Leave
   `BUYER_SEND_ENABLED` unset or `false`.
2. Redeploy so the environment is fresh.
3. Connect Gmail (Settings → Email) if not already.
4. In Supabase, create 2–3 buyer rows with emails you control (internal
   addresses only). Attach them as recipients to a test campaign.
5. Open the campaign's Send tab → Buyer Send.
6. Verify the readiness summary is `2 or 3 Ready · 0 Blocked · 0
   Already sent`.
7. Click **Review recipients** — confirm each row is Ready.
8. Select all → **Continue** → **Confirm & Send**.
9. **Expected: every buyer is refused with a "BUYER_SEND_ENABLED is
   false" error.** No inbox receives anything. `email_send_events`
   contains one `ok=false` row per buyer with that message.
10. Set `BUYER_SEND_ENABLED=true` in Vercel Production, redeploy.
11. Repeat step 7–8. Real emails should now land in the internal
    inboxes. `email_send_events` contains one `ok=true` row per buyer
    with `gmail_message_id` populated.
12. Repeat the send with the SAME buyers. **Expected: `Already sent`
    status; Gmail is NOT called.**

Only after step 12 passes cleanly is Buyer Send considered live.

---

## Enabling production Buyer Send

1. QA above complete and green.
2. Vercel → Project → Settings → Environment Variables → add
   `BUYER_SEND_ENABLED=true` for *Production*.
3. Deployments → latest → Redeploy (do NOT reuse build cache).
4. Once READY, run a final smoke test with your own inbox as a buyer.
5. Document who enabled it, when, and why, in the campaign audit trail.

---

## What is deliberately NOT implemented (future phases)

- Gmail inbox reading / reply detection.
- Email open tracking / tracking pixels.
- Click-tracking redirects.
- Automatic follow-up / scheduled sends.
- Bounce processing.
- Arbitrary resend button (blocked resend is only via manual removal
  of the audit row in Supabase, which should be avoided).
- Batch sizes > 10.
- CC/BCC campaigns.
- Additional Google OAuth scopes.

These will each be their own controlled phase.
