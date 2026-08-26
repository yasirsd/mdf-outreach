"use client";

import { formatDateTime } from "@/lib/utils";
import type { BuyerSendHistoryRow } from "@/lib/gmail/buyerSendAudit";
import { CheckCircle2, XCircle, Mail } from "lucide-react";
import { classifyFailure, retryLabel } from "@/lib/gmail/failureClassification";

export interface CampaignLookup {
  [id: string]: { name: string; product?: string } | undefined;
}

/**
 * Compact per-buyer contact history. Reads exclusively from
 * email_send_events (RLS-scoped) — no invented activity.
 */
export function BuyerContactHistory({
  history,
  campaigns,
  buyerCreatedAt,
}: {
  history: BuyerSendHistoryRow[];
  campaigns: CampaignLookup;
  buyerCreatedAt: string;
}) {
  return (
    <div>
      <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium mb-3">
        Contact history
      </div>

      {history.length === 0 ? (
        <div
          className="rounded-[10px] p-3 text-[12.5px] text-text-secondary"
          style={{
            backgroundColor: "var(--app-surface)",
            border: "1px solid var(--app-border)",
          }}
        >
          No production sends yet. This buyer has never been contacted through MDF
          Outreach.
        </div>
      ) : (
        <ol className="space-y-2">
          {history.map((h) => {
            const cmp = h.campaignId ? campaigns[h.campaignId] : undefined;
            const dateLabel = formatDateTime(h.createdAt);
            return (
              <li
                key={h.id}
                className="rounded-[10px] px-3 py-2.5"
                style={{
                  backgroundColor: "var(--app-surface)",
                  border: "1px solid var(--app-border)",
                }}
              >
                <div className="flex items-start gap-2">
                  {h.ok ? (
                    <CheckCircle2 size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                  ) : (
                    <XCircle size={14} className="text-brand-chilli mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-text-primary">
                      {h.ok ? "Email sent" : "Send failed"}
                      {cmp?.name ? (
                        <span className="text-text-secondary"> · {cmp.name}</span>
                      ) : null}
                    </div>
                    <div className="text-[11.5px] text-text-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span>{dateLabel}</span>
                      {cmp?.product ? <span>· {cmp.product}</span> : null}
                      {h.subject ? (
                        <span className="truncate max-w-[260px]" title={h.subject}>
                          · {h.subject}
                        </span>
                      ) : null}
                    </div>
                    {h.ok && h.gmailMessageId && (
                      <div className="mt-1 text-[10.5px] text-text-muted font-mono truncate">
                        Gmail id {h.gmailMessageId}
                      </div>
                    )}
                    {!h.ok && (
                      <div className="mt-1 text-[11.5px] text-brand-chilli/90 leading-relaxed">
                        {friendlyError(h.error)} ·{" "}
                        <span className="text-text-muted">{retryLabel(classifyFailure(h.error))}</span>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          <li
            className="rounded-[10px] px-3 py-2.5"
            style={{
              backgroundColor: "var(--app-surface)",
              border: "1px solid var(--app-border)",
            }}
          >
            <div className="flex items-start gap-2">
              <Mail size={14} className="text-text-muted mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="text-[13px] text-text-primary">Buyer added</div>
                <div className="text-[11.5px] text-text-muted mt-0.5">
                  {formatDateTime(buyerCreatedAt)}
                </div>
              </div>
            </div>
          </li>
        </ol>
      )}
    </div>
  );
}

function friendlyError(msg: string | null): string {
  if (!msg) return "Unknown failure";
  // Trim overly technical prefixes / bare status codes.
  return msg.replace(/^GmailApiError:\s*/i, "").slice(0, 220);
}
