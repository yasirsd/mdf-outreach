"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/ui/Page";
import { useWorkspace } from "@/components/WorkspaceProvider";
import type { AssetRecord, AssetSlot, WorkspaceSettings } from "@/lib/types";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import {
  exportWorkspaceBackupAction,
  saveSettingsAction,
  upsertAssetAction,
} from "./actions";

type Tab = "company" | "brand" | "email" | "assets" | "data" | "developer";

interface Props {
  initialSettings: WorkspaceSettings;
  initialAssets: AssetRecord[];
}

export function SettingsView({ initialSettings, initialAssets }: Props) {
  const router = useRouter();
  const { setLocalSettings } = useWorkspace();
  const [tab, setTab] = useState<Tab>("company");
  const [draft, setDraft] = useState<WorkspaceSettings>(initialSettings);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const saved = await saveSettingsAction(draft);
      setLocalSettings(saved);
      toast.success("Settings saved");
    } catch {
      toast.error("Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  const setCompany = (k: keyof WorkspaceSettings["company"], v: string) =>
    setDraft({ ...draft, company: { ...draft.company, [k]: v } });
  const setBrand = (k: keyof WorkspaceSettings["brand"], v: string) =>
    setDraft({ ...draft, brand: { ...draft.brand, [k]: v } });
  const setEmail = (k: keyof WorkspaceSettings["email"], v: string) =>
    setDraft({ ...draft, email: { ...draft.email, [k]: v } });

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        subtitle="Company, brand, email defaults, assets, and workspace data."
      />

      <div className="grid md:grid-cols-[220px_minmax(0,1fr)] gap-8">
        <aside className="flex md:flex-col gap-1">
          {(
            [
              ["company", "Company"],
              ["brand", "Brand"],
              ["email", "Email"],
              ["assets", "Assets"],
              ["data", "Data"],
              ["developer", "Developer"],
            ] as Array<[Tab, string]>
          ).map(([k, label]) => (
            <button
              key={k}
              className={cn(
                "text-left px-3 py-2 rounded-md text-[13px] font-medium transition-colors",
                tab === k
                  ? "bg-white border border-brand-border text-brand-charcoal"
                  : "text-brand-charcoal/70 hover:bg-brand-canvas/60 border border-transparent",
              )}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </aside>

        <div>
          {tab === "company" && (
            <Section title="Company" description="Used throughout the app and in outreach emails.">
              <TwoCol>
                <Field label="Company name">
                  <input className="input" value={draft.company.companyName} onChange={(e) => setCompany("companyName", e.target.value)} />
                </Field>
                <Field label="Short name">
                  <input className="input" value={draft.company.shortName} onChange={(e) => setCompany("shortName", e.target.value)} />
                </Field>
              </TwoCol>
              <Field label="Tagline">
                <input className="input" value={draft.company.tagline} onChange={(e) => setCompany("tagline", e.target.value)} />
              </Field>
              <Field label="Heritage line">
                <input className="input" value={draft.company.heritage} onChange={(e) => setCompany("heritage", e.target.value)} />
              </Field>
              <Field label="Location">
                <input className="input" value={draft.company.location} onChange={(e) => setCompany("location", e.target.value)} />
              </Field>
              <TwoCol>
                <Field label="Website">
                  <input className="input" value={draft.company.website} onChange={(e) => setCompany("website", e.target.value)} />
                </Field>
                <Field label="Contact email">
                  <input className="input" value={draft.company.email} onChange={(e) => setCompany("email", e.target.value)} />
                </Field>
              </TwoCol>
              <SaveBar onSave={save} saving={saving} />
            </Section>
          )}

          {tab === "brand" && (
            <Section title="Brand" description="MDF has one strong identity — kept intentional and restrained.">
              <TwoCol>
                <Field label="Brand orange">
                  <ColorInput value={draft.brand.orange} onChange={(v) => setBrand("orange", v)} />
                </Field>
                <Field label="Charcoal">
                  <ColorInput value={draft.brand.charcoal} onChange={(v) => setBrand("charcoal", v)} />
                </Field>
                <Field label="Warm ivory (background)">
                  <ColorInput value={draft.brand.ivory} onChange={(v) => setBrand("ivory", v)} />
                </Field>
                <Field label="Deep chilli red (accent)">
                  <ColorInput value={draft.brand.chilli} onChange={(v) => setBrand("chilli", v)} />
                </Field>
              </TwoCol>
              <SaveBar onSave={save} saving={saving} />
            </Section>
          )}

          {tab === "email" && (
            <Section title="Email defaults" description="Applied to new campaigns.">
              <TwoCol>
                <Field label="From name">
                  <input className="input" value={draft.email.fromName} onChange={(e) => setEmail("fromName", e.target.value)} />
                </Field>
                <Field label="Reply-to">
                  <input className="input" value={draft.email.replyTo} onChange={(e) => setEmail("replyTo", e.target.value)} />
                </Field>
              </TwoCol>
              <Field label="Default subject">
                <input className="input" value={draft.email.defaultSubject} onChange={(e) => setEmail("defaultSubject", e.target.value)} />
              </Field>
              <Field label="Default preheader">
                <input className="input" value={draft.email.defaultPreheader} onChange={(e) => setEmail("defaultPreheader", e.target.value)} />
              </Field>
              <Field label="Default CTA URL">
                <input className="input" value={draft.email.defaultCtaUrl} onChange={(e) => setEmail("defaultCtaUrl", e.target.value)} />
              </Field>
              <TwoCol>
                <Field label="Website URL">
                  <input className="input" value={draft.email.websiteUrl} onChange={(e) => setEmail("websiteUrl", e.target.value)} />
                </Field>
                <Field label="WhatsApp URL">
                  <input className="input" value={draft.email.whatsappUrl} onChange={(e) => setEmail("whatsappUrl", e.target.value)} />
                </Field>
              </TwoCol>
              <TwoCol>
                <Field label="LinkedIn URL">
                  <input className="input" value={draft.email.linkedinUrl} onChange={(e) => setEmail("linkedinUrl", e.target.value)} />
                </Field>
                <Field label="Instagram URL">
                  <input className="input" value={draft.email.instagramUrl} onChange={(e) => setEmail("instagramUrl", e.target.value)} />
                </Field>
              </TwoCol>
              <SaveBar onSave={save} saving={saving} />
            </Section>
          )}

          {tab === "assets" && (
            <AssetsSection initialAssets={initialAssets} onChange={() => router.refresh()} />
          )}

          {tab === "data" && <DataSection />}

          {tab === "developer" && (
            <Section title="Developer" description="Advanced information for operators.">
              <div className="rounded-xl border border-brand-border bg-white p-5 text-[13.5px] text-brand-charcoal/85 space-y-3">
                <div>
                  <strong className="text-brand-charcoal">Storage:</strong> Supabase (RLS enforced per workspace).
                </div>
                <div>
                  <strong className="text-brand-charcoal">Email provider:</strong> SimulationEmailProvider (no network calls).
                </div>
                <div>
                  <strong className="text-brand-charcoal">Live sending:</strong> Not connected in this phase.
                </div>
                <div className="pt-3 border-t border-brand-border text-brand-muted">
                  Phase 2 will introduce Gmail live sending — configuration will appear here.
                </div>
              </div>
            </Section>
          )}
        </div>
      </div>
    </PageContainer>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-6">
        <div className="font-serif text-[24px] tracking-[-0.015em] text-brand-charcoal">{title}</div>
        <div className="mt-1 text-[13.5px] text-brand-muted">{description}</div>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-4">{children}</div>;
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-10 h-10 rounded-lg border border-brand-border bg-white p-1 cursor-pointer"
      />
      <input className="input flex-1 font-mono text-[13px]" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SaveBar({ onSave, saving }: { onSave: () => void; saving: boolean }) {
  return (
    <div className="pt-4 flex justify-end">
      <button className="btn-primary" onClick={onSave} disabled={saving}>
        {saving ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}

function AssetsSection({
  initialAssets,
  onChange,
}: {
  initialAssets: AssetRecord[];
  onChange: () => void;
}) {
  const [assets, setAssets] = useState<AssetRecord[]>(initialAssets);
  const bySlot = useMemo<Record<string, AssetRecord | undefined>>(
    () => Object.fromEntries(assets.map((a) => [a.slot, a])),
    [assets],
  );
  const SLOTS: Array<{ slot: AssetSlot; label: string; hint: string }> = [
    { slot: "logo", label: "Logo", hint: "MDF logo mark" },
    { slot: "hero", label: "Hero", hint: "Premium studio photograph" },
    { slot: "stem", label: "Format — with stem", hint: "Whole chillies with stems" },
    { slot: "stemless", label: "Format — stemless", hint: "Stemless dry red chilli" },
    { slot: "powder", label: "Format — chilli powder", hint: "Chilli powder composition" },
    { slot: "packing", label: "Custom packing", hint: "Export-grade packing" },
    { slot: "origin", label: "Origin", hint: "Origin / farm scene" },
  ];

  async function updateSlot(slot: AssetSlot, patch: Partial<AssetRecord>) {
    try {
      const saved = await upsertAssetAction(slot, patch);
      setAssets((prev) => {
        const idx = prev.findIndex((a) => a.slot === slot);
        if (idx === -1) return [...prev, saved];
        const next = [...prev];
        next[idx] = saved;
        return next;
      });
      onChange();
    } catch {
      toast.error("Could not update asset");
    }
  }

  async function onFile(slot: AssetSlot, file: File) {
    if (file.size > 4 * 1024 * 1024) {
      toast.error("Image must be under 4 MB for local preview.");
      return;
    }
    const dataUrl: string = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = () => rej(new Error("read failed"));
      r.readAsDataURL(file);
    });
    await updateSlot(slot, { localDataUrl: dataUrl, name: file.name });
    toast.success("Preview image updated");
  }

  return (
    <Section title="Assets" description="Preview images and production URLs for the email.">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-900 flex gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <div>
          Local preview images look great in the app but cannot be delivered by email.
          Add a public HTTPS <strong>Production URL</strong> for each asset before Phase 2 live sending.
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {SLOTS.map(({ slot, label, hint }) => {
          const a = bySlot[slot];
          return (
            <div key={slot} className="rounded-xl border border-brand-border bg-white p-4 flex items-start gap-4">
              <div className="w-16 h-16 rounded-md bg-brand-canvas border border-brand-border overflow-hidden shrink-0">
                {a?.localDataUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={a.localDataUrl} alt={label} className="w-full h-full object-cover" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-brand-charcoal">{label}</div>
                <div className="text-[12px] text-brand-muted mb-2">{hint}</div>
                <div className="grid md:grid-cols-2 gap-2">
                  <label className="btn-outline text-[12px] h-8 cursor-pointer">
                    Upload local preview
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && onFile(slot, e.target.files[0])}
                    />
                  </label>
                  <input
                    className="input h-8 text-[12.5px]"
                    placeholder="Production HTTPS URL"
                    defaultValue={a?.productionUrl ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (a?.productionUrl ?? "")) {
                        void updateSlot(slot, { productionUrl: v });
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function DataSection() {
  const [busy, setBusy] = useState(false);

  async function exportBackup() {
    setBusy(true);
    try {
      const backup = await exportWorkspaceBackupAction();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `mdf-outreach-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Workspace backup exported");
    } catch {
      toast.error("Could not export backup");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Data" description="Workspace data lives in Supabase. Export a backup any time.">
      <div className="rounded-xl border border-brand-border bg-white divide-y divide-brand-border">
        <div className="p-5 flex items-start justify-between gap-4">
          <div>
            <div className="text-[14px] font-medium text-brand-charcoal">Export workspace backup</div>
            <div className="text-[13px] text-brand-muted mt-1">
              A single JSON file with buyers, campaigns, templates, recipients, activity, and settings from your workspace.
            </div>
          </div>
          <button className="btn-primary" onClick={exportBackup} disabled={busy}>
            <Download size={14} /> {busy ? "Exporting…" : "Export"}
          </button>
        </div>
        <div className="p-5">
          <div className="text-[14px] font-medium text-brand-charcoal">Import / restore</div>
          <div className="text-[13px] text-brand-muted mt-1">
            Backup restore is not exposed in the app. Contact your MDF administrator to restore
            from a backup file via the Supabase Dashboard.
          </div>
        </div>
      </div>
    </Section>
  );
}
