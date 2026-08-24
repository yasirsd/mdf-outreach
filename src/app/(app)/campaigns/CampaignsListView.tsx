"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ArrowRight } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/ui/Page";
import { Modal } from "@/components/ui/Modal";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { toast } from "@/components/ui/Toast";
import type { Campaign, CampaignRecipient, CampaignStatus, EmailTemplate } from "@/lib/types";
import { createCampaignAction } from "./actions";

const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
};

interface CampaignsWithRecipients {
  campaign: Campaign;
  recipients: CampaignRecipient[];
}

export function CampaignsListView({
  initial,
  templates,
}: {
  initial: CampaignsWithRecipients[];
  templates: EmailTemplate[];
}) {
  const [creating, setCreating] = useState(false);

  return (
    <PageContainer>
      <PageHeader
        title="Campaigns"
        subtitle="Outreach campaigns for your export markets and products."
        actions={
          <button className="btn-brand" onClick={() => setCreating(true)}>
            <Plus size={14} /> New campaign
          </button>
        }
      />

      {initial.length === 0 ? (
        <div className="card p-16 text-center">
          <div className="mx-auto max-w-md">
            <div className="text-[11px] tracking-[0.16em] uppercase text-brand-orange mb-4">Empty</div>
            <h2 className="font-serif text-[26px] leading-tight tracking-[-0.015em] text-brand-charcoal">
              Start your first campaign.
            </h2>
            <p className="mt-3 text-[14px] text-brand-muted leading-relaxed">
              A campaign groups the market, the product, the template, and the buyers into one focused effort.
            </p>
            <div className="mt-6">
              <button className="btn-brand" onClick={() => setCreating(true)}>
                <Plus size={14} /> New campaign
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {initial.map((row) => (
            <CampaignCard key={row.campaign.id} campaign={row.campaign} recipients={row.recipients} />
          ))}
        </div>
      )}

      <NewCampaignModal
        open={creating}
        onClose={() => setCreating(false)}
        templates={templates}
      />
    </PageContainer>
  );
}

function CampaignCard({ campaign, recipients }: { campaign: Campaign; recipients: CampaignRecipient[] }) {
  const prepared = recipients.filter((r) => !!r.preparedAt).length;
  const contacted = recipients.filter((r) =>
    ["contacted", "replied", "interested", "quotation-sent", "negotiating", "converted"].includes(r.status),
  ).length;
  const replied = recipients.filter((r) =>
    ["replied", "interested", "quotation-sent", "negotiating", "converted"].includes(r.status),
  ).length;
  const interested = recipients.filter((r) =>
    ["interested", "quotation-sent", "negotiating", "converted"].includes(r.status),
  ).length;

  return (
    <Link
      href={`/campaigns/${campaign.id}`}
      className="group card p-7 hover:shadow-card hover:border-brand-charcoal/25 transition-all block"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange">
            {campaign.country} · Export Campaign
          </div>
          <div className="mt-3 font-serif text-[24px] font-medium leading-[1.1] tracking-[-0.015em] text-brand-charcoal">
            {campaign.name}
          </div>
          <div className="mt-1 text-[13px] text-brand-muted">{campaign.product}</div>
        </div>
        <span
          className={`text-[10.5px] px-2 py-1 rounded-md border ${
            campaign.status === "active"
              ? "border-emerald-200 text-emerald-700 bg-white"
              : "border-brand-border text-brand-muted bg-white"
          }`}
        >
          {STATUS_LABELS[campaign.status]}
        </span>
      </div>
      <div className="mt-6 grid grid-cols-5 gap-4 pt-5 border-t border-brand-border">
        <Stat label="Recipients" value={recipients.length} />
        <Stat label="Prepared" value={prepared} />
        <Stat label="Contacted" value={contacted} />
        <Stat label="Replied" value={replied} />
        <Stat label="Interested" value={interested} accent />
      </div>
      <div className="mt-6 flex items-center justify-between text-[13px] text-brand-muted group-hover:text-brand-charcoal transition-colors">
        <span>Open campaign</span>
        <ArrowRight size={14} />
      </div>
    </Link>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10.5px] tracking-[0.14em] uppercase text-brand-muted">{label}</div>
      <div
        className={`mt-1.5 font-serif text-[20px] tracking-[-0.015em] ${accent ? "text-brand-orange" : "text-brand-charcoal"}`}
      >
        {value}
      </div>
    </div>
  );
}

function NewCampaignModal({
  open,
  onClose,
  templates,
}: {
  open: boolean;
  onClose: () => void;
  templates: EmailTemplate[];
}) {
  const router = useRouter();
  const { settings } = useWorkspace();
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [product, setProduct] = useState("");
  const [description, setDescription] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [status, setStatus] = useState<CampaignStatus>("draft");
  const [saving, setSaving] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const c = await createCampaignAction({
        name: name.trim() || `${country} — ${product}`,
        country,
        product,
        description,
        templateId,
        status,
        subject: settings.email.defaultSubject,
        preheader: settings.email.defaultPreheader,
        fromName: settings.email.fromName,
        replyTo: settings.email.replyTo,
      });
      toast.success("Campaign created");
      onClose();
      router.push(`/campaigns/${c.id}`);
    } catch {
      toast.error("Could not create campaign");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New campaign"
      subtitle="Group a market, product, template, and buyers into one outreach effort."
      size="md"
    >
      <form onSubmit={create} className="p-6 space-y-4">
        <div>
          <label className="label">Campaign name</label>
          <input
            className="input"
            placeholder="Campaign name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Country / Market</label>
            <input className="input" value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>
          <div>
            <label className="label">Product</label>
            <input className="input" value={product} onChange={(e) => setProduct(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Description</label>
          <textarea
            className="textarea"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Default template</label>
            <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as CampaignStatus)}
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-4">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-brand" disabled={saving}>
            {saving ? "Creating…" : "Create campaign"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
