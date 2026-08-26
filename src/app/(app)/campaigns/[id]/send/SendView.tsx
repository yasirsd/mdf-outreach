"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Send, Lock, Sparkles, Mail } from "lucide-react";
import type {
  AssetRecord,
  Buyer,
  Campaign,
  CampaignRecipient,
  EmailTemplate,
} from "@/lib/types";
import { validateCampaign } from "@/lib/email/validation";
import { renderEmailHtml, renderEmailText } from "@/lib/email/renderer";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { emailProvider } from "@/lib/email/provider";
import { toast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { EmailPreviewFrame } from "@/components/email/EmailPreviewFrame";
import { cn } from "@/lib/utils";
import type {
  GmailConnectionSummary,
  TestRecipient,
} from "@/app/(app)/settings/gmailActions";
import {
  gmailPreflightAction,
  sendGmailTestAction,
} from "@/app/(app)/campaigns/gmailActions";
import type { BuyerSendPageData } from "@/app/(app)/campaigns/buyerSendActions";
import { BuyerSendPanel } from "./BuyerSendPanel";

interface Props {
  campaign: Campaign;
  template: EmailTemplate;
  recipients: CampaignRecipient[];
  buyers: Buyer[];
  assets: AssetRecord[];
  gmailSummary: GmailConnectionSummary;
  testRecipients: TestRecipient[];
  buyerSendData: BuyerSendPageData | null;
}

type SendMode = "simulation" | "gmail-test" | "buyer-send";

export function SendView({
  campaign,
  template,
  recipients,
  buyers,
  assets,
  gmailSummary,
  testRecipients,
  buyerSendData,
}: Props) {
  const { settings } = useWorkspace();

  const [testBuyerId, setTestBuyerId] = useState("");
  const [testResult, setTestResult] = useState<{
    html: string;
    text: string;
    buyer: Buyer;
    at: string;
  } | null>(null);
  const [simulating, setSimulating] = useState(false);

  const report = useMemo(
    () => validateCampaign({ campaign, recipients, buyers, template, settings, assets }),
    [campaign, template, settings, recipients, buyers, assets],
  );

  const buyerById = useMemo(() => new Map(buyers.map((b) => [b.id, b])), [buyers]);
  const recipientBuyers = recipients
    .map((r) => buyerById.get(r.buyerId))
    .filter((b): b is Buyer => !!b);

  async function runSimulation() {
    const buyer =
      (testBuyerId ? recipientBuyers.find((b) => b.id === testBuyerId) : recipientBuyers[0]) ??
      null;
    if (!buyer) {
      toast.info("Add a recipient first.");
      return;
    }
    setSimulating(true);
    const assetsBySlot = Object.fromEntries(assets.map((a) => [a.slot, a]));
    const html = renderEmailHtml({ template, buyer, settings, assetsBySlot });
    const text = renderEmailText({ template, buyer, settings, assetsBySlot });
    const result = await emailProvider.send({
      to: buyer.email,
      toName: `${buyer.firstName} ${buyer.lastName}`.trim(),
      subject: campaign.subject,
      html,
      text,
      fromName: campaign.fromName,
      replyTo: campaign.replyTo,
    });
    setTestResult({ html, text, buyer, at: result.at });
    setSimulating(false);
    toast.success("Simulation complete — no real email was sent.");
  }

  return (
    <div>
      <div className="mb-8">
        <h2 className="font-serif text-[28px] leading-tight tracking-[-0.015em] text-brand-charcoal">
          Ready to send?
        </h2>
        <p className="mt-2 text-brand-muted text-[14px]">
          Review the campaign, run a simulated test, and validate everything before live sending is enabled.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card p-6">
          <div className="text-[10.5px] tracking-[0.14em] uppercase text-brand-muted">Campaign</div>
          <div className="mt-2 font-serif text-[22px] tracking-[-0.015em] text-brand-charcoal">
            {campaign.name}
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-y-3 gap-x-4 text-[13px]">
            <Item label="Recipients" value={String(report.recipientCount)} />
            <Item label="Template" value={template.name} />
            <Item label="From" value={campaign.fromName} />
            <Item label="Reply-to" value={campaign.replyTo || "—"} />
            <Item label="Subject" value={campaign.subject} full />
            <Item label="Preheader" value={campaign.preheader || "—"} full />
          </dl>
        </div>

        <div className="card p-6">
          <div className="text-[10.5px] tracking-[0.14em] uppercase text-brand-muted">
            Pre-flight validation
          </div>
          <ul className="mt-4 space-y-2">
            {report.lines.map((line, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[13px]">
                {line.ok && !line.warn ? (
                  <CheckCircle2 size={15} className="text-emerald-600 mt-0.5 shrink-0" />
                ) : line.warn ? (
                  <AlertTriangle size={15} className="text-amber-500 mt-0.5 shrink-0" />
                ) : (
                  <XCircle size={15} className="text-brand-chilli mt-0.5 shrink-0" />
                )}
                <span
                  className={
                    line.warn
                      ? "text-brand-charcoal/80"
                      : line.ok
                        ? "text-brand-charcoal/85"
                        : "text-brand-chilli"
                  }
                >
                  {line.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <SendModeSelector
        gmailReady={gmailSummary.connected && testRecipients.length > 0}
        gmailSummary={gmailSummary}
        testRecipients={testRecipients}
        recipientBuyers={recipientBuyers}
        testBuyerId={testBuyerId}
        setTestBuyerId={setTestBuyerId}
        onSimulate={runSimulation}
        simulating={simulating}
        campaignId={campaign.id}
        buyerSendData={buyerSendData}
      />

      <Modal
        open={!!testResult}
        onClose={() => setTestResult(null)}
        size="xl"
        title="Simulated test send"
        subtitle={
          testResult
            ? `Rendered for ${testResult.buyer.firstName} ${testResult.buyer.lastName} · ${testResult.buyer.email}`
            : ""
        }
      >
        {testResult && (
          <div className="p-6">
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3 text-[13px] text-emerald-800 mb-4">
              <span className="font-medium">Email successfully prepared.</span> Live Gmail sending
              will be connected in Phase 2.
            </div>
            <div className="rounded-xl overflow-hidden border border-brand-border">
              <EmailPreviewFrame html={testResult.html} width="100%" minHeight={700} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Item({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <dt className="text-[10.5px] tracking-[0.14em] uppercase text-brand-muted">{label}</dt>
      <dd className="mt-1 text-brand-charcoal truncate">{value}</dd>
    </div>
  );
}

/* -----------------------------------------------------------------------
 * Send mode selector — three visually distinct rails so the operator
 * can never confuse an internal QA send with a real buyer send.
 * ----------------------------------------------------------------------- */

interface SendModeSelectorProps {
  gmailReady: boolean;
  gmailSummary: GmailConnectionSummary;
  testRecipients: TestRecipient[];
  recipientBuyers: Buyer[];
  testBuyerId: string;
  setTestBuyerId: (id: string) => void;
  onSimulate: () => void;
  simulating: boolean;
  campaignId: string;
  buyerSendData: BuyerSendPageData | null;
}

function SendModeSelector(props: SendModeSelectorProps) {
  const [mode, setMode] = useState<SendMode>("simulation");
  const modes: Array<{ id: SendMode; label: string; description: string; disabled?: boolean }> = [
    {
      id: "simulation",
      label: "Simulation",
      description: "Preview the generated email without delivery.",
    },
    {
      id: "gmail-test",
      label: "Real Gmail Test",
      description: "Deliver this exact email to an approved MDF test inbox.",
    },
    {
      id: "buyer-send",
      label: "Buyer Send",
      description: "Individually personalized emails to real buyers.",
    },
  ];
  return (
    <div className="mt-6">
      <div className="grid md:grid-cols-3 gap-2">
        {modes.map((m) => (
          <button
            key={m.id}
            onClick={() => !m.disabled && setMode(m.id)}
            disabled={m.disabled}
            className={cn(
              "text-left rounded-[12px] p-4 transition-all border",
              mode === m.id
                ? "border-brand-orange"
                : "border-[color:var(--app-border)] hover:border-[color:var(--app-border-strong)]",
            )}
            style={{
              backgroundColor:
                mode === m.id ? "rgba(243,107,33,0.06)" : "var(--app-surface)",
              opacity: m.disabled ? 0.55 : 1,
              cursor: m.disabled ? "not-allowed" : "pointer",
            }}
          >
            <div className="flex items-center gap-2">
              {m.id === "simulation" && <Sparkles size={13} className="text-brand-orange" />}
              {m.id === "gmail-test" && <Mail size={13} className="text-brand-orange" />}
              {m.id === "buyer-send" && <Lock size={13} className="text-text-muted" />}
              <span className="text-[13px] font-medium text-text-primary">{m.label}</span>
            </div>
            <div className="mt-1.5 text-[12px] text-text-secondary leading-relaxed">
              {m.description}
            </div>
          </button>
        ))}
      </div>

      {mode === "simulation" && (
        <div className="mt-4 card p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[13px] font-medium text-text-primary">
                Renders and validates locally
              </div>
              <div className="text-[12px] text-text-muted mt-1">
                No real email is delivered. Uses the preview renderer (Base64 previews allowed).
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                className="input h-9 text-[13px] w-auto"
                value={props.testBuyerId}
                onChange={(e) => props.setTestBuyerId(e.target.value)}
              >
                {props.recipientBuyers.length === 0 && (
                  <option value="">No recipients</option>
                )}
                {props.recipientBuyers.map((b) => (
                  <option key={b.id} value={b.id}>
                    Preview as {b.firstName} {b.lastName} · {b.company}
                  </option>
                ))}
              </select>
              <button
                className="btn-primary"
                onClick={props.onSimulate}
                disabled={props.simulating || props.recipientBuyers.length === 0}
              >
                <Send size={13} />{" "}
                {props.simulating ? "Simulating…" : "Send Test (Simulation)"}
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === "gmail-test" && (
        <GmailTestPanel
          gmailSummary={props.gmailSummary}
          testRecipients={props.testRecipients}
          recipientBuyers={props.recipientBuyers}
          campaignId={props.campaignId}
        />
      )}

      {mode === "buyer-send" &&
        (props.buyerSendData ? (
          <BuyerSendPanel
            campaign={props.buyerSendData.campaign}
            template={props.buyerSendData.template}
            gmailConnected={props.buyerSendData.gmailConnected}
            gmailSenderEmail={props.buyerSendData.gmailSenderEmail}
            rows={props.buyerSendData.rows}
            summary={props.buyerSendData.summary}
            deliverySummary={props.buyerSendData.deliverySummary}
            buyersById={props.buyerSendData.buyersById}
            batchMax={props.buyerSendData.batchMax}
            buyerSendEnabled={props.buyerSendData.buyerSendEnabled}
          />
        ) : (
          <div
            className="mt-4 rounded-[12px] p-6 flex items-start gap-3"
            style={{
              backgroundColor: "var(--app-surface)",
              border: "1px dashed var(--app-border-strong)",
            }}
          >
            <Lock size={16} className="text-text-muted mt-0.5" />
            <div>
              <div className="text-[14px] font-medium text-text-primary">
                Buyer send unavailable
              </div>
              <p className="mt-1 text-[13px] text-text-secondary max-w-xl leading-relaxed">
                Readiness could not be computed for this campaign. Ensure the
                campaign has a template and at least one recipient, then reload.
              </p>
            </div>
          </div>
        ))}
    </div>
  );
}

/* -----------------------------------------------------------------------
 * Gmail Test panel — the workflow the operator actually uses to prove
 * a real Gmail send in a safe way.
 * ----------------------------------------------------------------------- */

function GmailTestPanel({
  gmailSummary,
  testRecipients,
  recipientBuyers,
  campaignId,
}: {
  gmailSummary: GmailConnectionSummary;
  testRecipients: TestRecipient[];
  recipientBuyers: Buyer[];
  campaignId: string;
}) {
  const [renderBuyerId, setRenderBuyerId] = useState<string>(recipientBuyers[0]?.id ?? "");
  const [recipient, setRecipient] = useState<string>(testRecipients[0]?.email ?? "");
  const [busy, setBusy] = useState<"preflight" | "send" | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<null | {
    ok: boolean;
    messageId?: string;
    threadId?: string;
    deliveredTo?: string;
    error?: string;
  }>(null);

  if (!gmailSummary.connected) {
    return (
      <div
        className="mt-4 rounded-[12px] p-5 flex items-start gap-3"
        style={{
          backgroundColor: "var(--app-surface)",
          border: "1px solid var(--app-border-strong)",
        }}
      >
        <Mail size={16} className="text-text-muted mt-0.5" />
        <div>
          <div className="text-[13.5px] font-medium text-text-primary">Gmail not connected</div>
          <p className="mt-1 text-[12.5px] text-text-secondary max-w-md leading-relaxed">
            Connect the official MDF Gmail sender before running a Real Gmail Test.
          </p>
          <Link href="/settings?tab=email" className="btn-secondary mt-3">
            Open Settings → Email
          </Link>
        </div>
      </div>
    );
  }

  if (testRecipients.length === 0) {
    return (
      <div
        className="mt-4 rounded-[12px] p-5 flex items-start gap-3"
        style={{
          backgroundColor: "var(--app-surface)",
          border: "1px solid var(--app-border-strong)",
        }}
      >
        <AlertTriangle size={16} className="text-amber-400 mt-0.5" />
        <div>
          <div className="text-[13.5px] font-medium text-text-primary">
            No approved test recipients
          </div>
          <p className="mt-1 text-[12.5px] text-text-secondary max-w-md leading-relaxed">
            Add at least one approved MDF test inbox in Settings → Email before running a Real
            Gmail Test. Buyer emails cannot be a target during test mode.
          </p>
          <Link href="/settings?tab=email" className="btn-secondary mt-3">
            Add test recipient
          </Link>
        </div>
      </div>
    );
  }

  async function runPreflight() {
    setBusy("preflight");
    setBlockers([]);
    try {
      const res = await gmailPreflightAction({
        campaignId,
        renderBuyerId: renderBuyerId || undefined,
        recipient,
      });
      setBlockers(res.blockers);
      if (res.ok) toast.success("Preflight passed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preflight failed");
    } finally {
      setBusy(null);
    }
  }

  async function runSend() {
    if (!confirm(`Deliver a real Gmail test to ${recipient}? Buyers will NOT receive anything.`)) {
      return;
    }
    setBusy("send");
    setBlockers([]);
    // Per-attempt nonce — the server dedupes duplicate submits.
    const nonce =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `n-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const result = await sendGmailTestAction({
        campaignId,
        renderBuyerId: renderBuyerId || undefined,
        recipient,
        nonce,
      });
      setLastResult(result);
      if (result.ok) {
        toast.success(`Delivered to ${result.deliveredTo}`);
      } else {
        toast.error(result.error ?? "Gmail rejected the message");
        if (result.error) setBlockers([result.error]);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 card p-5">
      <div className="grid md:grid-cols-2 gap-4 items-end">
        <label className="block">
          <span className="label">Preview as buyer</span>
          <select
            className="input h-9 text-[13px]"
            value={renderBuyerId}
            onChange={(e) => setRenderBuyerId(e.target.value)}
          >
            <option value="">(no buyer — generic personalization)</option>
            {recipientBuyers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.firstName} {b.lastName} · {b.company}
              </option>
            ))}
          </select>
          <div className="mt-1 text-[11px] text-text-muted">
            Personalization uses this buyer&apos;s data. Delivery goes to your test inbox — the
            actual buyer receives nothing.
          </div>
        </label>
        <label className="block">
          <span className="label">Deliver to (approved MDF inbox)</span>
          <select
            className="input h-9 text-[13px]"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          >
            {testRecipients.map((r) => (
              <option key={r.id} value={r.email}>
                {r.email}
                {r.label ? ` — ${r.label}` : ""}
              </option>
            ))}
          </select>
          <div className="mt-1 text-[11px] text-text-muted">
            Connected as {gmailSummary.email}. Scope: gmail.send only.
          </div>
        </label>
      </div>

      {blockers.length > 0 && (
        <ul
          className="mt-4 rounded-[10px] p-3 text-[12.5px] space-y-1.5"
          style={{
            backgroundColor: "rgba(239,108,92,0.08)",
            border: "1px solid rgba(239,108,92,0.28)",
            color: "#F08B7E",
          }}
        >
          {blockers.map((b, i) => (
            <li key={i} className="flex items-start gap-2">
              <XCircle size={13} className="mt-0.5 shrink-0" /> {b}
            </li>
          ))}
        </ul>
      )}

      {lastResult?.ok && (
        <div
          className="mt-4 rounded-[10px] p-3 text-[12.5px]"
          style={{
            backgroundColor: "rgba(74,222,128,0.10)",
            border: "1px solid rgba(74,222,128,0.28)",
            color: "#86EFAC",
          }}
        >
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 size={13} /> Delivered to {lastResult.deliveredTo}
          </div>
          <div className="mt-1 font-mono text-[11px] text-text-muted">
            Gmail message id: {lastResult.messageId}
            <br />
            Gmail thread id: {lastResult.threadId}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-2 flex-wrap">
        <button
          className="btn-secondary"
          onClick={runPreflight}
          disabled={busy !== null}
        >
          {busy === "preflight" ? "Checking…" : "Run preflight"}
        </button>
        <button
          className="btn-primary"
          onClick={runSend}
          disabled={busy !== null || !recipient}
        >
          <Send size={13} /> {busy === "send" ? "Sending…" : "Deliver Gmail Test"}
        </button>
      </div>
    </div>
  );
}
