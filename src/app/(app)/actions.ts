"use server";

import { revalidatePath } from "next/cache";
import { serverRepositories } from "@/lib/repositories/server";
import { createDefaultSettings } from "@/lib/workspace/defaults";
import { createDefaultTemplate } from "@/lib/email/defaultTemplate";
import type { WorkspaceSettings } from "@/lib/types";
import { logActivity } from "@/lib/activity";
import { randomUUID } from "node:crypto";

/**
 * Initialize workspace_settings + a default email template on first access.
 * Idempotent — every subsequent call returns the existing settings.
 */
export async function ensureSettingsAction(): Promise<WorkspaceSettings> {
  const { repos } = await serverRepositories();
  const existing = await repos.settings.get();
  if (existing) return existing;

  const defaults = { ...createDefaultSettings(), onboardingComplete: true };
  const saved = await repos.settings.put(defaults);

  // Seed a single blank template shell so the campaign editor has something
  // to point at. This is chrome, not fictional business data.
  const templates = await repos.templates.list();
  if (templates.length === 0) {
    const t = createDefaultTemplate();
    t.id = randomUUID();
    t.isDemo = false;
    await repos.templates.create(t);
  }

  return saved;
}

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
