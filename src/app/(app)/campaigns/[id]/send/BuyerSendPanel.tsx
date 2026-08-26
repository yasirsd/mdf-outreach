"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  XCircle,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";
import { cn, formatDateTime } from "@/lib/utils";
import type { Buyer, Campaign, EmailTemplate } from "@/lib/types";
import type {
  BuyerReadinessRow,
  BuyerReadinessStatus,
} from "@/lib/gmail/buyerSendReadiness";
import type { CampaignDeliverySummary } from "@/lib/gmail/deliverySummary";
import { classifyFailure, retryLabel } from "@/lib/gmail/failureClassification";
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
  deliverySummary: CampaignDeliverySummary;
  buyersById: Record<string, Buyer>;
  batchMax: number;
  buyerSendEnabled: boolean;
}

type Phase = "idle" | "reviewing" | "checklist" | "confirming" | "sending" | "done";

const CHECKLIST_ITEMS: Array<{ key: string; label: string }> = [
  { key: "subject", label: "Subject reviewed" },
  { key: "preheader", label: "Preheader reviewed" },
  { key: "template", label: "Template selected" },
  { key: "imagery", label: "Production imagery ready" },
  { key: "cta", label: "CTA destination checked" },
  { key: "sender", label: "Gmail sender connected" },
  { key: "personalization", label: "All personalization resolved" },
  { key: "suppression", label: "No suppressed recipients" },
  { key: "duplicates", label: "No previously-sent recipients selected" },
];

export function BuyerSendPanel(props: BuyerSendPanelProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [outcomes, setOutcomes] = useState<PerBuyerOutcome[]>([]);
  const [inFlightBuyerId, setInFlightBuyerId] = useState<string | null>(null);
  const [finalResult, setFinalResult] = useState<SendBuyersResult | null>(null);
  const [checklistAck, setChecklistAck] = useState(false);
  const [confirmType, setConfirmType] = useState("");

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
    if (readyRows.length > props.batchMax) {
      toast.info(`Initial production limit: ${props.batchMax} buyers per batch.`);
    }
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function resetToIdle() {
    setPhase("idle");
    setSelectedIds(new Set());
    setChecklistAck(false);
    setConfirmType("");
    setOutcomes([]);
    setFinalResult(null);
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

  const suppressedSelectedCount = useMemo(() => {
    let n = 0;
    for (const id of selectedIds) {
      if (props.buyersById[id]?.suppressed) n += 1;
    }
    return n;
  }, [selectedIds, props.buyersById]);

  const previouslySentSelectedCount = useMemo(() => {
    let n = 0;
    for (const id of selectedIds) {
      const row = props.rows.find((r) => r.buyerId === id);
      if (row?.previousContactAt) n += 1;
    }
    return n;
  }, [selectedIds, props.rows]);

  const checklistBlockers: string[] = [];
  if (suppressedSelectedCount > 0) {
    checklistBlockers.push(`${suppressedSelectedCount} suppressed buyer(s) selected.`);
  }
  if (previouslySentSelectedCount > 0) {
    checklistBlockers.push(
      `${previouslySentSelectedCount} selected buyer(s) have previously received a production email.`,
    );
  }

  const typeSendOk = confirmType.trim().toUpperCase() === "SEND";
  const canConfirmSend =
    typeSendOk && checklistAck && selectedIds.size > 0 && checklistBlockers.length === 0;

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

        <DeliveryStatusCard summary={props.deliverySummary} />

        {!props.buyerSendEnabled && (
          <div
            className="mt-4 rounded-[10px] p-3 text-[12px] flex items-start gap-2"
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

        {props.deliverySummary.campaignDeliveryComplete && (
          <div
            className="mt-4 rounded-[10px] p-3 text-[12.5px] flex items-start gap-2"
            style={{
              backgroundColor: "rgba(74,222,128,0.10)",
              border: "1px solid rgba(74,222,128,0.24)",
              color: "#86EFAC",
            }}
          >
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-medium text-emerald-300">Campaign delivery complete</div>
              <div className="mt-0.5 text-[12px]">
                All eligible recipients have received this campaign.
              </div>
            </div>
          </div>
        )}

        <EmptyStateHint
          gmailConnected={props.gmailConnected}
          template={props.template}
          subject={props.campaign.subject}
          summary={props.summary}
        />

        <div className="flex items-center gap-2 flex-wrap mt-4">
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
        onClose={resetToIdle}
        size="xl"
        title="Review recipients"
        subtitle={`${props.summary.ready} ready · ${props.summary.blocked} blocked · ${props.summary.alreadySent} already sent`}
        actions={
          <>
            <button className="btn-secondary" onClick={resetToIdle}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={selectedIds.size === 0}
              onClick={() => setPhase("checklist")}
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
            className="rounded-[10px] overflow-hidden overflow-x-auto"
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
                  <th className="text-left px-3 py-2">Product</th>
                  <th className="text-left px-3 py-2">Readiness</th>
                  <th className="text-left px-3 py-2">Previous contact</th>
                </tr>
              </thead>
              <tbody>
                {props.rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-text-muted">
                      This campaign has no recipients yet.
                    </td>
                  </tr>
                ) : (
                  props.rows.map((row) => {
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
                        <td className="px-3 py-2 text-text-secondary">
                          {buyer?.productInterest || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <ReadinessBadge status={row.status} reasons={row.reasons} />
                        </td>
                        <td className="px-3 py-2 text-text-secondary">
                          <PreviousContactCell
                            at={row.previousContactAt}
                            thisCampaign={!!row.previousContactInThisCampaign}
                          />
                        </td>
                      </tr>
                    );
                  })
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

      {/* ------------------ Pre-send checklist ------------------ */}
      <Modal
        open={phase === "checklist"}
        onClose={() => setPhase("reviewing")}
        size="md"
        title="Pre-send checklist"
        subtitle={`${selectedIds.size} selected · operator awareness only — server preflight remains authoritative.`}
        actions={
          <>
            <button className="btn-secondary" onClick={() => setPhase("reviewing")}>
              Back
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                setConfirmType("");
                setPhase("confirming");
              }}
              disabled={!checklistAck || checklistBlockers.length > 0}
            >
              Continue
            </button>
          </>
        }
      >
        <div className="px-6 py-5 space-y-4">
          <ul className="space-y-1.5">
            {CHECKLIST_ITEMS.map((it) => (
              <li key={it.key} className="flex items-start gap-2 text-[13px] text-text-primary">
                <CheckCircle2 size={13} className="text-emerald-400 mt-0.5 shrink-0" />
                <span>{it.label}</span>
              </li>
            ))}
          </ul>

          {checklistBlockers.length > 0 && (
            <div
              className="rounded-[10px] p-3 text-[12.5px] leading-relaxed"
              style={{
                backgroundColor: "rgba(239,108,92,0.10)",
                border: "1px solid rgba(239,108,92,0.28)",
                color: "#F0A19A",
              }}
            >
              <div className="font-medium mb-1">Please fix before continuing</div>
              <ul className="list-disc pl-4">
                {checklistBlockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          )}

          <label
            className="flex items-start gap-2 rounded-[10px] px-3 py-2.5 cursor-pointer"
            style={{
              backgroundColor: "var(--app-surface)",
              border: "1px solid var(--app-border-strong)",
            }}
          >
            <input
              type="checkbox"
              checked={checklistAck}
              onChange={(e) => setChecklistAck(e.target.checked)}
              className="mt-1"
            />
            <span className="text-[13px] text-text-primary leading-relaxed">
              I reviewed the selected recipients and confirm they are appropriate contacts for
              this campaign.
            </span>
          </label>
        </div>
      </Modal>

      {/* ------------------ Final confirmation (external, type SEND) ------------------ */}
      <Modal
        open={phase === "confirming"}
        onClose={() => setPhase("checklist")}
        size="md"
        title="Real external email delivery"
        subtitle="This cannot be undone."
        actions={
          <>
            <button className="btn-secondary" onClick={() => setPhase("checklist")}>
              Cancel
            </button>
            <button className="btn-primary" onClick={performSend} disabled={!canConfirmSend}>
              <Send size={13} /> Confirm &amp; Send {selectedIds.size}
            </button>
          </>
        }
      >
        <div className="p-6 space-y-4 text-[13px]">
          <div
            className="rounded-[10px] px-3 py-2.5 text-[12.5px]"
            style={{
              backgroundColor: "rgba(220,60,60,0.10)",
              border: "1px solid rgba(220,60,60,0.28)",
              color: "#F0857B",
            }}
          >
            <strong>{selectedIds.size}</strong> buyer{selectedIds.size === 1 ? "" : "s"} will
            receive an individual email from{" "}
            <strong>{props.gmailSenderEmail ?? "—"}</strong>.
          </div>

          <div className="space-y-2">
            <ConfirmRow label="Campaign" value={props.campaign.name} />
            <ConfirmRow label="Sender" value={props.gmailSenderEmail ?? "—"} />
            <ConfirmRow label="Recipients" value={String(selectedIds.size)} />
            <ConfirmRow label="Template" value={props.template?.name ?? "—"} />
            <ConfirmRow label="Subject" value={props.campaign.subject || "—"} />
          </div>

          <div className="pt-2 text-[12.5px] text-text-muted leading-relaxed">
            Each buyer receives an <strong>individual personalized email</strong>. Recipients
            are never combined in To / CC / BCC. Simulation and Real Gmail Test are unaffected.
          </div>

          <label className="block">
            <span className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted">
              Type <span className="text-brand-orange font-semibold">SEND</span> to enable the
              button
            </span>
            <input
              className="input mt-1.5 uppercase tracking-widest text-[15px] font-medium"
              value={confirmType}
              onChange={(e) => setConfirmType(e.target.value)}
              placeholder="SEND"
              aria-label="Type SEND to confirm"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>
      </Modal>

      {/* ------------------ Progress + Result modal ------------------ */}
      <Modal
        open={phase === "sending" || phase === "done"}
        onClose={() => {
          if (phase === "done") resetToIdle();
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
            <button className="btn-primary" onClick={resetToIdle}>
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

function DeliveryStatusCard({ summary }: { summary: CampaignDeliverySummary }) {
  return (
    <div
      className="rounded-[10px] p-3.5 mt-2"
      style={{
        backgroundColor: "var(--app-sidebar)",
        border: "1px solid var(--app-border)",
      }}
    >
      <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted mb-2.5">
        Delivery status
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[13px]">
        <Metric label="Total recipients" value={summary.totalRecipients} />
        <Metric label="Ready" value={summary.ready} tone="ready" />
        <Metric label="Blocked" value={summary.blocked} tone="blocked" />
        <Metric label="Already sent" value={summary.alreadySent} tone="already" />
        <Metric label="Successful" value={summary.successful} tone="ready" />
        <Metric label="Failed" value={summary.failed} tone="blocked" />
        <Metric label="Never attempted" value={summary.neverAttempted} />
        <Metric
          label="Last delivery"
          value={
            summary.lastDeliveryAt ? formatDateTime(summary.lastDeliveryAt) : "—"
          }
          small
        />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  small,
}: {
  label: string;
  value: number | string;
  tone?: "ready" | "blocked" | "already";
  small?: boolean;
}) {
  const color =
    tone === "ready"
      ? "#86EFAC"
      : tone === "blocked"
        ? "#F08B7E"
        : tone === "already"
          ? "#B2C0D6"
          : "var(--text-primary)";
  return (
    <div>
      <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted mb-1">
        {label}
      </div>
      <div
        className={cn(
          small ? "text-[12.5px]" : "text-[18px] font-medium tabular-nums",
        )}
        style={{ color }}
      >
        {value}
      </div>
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
  const first = reasons[0] ?? "Blocked";
  const isSuppression = /do not contact|suppress/i.test(first);
  return (
    <span
      className="inline-flex items-start gap-1 text-brand-chilli max-w-[280px]"
      title={reasons.join(" · ")}
    >
      {isSuppression ? (
        <ShieldOff size={13} className="mt-0.5 shrink-0" />
      ) : (
        <XCircle size={13} className="mt-0.5 shrink-0" />
      )}
      <span>Blocked · {first}</span>
    </span>
  );
}

function PreviousContactCell({
  at,
  thisCampaign,
}: {
  at: string | null | undefined;
  thisCampaign: boolean;
}) {
  if (!at) {
    return <span className="text-text-muted">Never contacted</span>;
  }
  if (thisCampaign) {
    return <span className="text-text-secondary">Already sent in this campaign</span>;
  }
  return <span>{formatDateTime(at)}</span>;
}

function EmptyStateHint({
  gmailConnected,
  template,
  subject,
  summary,
}: {
  gmailConnected: boolean;
  template: EmailTemplate | null;
  subject: string;
  summary: { ready: number; blocked: number; alreadySent: number; total: number };
}) {
  if (summary.total === 0) {
    return (
      <Hint
        tone="info"
        title="No recipients yet"
        body={
          <>
            Add buyers to this campaign on the <strong>Recipients</strong> tab before running
            Buyer Send.
          </>
        }
      />
    );
  }
  if (!gmailConnected) {
    return (
      <Hint
        tone="warn"
        title="Gmail sender not connected"
        body={<>Open Settings → Email to connect the MDF Gmail sender before sending.</>}
      />
    );
  }
  if (!template) {
    return (
      <Hint
        tone="warn"
        title="No template selected"
        body={
          <>Choose an email template on the campaign&apos;s Email tab before sending.</>
        }
      />
    );
  }
  if (!subject.trim()) {
    return (
      <Hint
        tone="warn"
        title="Subject is empty"
        body={<>Add a subject on the Email tab. Empty subject blocks every buyer.</>}
      />
    );
  }
  if (summary.ready === 0 && summary.blocked > 0 && summary.alreadySent === 0) {
    return (
      <Hint
        tone="warn"
        title="Every recipient is blocked"
        body={
          <>
            Open <strong>Review recipients</strong> to see the reason for each buyer and fix
            the issues, or remove them from this campaign.
          </>
        }
      />
    );
  }
  if (summary.ready === 0 && summary.alreadySent === summary.total) {
    return null; // campaignDeliveryComplete banner handled above
  }
  return null;
}

function Hint({
  tone,
  title,
  body,
}: {
  tone: "info" | "warn";
  title: string;
  body: React.ReactNode;
}) {
  const styles = {
    info: {
      bg: "rgba(120,140,170,0.10)",
      border: "rgba(120,140,170,0.30)",
      fg: "#B2C0D6",
      icon: <CheckCircle2 size={14} />,
    },
    warn: {
      bg: "rgba(240,180,90,0.08)",
      border: "rgba(240,180,90,0.28)",
      fg: "#EBC275",
      icon: <AlertTriangle size={14} />,
    },
  } as const;
  const s = styles[tone];
  return (
    <div
      className="mt-4 rounded-[10px] p-3 text-[12.5px] flex items-start gap-2"
      style={{
        backgroundColor: s.bg,
        border: `1px solid ${s.border}`,
        color: s.fg,
      }}
    >
      <span className="mt-0.5 shrink-0">{s.icon}</span>
      <div>
        <div className="font-medium">{title}</div>
        <div className="mt-0.5">{body}</div>
      </div>
    </div>
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
                "flex items-start gap-2 text-[13px] rounded-[8px] px-2.5 py-1.5",
              )}
              style={{ backgroundColor: "var(--app-sidebar)" }}
            >
              <OutcomeIcon outcome={outcome} inFlight={inFlight} />
              <div className="flex-1 min-w-0">
                <div className="truncate text-text-primary">
                  {buyer?.company || buyer?.email || id}
                </div>
                {outcome && !outcome.ok && (
                  <div className="text-[11.5px] text-text-muted mt-0.5">
                    {outcome.skipped === "already-sent"
                      ? "Already sent"
                      : outcome.error ?? "Failed"}{" "}
                    <span className="text-text-muted">
                      · {retryLabel(classifyFailure(outcome.error ?? null))}
                    </span>
                  </div>
                )}
                {outcome && outcome.ok && (
                  <div className="text-[11.5px] text-text-muted mt-0.5 font-mono truncate">
                    Gmail id {outcome.messageId}
                  </div>
                )}
              </div>
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
  if (inFlight) return <Loader2 size={13} className="animate-spin text-brand-orange mt-1" />;
  if (!outcome)
    return (
      <span className="w-[13px] h-[13px] rounded-full border border-app-border mt-1" />
    );
  if (outcome.ok) return <CheckCircle2 size={13} className="text-emerald-400 mt-1" />;
  if (outcome.skipped === "already-sent")
    return <CheckCircle2 size={13} className="text-text-muted mt-1" />;
  return <XCircle size={13} className="text-brand-chilli mt-1" />;
}

// StatChip kept only so refactors don't break other imports; not currently rendered.
void StatChip;
