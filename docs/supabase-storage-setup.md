# MDF Outreach — Supabase Storage setup (Phase D1)

One-time, admin-only. Enables production hosting of email marketing
imagery for outbound campaigns.

**Never** paste service-role keys, database passwords, or OAuth secrets
into this chat. Everything below runs in the Supabase Dashboard.

---

## 1. Create the bucket

1. Open the Supabase Dashboard for project `yiydqpkanhsezqsrwnxg`.
2. Left sidebar → **Storage**.
3. Click **New bucket**.
4. Fill in exactly:
   - **Name**: `email-assets`
   - **Public bucket**: **ON** (email images must load for external
     recipients over HTTPS)
   - **File size limit**: `5 MB`
   - **Allowed MIME types**: `image/jpeg`, `image/png`, `image/gif`
5. Click **Save**.

**Do not** upload internal MDF documents, buyer information, contracts,
invoices, private company records, or credentials into this bucket. It
is public-read. Only outbound-safe marketing imagery belongs here.

---

## 2. Apply the Storage RLS policies

Public bucket means anonymous **READ** for anyone with the URL. We must
still restrict **WRITE / UPDATE / DELETE** to authenticated MDF workspace
members writing to their own workspace path.

Left sidebar → **SQL Editor** → **+ New query** → paste this and click
**Run**:

```sql
-- MDF Outreach — Storage RLS for the `email-assets` bucket.
-- Uses the existing mdf.is_member_of() helper from migration 0001.

-- INSERT: authenticated members may upload only into their own
-- workspace's top-level prefix. The first path segment IS the
-- workspace_id.
drop policy if exists "mdf_email_assets_insert" on storage.objects;
create policy "mdf_email_assets_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'email-assets'
    and mdf.is_member_of((storage.foldername(name))[1]::uuid)
  );

-- UPDATE: same rule.
drop policy if exists "mdf_email_assets_update" on storage.objects;
create policy "mdf_email_assets_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'email-assets'
    and mdf.is_member_of((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'email-assets'
    and mdf.is_member_of((storage.foldername(name))[1]::uuid)
  );

-- DELETE: same rule.
drop policy if exists "mdf_email_assets_delete" on storage.objects;
create policy "mdf_email_assets_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'email-assets'
    and mdf.is_member_of((storage.foldername(name))[1]::uuid)
  );

-- Public READ policy is created automatically when the bucket is
-- marked public. If the READ policy was removed manually, restore it:
drop policy if exists "mdf_email_assets_public_read" on storage.objects;
create policy "mdf_email_assets_public_read" on storage.objects
  for select to public
  using ( bucket_id = 'email-assets' );
```

That's it. Now:

- **Anyone with the URL** can `GET` an image (needed by email recipients).
- **Only authenticated MDF members** can `INSERT`, `UPDATE`, `DELETE`, and
  only for paths that begin with a workspace they belong to.
- Cross-workspace writes are blocked at the database level, not just in
  application code.

---

## 3. Apply the database migration

The app also needs the `email_assets` table to know about theme, storage
path, status, and alt text. Apply:

```
supabase/migrations/0006_email_asset_pipeline.sql
```

Same procedure as before — Dashboard → SQL Editor → paste the file → Run.

---

## 4. Verify

Dashboard → **Storage** → click `email-assets` → the bucket page should
show:

- **Public**: yes
- **File size limit**: 5 MB
- **Allowed MIME types**: `image/jpeg`, `image/png`, `image/gif`

Dashboard → **Authentication** → **Policies** → **storage.objects** → the
four policies above should be listed.

Dashboard → **SQL Editor** → run:

```sql
select policyname, cmd from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'mdf_email_assets%'
order by cmd;
```

Should return four rows (one each for select, insert, update, delete).

---

## 5. Ongoing hygiene

- **Never** grant `anon` write access to any Storage bucket.
- If a Dashboard team member accidentally uploads a private document here,
  delete it immediately — the bucket is public-read.
- Rotate `APP_SESSION_SECRET` if you suspect it has been exposed.
- Increase the bucket's file-size limit only if the asset pipeline
  itself allows larger uploads. The application refuses uploads above
  `MAX_ASSET_BYTES` (`src/lib/assets/storage.ts`), so raising the
  Dashboard limit alone will not accept larger files.
