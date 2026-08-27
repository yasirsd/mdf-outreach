"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, RefreshCcw } from "lucide-react";
import {
  getEnvReadinessAction,
  type EnvReadinessReport,
} from "./envReadinessAction";

/**
 * F9 — Production readiness panel.
 *
 * Displays environment metadata via the auth-gated server action. Never
 * displays secret values. Never provides a control to flip
 * BUYER_SEND_ENABLED — that remains an operator env-var decision.
 */
export function ProductionReadinessPanel() {
  const [report, setReport] = useState<EnvReadinessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await getEnvReadinessAction();
      setReport(r);
    } catch {
      setError("Could not read environment status.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div
      className="rounded-[12px] p-5"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
    >
      <div className="flex items-baseline justify-between gap-4 mb-4">
        <div>
          <h3 className="text-[14px] font-semibold text-text-primary tracking-tight">
            Production readiness
          </h3>
          <p className="mt-0.5 text-[11.5px] text-text-muted leading-relaxed">
            Environment configuration status. Secret values are never displayed.
          </p>
        </div>
        <button
          className="btn-ghost h-8 px-2 text-[11.5px]"
          onClick={load}
          disabled={loading}
          aria-label="Refresh environment status"
        >
          <RefreshCcw size={12} /> Refresh
        </button>
      </div>

      {loading && (
        <div className="text-[12.5px] text-text-muted">Loading…</div>
      )}
      {error && !loading && (
        <div className="text-[12.5px]" style={{ color: "#F08B7E" }}>
          {error}
        </div>
      )}

      {!loading && !error && report && (
        <>
          <ul className="space-y-1.5">
            {report.entries.map((e) => (
              <li
                key={e.name}
                className="grid grid-cols-[minmax(0,1fr)_100px_minmax(0,1.4fr)] items-center gap-3 py-2"
                style={{ borderBottom: "1px solid var(--app-border)" }}
              >
                <div className="text-[12.5px] text-text-primary font-medium tabular-nums truncate">
                  {friendlyName(e.name)}
                </div>
                <div>
                  <StatusBadge status={e.status} required={e.required} />
                </div>
                <div className="text-[11.5px] text-text-muted truncate" title={e.detail}>
                  {e.detail}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 text-[11.5px] text-text-muted leading-relaxed">
            Buyer Send is controlled by the <code>BUYER_SEND_ENABLED</code>{" "}
            environment variable and cannot be enabled from this panel. Update
            the deploy target and redeploy to change it.
          </div>
        </>
      )}
    </div>
  );
}

function friendlyName(name: string): string {
  switch (name) {
    case "NEXT_PUBLIC_SUPABASE_URL":
      return "Supabase URL";
    case "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY":
      return "Supabase anon key";
    case "APP_SESSION_SECRET":
      return "Session secret";
    case "GOOGLE_CLIENT_ID":
      return "Google client id";
    case "GOOGLE_CLIENT_SECRET":
      return "Google client secret";
    case "GMAIL_TOKEN_ENCRYPTION_KEY":
      return "Gmail token encryption";
    case "APP_BASE_URL":
      return "App base URL";
    case "MDF_WORKSPACE_TIMEZONE":
      return "Workspace timezone";
    case "BUYER_SEND_ENABLED":
      return "Buyer Send";
    default:
      return name;
  }
}

function StatusBadge({
  status,
  required,
}: {
  status: "ok" | "missing" | "invalid";
  required: boolean;
}) {
  if (status === "ok") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-medium tabular-nums"
        style={{ color: "var(--brand-orange)" }}
      >
        <CheckCircle2 size={11} /> Ready
      </span>
    );
  }
  if (status === "missing") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-medium"
        style={{ color: required ? "#EF6C5C" : "var(--text-muted)" }}
      >
        <AlertTriangle size={11} /> {required ? "Missing" : "Optional"}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium"
      style={{ color: "#EF6C5C" }}
    >
      <XCircle size={11} /> Invalid
    </span>
  );
}
