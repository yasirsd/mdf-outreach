"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import type { BuyerSendHistoryRow } from "@/lib/gmail/buyerSendAudit";
import { classifyFailure, retryLabel } from "@/lib/gmail/failureClassification";
import type { Buyer } from "@/lib/types";

type Filter = "all" | "sent" | "failed";

export function SendHistoryTable({
  rows,
  buyersById,
}: {
  rows: BuyerSendHistoryRow[];
  buyersById: Record<string, Pick<Buyer, "company" | "firstName" | "lastName" | "email">>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const filtered = useMemo(() => {
    if (filter === "sent") return rows.filter((r) => r.ok);
    if (filter === "failed") return rows.filter((r) => !r.ok);
    return rows;
  }, [rows, filter]);

  const counts = useMemo(() => {
    let sent = 0;
    let failed = 0;
    for (const r of rows) {
      if (r.ok) sent += 1;
      else failed += 1;
    }
    return { sent, failed, total: rows.length };
  }, [rows]);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted mb-1">
            Send history
          </div>
          <div className="text-[13px] text-text-muted">
            {counts.total} attempts · {counts.sent} sent · {counts.failed} failed
          </div>
        </div>
        <div className="inline-flex rounded-[10px] p-0.5"
          style={{ backgroundColor: "var(--app-surface)", border: "1px solid var(--app-border)" }}
        >
          {(["all", "sent", "failed"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1 text-[12px] rounded-[8px] capitalize transition-colors",
                filter === f
                  ? "text-text-primary"
                  : "text-text-secondary hover:text-text-primary",
              )}
              style={{
                backgroundColor: filter === f ? "var(--app-elevated)" : "transparent",
              }}
            >
              {f}
              {f === "sent" ? ` · ${counts.sent}` : ""}
              {f === "failed" ? ` · ${counts.failed}` : ""}
            </button>
          ))}
        </div>
      </div>

      <div
        className="rounded-[10px] overflow-hidden overflow-x-auto"
        style={{
          backgroundColor: "var(--app-surface)",
          border: "1px solid var(--app-border)",
        }}
      >
        <table className="w-full text-[13px]">
          <thead
            className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted"
            style={{ backgroundColor: "var(--app-sidebar)" }}
          >
            <tr>
              <th className="text-left px-3 py-2">Time</th>
              <th className="text-left px-3 py-2">Company</th>
              <th className="text-left px-3 py-2">Contact</th>
              <th className="text-left px-3 py-2">Email</th>
              <th className="text-left px-3 py-2">Result</th>
              <th className="text-left px-3 py-2">Gmail ID</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-text-muted">
                  {rows.length === 0
                    ? "No production send attempts yet for this campaign."
                    : `No ${filter} attempts.`}
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const b = r.buyerId ? buyersById[r.buyerId] : undefined;
                return (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--app-border)" }}>
                    <td className="px-3 py-2 text-text-secondary whitespace-nowrap">
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="px-3 py-2">{b?.company ?? "—"}</td>
                    <td className="px-3 py-2 text-text-secondary">
                      {b
                        ? `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim() || "—"
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{r.recipientEmail}</td>
                    <td className="px-3 py-2">
                      {r.ok ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 size={13} /> Sent
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-start gap-1 text-brand-chilli max-w-[320px]"
                          title={r.error ?? ""}
                        >
                          <XCircle size={13} className="mt-0.5 shrink-0" />
                          <span>
                            Failed · {truncate(r.error, 120)}{" "}
                            <span className="text-text-muted">
                              · {retryLabel(classifyFailure(r.error))}
                            </span>
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-text-muted font-mono text-[11.5px] truncate max-w-[220px]">
                      {r.gmailMessageId ?? "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function truncate(s: string | null, n: number): string {
  if (!s) return "Unknown";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
