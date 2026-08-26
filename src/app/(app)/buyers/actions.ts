"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { serverRepositories } from "@/lib/repositories/server";
import { logActivity } from "@/lib/activity";
import { createClient } from "@/utils/supabase/server";
import { fetchSendHistoryForBuyer, type BuyerSendHistoryRow } from "@/lib/gmail/buyerSendAudit";
import type { Buyer, BuyerStatus, BuyerSuppressionReason } from "@/lib/types";

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function sanitize(b: Partial<Buyer>): Partial<Buyer> {
  // Strip anything client-supplied that we recompute server-side.
  const { createdAt: _c, updatedAt: _u, isDemo: _d, ...rest } = b;
  return rest;
}

export async function saveBuyerAction(input: Buyer): Promise<Buyer> {
  const { repos } = await serverRepositories();
  const existing = input.id && isUuid(input.id) ? await repos.buyers.get(input.id) : undefined;
  if (existing) {
    const updated = await repos.buyers.update(existing.id, sanitize(input));
    await logActivity(
      repos,
      "buyer.updated",
      `${updated.company || updated.firstName || updated.email} updated`,
      { type: "buyer", id: updated.id },
    );
    revalidatePath("/buyers");
    revalidatePath("/");
    return updated;
  }

  const created = await repos.buyers.create({
    ...(sanitize(input) as Buyer),
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Buyer);
  await logActivity(
    repos,
    "buyer.added",
    `${created.firstName} ${created.lastName}`.trim() || created.email,
    { type: "buyer", id: created.id },
  );
  revalidatePath("/buyers");
  revalidatePath("/");
  return created;
}

export async function updateBuyerStatusAction(id: string, status: BuyerStatus): Promise<Buyer> {
  const { repos } = await serverRepositories();
  const updated = await repos.buyers.update(id, { status });
  await logActivity(
    repos,
    "buyer.status",
    `${updated.company || updated.email} marked as ${status}`,
    { type: "buyer", id: updated.id },
  );
  revalidatePath("/buyers");
  revalidatePath("/");
  return updated;
}

export interface BuyerContactHistoryResult {
  history: BuyerSendHistoryRow[];
  campaigns: Record<string, { name: string; product?: string }>;
}

/**
 * Read-only: production send history for one buyer, plus a small
 * campaign lookup so the UI can label each event. Workspace-scoped
 * via RLS + serverRepositories.
 */
export async function getBuyerContactHistoryAction(
  buyerId: string,
): Promise<BuyerContactHistoryResult> {
  const { session, repos } = await serverRepositories();
  const supabase = createClient(cookies());
  const history = await fetchSendHistoryForBuyer({
    supabase,
    workspaceId: session.membership.workspaceId,
    buyerId,
    limit: 50,
  });
  const campaignIds = Array.from(
    new Set(history.map((h) => h.campaignId).filter((v): v is string => !!v)),
  );
  const campaigns: Record<string, { name: string; product?: string }> = {};
  for (const cid of campaignIds) {
    const c = await repos.campaigns.get(cid).catch(() => undefined);
    if (c) campaigns[cid] = { name: c.name, product: c.product || undefined };
  }
  return { history, campaigns };
}

export async function suppressBuyerAction(input: {
  id: string;
  reason: BuyerSuppressionReason;
  note?: string;
}): Promise<Buyer> {
  const { repos } = await serverRepositories();
  const existing = await repos.buyers.get(input.id);
  if (!existing) throw new Error("Buyer not found");
  const updated = await repos.buyers.update(input.id, {
    suppressed: true,
    suppressionReason: input.reason,
    suppressedAt: new Date().toISOString(),
  });
  await logActivity(
    repos,
    "buyer.suppressed",
    `${updated.company || updated.email} marked "Do not contact" (${input.reason}${input.note ? `: ${input.note}` : ""})`,
    { type: "buyer", id: updated.id },
  );
  revalidatePath("/buyers");
  revalidatePath(`/buyers/${updated.id}`);
  return updated;
}

export async function unsuppressBuyerAction(id: string): Promise<Buyer> {
  const { repos } = await serverRepositories();
  const existing = await repos.buyers.get(id);
  if (!existing) throw new Error("Buyer not found");
  const updated = await repos.buyers.update(id, {
    suppressed: false,
    suppressionReason: undefined,
    suppressedAt: undefined,
  });
  await logActivity(
    repos,
    "buyer.unsuppressed",
    `${updated.company || updated.email} suppression removed`,
    { type: "buyer", id: updated.id },
  );
  revalidatePath("/buyers");
  revalidatePath(`/buyers/${updated.id}`);
  return updated;
}

export async function deleteBuyerAction(id: string): Promise<void> {
  const { repos } = await serverRepositories();
  const b = await repos.buyers.get(id);
  await repos.buyers.delete(id);
  if (b) {
    await logActivity(repos, "buyer.deleted", `${b.company || b.email} deleted`, {
      type: "buyer",
      id,
    });
  }
  revalidatePath("/buyers");
  revalidatePath("/");
}

export interface BulkImportResult {
  added: number;
  updated: number;
  skipped: number;
  errors: Array<{ email: string; reason: string }>;
}

export async function bulkImportBuyersAction(
  buyers: Buyer[],
  mode: "skip" | "update" = "skip",
): Promise<BulkImportResult> {
  const { repos } = await serverRepositories();
  const result: BulkImportResult = { added: 0, updated: 0, skipped: 0, errors: [] };

  for (const raw of buyers) {
    if (!raw.email || !raw.email.includes("@")) {
      result.errors.push({ email: raw.email ?? "", reason: "missing or invalid email" });
      continue;
    }
    try {
      const found = await repos.buyers.findByEmail(raw.email);
      const now = new Date().toISOString();
      const clean = sanitize(raw) as Buyer;
      if (found) {
        if (mode === "skip") {
          result.skipped += 1;
          continue;
        }
        await repos.buyers.update(found.id, clean);
        result.updated += 1;
      } else {
        await repos.buyers.create({
          ...clean,
          id: randomUUID(),
          createdAt: now,
          updatedAt: now,
        } as Buyer);
        result.added += 1;
      }
    } catch (e) {
      result.errors.push({
        email: raw.email,
        reason: e instanceof Error ? e.message : "unknown",
      });
    }
  }

  if (result.added + result.updated > 0) {
    await logActivity(
      repos,
      "buyers.imported",
      `Imported ${result.added} new / updated ${result.updated} buyers via CSV`,
    );
    revalidatePath("/buyers");
    revalidatePath("/");
  }
  return result;
}
