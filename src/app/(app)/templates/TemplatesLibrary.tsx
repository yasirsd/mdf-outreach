"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Eye } from "lucide-react";
import type { AssetRecord, EmailTemplate, WorkspaceSettings } from "@/lib/types";
import { renderEmailHtml } from "@/lib/email/renderer";
import { EmailPreviewFrame } from "@/components/email/EmailPreviewFrame";
import { LazyEmailPreview } from "@/components/email/LazyEmailPreview";
import type { ProductTheme } from "@/lib/email/themes/types";
import { Modal } from "@/components/ui/Modal";

interface ProductRow {
  theme: ProductTheme;
  signature?: EmailTemplate;
  direct?: EmailTemplate;
}

interface CategoryGroup {
  category: string;
  products: ProductRow[];
}

interface Props {
  groups: CategoryGroup[];
  uncategorised: EmailTemplate[];
  settings: WorkspaceSettings;
  assetsBySlot: Record<string, AssetRecord | undefined>;
}

const VARIANT_DESCRIPTION: Record<"signature" | "direct", string> = {
  signature: "Rich product storytelling. Best for introductions, warm leads, detailed product presentations.",
  direct: "Concise procurement outreach. Best for cold outreach, first contact, purchasing managers.",
};

export function TemplatesLibrary({ groups, uncategorised, settings, assetsBySlot }: Props) {
  const [previewing, setPreviewing] = useState<EmailTemplate | null>(null);

  const total = groups.reduce(
    (n, g) => n + g.products.reduce((m, p) => m + (p.signature ? 1 : 0) + (p.direct ? 1 : 0), 0),
    0,
  );

  return (
    <>
      <div className="mb-8 text-[12px] text-text-muted">
        {total} approved master templates across {groups.reduce((n, g) => n + g.products.length, 0)}{" "}
        product families.
      </div>

      <div className="space-y-12">
        {groups.map((g) => (
          <CategorySection
            key={g.category}
            group={g}
            settings={settings}
            assetsBySlot={assetsBySlot}
            onPreview={setPreviewing}
          />
        ))}

        {uncategorised.length > 0 && (
          <section>
            <SectionHeading title="Other templates" hint="Templates without a product theme" />
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {uncategorised.map((t) => (
                <PlainTemplateCard
                  key={t.id}
                  template={t}
                  settings={settings}
                  assetsBySlot={assetsBySlot}
                  onPreview={setPreviewing}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      <PreviewModal
        template={previewing}
        onClose={() => setPreviewing(null)}
        settings={settings}
        assetsBySlot={assetsBySlot}
      />
    </>
  );
}

function CategorySection({
  group,
  settings,
  assetsBySlot,
  onPreview,
}: {
  group: CategoryGroup;
  settings: WorkspaceSettings;
  assetsBySlot: Record<string, AssetRecord | undefined>;
  onPreview: (t: EmailTemplate) => void;
}) {
  return (
    <section>
      <div className="mb-5 flex items-baseline gap-3">
        <h2 className="text-[10.5px] tracking-[0.22em] uppercase text-brand-orange font-semibold">
          {group.category}
        </h2>
        <div
          className="flex-1 h-px"
          style={{ backgroundColor: "var(--app-border)" }}
          aria-hidden
        />
      </div>
      <div className="space-y-8">
        {group.products.map((row) => (
          <ProductGroup
            key={row.theme.key}
            row={row}
            settings={settings}
            assetsBySlot={assetsBySlot}
            onPreview={onPreview}
          />
        ))}
      </div>
    </section>
  );
}

function ProductGroup({
  row,
  settings,
  assetsBySlot,
  onPreview,
}: {
  row: ProductRow;
  settings: WorkspaceSettings;
  assetsBySlot: Record<string, AssetRecord | undefined>;
  onPreview: (t: EmailTemplate) => void;
}) {
  const { theme, signature, direct } = row;
  return (
    <div>
      <div className="mb-3 flex items-baseline gap-3">
        <div
          className="w-[6px] h-[6px] rounded-full"
          style={{ backgroundColor: theme.palette.primary }}
        />
        <h3 className="text-[16px] font-semibold tracking-tight text-text-primary">{theme.name}</h3>
        <span className="text-[11.5px] text-text-muted">{theme.origin}</span>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <TemplateCard
          template={signature}
          variantLabel="Signature"
          description={VARIANT_DESCRIPTION.signature}
          theme={theme}
          settings={settings}
          assetsBySlot={assetsBySlot}
          onPreview={onPreview}
        />
        <TemplateCard
          template={direct}
          variantLabel="Direct"
          description={VARIANT_DESCRIPTION.direct}
          theme={theme}
          settings={settings}
          assetsBySlot={assetsBySlot}
          onPreview={onPreview}
        />
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  variantLabel,
  description,
  theme,
  settings,
  assetsBySlot,
  onPreview,
}: {
  template: EmailTemplate | undefined;
  variantLabel: string;
  description: string;
  theme: ProductTheme;
  settings: WorkspaceSettings;
  assetsBySlot: Record<string, AssetRecord | undefined>;
  onPreview: (t: EmailTemplate) => void;
}) {
  if (!template) {
    return (
      <article
        className="rounded-[14px] p-6 flex items-center gap-3 text-[12.5px] text-text-secondary"
        style={{
          backgroundColor: "var(--app-surface)",
          border: "1px dashed var(--app-border-strong)",
        }}
      >
        Master library repair is available in Settings → Developer.
      </article>
    );
  }
  const previewHtml = renderEmailHtml({ template, buyer: null, settings, assetsBySlot });
  return (
    <article
      className="rounded-[14px] overflow-hidden flex flex-col group focus-within:ring-2 focus-within:ring-brand-orange/30"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
    >
      <button
        type="button"
        onClick={() => onPreview(template)}
        className="relative block text-left overflow-hidden focus-ring-quiet"
        style={{ height: 280, backgroundColor: theme.palette.paper }}
        aria-label={`Preview ${template.name}`}
      >
        <div
          className="absolute inset-0 origin-top-left pointer-events-none transition-transform duration-220 group-hover:scale-[0.51]"
          style={{ transform: "scale(0.5)", width: "200%", height: "560px" }}
        >
          <LazyEmailPreview html={previewHtml} width="100%" minHeight={560} />
        </div>
        <div
          className="absolute top-3 left-3 text-[10px] px-2 py-0.5 rounded-full font-medium tracking-[0.08em] uppercase"
          style={{
            backgroundColor: "rgba(0,0,0,0.65)",
            color: theme.palette.paper,
            backdropFilter: "blur(6px)",
          }}
        >
          {variantLabel}
        </div>
        <div
          className="absolute top-3 right-3 text-[10px] px-2 py-0.5 rounded-full font-medium tracking-[0.08em] uppercase"
          style={{
            backgroundColor:
              template.status === "approved" ? "rgba(74,222,128,0.16)" : "rgba(255,255,255,0.14)",
            color: template.status === "approved" ? "#86EFAC" : theme.palette.paper,
          }}
        >
          {template.status === "approved" ? "Approved" : template.status ?? "Draft"} · v
          {template.version ?? 1}
        </div>
      </button>

      <div className="p-5 flex-1 flex flex-col">
        <div className="text-[13.5px] font-medium text-text-primary">{template.name}</div>
        <p className="mt-1.5 text-[12px] text-text-secondary leading-relaxed">{description}</p>

        <div className="mt-auto pt-4 flex items-center justify-end gap-1.5">
          <button
            className="text-[11.5px] px-2 py-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-app-hover flex items-center gap-1 focus-ring-quiet"
            onClick={() => onPreview(template)}
          >
            <Eye size={12} /> Preview
          </button>
          <Link
            href="/campaigns"
            className="text-[11.5px] px-2.5 py-1 rounded-md focus-ring-quiet flex items-center gap-1"
            style={{ backgroundColor: theme.palette.accent, color: "#0b0b0b" }}
          >
            Use in campaign <ArrowUpRight size={12} />
          </Link>
        </div>
      </div>
    </article>
  );
}

function PlainTemplateCard({
  template,
  settings,
  assetsBySlot,
  onPreview,
}: {
  template: EmailTemplate;
  settings: WorkspaceSettings;
  assetsBySlot: Record<string, AssetRecord | undefined>;
  onPreview: (t: EmailTemplate) => void;
}) {
  const html = renderEmailHtml({ template, buyer: null, settings, assetsBySlot });
  return (
    <article
      className="rounded-[14px] overflow-hidden"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
    >
      <div className="overflow-hidden" style={{ height: 240, backgroundColor: "#FAF8F4" }}>
        <div
          className="origin-top-left pointer-events-none"
          style={{ transform: "scale(0.5)", width: "200%", height: "480px" }}
        >
          <LazyEmailPreview html={html} width="100%" minHeight={480} />
        </div>
      </div>
      <div className="p-4">
        <div className="text-[13px] font-medium text-text-primary">{template.name}</div>
        <div className="mt-2 flex items-center justify-end gap-1.5">
          <button
            className="text-[11.5px] px-2 py-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-app-hover flex items-center gap-1 focus-ring-quiet"
            onClick={() => onPreview(template)}
          >
            <Eye size={12} /> Preview
          </button>
        </div>
      </div>
    </article>
  );
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-3 mb-4">
      <h2 className="text-[15px] font-semibold text-text-primary tracking-tight">{title}</h2>
      {hint && <span className="text-[11.5px] text-text-muted">{hint}</span>}
    </div>
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
  settings: WorkspaceSettings;
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
