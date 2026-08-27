"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X, CheckCircle2, AlertCircle } from "lucide-react";
import type { Buyer, BuyerStatus, CampaignRecipient } from "@/lib/types";
import { StatusPill } from "@/components/StatusPill";
import { toast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { isValidEmail } from "@/lib/utils";
import { BUYER_STATUS_LABELS, BUYER_STATUS_ORDER } from "@/lib/types";
import { addRecipientsAction, removeRecipientAction } from "@/app/(app)/campaigns/actions";
import {
  searchAvailableRecipientsAction,
  type AvailableBuyerRow,
} from "./actions";

interface Props {
  campaignId: string;
  recipients: CampaignRecipient[];
  buyers: Buyer[];
}

export function RecipientsView({ campaignId, recipients, buyers }: Props) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<BuyerStatus | "">("");
  const [showAdd, setShowAdd] = useState(false);

  const buyerById = useMemo(() => new Map(buyers.map((b) => [b.id, b])), [buyers]);
  const rows = useMemo(
    () =>
      recipients
        .map((r) => ({ recipient: r, buyer: buyerById.get(r.buyerId) as Buyer | undefined }))
        .filter((r) => !!r.buyer) as Array<{ recipient: CampaignRecipient; buyer: Buyer }>,
    [recipients, buyerById],
  );

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows.filter(({ buyer }) => {
      if (statusFilter && buyer.status !== statusFilter) return false;
      if (!query) return true;
      return [buyer.firstName, buyer.lastName, buyer.company, buyer.email]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [rows, q, statusFilter]);

  async function remove(recipientId: string) {
    try {
      await removeRecipientAction(recipientId, campaignId);
      toast.success("Removed from campaign");
      router.refresh();
    } catch {
      toast.error("Could not remove recipient");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            className="input pl-8"
            placeholder="Search recipients…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select
          className="input h-9 w-auto text-[13px]"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as BuyerStatus | "")}
        >
          <option value="">All statuses</option>
          {BUYER_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {BUYER_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button className="btn-primary" onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Add buyers
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-14 text-center">
          <div className="max-w-md mx-auto">
            <div className="text-[11px] tracking-[0.16em] uppercase text-brand-orange mb-3">Empty</div>
            <div className="text-[22px] font-semibold tracking-tight text-text-primary">
              No recipients yet.
            </div>
            <p className="mt-2 text-[14px] text-text-muted">
              Choose which buyers should receive this campaign.
            </p>
            <button className="btn-primary mt-6" onClick={() => setShowAdd(true)}>
              <Plus size={14} /> Add buyers
            </button>
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_120px_140px_120px_36px] items-center px-5 py-3 border-b border-white/[0.06] text-[10.5px] uppercase tracking-[0.14em] text-text-muted bg-[color:var(--app-sidebar)]">
            <div>Company · Contact</div>
            <div>Email</div>
            <div>Country</div>
            <div>Status</div>
            <div>Ready?</div>
            <div></div>
          </div>
          <ul className="divide-y divide-white/[0.06]">
            {filtered.map(({ recipient, buyer }) => {
              const ready = isValidEmail(buyer.email) && !!buyer.firstName;
              return (
                <li
                  key={recipient.id}
                  className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_120px_140px_120px_36px] items-center px-5 py-3.5 hover:bg-[color:var(--app-sidebar)]/[0.03] transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-text-primary truncate">
                      {buyer.company || `${buyer.firstName} ${buyer.lastName}`}
                    </div>
                    <div className="text-[12.5px] text-text-muted truncate">
                      {[buyer.firstName, buyer.lastName].filter(Boolean).join(" ") || "—"}
                    </div>
                  </div>
                  <div className="text-[13px] text-text-muted truncate">{buyer.email}</div>
                  <div className="text-[13px] text-text-primary/80">{buyer.country || "—"}</div>
                  <div>
                    <StatusPill status={buyer.status} small />
                  </div>
                  <div>
                    {ready ? (
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-400">
                        <CheckCircle2 size={13} /> Ready
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:#F08B7E]">
                        <AlertCircle size={13} /> Incomplete
                      </span>
                    )}
                  </div>
                  <div className="justify-self-end">
                    <button
                      className="text-text-muted hover:text-[color:#F08B7E] p-1 -m-1"
                      aria-label="Remove"
                      onClick={() => remove(recipient.id)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <AddBuyersModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        campaignId={campaignId}
      />
    </div>
  );
}

/**
 * F9 — server-side candidate search. Debounces typing, calls
 * searchAvailableRecipientsAction with query/filters, keeps a stable
 * multi-select set across searches while the modal is open, and clears
 * that set on close/add.
 */
function AddBuyersModal({
  open,
  onClose,
  campaignId,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [rows, setRows] = useState<AvailableBuyerRow[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const [hitScanCap, setHitScanCap] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Map<string, AvailableBuyerRow>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const requestSeq = useRef(0);

  // Reset local state whenever the modal opens fresh.
  useEffect(() => {
    if (!open) return;
    setQ("");
    setDebouncedQ("");
    setChecked(new Map());
    setError(null);
  }, [open]);

  // Debounce search input.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => setDebouncedQ(q.trim()), 280);
    return () => window.clearTimeout(id);
  }, [q, open]);

  // Load candidates whenever the debounced query changes.
  useEffect(() => {
    if (!open) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    searchAvailableRecipientsAction({
      campaignId,
      query: debouncedQ || undefined,
      pageSize: 25,
    })
      .then((r) => {
        if (seq !== requestSeq.current) return; // stale
        setRows(r.rows);
        setExhausted(r.exhausted);
        setHitScanCap(r.hitScanCap);
      })
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setError("Could not load buyers. Try again.");
      })
      .finally(() => {
        if (seq !== requestSeq.current) return;
        setLoading(false);
      });
  }, [debouncedQ, open, campaignId]);

  function toggle(row: AvailableBuyerRow) {
    setChecked((prev) => {
      const next = new Map(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, row);
      return next;
    });
  }

  async function add() {
    if (checked.size === 0) {
      onClose();
      return;
    }
    setSubmitting(true);
    try {
      const { added } = await addRecipientsAction(
        campaignId,
        Array.from(checked.keys()),
      );
      toast.success(`${added} buyer${added === 1 ? "" : "s"} added`);
      setChecked(new Map());
      onClose();
      router.refresh();
    } catch {
      toast.error("Could not add buyers");
    } finally {
      setSubmitting(false);
    }
  }

  const noQuery = debouncedQ === "";
  const empty = !loading && rows.length === 0;
  const selectedRows = Array.from(checked.values());

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add buyers to campaign"
      subtitle={
        noQuery && rows.length === 0
          ? "Search for buyers to add. Existing recipients are excluded automatically."
          : rows.length > 0
            ? `Showing up to ${rows.length} eligible buyer${rows.length === 1 ? "" : "s"}${!exhausted ? " — refine your search for more" : ""}`
            : "Search for buyers to add."
      }
      size="lg"
      busy={submitting}
      actions={
        <>
          <button className="btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={add}
            disabled={submitting || checked.size === 0}
          >
            Add {checked.size > 0 ? `${checked.size} ` : ""}buyer{checked.size === 1 ? "" : "s"}
          </button>
        </>
      }
    >
      <div className="p-6">
        <div className="relative mb-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            className="input pl-8"
            placeholder="Search company, contact or email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search available buyers"
            autoFocus
          />
        </div>

        {checked.size > 0 && (
          <div className="mb-3 text-[11.5px] text-text-muted">
            {checked.size} selected · selection is preserved as you search.
          </div>
        )}

        <div
          className="border border-white/[0.08] rounded-xl max-h-[420px] overflow-y-auto"
          aria-busy={loading}
          aria-live="polite"
        >
          {loading && (
            <div className="p-6 text-center text-[13px] text-text-muted">Searching…</div>
          )}
          {error && !loading && (
            <div className="p-6 text-center text-[13px]" style={{ color: "#F08B7E" }}>
              {error}
            </div>
          )}
          {!loading && !error && empty && (
            <div className="p-8 text-center text-[13px] text-text-muted">
              {noQuery
                ? "Start typing to search buyers."
                : hitScanCap
                  ? "Too many matches to scan. Refine your search."
                  : exhausted
                    ? "No additional matching buyers."
                    : "No matching buyers. Try a different search."}
            </div>
          )}
          {!loading && !error && rows.length > 0 && (
            <ul className="divide-y divide-white/[0.06]">
              {rows.map((b) => {
                const isChecked = checked.has(b.id);
                return (
                  <li
                    key={b.id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-[color:var(--app-sidebar)]/[0.03] cursor-pointer"
                    onClick={() => toggle(b)}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggle(b)}
                      aria-label={`Select ${b.company || b.email}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-medium text-text-primary truncate">
                        {b.company || `${b.firstName} ${b.lastName}`.trim() || b.email}
                      </div>
                      <div className="text-[12px] text-text-muted truncate">
                        {b.email}
                        {b.country ? ` · ${b.country}` : ""}
                        {b.productInterest ? ` · ${b.productInterest}` : ""}
                      </div>
                    </div>
                    <StatusPill status={b.status as BuyerStatus} small />
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selectedRows.length > 0 && (
          <div className="mt-4 text-[11.5px] text-text-muted">
            <span className="text-text-primary font-medium">Selected:</span>{" "}
            {selectedRows
              .slice(0, 4)
              .map((r) => r.company || r.email)
              .join(", ")}
            {selectedRows.length > 4 ? `, +${selectedRows.length - 4} more` : ""}
          </div>
        )}
      </div>
    </Modal>
  );
}
