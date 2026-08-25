"use server";

import { revalidatePath } from "next/cache";
import { serverRepositories } from "@/lib/repositories/server";
import { logActivity } from "@/lib/activity";
import { ensureMasterLibrary, resetMasterLibrary } from "@/lib/workspace/ensure";
import type { WorkspaceSettings } from "@/lib/types";

export async function saveSettingsAction(next: WorkspaceSettings): Promise<WorkspaceSettings> {
  const { repos } = await serverRepositories();
  const merged: WorkspaceSettings = {
    ...next,
    id: "singleton",
    updatedAt: new Date().toISOString(),
  };
  const saved = await repos.settings.put(merged);
  await logActivity(repos, "settings.updated", "Workspace settings updated");
  revalidatePath("/", "layout");
  return saved;
}

/**
 * Administrative maintenance action. Ensures the 8 approved master
 * templates exist in the workspace. Safe to run repeatedly — never
 * duplicates or overwrites existing masters.
 *
 * Exposed only in Settings → Developer, not in the normal Templates UX.
 */
export async function verifyMasterLibraryAction(): Promise<{ created: number; total: number }> {
  const { repos } = await serverRepositories();
  const result = await ensureMasterLibrary(repos);
  if (result.created > 0) {
    await logActivity(
      repos,
      "library.repaired",
      `MDF master library repaired — ${result.created} template${result.created === 1 ? "" : "s"} restored`,
    );
  }
  revalidatePath("/templates");
  revalidatePath("/settings");
  return result;
}

/**
 * Administrative reset action: overwrite every master with the current
 * library definition. Bumps `version` and does NOT touch campaigns.
 */
export async function resetMasterLibraryAction(): Promise<{
  created: number;
  updated: number;
  total: number;
}> {
  const { repos } = await serverRepositories();
  const result = await resetMasterLibrary(repos);
  await logActivity(
    repos,
    "library.reset",
    `MDF master library reset — ${result.created} created, ${result.updated} updated to new approved version`,
  );
  revalidatePath("/templates");
  revalidatePath("/settings");
  return result;
}
