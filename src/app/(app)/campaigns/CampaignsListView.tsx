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
import { PRODUCT_CATALOGUE } from "@/lib/email/themes/catalogue";
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
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus size={13} /> New campaign
          </button>
        }
      />

      {initial.length === 0 ? (
        <div
          className="rounded-[16px] p-14 text-center"
          style={{
            backgroundColor: "var(--app-surface)",
            border: "1px dashed var(--app-border-strong)",
          }}
        >
          <div className="mx-auto max-w-md">
            <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange mb-3 font-medium">
              Start
            </div>
            <h2 className="text-[22px] font-semibold tracking-tight text-text-primary">
              Start your first campaign.
            </h2>
            <p className="mt-2 text-[13.5px] text-text-secondary leading-relaxed">
              A campaign groups market + product + buyers + email into one focused effort.
            </p>
            <div className="mt-6">
              <button className="btn-primary" onClick={() => setCreating(true)}>
                <Plus size={13} /> New campaign
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

  const statusTone =
    campaign.status === "active"
      ? { fg: "#4ADE80", bg: "rgba(34,197,94,0.10)", border: "rgba(34,197,94,0.28)" }
      : campaign.status === "paused"
        ? { fg: "#FCD34D", bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.28)" }
        : campaign.status === "completed"
          ? { fg: "#93C5FD", bg: "rgba(59,130,246,0.10)", border: "rgba(59,130,246,0.28)" }
          : { fg: "#A1A1AA", bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.12)" };

  return (
    <Link
      href={`/campaigns/${campaign.id}`}
      className="group block rounded-[14px] p-6 transition-colors duration-180 focus-ring-quiet"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange font-medium">
            {campaign.country} · Export
          </div>
          <div className="mt-2.5 text-[17px] font-semibold tracking-tight text-text-primary truncate">
            {campaign.name}
          </div>
          <div className="mt-1 text-[12.5px] text-text-secondary truncate">{campaign.product}</div>
        </div>
        <span
          className="text-[11px] px-2.5 py-1 rounded-full font-medium shrink-0"
          style={{ color: statusTone.fg, backgroundColor: statusTone.bg, border: `1px solid ${statusTone.border}` }}
        >
          {STATUS_LABELS[campaign.status]}
        </span>
      </div>
      <div
        className="mt-5 grid grid-cols-5 gap-3 pt-4"
        style={{ borderTop: "1px solid var(--app-border)" }}
      >
        <Stat label="Recipients" value={recipients.length} />
        <Stat label="Prepared" value={prepared} />
        <Stat label="Contacted" value={contacted} />
        <Stat label="Replied" value={replied} />
        <Stat label="Interested" value={interested} accent />
      </div>
      <div className="mt-5 flex items-center justify-between text-[12px] text-text-muted group-hover:text-text-secondary transition-colors">
        <span>Open campaign</span>
        <ArrowRight size={13} />
      </div>
    </Link>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.14em] uppercase text-text-muted font-medium">
        {label}
      </div>
      <div
        className="mt-1.5 text-[17px] font-semibold tabular-nums tracking-tight"
        style={{ color: accent ? "var(--brand-orange)" : "var(--text-primary)" }}
      >
        {value}
      </div>
    </div>
  );
}

function NewCampaignModal({
  open,
  onClose,
  templates: _templates,
}: {
  open: boolean;
  onClose: () => void;
  templates: EmailTemplate[];
}) {
  const router = useRouter();
  const { settings } = useWorkspace();
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [themeKey, setThemeKey] = useState<string>("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<CampaignStatus>("draft");
  const [saving, setSaving] = useState(false);

  const selectedProduct = PRODUCT_CATALOGUE.find((p) => p.key === themeKey);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!themeKey || !selectedProduct) {
      toast.error("Choose a product to continue.");
      return;
    }
    setSaving(true);
    try {
      const finalName =
        name.trim() ||
        `${country.trim() || "Global"} — ${selectedProduct.name}`;
      const c = await createCampaignAction({
        name: finalName,
        country,
        product: selectedProduct.name,
        themeKey: selectedProduct.key,
        description,
        status,
        subject: settings.email.defaultSubject,
        preheader: settings.email.defaultPreheader,
        fromName: settings.email.fromName,
        replyTo: settings.email.replyTo,
      });
      toast.success("Campaign created — choose an email template");
      onClose();
      router.push(`/campaigns/${c.id}/email`);
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
        <label className="block">
          <span className="label">Campaign name</span>
          <input
            className="input"
            placeholder="e.g. Thailand — Guntur Chilli Spring outreach"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="label">Country / Market</span>
            <input
              className="input"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="e.g. Thailand"
            />
          </label>
          <label className="block">
            <span className="label">Status</span>
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
          </label>
        </div>

        <div>
          <div className="label">Product</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PRODUCT_CATALOGUE.map((p) => {
              const active = themeKey === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  className="text-left rounded-[10px] p-3 transition-colors focus-ring-quiet"
                  style={{
                    backgroundColor: active ? "var(--app-elevated)" : "var(--app-surface)",
                    border: active
                      ? "1px solid var(--brand-orange)"
                      : "1px solid var(--app-border)",
                  }}
                  onClick={() => setThemeKey(p.key)}
                  aria-pressed={active}
                >
                  <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium">
                    {p.category}
                  </div>
                  <div className="mt-1 text-[13.5px] font-medium text-text-primary">{p.name}</div>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11.5px] text-text-muted">
            You&apos;ll choose the Signature or Direct email template on the next step.
          </p>
        </div>

        <label className="block">
          <span className="label">Description</span>
          <textarea
            className="textarea"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional internal note about this campaign."
          />
        </label>

        <div className="flex items-center justify-end gap-2 pt-4">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !themeKey}>
            {saving ? "Creating…" : "Continue"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
