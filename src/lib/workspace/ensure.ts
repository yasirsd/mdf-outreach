import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseRepositoryBundle } from "@/lib/repositories/supabase/repositories";
import type { EmailTemplate, WorkspaceSettings } from "@/lib/types";
import { createDefaultSettings } from "@/lib/workspace/defaults";
import { allProductionTemplates } from "@/lib/email/templates/build";

/**
 * Idempotent workspace bootstrap. Called from the protected layout so a
 * signed-in MDF operator always sees:
 *   - the workspace_settings singleton (created on first access)
 *   - the 8 approved MDF master email templates
 *
 * NEVER creates buyers, campaigns, fictional activity, or example.com
 * records. Only genuine MDF infrastructure records.
 */
export async function ensureWorkspaceReady(
  repos: SupabaseRepositoryBundle,
): Promise<{ settings: WorkspaceSettings; libraryStatus: { created: number; total: number } }> {
  let settings = await repos.settings.get();
  if (!settings) {
    const defaults: WorkspaceSettings = {
      ...createDefaultSettings(),
      onboardingComplete: true,
    };
    settings = await repos.settings.put(defaults);
  }
  const libraryStatus = await ensureMasterLibrary(repos);
  return { settings, libraryStatus };
}

export async function ensureMasterLibrary(
  repos: SupabaseRepositoryBundle,
): Promise<{ created: number; total: number }> {
  const existing = await repos.templates.list();
  const byKey = new Map<string, EmailTemplate>();
  for (const t of existing) {
    if (t.themeKey && t.variant) byKey.set(`${t.themeKey}:${t.variant}`, t);
  }
  const desired = allProductionTemplates();
  let created = 0;
  for (const template of desired) {
    const key = `${template.themeKey}:${template.variant}`;
    if (!byKey.has(key)) {
      await repos.templates.create({ ...template, id: randomUUID() });
      created += 1;
    }
  }
  return { created, total: desired.length };
}

/**
 * Explicit administrative action: overwrite every master template with
 * the current approved library content, bumping their `version`. Used
 * only when an operator wants to adopt a redesigned library.
 *
 * Campaigns are NOT affected — they each hold their own snapshot.
 */
export async function resetMasterLibrary(
  repos: SupabaseRepositoryBundle,
): Promise<{ created: number; updated: number; total: number }> {
  const existing = await repos.templates.list();
  const byKey = new Map<string, EmailTemplate>();
  for (const t of existing) {
    if (t.themeKey && t.variant) byKey.set(`${t.themeKey}:${t.variant}`, t);
  }
  const desired = allProductionTemplates();
  let created = 0;
  let updated = 0;
  for (const template of desired) {
    const key = `${template.themeKey}:${template.variant}`;
    const found = byKey.get(key);
    if (!found) {
      await repos.templates.create({ ...template, id: randomUUID() });
      created += 1;
    } else {
      await repos.templates.update(found.id, {
        name: template.name,
        label: template.label,
        sections: template.sections,
        themeKey: template.themeKey,
        variant: template.variant,
        version: (found.version ?? 1) + 1,
        status: "approved",
      });
      updated += 1;
    }
  }
  return { created, updated, total: desired.length };
}
