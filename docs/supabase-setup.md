# MDF Outreach — Supabase setup

This is the manual, one-time procedure for bringing up the production
Supabase project for MDF Outreach. Everything Claude cannot do itself
(clicks in the Supabase Dashboard, entering passwords, applying SQL)
is listed here.

Nothing on this page should be shared publicly. Do not paste passwords,
service-role keys, or JWT secrets into chat.

---

## 1. Prerequisites

- The Supabase project (`yiydqpkanhsezqsrwnxg`) already exists.
- You have access to the Supabase Dashboard as an admin.
- The publishable key and project URL are already in `.env.local`:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `APP_SESSION_SECRET` in `.env.local` is a strong random value (≥ 32
  chars). Regenerate for each new environment:

  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
  ```

**Never** put `service_role` or any secret Supabase key into `.env.local`
or any file that ships to the browser. Browser variables must begin with
`NEXT_PUBLIC_` and hold nothing sensitive.

---

## 2. Disable public sign-up

MDF Outreach is a private company application. Only accounts explicitly
provisioned by MDF are allowed.

1. Open the Supabase Dashboard.
2. Left sidebar → **Authentication**.
3. Top tab → **Sign In / Providers**.
4. Find the **Email** provider row → click **Configure** (or the pencil).
5. Set:
   - **Enable Email provider** → ON.
   - **Allow new users to sign up** → **OFF**. ← this is the critical
     setting; without it any visitor with the login URL could create an
     account.
   - **Confirm email** → ON (recommended).
6. Click **Save**.

Then:

7. Left sidebar → **Authentication** → **Providers** page.
8. Confirm every non-Email provider (Google, GitHub, etc.) is **disabled**.
9. Left sidebar → **Authentication** → **URL Configuration**.
10. **Site URL**: set to your deployed origin (e.g.
    `https://outreach.mdfexport.com`) or `http://localhost:3000` during
    development.
11. **Redirect URLs**: add
    `https://<your-origin>/auth/callback` and, for local dev,
    `http://localhost:3000/auth/callback`.
12. **Save**.

---

## 3. JWT / session TTLs

MDF enforces its 30-minute idle timeout and 8-hour absolute lifetime in
application code (see `src/lib/auth/session.ts`). Supabase JWT settings
are defense in depth only.

1. Dashboard → **Project Settings** → **Auth**.
2. Find **JWT expiry limit** and set it to `3600` (1 hour) — the
   Supabase-recommended minimum for a typical web app. Short access
   tokens keep the blast radius small if one is ever leaked, while
   Supabase's refresh-token rotation keeps sessions usable within the
   MDF 8-hour cap.
3. Do **not** set the refresh-token TTL as the sole enforcement of the
   8-hour cap. Refresh rotation is not our fixed-session mechanism.
4. Save.

---

## 4. Apply database migrations

The SQL files under `supabase/migrations/` create the schema, RLS
policies, and grants. Run them in order.

Option A — Supabase CLI (recommended once the CLI is installed):

```bash
supabase link --project-ref yiydqpkanhsezqsrwnxg
supabase db push
```

Option B — Dashboard SQL editor (no CLI needed):

1. Dashboard → **SQL Editor** → **+ New query**.
2. Copy the contents of `supabase/migrations/0001_workspaces.sql`, paste,
   click **Run**. Wait for success.
3. Repeat for `0002_business_tables.sql`.
4. Repeat for `0003_rls_grants.sql`.

After the third file finishes, RLS is enabled on every business table
and anonymous access is fully denied.

---

## 5. Create the first authorized MDF user

Only accounts you explicitly create here can enter MDF Outreach.

1. Dashboard → **Authentication** → **Users** tab.
2. Click **+ Add user** → **Create new user**.
3. **Email**: enter the real MDF operator's email address.
4. **Password**: click **Generate a random password**, or type a strong
   one you will share out-of-band. **Do not** paste passwords into this
   chat window.
5. Toggle **Auto Confirm User** → **ON** (skips the email confirmation
   click; only appropriate because you created this account yourself).
6. Click **Create user**.
7. Send the credentials to the MDF operator through a secure channel
   (password manager share, encrypted DM). They can change the password
   themselves via `/auth/reset-password` after their first login.

---

## 6. Provision the MDF workspace + owner membership

This is a one-time SQL step. It creates the MDF workspace row and marks
the user you just created as its `owner`.

1. Open `supabase/bootstrap.sql` in this repo.
2. Copy the whole file.
3. Dashboard → **SQL Editor** → **+ New query**.
4. Paste.
5. Replace **both** occurrences of `<MDF_USER_EMAIL>` with the exact
   email you used in step 5. Do not paste this into chat.
6. Click **Run**.
7. Confirm the `NOTICE` at the bottom shows a `workspace_id` and
   `owner_user_id`. If it raised an exception, the auth user probably
   isn't created yet — re-do step 5, then re-run.

**Do not** commit this file with a real email in it — treat it as a
one-shot template.

---

## 7. Verify the security state

Run these checks in the SQL editor:

```sql
-- Should return exactly one row.
select id, name, slug from public.workspaces;

-- Should return exactly your one authorized MDF user.
select wm.user_id, u.email, wm.role, wm.active
  from public.workspace_members wm
  join auth.users u on u.id = wm.user_id;

-- Should all be zero.
select
  (select count(*) from public.buyers)              as buyers,
  (select count(*) from public.campaigns)           as campaigns,
  (select count(*) from public.campaign_recipients) as campaign_recipients,
  (select count(*) from public.activity_events)     as activity_events;
```

If those numbers match, the production database is clean.

---

## 8. Verify anon access is denied

From the client (or any browser tab), open the DevTools console with
the app loaded and confirm the anonymous key cannot read business data:

```js
const { createClient } = await import('@supabase/supabase-js');
const s = createClient(
  '<NEXT_PUBLIC_SUPABASE_URL>',
  '<NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY>',
);
console.log(await s.from('buyers').select('*'));
// Expect: { data: [], error: null }  ← RLS silently filters to 0 rows.
// (Some Supabase versions return an explicit error; either result is fine
// as long as no buyer rows come back.)
```

---

## 9. Adding future MDF users

For every additional MDF operator, repeat sections 5 and 6:

- Section 5 creates the Auth user.
- Section 6 (the bootstrap SQL) can be re-used, but only the
  `insert into public.workspace_members ...` block needs to run — the
  `insert into public.workspaces` will no-op via `on conflict`.

Alternatively, run this one-line SQL (replace both placeholders):

```sql
insert into public.workspace_members (workspace_id, user_id, role, active)
select w.id, u.id, 'member', true
  from public.workspaces w, auth.users u
  where w.slug = 'mdf'
    and lower(u.email) = lower('<NEW_MDF_USER_EMAIL>')
on conflict (workspace_id, user_id) do update set active = true;
```

Never expose a "create user" button in the app. All provisioning happens
here, in the Supabase Dashboard.

---

## 10. Corporate TLS interception (Avast, Zscaler, Netskope, etc.)

MDF workstations run Avast Antivirus, which intercepts HTTPS and re-signs
certificates with a local root CA installed in the Windows Certificate Store.
Node.js does not read that store by default, so `fetch` from the Next.js
dev server to Supabase fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` unless
you tell Node about the local CA.

Avast's installer sets a system-wide User env var that fixes this for you:

```text
NODE_EXTRA_CA_CERTS = C:\ProgramData\Avast Software\Avast\wscert.pem
```

Verify it's set in a fresh PowerShell:

```powershell
$env:NODE_EXTRA_CA_CERTS
```

If the value is blank (or points to a file that doesn't exist), the app's
login page will show "Cannot reach the authentication server." Fix it with:

- **Preferred**: reinstall/repair Avast so it re-injects the env var and
  reissues the PEM. Then open a **fresh** PowerShell so the new env is
  inherited.
- **Alternative**: on Node 22.5+ start the dev server with
  `--use-system-ca`, which reads the Windows Certificate Store directly:

  ```powershell
  $env:NODE_OPTIONS = "--use-system-ca"
  npm run dev
  ```

**Never** set `NODE_TLS_REJECT_UNAUTHORIZED=0` on an MDF machine — it
disables the very verification we're enforcing everywhere else.

---

## 11. Ongoing hygiene

- Rotate `APP_SESSION_SECRET` if you suspect it has been exposed. Every
  active user will be signed out and forced to log in again.
- Never place `service_role` or `SUPABASE_SERVICE_ROLE_KEY` into an
  `.env.local` that ships with the app. Only use it in one-off admin
  scripts, and never with a `NEXT_PUBLIC_` prefix.
- Never seed fictional business data into production.
