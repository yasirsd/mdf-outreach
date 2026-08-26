"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Send,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import type { Buyer, Campaign, EmailTemplate } from "@/lib/types";
import type {
  BuyerReadinessRow,
  BuyerReadinessStatus,
} from "@/lib/gmail/buyerSendReadiness";
import {
  sendBuyersAction,
  type PerBuyerOutcome,
  type SendBuyersResult,
} from "@/app/(app)/campaigns/buyerSendActions";

export interface BuyerSendPanelProps {
  campaign: Campaign;
  template: EmailTemplate | null;
  gmailConnected: boolean;
  gmailSenderEmail: string | null;
  rows: BuyerReadinessRow[];
  summary: { ready: number; blocked: number; alreadySent: number; total: number };
  buyersById: Record<string, Buyer>;
  batchMax: number;
  buyerSendEnabled: boolean;
}

type Phase = "idle" | "reviewing" | "confirming" | "sending" | "done";

export function BuyerSendPanel(props: BuyerSendPanelProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [outcomes, setOutcomes] = useState<PerBuyerOutcome[]>([]);
  const [inFlightBuyerId, setInFlightBuyerId] = useState<string | null>(null);
  const [finalResult, setFinalResult] = useState<SendBuyersResult | null>(null);

  const readyRows = useMemo(
    () => props.rows.filter((r) => r.status === "ready"),
    [props.rows],
  );

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < props.batchMax) next.add(id);
      return next;
    });
  }

  function selectAllReady() {
    const next = new Set<string>();
    for (const r of readyRows) {
      if (next.size >= props.batchMax) break;
      next.add(r.buyerId);
    }
    setSelectedIds(next);
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function performSend() {
    const buyerIds = Array.from(selectedIds);
    if (buyerIds.length === 0) return;
    if (buyerIds.length > props.batchMax) {
      toast.error(`Batch exceeds the ${props.batchMax}-buyer safety limit.`);
      return;
    }
    setPhase("sending");
    setOutcomes([]);
    setInFlightBuyerId(buyerIds[0] ?? null);

    // One nonce per Confirm click — the server dedupes duplicate submits.
    const nonce =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `n-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const res = await sendBuyersAction({
        campaignId: props.campaign.id,
        buyerIds,
        batchNonce: nonce,
      });
      setOutcomes(res.outcomes);
      setFinalResult(res);
      setInFlightBuyerId(null);
      setPhase("done");
      if (res.ok && res.sent > 0) {
        toast.success(`${res.sent} sent · ${res.failed} failed · ${res.skipped} skipped`);
      } else if (res.error) {
        toast.error(res.error);
      } else if (res.failed > 0) {
        toast.error(`${res.failed} failed`);
      }
    } catch (e) {
      setInFlightBuyerId(null);
      setPhase("done");
      toast.error(e instanceof Error ? e.message : "Send failed");
    }
  }

  return (
    <>
      <div
        className="mt-4 rounded-[12px] p-5"
        style={{
          backgroundColor: "var(--app-surface)",
          border: "1px solid var(--app-border-strong)",
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.16em] uppercase"
            style={{ backgroundColor: "rgba(220,60,60,0.10)", color: "#F0857B" }}
          >
            Production
          </span>
          <span className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted">
            Real email delivery · cannot be undone
          </span>
        </div>

        <div className="grid md:grid-cols-2 gap-x-6 gap-y-2 mb-4">
          <MetaRow label="Campaign" value={props.campaign.name} />
          <MetaRow
            label="Sender"
            value={props.gmailSenderEmail ?? "— not connected —"}
          />
          <MetaRow label="Template" value={props.template?.name ?? "— none —"} />
          <MetaRow label="Subject" value={props.campaign.subject || "—"} />
        </div>

        <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted mb-2">
          Recipient readiness
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          <StatChip color="ready" label={`${props.summary.ready} Ready`} />
          <StatChip color="blocked" label={`${props.summary.blocked} Blocked`} />
          <StatChip
            color="already"
            label={`${props.summary.alreadySent} Already sent`}
          />
        </div>

        {!props.buyerSendEnabled && (
          <div
            className="mb-4 rounded-[10px] p-3 text-[12px] flex items-start gap-2"
            style={{
              backgroundColor: "rgba(240,180,90,0.08)",
              border: "1px solid rgba(240,180,90,0.28)",
              color: "#EBC275",
            }}
          >
            <ShieldAlert size={13} className="mt-0.5 shrink-0" />
            <span>
              <strong>Safety gate is engaged.</strong> The complete review / confirm workflow
              is available for QA, but the final Gmail call is refused server-side because{" "}
              <code>BUYER_SEND_ENABLED</code> is false. See{" "}
              <span className="whitespace-nowrap">docs/buyer-send.md</span>.
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="btn-secondary"
            onClick={() => {
              setSelectedIds(new Set());
              setPhase("reviewing");
            }}
            disabled={props.summary.total === 0}
          >
            Review recipients
          </button>
          <span className="text-[11.5px] text-text-muted">
            Initial production safety limit: {props.batchMax} buyers per send batch.
          </span>
        </div>
      </div>

      {/* ------------------ Review recipients modal ------------------ */}
      <Modal
        open={phase === "reviewing"}
        onClose={() => setPhase("idle")}
        size="xl"
        title="Review recipients"
        subtitle={`${props.summary.ready} ready · ${props.summary.blocked} blocked · ${props.summary.alreadySent} already sent`}
        actions={
          <>
            <button className="btn-secondary" onClick={() => setPhase("idle")}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={selectedIds.size === 0}
              onClick={() => setPhase("confirming")}
            >
              Continue with {selectedIds.size} selected
            </button>
          </>
        }
      >
        <div className="px-6 pt-4 pb-6">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div className="text-[12px] text-text-muted">
              Only <strong>Ready</strong> recipients can be selected. Blocked and Already-sent
              rows are surfaced for transparency but cannot be included.
            </div>
            <div className="flex items-center gap-2">
              <button
                className="text-[12px] px-2 py-1 rounded-[6px] text-text-secondary hover:text-text-primary hover:bg-app-hover disabled:opacity-40 disabled:pointer-events-none"
                onClick={selectAllReady}
                disabled={readyRows.length === 0}
              >
                Select {Math.min(readyRows.length, props.batchMax)} ready
              </button>
              <button
                className="text-[12px] px-2 py-1 rounded-[6px] text-text-secondary hover:text-text-primary hover:bg-app-hover disabled:opacity-40 disabled:pointer-events-none"
                onClick={clearSelection}
                disabled={selectedIds.size === 0}
              >
                Clear
              </button>
            </div>
          </div>

          <div
            className="rounded-[10px] overflow-hidden"
            style={{ border: "1px solid var(--app-border)" }}
          >
            <table className="w-full text-[13px]">
              <thead
                className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted"
                style={{ backgroundColor: "var(--app-sidebar)" }}
              >
                <tr>
                  <th className="text-left px-3 py-2 w-8"></th>
                  <th className="text-left px-3 py-2">Company</th>
                  <th className="text-left px-3 py-2">Contact</th>
                  <th className="text-left px-3 py-2">Email</th>
                  <th className="text-left px-3 py-2">Country</th>
                  <th className="text-left px-3 py-2">Readiness</th>
                </tr>
              </thead>
              <tbody>
                {props.rows.map((row) => {
                  const buyer = props.buyersById[row.buyerId];
                  const disabled = row.status !== "ready";
                  const checked = selectedIds.has(row.buyerId);
                  return (
                    <tr
                      key={row.buyerId}
                      style={{ borderTop: "1px solid var(--app-border)" }}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggle(row.buyerId)}
                          aria-label={`Select ${buyer?.company || buyer?.email || row.buyerId}`}
                        />
                      </td>
                      <td className="px-3 py-2">{buyer?.company ?? "—"}</td>
                      <td className="px-3 py-2">
                        {buyer
                          ? `${buyer.firstName ?? ""} ${buyer.lastName ?? ""}`.trim() || "—"
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{buyer?.email ?? "—"}</td>
                      <td className="px-3 py-2 text-text-secondary">{buyer?.country ?? "—"}</td>
                      <td className="px-3 py-2">
                        <ReadinessBadge status={row.status} reasons={row.reasons} />
                      </td>
                    </tr>
                  );
                })}
                {props.rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-text-muted">
                      This campaign has no recipients yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {selectedIds.size >= props.batchMax && (
            <div className="mt-3 text-[12px] text-amber-400">
              Batch limit reached ({props.batchMax}). Deselect a buyer to pick another.
            </div>
          )}
        </div>
      </Modal>

      {/* ------------------ Final confirmation dialog ------------------ */}
      <Modal
        open={phase === "confirming"}
        onClose={() => setPhase("reviewing")}
        size="md"
        title={`Send ${selectedIds.size} buyer email${selectedIds.size === 1 ? "" : "s"}?`}
        actions={
          <>
            <button className="btn-secondary" onClick={() => setPhase("reviewing")}>
              Cancel
            </button>
            <button className="btn-primary" onClick={performSend}>
              <Send size={13} /> Confirm &amp; Send {selectedIds.size}
            </button>
          </>
        }
      >
        <div className="p-6 space-y-3 text-[13px]">
          <ConfirmRow label="Campaign" value={props.campaign.name} />
          <ConfirmRow label="Sender" value={props.gmailSenderEmail ?? "—"} />
          <ConfirmRow label="Recipients" value={String(selectedIds.size)} />
          <ConfirmRow label="Template" value={props.template?.name ?? "—"} />
          <ConfirmRow label="Subject" value={props.campaign.subject || "—"} />
          <div className="pt-2 text-[12.5px] text-text-muted leading-relaxed">
            Each buyer receives an <strong>individual personalized email</strong>. Recipients are
            never combined in To / CC / BCC. This action cannot be undone.
          </div>
        </div>
      </Modal>

      {/* ------------------ Progress + Result modal ------------------ */}
      <Modal
        open={phase === "sending" || phase === "done"}
        onClose={() => {
          if (phase === "done") setPhase("idle");
        }}
        size="lg"
        title={phase === "sending" ? "Sending buyer emails" : "Send complete"}
        subtitle={
          finalResult
            ? `${finalResult.sent} sent · ${finalResult.failed} failed · ${finalResult.skipped} skipped`
            : undefined
        }
        actions={
          phase === "done" ? (
            <button className="btn-primary" onClick={() => setPhase("idle")}>
              Close
            </button>
          ) : undefined
        }
      >
        <div className="p-6">
          <ProgressList
            selectedIds={Array.from(selectedIds)}
            buyersById={props.buyersById}
            outcomes={outcomes}
            inFlightBuyerId={inFlightBuyerId}
            phase={phase}
          />
          {finalResult?.error && phase === "done" && (
            <div className="mt-4 text-[12.5px] text-brand-chilli">{finalResult.error}</div>
          )}
        </div>
      </Modal>
    </>
  );
}

/* --------------------------- small UI helpers --------------------------- */

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted min-w-[70px]">
        {label}
      </span>
      <span className="text-[13px] text-text-primary truncate">{value}</span>
    </div>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <span className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted min-w-[90px]">
        {label}
      </span>
      <span className="text-[13.5px] text-text-primary">{value}</span>
    </div>
  );
}

function StatChip({
  color,
  label,
}: {
  color: "ready" | "blocked" | "already";
  label: string;
}) {
  const styles: Record<typeof color, { bg: string; fg: string; icon: JSX.Element }> = {
    ready: {
      bg: "rgba(74,222,128,0.10)",
      fg: "#86EFAC",
      icon: <ShieldCheck size={12} />,
    },
    blocked: {
      bg: "rgba(239,108,92,0.10)",
      fg: "#F08B7E",
      icon: <XCircle size={12} />,
    },
    already: {
      bg: "rgba(120,140,170,0.14)",
      fg: "#B2C0D6",
      icon: <CheckCircle2 size={12} />,
    },
  } as const;
  const s = styles[color];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {s.icon} {label}
    </span>
  );
}

function ReadinessBadge({
  status,
  reasons,
}: {
  status: BuyerReadinessStatus;
  reasons: string[];
}) {
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-400">
        <ShieldCheck size={13} /> Ready
      </span>
    );
  }
  if (status === "already-sent") {
    return (
      <span className="inline-flex items-center gap-1 text-text-secondary">
        <CheckCircle2 size={13} /> Already sent
      </span>
    );
  }
  return (
    <span className="inline-flex items-start gap-1 text-brand-chilli max-w-[280px]">
      <XCircle size={13} className="mt-0.5 shrink-0" />
      <span title={reasons.join(" · ")}>
        Blocked{reasons.length ? ` · ${reasons[0]}` : ""}
      </span>
    </span>
  );
}

function ProgressList({
  selectedIds,
  buyersById,
  outcomes,
  inFlightBuyerId,
  phase,
}: {
  selectedIds: string[];
  buyersById: Record<string, Buyer>;
  outcomes: PerBuyerOutcome[];
  inFlightBuyerId: string | null;
  phase: Phase;
}) {
  // Merge selected order with outcomes so the operator sees deterministic
  // order and a live in-flight indicator.
  const byId = new Map<string, PerBuyerOutcome>();
  for (const o of outcomes) byId.set(o.buyerId, o);
  const completedCount = outcomes.length;
  return (
    <div>
      <div className="text-[12px] text-text-muted mb-3">
        {phase === "sending"
          ? `${completedCount} / ${selectedIds.length} completed`
          : `${completedCount} / ${selectedIds.length} processed`}
      </div>
      <ul className="space-y-1.5">
        {selectedIds.map((id) => {
          const buyer = buyersById[id];
          const outcome = byId.get(id);
          const inFlight = phase === "sending" && !outcome && id === inFlightBuyerId;
          return (
            <li
              key={id}
              className={cn(
                "flex items-center gap-2 text-[13px] rounded-[8px] px-2.5 py-1.5",
              )}
              style={{ backgroundColor: "var(--app-sidebar)" }}
            >
              <OutcomeIcon outcome={outcome} inFlight={inFlight} />
              <span className="flex-1 truncate text-text-primary">
                {buyer?.company || buyer?.email || id}
              </span>
              <span className="text-[11.5px] text-text-muted truncate max-w-[300px]">
                {outcomeLabel(outcome)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OutcomeIcon({
  outcome,
  inFlight,
}: {
  outcome: PerBuyerOutcome | undefined;
  inFlight: boolean;
}) {
  if (inFlight) return <Loader2 size={13} className="animate-spin text-brand-orange" />;
  if (!outcome) return <span className="w-[13px] h-[13px] rounded-full border border-app-border" />;
  if (outcome.ok) return <CheckCircle2 size={13} className="text-emerald-400" />;
  if (outcome.skipped === "already-sent") return <CheckCircle2 size={13} className="text-text-muted" />;
  return <XCircle size={13} className="text-brand-chilli" />;
}

function outcomeLabel(outcome: PerBuyerOutcome | undefined): string {
  if (!outcome) return "";
  if (outcome.ok) return `Sent · ${outcome.messageId}`;
  if (outcome.skipped === "already-sent") return "Already sent";
  if (outcome.skipped === "claim-taken") return "Claim held elsewhere";
  return outcome.error ?? "Failed";
}
