"use server";

import { requireMdfSession } from "@/lib/auth/require";
import { describeEnvironment, type EnvEntry } from "@/lib/env";

/**
 * MDF Outreach — F9 environment-readiness server action.
 *
 * Returns a safe, human-readable snapshot of the runtime environment
 * suitable for the Settings → Developer panel.
 *
 * SAFETY:
 *   • Auth-gated (requireMdfSession) — non-members receive an error.
 *   • Uses the F8 `describeEnvironment` helper, which itself never
 *     returns any raw value. This action never touches process.env
 *     beyond what describeEnvironment already reads.
 *   • Does not expose control switches. `BUYER_SEND_ENABLED` is
 *     reported informationally only — enabling remains an operator
 *     env-var decision, not a UI action.
 */
export interface EnvReadinessEntry {
  name: string;
  required: boolean;
  status: "ok" | "missing" | "invalid";
  detail: string;
}

export interface EnvReadinessReport {
  entries: EnvReadinessEntry[];
  hasBlockingIssues: boolean;
}

export async function getEnvReadinessAction(): Promise<EnvReadinessReport> {
  await requireMdfSession();
  const report = describeEnvironment();
  return {
    entries: report.entries.map(
      (e: EnvEntry): EnvReadinessEntry => ({
        name: e.name,
        required: e.required,
        status: e.status,
        detail: e.detail,
      }),
    ),
    hasBlockingIssues: report.hasBlockingIssues,
  };
}
