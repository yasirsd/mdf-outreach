"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  Monitor,
  Smartphone,
  Save,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import type {
  AssetRecord,
  Buyer,
  Campaign,
  CampaignRecipient,
  EmailSection,
  EmailTemplate,
} from "@/lib/types";
import { renderEmailHtml } from "@/lib/email/renderer";
import { EmailPreviewFrame } from "@/components/email/EmailPreviewFrame";
import { SectionProperties } from "@/components/email/SectionProperties";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { getProductTheme } from "@/lib/email/themes/registry";
import type { ProductKey } from "@/lib/email/themes/types";
import {
  saveCampaignEmailAction,
  useTemplateForCampaignAction,
} from "@/app/(app)/campaigns/actions";
import { EmailDetailsPanel } from "./EmailDetailsPanel";

const SECTION_LABELS: Record<string, string> = {
  intro: "Introduction",
  hero: "Hero",
  heritage: "Heritage",
  origin: "Origin",
  formats: "Product Formats",
  packing: "Custom Packing",
  why: "Why MDF",
  cta: "Final CTA",
  footer: "Footer",
};

interface Props {
  campaign: Campaign;
  compatibleTemplates: EmailTemplate[];
  currentMaster?: EmailTemplate;
  knownTheme?: ProductKey;
  recipients: CampaignRecipient[];
  buyers: Buyer[];
  assets: AssetRecord[];
}

export function EmailComposerView(props: Props) {
  const { campaign, compatibleTemplates, currentMaster, knownTheme, recipients, buyers, assets } = props;
  const router = useRouter();

  // If the campaign has no snapshot yet, force the picker experience.
  if (!campaign.emailSections || campaign.emailSections.length === 0) {
    return (
      <TemplatePicker
        campaign={campaign}
        compatibleTemplates={compatibleTemplates}
        knownTheme={knownTheme}
        assets={assets}
        onChosen={() => router.refresh()}
        mode="initial"
      />
    );
  }

  return (
    <EmailComposer
      campaign={campaign}
      compatibleTemplates={compatibleTemplates}
      currentMaster={currentMaster}
      knownTheme={knownTheme}
      recipients={recipients}
      buyers={buyers}
      assets={assets}
    />
  );
}

/* -----------------------------------------------------------------------
 * Template picker (initial + change flows)
 * ----------------------------------------------------------------------- */

function TemplatePicker({
  campaign,
  compatibleTemplates,
  knownTheme,
  assets,
  onChosen,
  mode,
  onCancel,
}: {
  campaign: Campaign;
  compatibleTemplates: EmailTemplate[];
  knownTheme?: ProductKey;
  assets: AssetRecord[];
  onChosen: () => void;
  mode: "initial" | "change";
  onCancel?: () => void;
}) {
  const router = useRouter();
  const { settings } = useWorkspace();
  const assetsBySlot = useMemo(
    () => Object.fromEntries(assets.map((a) => [a.slot, a])),
    [assets],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<EmailTemplate | null>(null);
  const [previewing, setPreviewing] = useState<EmailTemplate | null>(null);

  async function apply(t: EmailTemplate) {
    setBusy(t.id);
    try {
      await useTemplateForCampaignAction(campaign.id, t.id);
      toast.success(`${t.name} applied`);
      onChosen();
      if (mode === "change") router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply template");
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  const theme = knownTheme ? getProductTheme(knownTheme) : null;
  const signature = compatibleTemplates.find((t) => t.variant === "signature");
  const direct = compatibleTemplates.find((t) => t.variant === "direct");

  return (
    <div>
      <div
        className="rounded-[14px] p-6 mb-6"
        style={{
          backgroundColor: "var(--app-elevated)",
          border: "1px solid var(--app-border-strong)",
        }}
      >
        <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange font-medium">
          {mode === "initial" ? "Choose an email template" : "Change template"}
        </div>
        <h2 className="mt-2 text-[19px] font-semibold tracking-tight text-text-primary">
          {mode === "initial"
            ? "Choose the outreach style for this campaign."
            : "Switch this campaign to a different email template."}
        </h2>
        {theme && (
          <p className="mt-1.5 text-[13px] text-text-secondary">
            Compatible with <strong className="text-text-primary">{theme.name}</strong>.
          </p>
        )}
        {mode === "change" && (
          <p className="mt-1 text-[12px] text-text-muted">
            Switching replaces this campaign's current email layout and content. Recipients and
            campaign metadata are not affected.
          </p>
        )}
      </div>

      {compatibleTemplates.length === 0 ? (
        <EmptyIncompatibleState knownTheme={knownTheme} />
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          <VariantCard
            template={signature}
            label="Signature"
            description="Rich product storytelling. Best for introductions, warm leads, and detailed presentations."
            settings={settings}
            assetsBySlot={assetsBySlot}
            onApply={(t) => (mode === "initial" ? apply(t) : setConfirming(t))}
            onPreview={(t) => setPreviewing(t)}
            busy={busy}
          />
          <VariantCard
            template={direct}
            label="Direct"
            description="Concise procurement outreach. Best for cold outreach and purchasing managers."
            settings={settings}
            assetsBySlot={assetsBySlot}
            onApply={(t) => (mode === "initial" ? apply(t) : setConfirming(t))}
            onPreview={(t) => setPreviewing(t)}
            busy={busy}
          />
        </div>
      )}

      {onCancel && (
        <div className="mt-4 text-right">
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}

      <PreviewModal
        template={previewing}
        onClose={() => setPreviewing(null)}
        settings={settings}
        assetsBySlot={assetsBySlot}
      />

      <Modal
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title="Change template?"
        subtitle="Switching replaces this campaign's current email layout and content."
        size="md"
        actions={
          <>
            <button className="btn-ghost" onClick={() => setConfirming(null)}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={busy !== null}
              onClick={() => confirming && apply(confirming)}
            >
              {busy ? "Applying…" : "Change template"}
            </button>
          </>
        }
      >
        <div className="p-6 text-[13px] text-text-secondary space-y-3 leading-relaxed">
          <p>
            You are switching to <strong className="text-text-primary">{confirming?.name}</strong>.
            Any campaign-specific edits made on the current email will be replaced with the new
            template's content.
          </p>
          <p>
            Recipients, buyer data, and campaign metadata (name, subject, from) are not affected.
          </p>
        </div>
      </Modal>
    </div>
  );
}

function VariantCard({
  template,
  label,
  description,
  settings,
  assetsBySlot,
  onApply,
  onPreview,
  busy,
}: {
  template: EmailTemplate | undefined;
  label: string;
  description: string;
  settings: ReturnType<typeof useWorkspace>["settings"];
  assetsBySlot: Record<string, AssetRecord | undefined>;
  onApply: (t: EmailTemplate) => void;
  onPreview: (t: EmailTemplate) => void;
  busy: string | null;
}) {
  if (!template) {
    return (
      <div
        className="rounded-[14px] p-6 text-[12.5px] text-text-secondary"
        style={{
          backgroundColor: "var(--app-surface)",
          border: "1px dashed var(--app-border-strong)",
        }}
      >
        {label} template is missing. An administrator can repair the master library in Settings →
        Developer.
      </div>
    );
  }
  const themeKey = template.themeKey as ProductKey | undefined;
  const theme = themeKey ? getProductTheme(themeKey) : null;
  const html = renderEmailHtml({ template, buyer: null, settings, assetsBySlot });
  const bg = theme?.palette.paper ?? "#FAF8F4";
  return (
    <article
      className="rounded-[14px] overflow-hidden flex flex-col"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
    >
      <button
        type="button"
        onClick={() => onPreview(template)}
        className="relative block text-left overflow-hidden focus-ring-quiet"
        style={{ height: 280, backgroundColor: bg }}
        aria-label={`Preview ${template.name}`}
      >
        <div
          className="absolute inset-0 origin-top-left pointer-events-none"
          style={{ transform: "scale(0.5)", width: "200%", height: "560px" }}
        >
          <EmailPreviewFrame html={html} width="100%" minHeight={560} />
        </div>
        <div
          className="absolute top-3 left-3 text-[10px] px-2 py-0.5 rounded-full font-medium tracking-[0.08em] uppercase"
          style={{
            backgroundColor: "rgba(0,0,0,0.65)",
            color: theme?.palette.paper ?? "#F5F5F4",
            backdropFilter: "blur(6px)",
          }}
        >
          {label}
        </div>
      </button>

      <div className="p-5 flex-1 flex flex-col">
        <div className="text-[13.5px] font-medium text-text-primary">{template.name}</div>
        <p className="mt-1.5 text-[12px] text-text-secondary leading-relaxed">{description}</p>

        <div className="mt-auto pt-4 flex items-center justify-end gap-2">
          <button
            className="btn-ghost text-[12px] h-8"
            type="button"
            onClick={() => onPreview(template)}
          >
            <Eye size={12} /> Preview
          </button>
          <button
            className="btn-primary text-[12px] h-8"
            type="button"
            onClick={() => onApply(template)}
            disabled={busy === template.id}
          >
            {busy === template.id ? "Applying…" : "Select"}
          </button>
        </div>
      </div>
    </article>
  );
}

function EmptyIncompatibleState({ knownTheme }: { knownTheme?: ProductKey }) {
  return (
    <div
      className="rounded-[14px] p-10 text-center"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px dashed var(--app-border-strong)",
      }}
    >
      <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange font-medium mb-2">
        No compatible templates
      </div>
      <p className="text-[13px] text-text-secondary max-w-md mx-auto leading-relaxed">
        No approved MDF master templates were found for
        {knownTheme ? ` this product (${knownTheme})` : " this campaign"}.
        An administrator can repair the library from Settings → Developer.
      </p>
      <Link href="/templates" className="btn-secondary mt-5 inline-flex">
        <ExternalLink size={13} /> Browse creative library
      </Link>
    </div>
  );
}

/* -----------------------------------------------------------------------
 * Email composer (edits the campaign snapshot only)
 * ----------------------------------------------------------------------- */

function EmailComposer({
  campaign: initialCampaign,
  compatibleTemplates,
  currentMaster,
  knownTheme,
  recipients,
  buyers,
  assets,
}: {
  campaign: Campaign;
  compatibleTemplates: EmailTemplate[];
  currentMaster?: EmailTemplate;
  knownTheme?: ProductKey;
  recipients: CampaignRecipient[];
  buyers: Buyer[];
  assets: AssetRecord[];
}) {
  const router = useRouter();
  const { settings } = useWorkspace();
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [view, setView] = useState<"desktop" | "mobile">("desktop");
  const [previewBuyerId, setPreviewBuyerId] = useState<string>("");
  const [draftSections, setDraftSections] = useState<EmailSection[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [showChanger, setShowChanger] = useState(false);
  const [previewingTemplate, setPreviewingTemplate] = useState<EmailTemplate | null>(null);

  // Local view of the campaign so the preview header + send eligibility
  // reflect Email-details edits immediately (server round-trip is fine,
  // but we don't want the header to feel laggy).
  const [campaign, setCampaign] = useState<Campaign>(initialCampaign);

  const workingSections = draftSections ?? campaign.emailSections ?? [];

  // Build a synthetic template object so the renderer can consume the snapshot
  // (with the campaign's theme so palette resolves correctly).
  const renderableTemplate = useMemo<EmailTemplate>(
    () => ({
      id: campaign.id,
      name: campaign.name,
      sections: workingSections,
      themeKey: campaign.themeKey,
      variant: campaign.templateVariant,
      version: 1,
      status: "approved",
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
    }),
    [campaign, workingSections],
  );

  const buyerById = useMemo(() => new Map(buyers.map((b) => [b.id, b])), [buyers]);
  const recipientBuyers = recipients
    .map((r) => buyerById.get(r.buyerId))
    .filter((b): b is Buyer => !!b);
  const previewBuyer =
    (previewBuyerId ? recipientBuyers.find((b) => b.id === previewBuyerId) : recipientBuyers[0]) ??
    null;

  const assetsBySlot = useMemo(
    () => Object.fromEntries(assets.map((a) => [a.slot, a])),
    [assets],
  );

  const html = useMemo(
    () =>
      renderEmailHtml({
        template: renderableTemplate,
        buyer: previewBuyer,
        settings,
        assetsBySlot,
        campaign,
      }),
    [renderableTemplate, previewBuyer, settings, assetsBySlot, campaign],
  );

  const selectedSection =
    workingSections.find((s) => s.id === selectedSectionId) ?? workingSections[0];

  function updateSection(idx: number, patch: Partial<EmailSection>) {
    const next = workingSections.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    setDraftSections(next);
  }
  function move(idx: number, dir: -1 | 1) {
    const next = [...workingSections];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setDraftSections(next);
  }
  function toggleVisible(idx: number) {
    updateSection(idx, { visible: !workingSections[idx].visible });
  }

  async function save() {
    if (!draftSections) return;
    setSaving(true);
    try {
      await saveCampaignEmailAction(campaign.id, draftSections);
      toast.success("Campaign email saved");
      setDraftSections(null);
      router.refresh();
    } catch {
      toast.error("Could not save email");
    } finally {
      setSaving(false);
    }
  }

  const previewWidth = view === "desktop" ? 720 : 400;
  const theme = knownTheme ? getProductTheme(knownTheme) : null;

  return (
    <div>
      {/* Template control strip */}
      <div
        className="rounded-[12px] mb-5 flex items-center justify-between gap-4 flex-wrap px-5 py-3"
        style={{
          backgroundColor: "var(--app-surface)",
          border: "1px solid var(--app-border)",
        }}
      >
        <div className="min-w-0">
          <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium">
            Template
          </div>
          <div className="mt-0.5 text-[13.5px] font-medium text-text-primary truncate">
            {theme?.name ?? campaign.product ?? "Custom"} —{" "}
            {campaign.templateVariant === "direct" ? "Direct" : "Signature"}
          </div>
          <div className="text-[11.5px] text-text-muted flex items-center gap-1.5 mt-0.5">
            {currentMaster && (
              <>
                <span
                  className="inline-flex items-center gap-1 rounded-full px-1.5 py-0"
                  style={{
                    backgroundColor: "rgba(74,222,128,0.12)",
                    color: "#86EFAC",
                  }}
                >
                  Approved
                </span>
                <span>v{currentMaster.version ?? 1}</span>
                <span className="opacity-60">·</span>
              </>
            )}
            <span>Campaign-specific copy — master library unchanged</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {currentMaster && (
            <button
              type="button"
              className="btn-ghost text-[12px] h-8"
              onClick={() => setPreviewingTemplate(currentMaster)}
            >
              <Eye size={12} /> Preview master
            </button>
          )}
          <button
            type="button"
            className="btn-secondary text-[12px] h-8"
            onClick={() => setShowChanger(true)}
          >
            <RefreshCw size={12} /> Change template
          </button>
        </div>
      </div>

      <EmailDetailsPanel
        campaign={campaign}
        onSaved={(patch) => setCampaign((prev) => ({ ...prev, ...patch }))}
      />

      <div className="grid grid-cols-[240px_minmax(0,1fr)_320px] gap-4 -mx-2">
        {/* LEFT: sections */}
        <aside
          className="rounded-[12px] p-3 h-fit sticky top-6"
          style={{
            backgroundColor: "var(--app-surface)",
            border: "1px solid var(--app-border)",
          }}
        >
          <div className="px-2 py-1.5 text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium">
            Sections
          </div>
          <ul className="flex flex-col gap-0.5">
            {workingSections.map((s, i) => {
              const isSel = selectedSection?.id === s.id;
              return (
                <li key={s.id}>
                  <div
                    className={cn(
                      "flex items-center gap-1 rounded-md px-2 py-1.5 text-[12.5px] transition-colors cursor-pointer",
                      isSel
                        ? "text-text-primary"
                        : "text-text-secondary hover:text-text-primary",
                    )}
                    style={isSel ? { backgroundColor: "var(--app-hover)" } : undefined}
                    onClick={() => setSelectedSectionId(s.id)}
                  >
                    <span className="text-text-muted text-[10.5px] w-4">{i + 1}</span>
                    <span className="flex-1 truncate">{SECTION_LABELS[s.type] ?? s.type}</span>
                    <button
                      className="p-0.5 text-text-muted hover:text-text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleVisible(i);
                      }}
                      aria-label={s.visible ? "Hide" : "Show"}
                    >
                      {s.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                    <button
                      className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-30"
                      onClick={(e) => {
                        e.stopPropagation();
                        move(i, -1);
                      }}
                      disabled={i === 0}
                      aria-label="Move up"
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-30"
                      onClick={(e) => {
                        e.stopPropagation();
                        move(i, 1);
                      }}
                      disabled={i === workingSections.length - 1}
                      aria-label="Move down"
                    >
                      <ChevronDown size={12} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {draftSections && (
            <div
              className="mt-3 pt-3 flex gap-2"
              style={{ borderTop: "1px solid var(--app-border)" }}
            >
              <button
                className="btn-ghost text-[12px] h-8 flex-1"
                onClick={() => setDraftSections(null)}
              >
                Discard
              </button>
              <button
                className="btn-primary text-[12px] h-8 flex-1"
                onClick={save}
                disabled={saving}
              >
                <Save size={12} /> {saving ? "…" : "Save"}
              </button>
            </div>
          )}
        </aside>

        {/* CENTER: preview */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium">
                Preview as
              </span>
              <select
                className="input h-8 text-[12.5px] w-auto"
                value={previewBuyer?.id ?? ""}
                onChange={(e) => setPreviewBuyerId(e.target.value)}
              >
                {recipientBuyers.length === 0 && <option value="">No recipients yet</option>}
                {recipientBuyers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.firstName} {b.lastName} · {b.company}
                  </option>
                ))}
              </select>
            </div>
            <div
              className="inline-flex rounded-[8px] p-0.5"
              style={{
                backgroundColor: "var(--app-elevated)",
                border: "1px solid var(--app-border)",
              }}
            >
              <ViewToggle
                active={view === "desktop"}
                icon={<Monitor size={12} />}
                label="Desktop"
                onClick={() => setView("desktop")}
              />
              <ViewToggle
                active={view === "mobile"}
                icon={<Smartphone size={12} />}
                label="Mobile"
                onClick={() => setView("mobile")}
              />
            </div>
          </div>

          <div
            className="rounded-[14px] p-6 md:p-10 flex items-start justify-center min-h-[600px]"
            style={{ backgroundColor: "#E8E5DF" }}
          >
            <div
              className="bg-white shadow-panel rounded-md overflow-hidden"
              style={{ width: previewWidth, maxWidth: "100%" }}
            >
              <div className="bg-[#F5F0E7] px-4 py-2 border-b border-[#D9CFBB] text-[11.5px] text-[#1B1817] flex items-baseline gap-2">
                <span className="text-[#5A524C]">Subject:</span>
                <span className="font-medium truncate">
                  {campaign.subject.replace(
                    /\{\{company\}\}/g,
                    previewBuyer?.company ?? "your company",
                  )}
                </span>
              </div>
              <EmailPreviewFrame html={html} width="100%" minHeight={900} />
            </div>
          </div>
        </div>

        {/* RIGHT: properties */}
        <aside
          className="rounded-[12px] h-fit sticky top-6"
          style={{
            backgroundColor: "var(--app-surface)",
            border: "1px solid var(--app-border)",
          }}
        >
          {selectedSection && (
            <SectionProperties
              section={selectedSection}
              onChange={(patch) => {
                const idx = workingSections.findIndex((s) => s.id === selectedSection.id);
                if (idx >= 0) updateSection(idx, patch);
              }}
              onInsertToken={() => {}}
            />
          )}
        </aside>
      </div>

      {/* Change template modal */}
      <Modal
        open={showChanger}
        onClose={() => setShowChanger(false)}
        title="Change template"
        subtitle="Only templates compatible with this campaign's product are shown."
        size="lg"
      >
        <div className="p-6" style={{ backgroundColor: "var(--app-bg)" }}>
          <TemplatePicker
            campaign={campaign}
            compatibleTemplates={compatibleTemplates}
            knownTheme={knownTheme}
            assets={assets}
            mode="change"
            onChosen={() => setShowChanger(false)}
            onCancel={() => setShowChanger(false)}
          />
        </div>
      </Modal>

      {/* Master preview modal */}
      <PreviewModal
        template={previewingTemplate}
        onClose={() => setPreviewingTemplate(null)}
        settings={settings}
        assetsBySlot={assetsBySlot}
      />
    </div>
  );
}

function ViewToggle({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2.5 h-7 rounded-[6px] text-[11.5px] font-medium flex items-center gap-1.5 transition-colors focus-ring-quiet",
        active ? "text-text-primary" : "text-text-muted hover:text-text-secondary",
      )}
      style={active ? { backgroundColor: "var(--app-hover)" } : undefined}
    >
      {icon}
      {label}
    </button>
  );
}

function PreviewModal({
  template,
  onClose,
  settings,
  assetsBySlot,
}: {
  template: EmailTemplate | null;
  onClose: () => void;
  settings: ReturnType<typeof useWorkspace>["settings"];
  assetsBySlot: Record<string, AssetRecord | undefined>;
}) {
  const html = template ? renderEmailHtml({ template, buyer: null, settings, assetsBySlot }) : "";
  return (
    <Modal
      open={!!template}
      onClose={onClose}
      title={template?.name ?? ""}
      subtitle={template ? `${template.label ?? "Template"} · v${template.version ?? 1}` : ""}
      size="xl"
    >
      {template && (
        <div className="p-6" style={{ backgroundColor: "var(--app-sidebar)" }}>
          <div
            className="mx-auto rounded-[12px] overflow-hidden shadow-panel"
            style={{ maxWidth: 720, backgroundColor: "#FAF8F4" }}
          >
            <EmailPreviewFrame html={html} width="100%" minHeight={900} />
          </div>
        </div>
      )}
    </Modal>
  );
}
