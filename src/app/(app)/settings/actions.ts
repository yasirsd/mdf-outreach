"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { serverRepositories } from "@/lib/repositories/server";
import { logActivity } from "@/lib/activity";
import type { AssetRecord, AssetSlot, WorkspaceBackup, WorkspaceSettings } from "@/lib/types";

export async function saveSettingsAction(next: WorkspaceSettings): Promise<WorkspaceSettings> {
  const { repos } = await serverRepositories();
  const merged: WorkspaceSettings = {
    ...next,
    id: "singleton",
    updatedAt: new Date().toISOString(),
  };
  const saved = await repos.settings.put(merged);
  await logActivity(repos, "settings.updated", "Workspace settings updated");
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return saved;
}

export async function upsertAssetAction(
  slot: AssetSlot,
  patch: Partial<AssetRecord>,
): Promise<AssetRecord> {
  const { repos } = await serverRepositories();
  const existing = (await repos.assets.list()).find((a) => a.slot === slot);
  const merged: AssetRecord = {
    id: existing?.id ?? randomUUID(),
    themeKey: patch.themeKey ?? existing?.themeKey,
    slot,
    name: patch.name ?? existing?.name ?? `${slot} asset`,
    productionUrl: patch.productionUrl ?? existing?.productionUrl ?? "",
    localDataUrl: patch.localDataUrl ?? existing?.localDataUrl ?? "",
    storagePath: patch.storagePath ?? existing?.storagePath,
    status: patch.status ?? existing?.status ?? "draft",
    altText: patch.altText ?? existing?.altText,
    mimeType: patch.mimeType ?? existing?.mimeType,
    fileSize: patch.fileSize ?? existing?.fileSize,
    isDecorative: patch.isDecorative ?? existing?.isDecorative,
    updatedAt: new Date().toISOString(),
  };
  const saved = await repos.assets.put(merged);
  revalidatePath("/settings");
  return saved;
}

export async function exportWorkspaceBackupAction(): Promise<WorkspaceBackup> {
  const { repos } = await serverRepositories();
  const backup = await repos.workspace.exportBackup();
  await logActivity(repos, "backup.exported", "Workspace backup exported");
  return backup;
}
