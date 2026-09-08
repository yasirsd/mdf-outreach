# Market Intelligence MI1C — server credential boundary

Market Intelligence global-write RPCs execute as PostgreSQL `service_role`.
MDF authenticates those server-side API requests with Supabase's modern
Secret API Key; the credential name and the database role are intentionally
different concepts.

## Credential contract

- Preferred and only accepted backend credential: Supabase Secret API Key
  (`sb_secret_...`).
- Server environment variable: `SUPABASE_SECRET_KEY`.
- Project URL: `NEXT_PUBLIC_SUPABASE_URL`.
- `SUPABASE_SERVICE_ROLE_KEY` is not supported as a legacy fallback because
  MDF never provisioned it before adopting Secret API Keys.
- `NEXT_PUBLIC_SUPABASE_SECRET_KEY` and every other browser-visible secret
  name are forbidden.

The credential is read only by
`src/lib/marketIntelligence/server/serviceRoleClient.ts`, which is protected
by `import "server-only"`. It creates a no-cookie, non-persistent Supabase
client and exposes it only to the narrow Market Intelligence writer. Missing,
blank, publishable, legacy JWT-shaped, or malformed credentials fail closed.
Caller-facing action and route errors remain the fixed
`configuration_error` response and never include the key or Supabase details.

Supabase Secret API Keys authenticate API requests using PostgreSQL
`service_role`, so the `GRANT EXECUTE ... TO service_role` statements in
applied migrations 0022 and 0023 remain correct. No schema migration or role
rename is required.

## First production provisioning

1. In the existing MDF Supabase project, create or copy a backend Secret API
   Key whose value begins with `sb_secret_`.
2. Add it to the server/deployment environment as `SUPABASE_SECRET_KEY`.
   Never use a `NEXT_PUBLIC_` prefix and never place the value in source,
   documentation, chat, screenshots, or client configuration.
3. Confirm `NEXT_PUBLIC_SUPABASE_URL` points to the same Supabase project.
4. Redeploy/restart the server so it receives the new environment variable.
5. Sign in as an MDF owner and invoke the same-origin internal Product-to-HS
   mapping sync exactly once. Members and unauthenticated callers remain
   denied.
6. Verify the sanitized sync summary and the resulting mapping rows through
   normal authenticated read paths. Rotate/delete the key immediately if its
   value was exposed.

Provisioning the key does not enable Buyer Send, call BACI, or grant a browser
any elevated database capability.
