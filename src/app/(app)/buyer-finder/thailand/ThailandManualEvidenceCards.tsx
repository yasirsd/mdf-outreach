"use client";

/**
 * TH06 — three operator-facing manual-evidence cards:
 *
 *   • DBD Company Registry
 *   • Thai Customs Operator Registry
 *   • Thai FDA Food Import Licence
 *
 * Each card is a thin client component that opens the OFFICIAL
 * source (allowed domains only) and lets the operator record
 * their observation via the TH04C server actions. There is NO
 * "run check" button — the system NEVER automates these sources.
 *
 * The card:
 *   - shows the current active state (if any),
 *   - the capture timestamp + capturing user id,
 *   - the official-source URL,
 *   - a "History / superseded" indicator when non-trivial.
 *
 * Form submission goes through the TH04C server actions, which
 * validate workspace membership + source-URL allowlist + lookup
 * basis, and derive `captured_by_user_id` from the session.
 */

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import {
  recordThailandManualEvidenceAction,
  supersedeThailandManualEvidenceAction,
  withdrawThailandManualEvidenceAction,
  type RecordThailandManualEvidenceInput,
  type ThailandManualEvidenceHistoryRow,
} from "../thailandManualEvidenceActions";
import type { ThailandManualEvidenceActiveRow } from "@/lib/tradeResearch/thailand/manualEvidenceResolver";

type ProviderId = RecordThailandManualEvidenceInput["providerId"];

interface CardCommonProps {
  readonly candidateId: string;
  readonly active?: ThailandManualEvidenceActiveRow;
  readonly history?: readonly ThailandManualEvidenceHistoryRow[];
}

const OFFICIAL_URL: Record<ProviderId, string> = {
  "thai-dbd": "https://datawarehouse.dbd.go.th/",
  "thai-customs-operator": "https://www.customs.go.th/",
  "thai-fda-importer": "https://www.fda.moph.go.th/",
};

const PROVIDER_LABEL: Record<ProviderId, string> = {
  "thai-dbd": "DBD Company Registry",
  "thai-customs-operator": "Thai Customs Operator Registry",
  "thai-fda-importer": "Thai FDA Food Import Licence",
};

const PROVIDER_CAVEAT: Record<ProviderId, string> = {
  "thai-dbd": "Confirms company identity only. Does NOT prove importer status, product scope, India origin, shipments, or buying intent.",
  "thai-customs-operator": "Registration confirms operator status only. It does not prove this company imports the selected product or imports from India.",
  "thai-fda-importer": "A food-import licence confirms regulatory status only. It does not prove Guntur chilli imports, India origin, shipments, or current buying.",
};

function StateBadge({ status }: { status?: "verified" | "not_found" | "inconclusive" }) {
  if (!status) return <Badge tone="neutral" aria-label="Manual check pending">Manual check pending</Badge>;
  if (status === "verified") return <Badge tone="success">Manually verified</Badge>;
  if (status === "not_found") return <Badge tone="danger">Not found</Badge>;
  return <Badge tone="warning">Inconclusive</Badge>;
}

function HistoryStatusBadge({ status }: { status: ThailandManualEvidenceHistoryRow["historyStatus"] }) {
  if (status === "current") return <Badge tone="success">Current</Badge>;
  if (status === "superseded") return <Badge tone="neutral">Superseded</Badge>;
  return <Badge tone="danger">Withdrawn</Badge>;
}

function HistoryList({ history }: { history: readonly ThailandManualEvidenceHistoryRow[] }) {
  if (!history.length) {
    return (
      <p className="text-[11px] text-[color:var(--text-secondary)] px-1 py-2">
        No history entries.
      </p>
    );
  }
  return (
    <ol className="space-y-2" aria-label="Manual evidence history">
      {history.map((row) => (
        <li
          key={row.id}
          data-history-id={row.id}
          data-history-status={row.historyStatus}
          className="rounded-md border border-[color:var(--app-border)]/60 bg-black/10 px-3 py-2 text-[11px] text-[color:var(--text-secondary)] space-y-1"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[color:var(--text-primary)]">{row.evidence_status}</span>
            <HistoryStatusBadge status={row.historyStatus} />
          </div>
          <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-0.5">
            <dt>Captured</dt><dd className="text-[color:var(--text-primary)]">{row.captured_at}</dd>
            <dt>By</dt><dd className="text-[color:var(--text-primary)] font-mono">{row.captured_by_user_id.slice(0, 8)}…</dd>
            <dt>Source</dt>
            <dd>
              <a href={row.source_url} target="_blank" rel="nofollow noopener noreferrer" className="underline text-[color:var(--brand-orange)]">
                {row.source_label}
              </a>
            </dd>
            {row.lookup_basis ? (<><dt>Lookup</dt><dd className="text-[color:var(--text-primary)]">{row.lookup_basis}{row.lookup_basis_detail ? ` — ${row.lookup_basis_detail}` : ""}</dd></>) : null}
            {row.supersedes_id ? (<><dt>Supersedes</dt><dd className="font-mono text-[color:var(--text-primary)]">{row.supersedes_id.slice(0, 8)}…</dd></>) : null}
            {row.superseded_by_id ? (<><dt>Superseded by</dt><dd className="font-mono text-[color:var(--text-primary)]">{row.superseded_by_id.slice(0, 8)}…</dd></>) : null}
          </dl>
        </li>
      ))}
    </ol>
  );
}

function BaseCard({ providerId, candidateId, active, history }: CardCommonProps & { providerId: ProviderId }) {
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [evidenceStatusLocal, setEvidenceStatusLocal] = useState<"verified" | "not_found" | "inconclusive">("verified");
  const [error, setError] = useState<string | null>(null);
  const label = PROVIDER_LABEL[providerId];
  const sourceUrl = active?.source_url ?? OFFICIAL_URL[providerId];
  const providerHistory = history ?? [];
  const historyCount = providerHistory.length;

  function handleSubmit(formData: FormData) {
    setError(null);
    const sourceUrlInput = String(formData.get("sourceUrl") ?? "").trim();
    const sourceLabel = String(formData.get("sourceLabel") ?? "").trim();
    const evidenceStatus = String(formData.get("evidenceStatus") ?? "").trim() as "verified" | "not_found" | "inconclusive";
    const lookupBasis = String(formData.get("lookupBasis") ?? "").trim() || null;
    const payload: Record<string, unknown> = { kind: providerId };
    for (const [key, val] of formData.entries()) {
      if (["sourceUrl", "sourceLabel", "evidenceStatus", "lookupBasis"].includes(key)) continue;
      if (typeof val === "string" && val.trim()) payload[key] = val.trim();
    }
    if (lookupBasis) (payload as { lookupBasis?: string }).lookupBasis = lookupBasis;
    startTransition(async () => {
      const result = active
        ? await supersedeThailandManualEvidenceAction(active.id, {
            candidateId, providerId, sourceUrl: sourceUrlInput, sourceLabel,
            evidencePayload: payload, evidenceStatus,
          })
        : await recordThailandManualEvidenceAction({
            candidateId, providerId, sourceUrl: sourceUrlInput, sourceLabel,
            evidencePayload: payload, evidenceStatus,
          });
      if (result.outcome !== "recorded") setError(result.message ?? result.outcome);
      else setShowForm(false);
    });
  }

  function handleWithdraw() {
    if (!active) return;
    startTransition(async () => {
      await withdrawThailandManualEvidenceAction(active.id);
    });
  }

  return (
    <section
      aria-label={label}
      className="rounded-xl p-4 bg-[color:var(--app-surface)] border border-[color:var(--app-border)] space-y-3"
    >
      <header className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-medium text-[color:var(--text-primary)]">{label}</h3>
          <p className="text-[11px] text-[color:var(--text-secondary)]">{PROVIDER_CAVEAT[providerId]}</p>
        </div>
        <StateBadge status={active?.evidence_status} />
      </header>

      {active ? (
        <dl className="text-[12px] text-[color:var(--text-secondary)] grid grid-cols-2 gap-x-4 gap-y-1">
          <dt>Captured</dt><dd className="text-[color:var(--text-primary)]">{active.captured_at}</dd>
          <dt>By</dt><dd className="text-[color:var(--text-primary)] font-mono text-[11px]">{active.captured_by_user_id.slice(0, 8)}…</dd>
          <dt>Source</dt>
          <dd><a href={active.source_url} target="_blank" rel="nofollow noopener noreferrer" className="underline text-[color:var(--brand-orange)]">{active.source_label}</a></dd>
          {historyCount > 0 ? (
            <>
              <dt>History</dt>
              <dd className="text-[color:var(--text-primary)]">{historyCount} entr{historyCount === 1 ? "y" : "ies"} (append-only)</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className="text-[12px] text-[color:var(--text-secondary)]">
          No manual check captured yet.
          {" "}
          <a href={OFFICIAL_URL[providerId]} target="_blank" rel="nofollow noopener noreferrer" className="underline text-[color:var(--brand-orange)]">Open official source</a>
          .
        </p>
      )}

      <div className="flex items-center gap-2">
        <button type="button"
          onClick={() => setShowForm((v) => !v)}
          disabled={isPending}
          className="h-8 px-3 text-[12px] rounded-md border border-[color:var(--app-border)] text-[color:var(--text-primary)] hover:bg-white/5">
          {active ? "Correct (supersede)" : "Record result"}
        </button>
        {active ? (
          <button type="button" onClick={handleWithdraw} disabled={isPending}
            className="h-8 px-3 text-[12px] rounded-md border border-[color:var(--app-border)] text-[color:var(--text-secondary)] hover:bg-white/5">
            Withdraw
          </button>
        ) : null}
        <a href={sourceUrl} target="_blank" rel="nofollow noopener noreferrer"
          className="h-8 px-3 text-[12px] rounded-md border border-[color:var(--app-border)] text-[color:var(--text-primary)] hover:bg-white/5 inline-flex items-center">
          Open official source ↗
        </a>
        {historyCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
            aria-controls={`history-${providerId}`}
            className="h-8 px-3 text-[12px] rounded-md border border-[color:var(--app-border)] text-[color:var(--text-primary)] hover:bg-white/5"
          >
            {showHistory ? "Hide history" : `History (${historyCount})`}
          </button>
        ) : null}
      </div>

      {showHistory && historyCount > 0 ? (
        <div
          id={`history-${providerId}`}
          data-history-provider={providerId}
          className="pt-2 border-t border-[color:var(--app-border)]/60 space-y-2"
        >
          <p className="text-[11px] text-[color:var(--text-secondary)]">
            Newest first. Append-only — corrections appear as new rows that supersede the previous one.
          </p>
          <HistoryList history={providerHistory} />
        </div>
      ) : null}

      {showForm ? (
        <form action={handleSubmit} className="space-y-2 pt-2 border-t border-[color:var(--app-border)]/60">
          <fieldset className="grid grid-cols-2 gap-2 text-[12px]">
            <label className="flex flex-col gap-1">
              <span className="text-[color:var(--text-secondary)]">Official source URL</span>
              <input name="sourceUrl" type="url" required defaultValue={OFFICIAL_URL[providerId]}
                className="h-8 rounded-md bg-black/20 border border-[color:var(--app-border)] px-2 text-[color:var(--text-primary)]" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[color:var(--text-secondary)]">Source label</span>
              <input name="sourceLabel" type="text" required defaultValue={`${label} lookup`}
                className="h-8 rounded-md bg-black/20 border border-[color:var(--app-border)] px-2 text-[color:var(--text-primary)]" />
            </label>
            {providerId === "thai-dbd" ? (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-[color:var(--text-secondary)]">Juristic registration number</span>
                  <input name="juristicRegistrationNumber" pattern="[0-9]{13}" title="Thai juristic number is 13 digits"
                    className="h-8 rounded-md bg-black/20 border border-[color:var(--app-border)] px-2 text-[color:var(--text-primary)]" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[color:var(--text-secondary)]">Legal name snapshot</span>
                  <input name="legalNameSnapshot"
                    className="h-8 rounded-md bg-black/20 border border-[color:var(--app-border)] px-2 text-[color:var(--text-primary)]" />
                </label>
                <label className="col-span-2 flex flex-col gap-1">
                  <span className="text-[color:var(--text-secondary)]">Registered address snapshot</span>
                  <input name="registeredAddressSnapshot"
                    className="h-8 rounded-md bg-black/20 border border-[color:var(--app-border)] px-2 text-[color:var(--text-primary)]" />
                </label>
              </>
            ) : null}
            {providerId === "thai-customs-operator" ? (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-[color:var(--text-secondary)]">Juristic / tax id</span>
                  <input name="juristicRegistrationNumber" pattern="[0-9]{13}" title="13 digits"
                    className="h-8 rounded-md bg-black/20 border border-[color:var(--app-border)] px-2 text-[color:var(--text-primary)]" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[color:var(--text-secondary)]">Registration status</span>
                  <select name="registrationStatusSnapshot" className="h-8 rounded-md bg-black/20 border border-[color:var(--app-border)] px-2 text-[color:var(--text-primary)]">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </label>
                <label className="col-span-2 flex flex-col gap-1">
                  <span className="text-[color:var(--text-secondary)]">
                    Operator type (importer/exporter/broker/aeo/other)
                    {evidenceStatusLocal === "verified" ? <span className="text-[color:#F08B7E]"> *required when verified</span> : <span className="text-[color:var(--text-secondary)]"> (optional unless observed)</span>}
                  </span>
                  <select
                    name="operatorTypeSnapshot"
                    required={evidenceStatusLocal === "verified"}
                    defaultValue=""
                    className="h-8 rounded-md bg-black/20 border border-[color:var(--app-border)] px-2 text-[color:var(--text-primary)]"
                  >
                    <option value="">— pick what the registry displayed —</option>
                    <option value="importer">Importer</option>
                    <option value="exporter">Exporter</option>
                    <option value="broker">Broker</option>
                    <option value="aeo">AEO</option>
                    <option value="other">Other</option>
                  </select>
                </label>
              </>
            ) : null}
            {providerId === "thai-fda-importer" ? (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-[color:var(--text-secondary)]">Licence number</span>
                  <input name="licenseNumberSnapshot" required
                    className="h-8 rounded-md bg-black/20 border border-[color:var(--app-border)] px-2 text-[color:var(--text-primary)]" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[color:var(--text-secondary)]">Licence type</span>
                  <input name="licenseTypeSnapshot"
                    className="h-8 rounded-md bg-black/20 border border-[color:var(--app-border)] px-2 text-[color:var(--text-primary)]" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[color:var(--text-secondary)]">Valid from (ISO)</span>
                  <input name="validFromSnapshot" type="date"
                    className="h-8 rounded-md bg-black/20 border border-[color:var(--app-border)] px-2 text-[color:var(--text-primary)]" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[color:var(--text-secondary)]">Valid until (ISO)</span>
                  <input name="validUntilSnapshot" type="date"
                    className="h-8 rounded-md bg-black/20 border border-[color:var(--app-border)] px-2 text-[color:var(--text-primary)]" />
                </label>
              </>
            ) : null}
            <label className="flex flex-col gap-1">
              <span className="text-[color:var(--text-secondary)]">Lookup basis</span>
              <select name="lookupBasis" className="h-8 rounded-md bg-black/20 border border-[color:var(--app-border)] px-2 text-[color:var(--text-primary)]">
                <option value="">unspecified</option>
                <option value="juristic_number">Juristic number</option>
                <option value="license_number">Licence number</option>
                <option value="exact_legal_name">Exact legal name</option>
                <option value="name_search">Name search</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[color:var(--text-secondary)]">Result</span>
              <select
                name="evidenceStatus"
                required
                value={evidenceStatusLocal}
                onChange={(e) => setEvidenceStatusLocal(e.target.value as "verified" | "not_found" | "inconclusive")}
                className="h-8 rounded-md bg-black/20 border border-[color:var(--app-border)] px-2 text-[color:var(--text-primary)]"
              >
                <option value="verified">Manually verified</option>
                <option value="not_found">Not found</option>
                <option value="inconclusive">Inconclusive</option>
              </select>
            </label>
          </fieldset>
          <div className="flex items-center gap-2 pt-1">
            <button type="submit" disabled={isPending}
              className="h-8 px-3 text-[12px] rounded-md bg-[color:var(--brand-orange)] text-black font-medium hover:brightness-110">
              {isPending ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="h-8 px-3 text-[12px] rounded-md border border-[color:var(--app-border)] text-[color:var(--text-secondary)]">
              Cancel
            </button>
            {error ? <span role="alert" className="text-[11px] text-[color:#F08B7E]">{error}</span> : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}

export function ThailandDbdCard(props: CardCommonProps) {
  return <BaseCard {...props} providerId="thai-dbd" />;
}
export function ThailandCustomsOperatorCard(props: CardCommonProps) {
  return <BaseCard {...props} providerId="thai-customs-operator" />;
}
export function ThailandFdaCard(props: CardCommonProps) {
  return <BaseCard {...props} providerId="thai-fda-importer" />;
}

export function ThailandManualEvidenceCards({
  candidateId,
  active,
  history,
}: {
  candidateId: string;
  active: { dbd?: ThailandManualEvidenceActiveRow; customsOperator?: ThailandManualEvidenceActiveRow; fdaImporter?: ThailandManualEvidenceActiveRow };
  history?: {
    dbd?: readonly ThailandManualEvidenceHistoryRow[];
    customsOperator?: readonly ThailandManualEvidenceHistoryRow[];
    fdaImporter?: readonly ThailandManualEvidenceHistoryRow[];
  };
}) {
  return (
    <section aria-label="Thailand manual official checks" className="space-y-3">
      <h2 className="text-[14px] font-medium text-[color:var(--text-primary)]">Manual official checks</h2>
      <ThailandDbdCard candidateId={candidateId} active={active.dbd} history={history?.dbd} />
      <ThailandCustomsOperatorCard candidateId={candidateId} active={active.customsOperator} history={history?.customsOperator} />
      <ThailandFdaCard candidateId={candidateId} active={active.fdaImporter} history={history?.fdaImporter} />
    </section>
  );
}
