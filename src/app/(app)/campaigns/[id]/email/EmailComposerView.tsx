"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  Monitor,
  Smartphone,
  Save,
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
import { saveTemplateAction } from "@/app/(app)/campaigns/actions";

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
  template: EmailTemplate;
  recipients: CampaignRecipient[];
  buyers: Buyer[];
  assets: AssetRecord[];
}

export function EmailComposerView({ campaign, template, recipients, buyers, assets }: Props) {
  const router = useRouter();
  const { settings } = useWorkspace();

  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [view, setView] = useState<"desktop" | "mobile">("desktop");
  const [previewBuyerId, setPreviewBuyerId] = useState<string>("");
  const [draftSections, setDraftSections] = useState<EmailSection[] | null>(null);
  const [saving, setSaving] = useState(false);

  const sections = draftSections ?? template.sections;
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
        template: { ...template, sections },
        buyer: previewBuyer,
        settings,
        assetsBySlot,
      }),
    [template, sections, previewBuyer, settings, assetsBySlot],
  );

  const selectedSection = sections.find((s) => s.id === selectedSectionId) ?? sections[0];

  function updateSection(idx: number, patch: Partial<EmailSection>) {
    const next = sections.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    setDraftSections(next);
  }

  function move(idx: number, dir: -1 | 1) {
    const next = [...sections];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setDraftSections(next);
  }

  function toggleVisible(idx: number) {
    updateSection(idx, { visible: !sections[idx].visible });
  }

  async function save() {
    if (!draftSections) return;
    setSaving(true);
    try {
      await saveTemplateAction({ ...template, sections: draftSections });
      toast.success("Template saved");
      setDraftSections(null);
      router.refresh();
    } catch {
      toast.error("Could not save template");
    } finally {
      setSaving(false);
    }
  }

  const previewWidth = view === "desktop" ? 720 : 400;

  return (
    <div className="grid grid-cols-[240px_minmax(0,1fr)_320px] gap-4 -mx-2">
      <aside className="rounded-2xl border border-brand-border bg-white p-3 h-fit sticky top-6">
        <div className="px-2 py-1.5 text-[10.5px] tracking-[0.14em] uppercase text-brand-muted">
          Sections
        </div>
        <ul className="flex flex-col gap-0.5">
          {sections.map((s, i) => {
            const isSel = selectedSection?.id === s.id;
            return (
              <li key={s.id}>
                <div
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2 py-1.5 text-[13px] transition-colors cursor-pointer",
                    isSel
                      ? "bg-brand-canvas text-brand-charcoal"
                      : "text-brand-charcoal/80 hover:bg-brand-canvas/60",
                  )}
                  onClick={() => setSelectedSectionId(s.id)}
                >
                  <span className="text-brand-muted/60 text-[10.5px] w-4">{i + 1}</span>
                  <span className="flex-1 truncate">{SECTION_LABELS[s.type] ?? s.type}</span>
                  <button
                    className="p-0.5 text-brand-muted hover:text-brand-charcoal"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleVisible(i);
                    }}
                    aria-label={s.visible ? "Hide" : "Show"}
                  >
                    {s.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                  <button
                    className="p-0.5 text-brand-muted hover:text-brand-charcoal disabled:opacity-30"
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
                    className="p-0.5 text-brand-muted hover:text-brand-charcoal disabled:opacity-30"
                    onClick={(e) => {
                      e.stopPropagation();
                      move(i, 1);
                    }}
                    disabled={i === sections.length - 1}
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
          <div className="mt-3 pt-3 border-t border-brand-border flex gap-2">
            <button className="btn-ghost text-[12px] h-8 flex-1" onClick={() => setDraftSections(null)}>
              Discard
            </button>
            <button className="btn-primary text-[12px] h-8 flex-1" onClick={save} disabled={saving}>
              <Save size={12} /> {saving ? "…" : "Save"}
            </button>
          </div>
        )}
      </aside>

      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-[11px] tracking-[0.14em] uppercase text-brand-muted">
              Preview as
            </span>
            <select
              className="input h-8 text-[13px]"
              value={previewBuyer?.id ?? ""}
              onChange={(e) => setPreviewBuyerId(e.target.value)}
            >
              {recipientBuyers.length === 0 && <option value="">No recipients</option>}
              {recipientBuyers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.firstName} {b.lastName} · {b.company}
                </option>
              ))}
            </select>
          </div>
          <div className="inline-flex bg-white border border-brand-border rounded-lg p-0.5">
            <button
              className={cn(
                "px-2.5 h-7 rounded-md text-[12px] flex items-center gap-1.5",
                view === "desktop" ? "bg-brand-canvas text-brand-charcoal" : "text-brand-muted",
              )}
              onClick={() => setView("desktop")}
            >
              <Monitor size={12} /> Desktop
            </button>
            <button
              className={cn(
                "px-2.5 h-7 rounded-md text-[12px] flex items-center gap-1.5",
                view === "mobile" ? "bg-brand-canvas text-brand-charcoal" : "text-brand-muted",
              )}
              onClick={() => setView("mobile")}
            >
              <Smartphone size={12} /> Mobile
            </button>
          </div>
        </div>

        <div className="rounded-2xl bg-brand-canvas p-6 md:p-10 flex items-start justify-center min-h-[600px]">
          <div
            className="bg-white shadow-card rounded-md overflow-hidden"
            style={{ width: previewWidth, maxWidth: "100%" }}
          >
            <div className="bg-brand-canvas/80 px-4 py-2 border-b border-brand-border text-[11.5px] text-brand-charcoal/85 flex items-baseline gap-2">
              <span className="text-brand-muted">Subject:</span>
              <span className="font-medium truncate">
                {campaign.subject.replace(/\{\{company\}\}/g, previewBuyer?.company ?? "your company")}
              </span>
            </div>
            <EmailPreviewFrame html={html} width="100%" minHeight={900} />
          </div>
        </div>
      </div>

      <aside className="rounded-2xl border border-brand-border bg-white h-fit sticky top-6">
        {selectedSection && (
          <SectionProperties
            section={selectedSection}
            onChange={(patch) => {
              const idx = sections.findIndex((s) => s.id === selectedSection.id);
              if (idx >= 0) updateSection(idx, patch);
            }}
            onInsertToken={() => {}}
          />
        )}
      </aside>
    </div>
  );
}
