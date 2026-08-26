# MDF Outreach — Gmail send-only setup (Phase D2/D3A)

One-time setup. Everything below runs in the Google Cloud Console, the
Vercel Dashboard, and your local shell. **Do not paste Google secrets
into this chat.** Everything sensitive goes into env files or the Vercel
Environment Variables screen.

Buyer sending stays disabled everywhere in the app until visual QA of
delivered Gmail is signed off. This setup only enables **Real Gmail Test**
sends to approved MDF test inboxes.

---

## 1. Google Cloud project + Gmail API

1. Open <https://console.cloud.google.com>.
2. Top bar → project selector → **New Project**.
   - Name: `MDF Outreach`
   - Save.
3. Left sidebar → **APIs & Services** → **Enabled APIs & Services** →
   **+ Enable APIs and Services**.
4. Search **Gmail API** → **Enable**.

## 2. OAuth consent screen

1. Left sidebar → **APIs & Services** → **OAuth consent screen**.
2. **User Type**: choose **Internal** (Google Workspace only — Ext requires app verification).
   If MDF Google Workspace uses a `mdfexport.com` primary domain, Internal is correct.
3. **Create**.
4. **App information**:
   - **App name**: `MDF Outreach`
   - **User support email**: your Google Workspace admin email
   - **App logo**: optional
5. **App domain**:
   - **Application home page**: `https://outreach.mdfexport.com` (or your Vercel URL)
   - **Application privacy policy**: any internal URL that exists
   - **Application terms of service**: any internal URL that exists
6. **Authorized domains**: add the top-level domain of the app (e.g. `vercel.app` or
   `mdfexport.com` — whichever matches your Vercel deployment).
7. **Developer contact information**: your admin email.
8. **Save and Continue**.
9. **Scopes**:
   - **Add or Remove Scopes** → filter for `gmail.send`.
   - Tick **`https://www.googleapis.com/auth/gmail.send`** — this is the ONLY Gmail
     scope MDF Outreach requests. Do not add `gmail.readonly`, `gmail.modify`,
     `gmail.compose`, contacts, calendar, or drive.
   - Also tick the two OpenID scopes: **`openid`** and **`.../auth/userinfo.email`**.
   - **Update** → **Save and Continue**.
10. **Test users** (only if User Type = External): add the specific test emails.
    For Internal, skip.
11. Back to Dashboard.

## 3. OAuth client

1. Left sidebar → **APIs & Services** → **Credentials**.
2. **+ Create Credentials** → **OAuth client ID**.
3. **Application type**: **Web application**.
4. **Name**: `MDF Outreach — Web`.
5. **Authorized redirect URIs** → **+ Add URI**. Add BOTH:
   - `http://localhost:3000/api/gmail/oauth/callback`
   - `https://<your-vercel-domain>/api/gmail/oauth/callback`
     (e.g. `https://outreach.mdfexport.com/api/gmail/oauth/callback` or the Vercel
     preview URL if you use one).
6. **Create**.
7. Copy the **Client ID** and **Client Secret**. **Do not paste them here.**
   Put them into env vars (below).

## 4. Local `.env.local`

Generate a dedicated Gmail token encryption key (server-only, separate
from `APP_SESSION_SECRET`):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Add these to your existing `.env.local`:

```
GOOGLE_CLIENT_ID=<the client id from step 3.7>
GOOGLE_CLIENT_SECRET=<the client secret from step 3.7>
GMAIL_TOKEN_ENCRYPTION_KEY=<the random 48-byte base64 value from the command above>
APP_BASE_URL=http://localhost:3000
```

**Never** prefix these with `NEXT_PUBLIC_`. They must remain server-only.

> Note on rotation: `APP_SESSION_SECRET` and `GMAIL_TOKEN_ENCRYPTION_KEY`
> are deliberately independent. Rotating `APP_SESSION_SECRET` signs out
> MDF users but does **not** invalidate stored Gmail tokens. Rotating
> `GMAIL_TOKEN_ENCRYPTION_KEY` invalidates every stored Gmail connection
> (operators must reconnect Gmail) but does **not** sign users out.

Restart `npm run dev` so Next re-reads the env.

## 5. Vercel production env

Vercel Dashboard → your project → **Settings** → **Environment Variables**. Add for
**Production** and **Preview**:

- `GOOGLE_CLIENT_ID` = same client id
- `GOOGLE_CLIENT_SECRET` = same client secret
- `GMAIL_TOKEN_ENCRYPTION_KEY` = a **new** 48-byte base64 value (do NOT reuse
  the local one — production tokens should be encrypted under a value that only
  Vercel holds)
- `APP_BASE_URL` = `https://outreach.mdfexport.com` (your production origin)

Do **not** add them to `Development` — that would ship them to your local build.

Redeploy after saving.

## 6. Database migrations

Apply **both** Gmail migrations in order (Dashboard → SQL Editor → paste →
**Run**, once each):

1. [`supabase/migrations/0008_gmail_send_only.sql`](../supabase/migrations/0008_gmail_send_only.sql)
   — creates `gmail_connections`, `email_test_recipients`,
   `email_send_events` with workspace-scoped RLS.
2. [`supabase/migrations/0009_email_send_idempotency.sql`](../supabase/migrations/0009_email_send_idempotency.sql)
   — creates the `email_send_idempotency` table that backs the
   database-atomic send-nonce claim (safe across Vercel instances) plus
   an optional `mdf.prune_send_idempotency()` housekeeping helper.

Both files end with `notify pgrst, 'reload schema';` so PostgREST picks
up the new tables immediately.

## 7. First test flow

1. Sign in to MDF Outreach as an MDF workspace member.
2. **Settings → Email** → **Approved delivery addresses** → add at least one MDF
   test inbox you actually control (e.g. `you@mdfexport.com`).
3. In the same screen, click **Connect Gmail**. Google will prompt for the
   `gmail.send` + `openid`/`email` scopes only. Consent.
4. You should return to Settings → Email with a green banner
   "Gmail sender connected." and the connected email shown.
5. Open a Guntur campaign → **Send** tab → pick **Real Gmail Test**.
6. Select the buyer to preview as, and the approved delivery address.
7. **Run preflight** — resolves any missing production asset / unresolved token /
   subject blockers before sending.
8. **Deliver Gmail Test** — confirm the dialog.
9. Check the destination inbox for the delivered email. The actual campaign
   buyer receives nothing; buyer status is never changed.

## 8. Ongoing hygiene

- Rotate `APP_SESSION_SECRET` invalidates every stored Gmail token. All workspaces
  must reconnect Gmail after such a rotation. This is deliberate.
- **Disconnect** in Settings → Email revokes the connection on our side. If you
  also want to revoke Google's copy of the token, do it at
  <https://myaccount.google.com/permissions>.
- Every test send is recorded in `email_send_events` with the returned Gmail
  message + thread id, whether it succeeded or failed.
- Buyer sending is intentionally not implemented yet. Do **not** grant broader
  Gmail scopes (`gmail.modify`, `gmail.readonly`, `contacts`, etc.) — the app
  does not use them and requesting them would trigger Google verification
  requirements.
