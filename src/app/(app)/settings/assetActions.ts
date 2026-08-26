"use server";

import { revalidatePath } from "next/cache";
import { randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { serverRepositories } from "@/lib/repositories/server";
import { logActivity } from "@/lib/activity";
import type { AssetRecord, AssetStatus } from "@/lib/types";
import type { ProductKey } from "@/lib/email/themes/types";
import { PRODUCT_THEMES } from "@/lib/email/themes/registry";
import { findSlotSpec } from "@/lib/assets/slots";
import {
  ALLOWED_EMAIL_MIME_TYPES,
  EMAIL_ASSET_BUCKET,
  MAX_ASSET_BYTES,
  assertPathInWorkspace,
  buildStoragePath,
  isAllowedEmailMime,
} from "@/lib/assets/storage";
import { friendlyAssetError } from "@/lib/assets/errors";

/*
 * Security invariants held by every action in this file:
 *
 *   1. `themeKey` MUST be a known product theme — otherwise reject.
 *   2. `slot` MUST be listed in the product's slot catalogue — otherwise reject.
 *   3. `workspaceId` is resolved server-side from the MDF session; the
 *      browser can never inject a different workspace.
 *   4. Every asset row we write / update includes theme_key + slot so
 *      the unique index guarantees a single approved asset per pair.
 *   5. Uploads go through the authenticated Supabase client so Storage
 *      RLS policies enforce write access to `workspaceId/…` only.
 *
 * Operational invariants:
 *
 *   6. Compensating cleanup: if the Storage upload succeeds but the DB
 *      upsert fails, the just-uploaded orphan is deleted before the
 *      error bubbles up. Historical Production files that were already
 *      referenced by sent email are NEVER auto-deleted.
 *   7. Immutable Production URLs: replacing an asset whose current row
 *      is in `production` status always writes to a fresh, uniquely
 *      named object path and only updates the DB row to point at the
 *      new URL. The previous Production file is left in the bucket so
 *      any already-sent email keeps rendering.
 */

function assertKnownThemeAndSlot(themeKey: string, slot: string): asserts themeKey is ProductKey {
  if (!(themeKey in PRODUCT_THEMES)) {
    throw new Error(`Unknown product theme: ${themeKey}`);
  }
  const spec = findSlotSpec(themeKey as ProductKey, slot);
  if (!spec) {
    throw new Error(`Slot "${slot}" is not defined for product ${themeKey}`);
  }
}

export interface UploadAssetInput {
  themeKey: string;
  slot: string;
  mimeType: string;
  size: number;
  fileName: string;
  /** base64-encoded file body (excluding data URL prefix). */
  base64: string;
  altText?: string;
}

export async function uploadEmailAssetAction(input: UploadAssetInput): Promise<AssetRecord> {
  assertKnownThemeAndSlot(input.themeKey, input.slot);
  if (!isAllowedEmailMime(input.mimeType)) {
    throw new Error(
      `Unsupported image type. Allowed: ${ALLOWED_EMAIL_MIME_TYPES.join(", ")}.`,
    );
  }
  if (input.size <= 0 || input.size > MAX_ASSET_BYTES) {
    const mb = (MAX_ASSET_BYTES / 1024 / 1024).toFixed(0);
    throw new Error(`Image must be > 0 bytes and <= ${mb} MB for email delivery.`);
  }

  const { session, repos } = await serverRepositories();
  const workspaceId = session.membership.workspaceId;
  const client = createClient(cookies());

  // Look up the current row BEFORE uploading. Two things depend on it:
  //   - deciding whether the previous file is safe to delete (never
  //     if it was in `production` — it may already be in a sent email)
  //   - reusing the row id so we UPDATE rather than INSERT (avoids the
  //     upsert on-conflict path that broke on the partial index before
  //     migration 0007).
  const existing = await repos.assets.findBySlot(input.themeKey, input.slot);

  const path = buildStoragePath({
    workspaceId,
    themeKey: input.themeKey,
    slot: input.slot,
    originalName: input.fileName,
    mime: input.mimeType,
    randomSuffix: randomBytes(4).toString("hex"),
  });
  assertPathInWorkspace(path, workspaceId);

  // 1. Upload the new object.
  const buffer = Buffer.from(input.base64, "base64");
  const { error: uploadError } = await client.storage
    .from(EMAIL_ASSET_BUCKET)
    .upload(path, buffer, {
      contentType: input.mimeType,
      upsert: false,
      cacheControl: "31536000, immutable",
    });
  if (uploadError) {
    throw friendlyAssetError(uploadError);
  }

  const { data: pub } = client.storage.from(EMAIL_ASSET_BUCKET).getPublicUrl(path);
  const publicUrl = pub.publicUrl;

  const spec = findSlotSpec(input.themeKey as ProductKey, input.slot)!;
  const now = new Date().toISOString();

  // 2. Persist the DB row. A fresh upload always lands as `draft` so
  //    Production URLs remain immutable — the operator must explicitly
  //    re-promote after reviewing the new asset.
  const record: AssetRecord = {
    id: existing?.id ?? randomUUID(),
    themeKey: input.themeKey,
    slot: input.slot,
    name: input.fileName,
    productionUrl: publicUrl,
    storagePath: path,
    status: "draft",
    altText: input.altText ?? existing?.altText ?? "",
    mimeType: input.mimeType,
    fileSize: input.size,
    isDecorative: spec.decorative ?? false,
    updatedAt: now,
  };

  let saved: AssetRecord;
  try {
    saved = await repos.assets.put(record);
  } catch (dbError) {
    // Compensating cleanup — orphan removal for the JUST uploaded file.
    // The path we just created cannot be referenced by any historical
    // send (it did not exist a moment ago), so removing it is safe.
    try {
      await client.storage.from(EMAIL_ASSET_BUCKET).remove([path]);
    } catch {
      // Non-fatal — the DB error is what matters to the user; log the
      // cleanup failure so ops can spot orphans if they accumulate.
      console.warn("[assets.uploadCleanup] failed to remove orphan", { path });
    }
    throw friendlyAssetError(dbError);
  }

  // 3. Immutable-Production-URL rule.
  //    - If the previous row was `production`, LEAVE its file in the
  //      bucket. Any sent email may still reference that URL.
  //    - If the previous row was `draft` or `approved`, the previous
  //      file was never sent anywhere and is safe to delete.
  if (existing?.storagePath && existing.storagePath !== path) {
    const previousWasProduction = existing.status === "production";
    if (!previousWasProduction) {
      try {
        assertPathInWorkspace(existing.storagePath, workspaceId);
        await client.storage.from(EMAIL_ASSET_BUCKET).remove([existing.storagePath]);
      } catch (e) {
        console.warn("[assets.previousCleanup] failed to remove non-production file", {
          path: existing.storagePath,
          error: (e as Error)?.message,
        });
      }
    } else {
      console.info("[assets.retainProduction] previous production URL retained", {
        path: existing.storagePath,
        newPath: path,
      });
    }
  }

  await logActivity(
    repos,
    "asset.uploaded",
    `Uploaded ${input.themeKey}/${input.slot} (${(input.size / 1024).toFixed(0)} KB)`,
    { type: "asset", id: saved.id },
  );
  revalidatePath("/settings");
  return saved;
}

export async function setAssetStatusAction(assetId: string, status: AssetStatus): Promise<AssetRecord> {
  const { repos } = await serverRepositories();
  const existing = await repos.assets.get(assetId);
  if (!existing) throw new Error("Asset not found");

  if (status === "production") {
    if (!existing.productionUrl) {
      throw new Error("Cannot promote to production without a hosted production URL.");
    }
    if (!existing.isDecorative && !existing.altText?.trim()) {
      throw new Error("Add alt text before promoting to production.");
    }
  }

  let saved: AssetRecord;
  try {
    saved = await repos.assets.patch(assetId, { status });
  } catch (e) {
    throw friendlyAssetError(e);
  }
  await logActivity(
    repos,
    "asset.status",
    `Asset ${existing.themeKey ?? "-"}/${existing.slot} → ${status}`,
    { type: "asset", id: assetId },
  );
  revalidatePath("/settings");
  return saved;
}

export async function setAssetAltTextAction(assetId: string, altText: string): Promise<AssetRecord> {
  const { repos } = await serverRepositories();
  try {
    const saved = await repos.assets.patch(assetId, { altText });
    revalidatePath("/settings");
    return saved;
  } catch (e) {
    throw friendlyAssetError(e);
  }
}

/**
 * Deletes an asset row. If the asset was `production`, the Storage file
 * is NOT removed — a previously-sent email may still reference it. Only
 * `draft` / `approved` files (never referenced by a send) are physically
 * removed.
 */
export async function deleteEmailAssetAction(assetId: string): Promise<void> {
  const { session, repos } = await serverRepositories();
  const workspaceId = session.membership.workspaceId;
  const existing = await repos.assets.get(assetId);
  if (!existing) return;

  const shouldRemoveFile =
    existing.storagePath && existing.status !== "production";
  if (shouldRemoveFile) {
    try {
      assertPathInWorkspace(existing.storagePath!, workspaceId);
      const client = createClient(cookies());
      await client.storage.from(EMAIL_ASSET_BUCKET).remove([existing.storagePath!]);
    } catch (e) {
      console.warn("[assets.deleteCleanup] failed to remove file", {
        path: existing.storagePath,
        error: (e as Error)?.message,
      });
    }
  } else if (existing.storagePath && existing.status === "production") {
    console.info("[assets.retainProduction] production file retained after row delete", {
      path: existing.storagePath,
    });
  }

  try {
    await repos.assets.delete(assetId);
  } catch (e) {
    throw friendlyAssetError(e);
  }
  await logActivity(
    repos,
    "asset.deleted",
    `Deleted ${existing.themeKey ?? "-"}/${existing.slot}`,
    { type: "asset", id: assetId },
  );
  revalidatePath("/settings");
}
