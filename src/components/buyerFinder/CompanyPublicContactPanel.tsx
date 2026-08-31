"use client";

import { useState } from "react";
import { Globe, Mail, Search } from "lucide-react";
import { AsyncButton } from "@/components/ui/AsyncButton";
import type { BuyerCandidatePublicEmail } from "@/lib/buyerFinder/types";
import type { PublicWebsiteAvailability } from "@/lib/buyerFinder/publicWebsiteAvailability";
import type { FreeEnrichmentJobStatus } from "@/lib/buyerFinder/freeEnrichmentJob";
import { findCandidatePublicCompanyContactsAction } from "@/app/(app)/buyer-finder/publicContactActions";

export const PUBLIC_EMAIL_DISPLAY_ALTERNATES = 4;
export const PUBLIC_LOOKUP_INCOMPLETE_TITLE = "Lookup incomplete";
export const PUBLIC_LOOKUP_INCOMPLETE_DETAIL =
  "Some public website pages could not be checked.";

function isSafeHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.username || url.password) return false;
    const port = url.port;
    if (port && port !== (url.protocol === "https:" ? "443" : "80")) return false;
    return true;
  } catch {
    return false;
  }
}

function lastCheckedLabel(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleString();
}

export function CompanyPublicContactPanel({
  candidateId,
  emails,
  searchedAt,
  publicWebsite: _publicWebsite,
  canSearch,
  onComplete,
  onError,
  jobStatus,
  standalone = false,
}: {
  candidateId: string;
  emails: BuyerCandidatePublicEmail[];
  searchedAt?: string;
  publicWebsite: PublicWebsiteAvailability;
  canSearch: boolean;
  onComplete: (message: string) => void;
  onError: (message: string) => void;
  jobStatus?: FreeEnrichmentJobStatus;
  standalone?: boolean;
}) {
  const primary = emails.find((e) => e.isPrimary) ?? emails[0];
  const others = emails.filter((e) => e.id !== primary?.id).slice(0, PUBLIC_EMAIL_DISPLAY_ALTERNATES);
  const searched = Boolean(searchedAt);
  const checked = lastCheckedLabel(searchedAt);
  const [incomplete, setIncomplete] = useState(false);

  async function runSearch() {
    const result = await findCandidatePublicCompanyContactsAction(candidateId);
    if (result.outcome === "success") {
      setIncomplete(false);
      onComplete("Public company contacts saved.");
      return;
    }
    if (result.outcome === "no_result") {
      setIncomplete(false);
      onComplete(result.message ?? "No public company email found.");
      return;
    }
    if (result.outcome === "incomplete") {
      setIncomplete(true);
      return;
    }
    if (result.outcome === "already_running") {
      setIncomplete(false);
      onComplete(result.message ?? "Lookup in progress.");
      return;
    }
    setIncomplete(false);
    onError(result.message ?? "Could not look up public company contacts.");
  }

  const showNotSearched = !searched && emails.length === 0 && !incomplete;
  const showNoResult = searched && emails.length === 0 && !incomplete;

  return (
    <div
      className={standalone ? "rounded-[12px] p-4" : "px-4 py-3"}
      style={standalone ? { backgroundColor: "var(--app-surface)" } : undefined}
    >
      <div className="text-[11px] font-medium text-text-muted mb-2">
        Free company contact
      </div>

      {showNotSearched && (
        <p className="text-[13px] text-text-primary mb-1">Not searched yet</p>
      )}

      {incomplete && emails.length === 0 && (
        <div className="mb-3">
          <p className="text-[13px] text-text-primary">{PUBLIC_LOOKUP_INCOMPLETE_TITLE}</p>
          <p className="mt-1 text-[12px] text-text-muted">{PUBLIC_LOOKUP_INCOMPLETE_DETAIL}</p>
        </div>
      )}

      {showNoResult && (
        <div className="mb-3">
          <p className="text-[13px] text-text-primary">No public company email found</p>
          <p className="mt-1 text-[12px] text-text-muted">Checked company website · No credits used</p>
        </div>
      )}

      {primary && (
        <div className="mb-3">
          <div className="flex items-start gap-2 text-[13px]">
            <Mail size={13} className="mt-0.5 text-text-muted shrink-0" />
            <div className="min-w-0">
              <div className="text-text-primary truncate">{primary.email}</div>
              <div className="mt-0.5 text-[11.5px] text-text-muted">
                Published on company website · Free
              </div>
              {isSafeHttpUrl(primary.sourceUrl) && (
                <a
                  href={primary.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-[12px] text-text-secondary hover:text-brand-orange transition-colors"
                >
                  <Globe size={11} />
                  View source
                </a>
              )}
            </div>
          </div>
          {others.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] uppercase tracking-[0.12em] text-text-muted mb-1.5">
                Other public emails
              </div>
              <ul className="space-y-1">
                {others.map((e) => (
                  <li key={e.id} className="text-[13px] text-text-secondary truncate">
                    {e.email}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <p className="text-[12px] text-text-muted mb-2">
        Checks the company website. No credits used.
      </p>
      {checked && (
        <p className="text-[11.5px] text-text-muted mb-2">Last checked {checked}</p>
      )}
      <AsyncButton
        variant="secondary"
        icon={<Search size={13} />}
        pendingLabel="Checking…"
        disabled={!canSearch}
        onClick={runSearch}
        onError={() => onError("Could not look up public company contacts.")}
      >
        {jobStatus === "failed" ? "Retry now" : searched || incomplete ? "Check again" : "Find public company contacts · Free"}
      </AsyncButton>
    </div>
  );
}
