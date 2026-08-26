"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, Wrench } from "lucide-react";
import { resetMasterLibraryAction, verifyMasterLibraryAction } from "@/app/(app)/actions";
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
import { AssetManager } from "./AssetManager";
import { GmailPanel } from "./GmailPanel";
import type { GmailConnectionSummary, TestRecipient } from "./gmailActions";

function AssetManagerSection({ initialAssets }: { initialAssets: AssetRecord[] }) {
  return (
    <div>
      <div className="mb-6">
        <div className="text-[18px] font-semibold tracking-tight text-text-primary">
          Email assets
        </div>
        <div className="mt-1 text-[13px] text-text-secondary">
          Manage the images used in outbound MDF emails. Uploads are stored in the
          workspace&apos;s Supabase asset bucket.
        </div>
      </div>
      <AssetManager initialAssets={initialAssets} />
    </div>
  );
}

type Tab = "company" | "brand" | "email" | "assets" | "data" | "developer";

interface Props {
  initialSettings: WorkspaceSettings;
  initialAssets: AssetRecord[];
  initialTab?: Tab;
  gmailSummary: GmailConnectionSummary;
  testRecipients: TestRecipient[];
  gmailStatus?: string | null;
}

export function SettingsView({
  initialSettings,
  initialAssets,
  initialTab,
  gmailSummary,
  testRecipients,
  gmailStatus,
}: Props) {
  const router = useRouter();
  const { setLocalSettings } = useWorkspace();
  const [tab, setTab] = useState<Tab>(initialTab ?? "company");
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
              <div className="mt-10 pt-8" style={{ borderTop: "1px solid var(--app-border)" }}>
                <GmailPanel
                  summary={gmailSummary}
                  testRecipients={testRecipients}
                  status={gmailStatus}
                />
              </div>
            </Section>
          )}

          {tab === "assets" && (
            <AssetManagerSection initialAssets={initialAssets} />
          )}

          {tab === "data" && <DataSection />}

          {tab === "developer" && (
            <Section
              title="Developer"
              description="Administrative maintenance actions and environment info."
            >
              <MasterLibraryRepair />

              <div
                className="rounded-[12px] p-5 text-[13px] space-y-3"
                style={{
                  backgroundColor: "var(--app-surface)",
                  border: "1px solid var(--app-border)",
                  color: "var(--text-secondary)",
                }}
              >
                <div>
                  <strong className="text-text-primary">Storage:</strong> Supabase (RLS enforced
                  per workspace).
                </div>
                <div>
                  <strong className="text-text-primary">Email provider:</strong>{" "}
                  SimulationEmailProvider (no network calls).
                </div>
                <div>
                  <strong className="text-text-primary">Live sending:</strong> Not connected in
                  this phase.
                </div>
                <div
                  className="pt-3 text-text-muted"
                  style={{ borderTop: "1px solid var(--app-border)" }}
                >
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
      <div className="mb-5">
        <div className="text-[18px] font-semibold tracking-tight text-text-primary">{title}</div>
        <div className="mt-1 text-[12.5px] text-text-secondary leading-relaxed max-w-2xl">
          {description}
        </div>
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
      <div
        className="rounded-[10px] p-4 text-[12.5px] flex gap-2 leading-relaxed"
        style={{
          backgroundColor: "rgba(252,211,77,0.08)",
          border: "1px solid rgba(252,211,77,0.28)",
          color: "#FCD34D",
        }}
      >
        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
        <div>
          Local preview images look great in the app but cannot be delivered by email. Add a
          public HTTPS <strong>Production URL</strong> for each asset before live sending.
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {SLOTS.map(({ slot, label, hint }) => {
          const a = bySlot[slot];
          return (
            <div
              key={slot}
              className="rounded-[10px] p-4 flex items-start gap-4"
              style={{
                backgroundColor: "var(--app-surface)",
                border: "1px solid var(--app-border)",
              }}
            >
              <div
                className="w-16 h-16 rounded-md overflow-hidden shrink-0"
                style={{
                  backgroundColor: "var(--app-elevated)",
                  border: "1px solid var(--app-border)",
                }}
              >
                {a?.localDataUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={a.localDataUrl} alt={label} className="w-full h-full object-cover" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-text-primary">{label}</div>
                <div className="text-[11.5px] text-text-muted mb-2.5">{hint}</div>
                <div className="grid md:grid-cols-2 gap-2">
                  <label className="btn-secondary text-[11.5px] h-8 cursor-pointer">
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

function MasterLibraryRepair() {
  const router = useRouter();
  const [busy, setBusy] = useState<"verify" | "reset" | null>(null);

  async function verify() {
    setBusy("verify");
    try {
      const result = await verifyMasterLibraryAction();
      if (result.created === 0) {
        toast.success(`All ${result.total} master templates are present.`);
      } else {
        toast.success(
          `Repaired ${result.created} of ${result.total} MDF master templates.`,
        );
      }
      router.refresh();
    } catch {
      toast.error("Could not verify library");
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    const yes = confirm(
      "Restore every MDF master template to the current approved library design? This bumps their version and replaces the content. Campaigns are not affected — each campaign holds its own snapshot.",
    );
    if (!yes) return;
    setBusy("reset");
    try {
      const result = await resetMasterLibraryAction();
      toast.success(
        `Library restored to approved version — ${result.updated} updated${
          result.created ? `, ${result.created} created` : ""
        }.`,
      );
      router.refresh();
    } catch {
      toast.error("Could not restore library");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="rounded-[12px] divide-y"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
        borderColor: "var(--app-border)",
      }}
    >
      <div className="p-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[13.5px] font-medium text-text-primary">
            Verify master template library
          </div>
          <div className="text-[12.5px] text-text-secondary mt-1 leading-relaxed max-w-xl">
            Confirms the 8 approved MDF master templates are present in this workspace and
            restores any that are missing. Never overwrites existing templates.
          </div>
        </div>
        <button
          className="btn-secondary shrink-0"
          onClick={verify}
          disabled={busy !== null}
        >
          <Wrench size={13} /> {busy === "verify" ? "Verifying…" : "Verify library"}
        </button>
      </div>
      <div
        className="p-5 flex items-start justify-between gap-4 flex-wrap"
        style={{ borderTop: "1px solid var(--app-border)" }}
      >
        <div>
          <div className="text-[13.5px] font-medium text-text-primary">
            Restore approved version
          </div>
          <div className="text-[12.5px] text-text-secondary mt-1 leading-relaxed max-w-xl">
            Overwrites every master template with the current approved library content and bumps
            its version number. Existing campaigns keep their own snapshots and are unaffected.
            Use after a redesign of the master library.
          </div>
        </div>
        <button className="btn-ghost shrink-0" onClick={reset} disabled={busy !== null}>
          {busy === "reset" ? "Restoring…" : "Restore approved version"}
        </button>
      </div>
    </div>
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
      <div
        className="rounded-[12px] divide-y"
        style={{
          backgroundColor: "var(--app-surface)",
          border: "1px solid var(--app-border)",
          borderColor: "var(--app-border)",
        }}
      >
        <div className="p-5 flex items-start justify-between gap-4">
          <div>
            <div className="text-[13.5px] font-medium text-text-primary">
              Export workspace backup
            </div>
            <div className="text-[12.5px] text-text-secondary mt-1 leading-relaxed">
              A single JSON file with buyers, campaigns, templates, recipients, activity, and
              settings from your workspace.
            </div>
          </div>
          <button className="btn-primary shrink-0" onClick={exportBackup} disabled={busy}>
            <Download size={13} /> {busy ? "Exporting…" : "Export"}
          </button>
        </div>
        <div className="p-5" style={{ borderTop: "1px solid var(--app-border)" }}>
          <div className="text-[13.5px] font-medium text-text-primary">Import / restore</div>
          <div className="text-[12.5px] text-text-secondary mt-1 leading-relaxed">
            Backup restore is not exposed in the app. Contact your MDF administrator to restore
            from a backup file via the Supabase Dashboard.
          </div>
        </div>
      </div>
    </Section>
  );
}
