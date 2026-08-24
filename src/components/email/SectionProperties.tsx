"use client";

import type { EmailSection, EmailSectionType } from "@/lib/types";
import { ChevronDown } from "lucide-react";

interface Props {
  section: EmailSection;
  onChange: (patch: Partial<EmailSection>) => void;
  onInsertToken: (field: string) => void;
}

interface FieldSpec {
  key: string;
  label: string;
  type: "text" | "textarea" | "url";
  placeholder?: string;
  personalize?: boolean;
}

const FIELDS: Record<EmailSectionType, FieldSpec[]> = {
  intro: [
    { key: "greeting", label: "Greeting", type: "text", personalize: true },
    { key: "body", label: "Introduction", type: "textarea", personalize: true },
  ],
  hero: [
    { key: "eyebrow", label: "Eyebrow (small caps line)", type: "text" },
    { key: "headline", label: "Headline (use \\n for line break)", type: "textarea" },
    { key: "body", label: "Supporting copy", type: "textarea", personalize: true },
    { key: "ctaLabel", label: "CTA label", type: "text" },
    { key: "ctaUrl", label: "CTA URL", type: "url" },
  ],
  heritage: [
    { key: "big", label: "Large number/word", type: "text" },
    { key: "title", label: "Title (small caps)", type: "text" },
    { key: "body", label: "Supporting body", type: "textarea" },
  ],
  origin: [
    { key: "headline", label: "Headline", type: "textarea" },
    { key: "body", label: "Body", type: "textarea" },
  ],
  formats: [
    { key: "headline", label: "Section headline", type: "textarea" },
    { key: "format1Title", label: "Format 1 · title", type: "text" },
    { key: "format1Body", label: "Format 1 · body", type: "textarea" },
    { key: "format2Title", label: "Format 2 · title", type: "text" },
    { key: "format2Body", label: "Format 2 · body", type: "textarea" },
    { key: "format3Title", label: "Format 3 · title", type: "text" },
    { key: "format3Body", label: "Format 3 · body", type: "textarea" },
  ],
  packing: [
    { key: "headline", label: "Headline", type: "textarea" },
    { key: "body", label: "Body", type: "textarea" },
    { key: "item1", label: "Feature 1", type: "text" },
    { key: "item2", label: "Feature 2", type: "text" },
    { key: "item3", label: "Feature 3", type: "text" },
    { key: "ctaLabel", label: "CTA label", type: "text" },
    { key: "ctaUrl", label: "CTA URL", type: "url" },
  ],
  why: [
    { key: "headline", label: "Section headline", type: "text" },
    { key: "p1Title", label: "Point 1 · title", type: "text" },
    { key: "p1Body", label: "Point 1 · body", type: "textarea" },
    { key: "p2Title", label: "Point 2 · title", type: "text" },
    { key: "p2Body", label: "Point 2 · body", type: "textarea" },
    { key: "p3Title", label: "Point 3 · title", type: "text" },
    { key: "p3Body", label: "Point 3 · body", type: "textarea" },
    { key: "p4Title", label: "Point 4 · title", type: "text" },
    { key: "p4Body", label: "Point 4 · body", type: "textarea" },
    { key: "p5Title", label: "Point 5 · title", type: "text" },
    { key: "p5Body", label: "Point 5 · body", type: "textarea" },
  ],
  cta: [
    { key: "headline", label: "Headline", type: "textarea" },
    { key: "body", label: "Body", type: "textarea" },
    { key: "ctaLabel", label: "Primary CTA label", type: "text" },
    { key: "ctaUrl", label: "Primary CTA URL", type: "url" },
    { key: "secondaryLabel", label: "Secondary link label", type: "text" },
    { key: "secondaryUrl", label: "Secondary link URL", type: "url" },
    { key: "footnote", label: "Footnote", type: "text" },
  ],
  footer: [],
};

const TOKENS = ["first_name", "last_name", "company", "country", "product", "greeting"];

export function SectionProperties({ section, onChange }: Props) {
  const specs = FIELDS[section.type];

  function setField(key: string, value: string) {
    onChange({ data: { ...section.data, [key]: value } });
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10.5px] tracking-[0.14em] uppercase text-brand-muted">
            Section
          </div>
          <div className="text-[15px] font-medium text-brand-charcoal capitalize">
            {sectionTitle(section.type)}
          </div>
        </div>
        <label className="flex items-center gap-2 text-[12px] text-brand-charcoal/80">
          <input
            type="checkbox"
            checked={section.visible}
            onChange={(e) => onChange({ visible: e.target.checked })}
          />
          Visible
        </label>
      </div>

      {specs.length === 0 ? (
        <div className="text-[13px] text-brand-muted leading-relaxed">
          The footer is generated from your Company and Email settings. Edit those in Settings.
        </div>
      ) : (
        <>
          {specs.map((spec) => (
            <FieldEditor
              key={spec.key}
              spec={spec}
              value={section.data[spec.key] ?? ""}
              onChange={(v) => setField(spec.key, v)}
              tokens={spec.personalize ? TOKENS : undefined}
            />
          ))}
        </>
      )}
    </div>
  );
}

function FieldEditor({
  spec,
  value,
  onChange,
  tokens,
}: {
  spec: FieldSpec;
  value: string;
  onChange: (v: string) => void;
  tokens?: string[];
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[11.5px] font-medium text-brand-charcoal/70">{spec.label}</label>
        {tokens && (
          <PersonalizationMenu
            onSelect={(t) => {
              onChange(`${value}{{${t}}}`);
            }}
          />
        )}
      </div>
      {spec.type === "textarea" ? (
        <textarea
          className="textarea text-[13px]"
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={spec.placeholder}
        />
      ) : (
        <input
          className="input text-[13px]"
          type={spec.type === "url" ? "url" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={spec.placeholder}
        />
      )}
    </div>
  );
}

function PersonalizationMenu({ onSelect }: { onSelect: (t: string) => void }) {
  return (
    <div className="relative group">
      <button
        type="button"
        className="text-[11px] text-brand-charcoal/60 hover:text-brand-charcoal inline-flex items-center gap-1"
      >
        Insert <ChevronDown size={10} />
      </button>
      <div className="absolute right-0 top-full mt-1 hidden group-hover:block group-focus-within:block bg-white border border-brand-border rounded-lg shadow-panel z-20 min-w-[160px] py-1">
        {TOKENS.map((t) => (
          <button
            key={t}
            type="button"
            className="w-full text-left px-3 py-1.5 text-[12px] text-brand-charcoal/85 hover:bg-brand-canvas"
            onClick={() => onSelect(t)}
          >
            <span className="text-brand-muted">{`{{`}</span>
            {t}
            <span className="text-brand-muted">{`}}`}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function sectionTitle(t: EmailSectionType): string {
  const map: Record<EmailSectionType, string> = {
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
  return map[t];
}
