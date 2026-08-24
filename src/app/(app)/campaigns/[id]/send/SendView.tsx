"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Send, Lock, Sparkles } from "lucide-react";
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

interface Props {
  campaign: Campaign;
  template: EmailTemplate;
  recipients: CampaignRecipient[];
  buyers: Buyer[];
  assets: AssetRecord[];
}

export function SendView({ campaign, template, recipients, buyers, assets }: Props) {
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

      <div className="mt-6 rounded-2xl bg-brand-canvas border border-brand-border p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[10.5px] tracking-[0.14em] uppercase text-brand-orange flex items-center gap-1.5">
              <Sparkles size={11} /> Simulation Mode
            </div>
            <div className="mt-2 font-serif text-[20px] tracking-[-0.015em] text-brand-charcoal">
              Send a simulated test email
            </div>
            <p className="mt-1 text-[13px] text-brand-muted max-w-lg">
              Renders personalized HTML + plain text and simulates a send. No real email is delivered.
              Live Gmail sending will be connected in Phase 2.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className="input h-9 text-[13px] w-auto"
              value={testBuyerId}
              onChange={(e) => setTestBuyerId(e.target.value)}
            >
              {recipientBuyers.length === 0 && <option value="">No recipients</option>}
              {recipientBuyers.map((b) => (
                <option key={b.id} value={b.id}>
                  Preview as {b.firstName} {b.lastName} · {b.company}
                </option>
              ))}
            </select>
            <button
              className="btn-primary"
              onClick={runSimulation}
              disabled={simulating || recipientBuyers.length === 0}
            >
              <Send size={14} /> {simulating ? "Simulating…" : "Send Test (Simulation)"}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-brand-border bg-white p-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10.5px] tracking-[0.14em] uppercase text-brand-muted flex items-center gap-1.5">
            <Lock size={11} /> Phase 2
          </div>
          <div className="mt-2 font-serif text-[20px] tracking-[-0.015em] text-brand-charcoal">
            Live sending via Gmail
          </div>
          <p className="mt-1 text-[13px] text-brand-muted max-w-lg">
            Once your Google Workspace Gmail integration is connected, this campaign can be sent to
            every recipient with a single click. Not enabled in Phase 1.
          </p>
        </div>
        <button className="btn-outline" disabled title="Not connected yet">
          Connect Gmail to Send
        </button>
      </div>

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
