"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Plug, Trash2, Plus, Check, AlertTriangle } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import {
  addTestRecipientAction,
  disconnectGmailAction,
  removeTestRecipientAction,
  type GmailConnectionSummary,
  type TestRecipient,
} from "./gmailActions";

interface Props {
  summary: GmailConnectionSummary;
  testRecipients: TestRecipient[];
  status?: string | null;
}

const STATUS_MESSAGES: Record<string, { kind: "success" | "error"; text: string }> = {
  connected: { kind: "success", text: "Gmail sender connected." },
  denied: { kind: "error", text: "You declined the Google permission. Nothing was connected." },
  "state-mismatch": {
    kind: "error",
    text: "Google callback did not match this session. Please try again.",
  },
  "token-exchange-failed": {
    kind: "error",
    text: "Google rejected the authorization code. Please try connecting again.",
  },
  "userinfo-failed": {
    kind: "error",
    text: "Could not read the Google account email. Please try again.",
  },
  "userinfo-empty": {
    kind: "error",
    text: "Google did not return an email address. Please try again.",
  },
};

export function GmailPanel({ summary, testRecipients, status }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [recipients, setRecipients] = useState(testRecipients);
  const banner = status ? STATUS_MESSAGES[status] : undefined;

  function connect() {
    window.location.assign("/api/gmail/oauth/start");
  }

  function disconnect() {
    if (!confirm("Disconnect the Gmail sender for this workspace?")) return;
    startTransition(async () => {
      try {
        await disconnectGmailAction();
        toast.success("Disconnected");
        router.refresh();
      } catch {
        toast.error("Could not disconnect");
      }
    });
  }

  return (
    <div className="space-y-8">
      {banner && (
        <div
          className="rounded-[10px] px-3.5 py-2.5 text-[12.5px]"
          style={
            banner.kind === "success"
              ? {
                  backgroundColor: "rgba(74,222,128,0.10)",
                  border: "1px solid rgba(74,222,128,0.28)",
                  color: "#86EFAC",
                }
              : {
                  backgroundColor: "rgba(239,108,92,0.10)",
                  border: "1px solid rgba(239,108,92,0.28)",
                  color: "#F08B7E",
                }
          }
        >
          {banner.text}
        </div>
      )}

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange font-medium">
              Google Workspace / Gmail
            </div>
            <h3 className="mt-1 text-[16px] font-semibold tracking-tight text-text-primary">
              Sender connection
            </h3>
          </div>
        </div>

        <div
          className="rounded-[12px] p-5"
          style={{
            backgroundColor: "var(--app-surface)",
            border: "1px solid var(--app-border)",
          }}
        >
          {summary.connected ? (
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Check size={14} className="text-emerald-400" />
                  <div className="text-[13px] font-medium text-text-primary">Connected as</div>
                </div>
                <div className="mt-1 text-[15px] font-medium text-text-primary truncate">
                  {summary.email}
                </div>
                <div className="mt-2 text-[11.5px] text-text-muted">
                  Scope: <span className="font-mono">{summary.scope || "gmail.send"}</span>
                </div>
                {summary.expiryAt && (
                  <div className="mt-1 text-[11.5px] text-text-muted">
                    Access token expiry: {new Date(summary.expiryAt).toLocaleString()}
                  </div>
                )}
              </div>
              <button className="btn-ghost shrink-0" onClick={disconnect} disabled={isPending}>
                {isPending ? "Working…" : "Disconnect"}
              </button>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Mail size={14} className="text-text-muted" />
                  <div className="text-[13px] font-medium text-text-primary">Not connected</div>
                </div>
                <p className="mt-2 text-[12.5px] text-text-secondary max-w-md leading-relaxed">
                  Connect the official MDF Google Workspace / Gmail account so the app can send
                  test emails. MDF Outreach uses the minimum <strong>gmail.send</strong> scope —
                  it cannot read your inbox.
                </p>
              </div>
              <button className="btn-primary shrink-0" onClick={connect} disabled={isPending}>
                <Plug size={13} /> Connect Gmail
              </button>
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange font-medium">
              Internal test recipients
            </div>
            <h3 className="mt-1 text-[16px] font-semibold tracking-tight text-text-primary">
              Approved delivery addresses
            </h3>
            <p className="mt-1 text-[12.5px] text-text-secondary max-w-2xl leading-relaxed">
              Gmail test sends can only deliver to addresses on this list. Buyer email addresses
              from campaigns can never be a target during test mode — the allowlist is enforced
              server-side.
            </p>
          </div>
        </div>

        <TestRecipientList
          recipients={recipients}
          onAdd={(r) => setRecipients((prev) => [...prev, r])}
          onRemove={(id) => setRecipients((prev) => prev.filter((r) => r.id !== id))}
        />
      </section>

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
          Test mode is active. Real buyer sending is disabled everywhere in the app until visual
          QA of delivered Gmail is signed off.
        </div>
      </div>
    </div>
  );
}

function TestRecipientList({
  recipients,
  onAdd,
  onRemove,
}: {
  recipients: TestRecipient[];
  onAdd: (r: TestRecipient) => void;
  onRemove: (id: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!email.trim()) return;
    setBusy(true);
    try {
      const r = await addTestRecipientAction(email, label);
      onAdd(r);
      setEmail("");
      setLabel("");
      toast.success("Added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add recipient");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this test recipient?")) return;
    try {
      await removeTestRecipientAction(id);
      onRemove(id);
    } catch {
      toast.error("Could not remove");
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
      <div className="p-4 grid md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] gap-2 items-end">
        <label className="block">
          <span className="label">Email</span>
          <input
            className="input h-9 text-[13px]"
            type="email"
            placeholder="you@mdfexport.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
          />
        </label>
        <label className="block">
          <span className="label">Label (optional)</span>
          <input
            className="input h-9 text-[13px]"
            placeholder="Owner inbox"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <button className="btn-primary" onClick={add} disabled={busy}>
          <Plus size={13} /> Add
        </button>
      </div>
      {recipients.length === 0 ? (
        <div className="p-5 text-[12.5px] text-text-muted text-center">
          No approved test recipients yet. Add at least one before running a Gmail test.
        </div>
      ) : (
        <ul>
          {recipients.map((r) => (
            <li
              key={r.id}
              className="px-4 py-3 flex items-center justify-between gap-4"
              style={{ borderTop: "1px solid var(--app-border)" }}
            >
              <div className="min-w-0">
                <div className="text-[13.5px] text-text-primary truncate">{r.email}</div>
                {r.label && (
                  <div className="text-[11.5px] text-text-muted truncate">{r.label}</div>
                )}
              </div>
              <button
                className="btn-ghost"
                onClick={() => remove(r.id)}
                aria-label="Remove"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
