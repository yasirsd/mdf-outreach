/**
 * TH06 — Thailand candidate evidence panel.
 *
 * Server-safe presentation of a `ThailandAggregateResult`. Lays
 * out the four groups the brief specifies:
 *   A. COMPANY
 *   B. PRODUCT / MARKET
 *   C. CONTACT
 *   D. COVERAGE
 *
 * Reuses the existing MDF `Badge` with explicit text labels — the
 * state is never communicated by colour alone (icons + text).
 * Keeps the layout flat; does not redesign Buyer Finder.
 */

import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type {
  ThailandAggregateResult,
} from "@/lib/tradeResearch/thailand/aggregate";

const STATE_LABELS: Record<string, { label: string; tone: BadgeTone; help?: string }> = {
  verified:            { label: "Verified",             tone: "success" },
  needs_review:        { label: "Needs review",         tone: "warning" },
  unavailable:         { label: "Unavailable",          tone: "neutral" },
  registered:          { label: "Registered",           tone: "success" },
  licensed:            { label: "Licensed",             tone: "success" },
  not_found:           { label: "Not found",            tone: "danger" },
  observed:            { label: "Observed",             tone: "accent" },
  not_observed:        { label: "Not observed",         tone: "neutral" },
  unknown:             { label: "Unknown",              tone: "neutral" },
  UNKNOWN:             { label: "Unknown",              tone: "neutral", help: "No certified free Thailand source in V1 provides company-level shipment records." },
  public_company_email:{ label: "Public company email", tone: "info" },
  named_public_contact:{ label: "Named public contact", tone: "info" },
  no_evidence:         { label: "No evidence evaluated",tone: "neutral" },
  evidence_partial:    { label: "Research partially complete", tone: "info" },
  evidence_complete:   { label: "Evidence checks complete",     tone: "success" },
};

function Row({ label, state, help }: { label: string; state: string; help?: string }) {
  const meta = STATE_LABELS[state] ?? { label: state, tone: "neutral" as BadgeTone };
  return (
    <div className="flex items-center justify-between py-2 border-b border-[color:var(--app-border)]/60 last:border-0">
      <div className="flex flex-col">
        <span className="text-[13px] text-[color:var(--text-primary)]">{label}</span>
        {help ?? meta.help ? <span className="text-[11px] text-[color:var(--text-secondary)]">{help ?? meta.help}</span> : null}
      </div>
      <Badge tone={meta.tone} aria-label={`${label}: ${meta.label}`}>{meta.label}</Badge>
    </div>
  );
}

function GroupHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-[12px] uppercase tracking-wide text-[color:var(--text-secondary)]">{title}</h3>
      {subtitle ? <p className="text-[11px] text-[color:var(--text-secondary)]/80">{subtitle}</p> : null}
    </div>
  );
}

export function ThailandEvidencePanel({ aggregate }: { aggregate: ThailandAggregateResult }) {
  return (
    <section
      aria-label="Thailand research evidence"
      className="rounded-xl p-4 bg-[color:var(--app-surface)] border border-[color:var(--app-border)] space-y-5"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-[14px] font-medium text-[color:var(--text-primary)]">Thailand research</h2>
        <Badge tone={STATE_LABELS[aggregate.overallState]?.tone ?? "neutral"}>
          {STATE_LABELS[aggregate.overallState]?.label ?? aggregate.overallState}
        </Badge>
      </header>

      <div>
        <GroupHeader title="Company" />
        <Row label="Company identity" state={aggregate.companyIdentity.value} />
        <Row label="Import/export registration" state={aggregate.importExportRegistration.value} />
        <Row label="Food import licence" state={aggregate.foodImportLicense.value} />
      </div>

      <div>
        <GroupHeader title="Product / Market" subtitle="Grain is preserved — company-level and market-level evidence are reported separately." />
        <Row label="Website product relevance (company site)" state={aggregate.productRelevance.companyLevel.value} />
        <Row label="Thailand market import activity (HS 09042110)" state={aggregate.marketImportActivity.value} />
        <Row label="India-origin market activity" state={aggregate.indiaOriginMarketActivity.value}
             help="Market-level flow. Never a candidate-level India-origin claim." />
        <Row label="Company shipment activity" state={aggregate.companyShipmentActivity.value} />
      </div>

      <div>
        <GroupHeader title="Contact" />
        <Row label="Public company contact" state={aggregate.contactAvailability.value}
             help="Phone alone does NOT satisfy Buyer-conversion email requirement." />
      </div>

      <div>
        <GroupHeader title="Coverage" />
        <ul className="text-[12px] text-[color:var(--text-secondary)] grid grid-cols-2 gap-x-6 gap-y-1">
          <li>Automated evaluated: <span className="text-[color:var(--text-primary)]">{aggregate.coverage.evaluated.filter((p) => p === "thai-customs-stats" || p === "public-website").length} / 2</span></li>
          <li>Manual completed: <span className="text-[color:var(--text-primary)]">{aggregate.coverage.evaluated.filter((p) => p.startsWith("thai-dbd") || p === "thai-customs-operator" || p === "thai-fda-importer").length} / 3</span></li>
          <li>Failed: <span className="text-[color:var(--text-primary)]">{aggregate.coverage.failed.length}</span></li>
          <li>Manual pending: <span className="text-[color:var(--text-primary)]">{aggregate.coverage.manualPending.length}</span></li>
        </ul>
        {aggregate.coverage.manualPending.length > 0 ? (
          <p className="mt-1 text-[11px] text-[color:var(--text-secondary)]">
            Pending manual checks: {aggregate.coverage.manualPending.join(", ")}.
          </p>
        ) : null}
      </div>

      {aggregate.conflicts.length > 0 ? (
        <div>
          <GroupHeader title="Conflicts" />
          <ul className="space-y-1 text-[12px] text-[color:var(--text-primary)]">
            {aggregate.conflicts.map((c, i) => (
              <li key={i}>
                <Badge tone="warning">Conflict</Badge>{" "}
                {c.kind === "duplicate_active_manual" ? `Duplicate active rows for ${c.providerId}: ${c.rowIds.join(", ")}` : null}
                {c.kind === "website_contradicts_manual" ? c.description : null}
                {c.kind === "identity_mismatch" ? c.description : null}
                {c.kind === "fda_other_juristic" ? c.description : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {aggregate.limitations.length > 0 ? (
        <div>
          <GroupHeader title="Limitations" />
          <ul className="space-y-1 text-[11px] text-[color:var(--text-secondary)]">
            {aggregate.limitations.map((l, i) => <li key={i}>• {l}</li>)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
