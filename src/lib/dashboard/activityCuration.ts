import type { ActivityEvent } from "@/lib/types";

/**
 * MDF Outreach — F6 Overview activity curation.
 *
 * The Overview panel surfaces only OPERATOR-MEANINGFUL events. We do
 * NOT delete or mutate audit rows — the /activity page still shows every
 * event with full fidelity. This is purely a display filter.
 *
 * Shown on Overview:
 *   • buyer.added / buyer.imported / buyer.status / buyer.suppressed
 *   • campaign.created / campaign.deleted / campaign.status
 *   • buyer-send.success / buyer-send.failure (the delivery signal)
 *   • gmail.connected / gmail.disconnected
 *
 * Hidden from Overview (still visible on /activity):
 *   • campaign.updated — fires for every subject / template / section
 *     / preheader edit; in a normal editing session dozens of these land
 *     for one campaign. It is the primary "email updated" noise that
 *     made the Overview feel like an audit log. Excluded here — the
 *     full-fidelity /activity route still shows every one.
 *   • email.prepared — technical preparation event fires per recipient
 *     during Buyer Send review; not operationally meaningful for the
 *     dashboard.
 *   • settings.updated / settings tabs saves (noisy)
 *   • gmail.testRecipient.added / removed
 *   • backup.exported
 *   • autosave / draft-tick style events
 *   • buyer.updated with no material change
 *
 * Each row also carries a small semantic ICON tag so the UI can render
 * a consistent glyph without repeating the mapping.
 */

export type OverviewActivityTone =
  | "buyer"
  | "campaign"
  | "email"
  | "email-fail"
  | "gmail"
  | "system";

export interface OverviewActivityRow extends ActivityEvent {
  tone: OverviewActivityTone;
}

interface Rule {
  match: (kind: string) => boolean;
  tone: OverviewActivityTone;
}

const RULES: Rule[] = [
  {
    match: (k) => /^buyer-send\.success$|buyer_send\.success$|^send\.success$/.test(k),
    tone: "email",
  },
  {
    match: (k) => /^buyer-send\.failure$|buyer_send\.failure$|^send\.failure$/.test(k),
    tone: "email-fail",
  },
  { match: (k) => k.startsWith("buyer.added") || k.startsWith("buyer.imported"), tone: "buyer" },
  { match: (k) => k.startsWith("buyer.status"), tone: "buyer" },
  { match: (k) => k.startsWith("buyer.suppressed"), tone: "buyer" },
  { match: (k) => k.startsWith("buyer.deleted"), tone: "buyer" },
  // Campaign lifecycle events only. `campaign.updated` is intentionally
  // excluded — it is the noisiest kind (every subject / template /
  // section save fires it) and would flood Overview.
  { match: (k) => k === "campaign.created" || k === "campaign.deleted" || k === "campaign.status", tone: "campaign" },
  { match: (k) => k === "gmail.connected" || k === "gmail.disconnected", tone: "gmail" },
];

const HIDDEN = [
  /^settings\./,
  /^backup\./,
  /^gmail\.testRecipient\./,
  /^workspace\./,
  /^tick$/,
  /^autosave/i,
  /^buyer\.updated$/,
  // Explicitly excluded — see module header.
  /^campaign\.updated$/,
  /^email\.prepared$/,
];

/**
 * Return the curated slice for Overview, up to `limit` rows (default 8).
 * Preserves original chronological order (newest first) — the caller
 * passes the repository's own newest-first list.
 */
export function curateOverviewActivity(
  events: ActivityEvent[],
  limit = 8,
): OverviewActivityRow[] {
  const out: OverviewActivityRow[] = [];
  for (const e of events) {
    const kind = e.kind ?? "";
    if (HIDDEN.some((rx) => rx.test(kind))) continue;
    const rule = RULES.find((r) => r.match(kind));
    if (!rule) continue;
    out.push({ ...e, tone: rule.tone });
    if (out.length >= limit) break;
  }
  return out;
}

/** Exposed for tests. */
export function isOverviewActivityKind(kind: string): boolean {
  if (HIDDEN.some((rx) => rx.test(kind))) return false;
  return RULES.some((r) => r.match(kind));
}
