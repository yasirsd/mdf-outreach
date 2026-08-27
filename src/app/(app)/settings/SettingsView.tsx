"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Wrench } from "lucide-react";
import { AsyncButton } from "@/components/ui/AsyncButton";
import { resetMasterLibraryAction, verifyMasterLibraryAction } from "@/app/(app)/actions";
import { PageContainer, PageHeader } from "@/components/ui/Page";
import { useWorkspace } from "@/components/WorkspaceProvider";
import type { AssetRecord, WorkspaceSettings } from "@/lib/types";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { exportWorkspaceBackupAction, saveSettingsAction } from "./actions";
import { AssetManager } from "./AssetManager";
import { GmailPanel } from "./GmailPanel";
import { ProductionReadinessPanel } from "./ProductionReadinessPanel";
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

type Tab = "company" | "email" | "assets" | "data" | "developer";

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
              ["email", "Email"],
              ["assets", "Assets"],
              ["data", "Data"],
              ["developer", "Developer"],
            ] as Array<[Tab, string]>
          ).map(([k, label]) => (
            <button
              key={k}
              className={cn(
                "text-left px-3 py-2 rounded-[8px] text-[13px] font-medium transition-colors",
                tab === k
                  ? "text-text-primary"
                  : "text-text-secondary hover:text-text-primary",
              )}
              style={{
                backgroundColor: tab === k ? "var(--app-elevated)" : "transparent",
                border: `1px solid ${tab === k ? "var(--app-border-strong)" : "transparent"}`,
              }}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </aside>

        <div>
          {tab === "company" && (
            <Section
              title="Company"
              description="Identity used in the app shell and in outreach emails."
            >
              <SubHeader
                title="Applied to outreach email"
                hint="These values appear inside the delivered email."
              />
              <Field label="Company name" hint="Shown in the footer sign-off and email <title>.">
                <input className="input" value={draft.company.companyName} onChange={(e) => setCompany("companyName", e.target.value)} />
              </Field>
              <Field label="Tagline" hint="Optional italic line beneath the company name in the footer.">
                <input className="input" value={draft.company.tagline} onChange={(e) => setCompany("tagline", e.target.value)} />
              </Field>
              <Field label="Heritage line" hint='Fallback body copy for the "40+ years" heritage section.'>
                <input className="input" value={draft.company.heritage} onChange={(e) => setCompany("heritage", e.target.value)} />
              </Field>
              <TwoCol>
                <Field label="Website" hint="Rendered as a link in the email footer.">
                  <input className="input" value={draft.company.website} onChange={(e) => setCompany("website", e.target.value)} />
                </Field>
                <Field label="Contact email" hint="Rendered as a mailto link in the email footer.">
                  <input className="input" value={draft.company.email} onChange={(e) => setCompany("email", e.target.value)} />
                </Field>
              </TwoCol>

              <div className="mt-8">
                <SubHeader
                  title="Company profile"
                  hint="Recorded for internal reference. Not currently applied to outreach email."
                />
                <TwoCol>
                  <Field label="Short name">
                    <input className="input" value={draft.company.shortName} onChange={(e) => setCompany("shortName", e.target.value)} />
                  </Field>
                  <Field label="Location">
                    <input className="input" value={draft.company.location} onChange={(e) => setCompany("location", e.target.value)} />
                  </Field>
                </TwoCol>
              </div>

              <SaveBar onSave={save} saving={saving} />
            </Section>
          )}

          {tab === "email" && (
            <Section
              title="Email"
              description="Defaults for new campaigns, plus the company links that appear in every outreach email."
            >
              <SubHeader
                title="New campaign defaults"
                hint="Applied only when a new campaign is created. Existing campaigns are never overwritten — edit them on the campaign's Email tab."
              />
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
              <Field
                label="Default preheader"
                hint="Applied when a new campaign is created. Existing campaigns are not changed."
              >
                <input className="input" value={draft.email.defaultPreheader} onChange={(e) => setEmail("defaultPreheader", e.target.value)} />
              </Field>
              <Field
                label="Default CTA destination"
                hint='Seeded into a campaign snapshot when the master template ships no CTA URL. Never overwrites an existing per-section CTA.'
              >
                <input className="input" value={draft.email.defaultCtaUrl} onChange={(e) => setEmail("defaultCtaUrl", e.target.value)} />
              </Field>

              <div className="mt-8">
                <SubHeader
                  title="Company links"
                  hint="Rendered as social links in every outreach email footer."
                />
                <TwoCol>
                  <Field label="WhatsApp URL">
                    <input className="input" value={draft.email.whatsappUrl} onChange={(e) => setEmail("whatsappUrl", e.target.value)} />
                  </Field>
                  <Field label="LinkedIn URL">
                    <input className="input" value={draft.email.linkedinUrl} onChange={(e) => setEmail("linkedinUrl", e.target.value)} />
                  </Field>
                </TwoCol>
                <Field label="Instagram URL">
                  <input className="input" value={draft.email.instagramUrl} onChange={(e) => setEmail("instagramUrl", e.target.value)} />
                </Field>
              </div>

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
              <ProductionReadinessPanel />

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
                  <strong className="text-text-primary">Simulation:</strong> renders emails
                  locally without a network call. Used for Simulation mode on Campaign → Send.
                </div>
                <div>
                  <strong className="text-text-primary">Gmail integration:</strong> connected
                  server-side with the <code>gmail.send</code> scope only. Real Gmail Test is
                  live; production Buyer Send is gated on <code>BUYER_SEND_ENABLED</code>.
                </div>
                <div
                  className="pt-3 text-text-muted"
                  style={{ borderTop: "1px solid var(--app-border)" }}
                >
                  Manage the connected Gmail sender + approved test recipients on the Email tab.
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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <div className="mt-1 text-[11.5px] text-text-muted">{hint}</div>}
    </div>
  );
}

function SubHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium">
        {title}
      </div>
      {hint && (
        <div className="mt-1 text-[12px] text-text-secondary leading-relaxed max-w-2xl">
          {hint}
        </div>
      )}
    </div>
  );
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-4">{children}</div>;
}

function SaveBar({ onSave, saving }: { onSave: () => Promise<void> | void; saving: boolean }) {
  return (
    <div className="pt-4 flex justify-end">
      <AsyncButton
        onClick={onSave}
        pending={saving}
        pendingLabel="Saving…"
      >
        Save changes
      </AsyncButton>
    </div>
  );
}

// (Deleted: an earlier version of an inline AssetsSection lived here. The
// live Assets tab uses AssetManager via AssetManagerSection above — see
// line 21. Kept the removal comment as a maintenance marker.)

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
        <AsyncButton
          variant="secondary"
          className="shrink-0"
          onClick={verify}
          pending={busy === "verify"}
          disabled={busy !== null && busy !== "verify"}
          icon={<Wrench size={13} />}
          pendingLabel="Verifying…"
        >
          Verify library
        </AsyncButton>
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
        <AsyncButton
          variant="ghost"
          className="shrink-0"
          onClick={reset}
          pending={busy === "reset"}
          disabled={busy !== null && busy !== "reset"}
          pendingLabel="Restoring…"
        >
          Restore approved version
        </AsyncButton>
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
          <AsyncButton
            className="shrink-0"
            onClick={exportBackup}
            pending={busy}
            icon={<Download size={13} />}
            pendingLabel="Exporting…"
          >
            Export
          </AsyncButton>
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
