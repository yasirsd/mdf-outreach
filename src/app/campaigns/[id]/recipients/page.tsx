"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Search, X, CheckCircle2, AlertCircle } from "lucide-react";
import { buyerRepo, campaignRepo, recipientRepo } from "@/lib/repositories";
import type { Buyer, BuyerStatus, CampaignRecipient } from "@/lib/types";
import { StatusPill } from "@/components/StatusPill";
import { toast } from "@/components/ui/Toast";
import { logActivity } from "@/lib/activity";
import { Modal } from "@/components/ui/Modal";
import { isValidEmail, uid } from "@/lib/utils";
import { BUYER_STATUS_LABELS, BUYER_STATUS_ORDER } from "@/lib/types";

export default function RecipientsPage() {
  const { id } = useParams<{ id: string }>();
  const campaign = useLiveQuery(() => campaignRepo.get(id), [id]);
  const recipients = useLiveQuery(() => recipientRepo.listByCampaign(id), [id], []);
  const buyers = useLiveQuery(() => buyerRepo.list(), [], []);

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
    await recipientRepo.remove(recipientId);
    toast.success("Removed from campaign");
  }

  if (!campaign) return null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted pointer-events-none" />
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
          <button className="btn-brand" onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Add buyers
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-14 text-center">
          <div className="max-w-md mx-auto">
            <div className="text-[11px] tracking-[0.16em] uppercase text-brand-orange mb-3">Empty</div>
            <div className="font-serif text-[24px] tracking-[-0.015em] text-brand-charcoal">
              No recipients yet.
            </div>
            <p className="mt-2 text-[14px] text-brand-muted">
              Choose which buyers should receive this campaign.
            </p>
            <button className="btn-brand mt-6" onClick={() => setShowAdd(true)}>
              <Plus size={14} /> Add buyers
            </button>
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_120px_140px_120px_36px] items-center px-5 py-3 border-b border-brand-border text-[10.5px] uppercase tracking-[0.14em] text-brand-muted bg-white">
            <div>Company · Contact</div>
            <div>Email</div>
            <div>Country</div>
            <div>Status</div>
            <div>Ready?</div>
            <div></div>
          </div>
          <ul className="divide-y divide-brand-border">
            {filtered.map(({ recipient, buyer }) => {
              const ready = isValidEmail(buyer.email) && !!buyer.firstName;
              return (
                <li
                  key={recipient.id}
                  className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_120px_140px_120px_36px] items-center px-5 py-3.5 hover:bg-brand-canvas/60 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-brand-charcoal truncate">
                      {buyer.company || `${buyer.firstName} ${buyer.lastName}`}
                    </div>
                    <div className="text-[12.5px] text-brand-muted truncate">
                      {[buyer.firstName, buyer.lastName].filter(Boolean).join(" ") || "—"}
                    </div>
                  </div>
                  <div className="text-[13px] text-brand-muted truncate">{buyer.email}</div>
                  <div className="text-[13px] text-brand-charcoal/80">{buyer.country || "—"}</div>
                  <div>
                    <StatusPill status={buyer.status} small />
                  </div>
                  <div>
                    {ready ? (
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-700">
                        <CheckCircle2 size={13} /> Ready
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-brand-chilli">
                        <AlertCircle size={13} /> Incomplete
                      </span>
                    )}
                  </div>
                  <div className="justify-self-end">
                    <button
                      className="text-brand-muted hover:text-brand-chilli p-1 -m-1"
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
        campaignId={id}
        existingBuyerIds={new Set(recipients.map((r) => r.buyerId))}
      />
    </div>
  );
}

function AddBuyersModal({
  open,
  onClose,
  campaignId,
  existingBuyerIds,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  existingBuyerIds: Set<string>;
}) {
  const buyers = useLiveQuery(() => buyerRepo.list(), [], []);
  const [q, setQ] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const available = useMemo(() => buyers.filter((b) => !existingBuyerIds.has(b.id)), [buyers, existingBuyerIds]);
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return available;
    return available.filter((b) =>
      [b.firstName, b.lastName, b.company, b.email, b.country].filter(Boolean).join(" ").toLowerCase().includes(query),
    );
  }, [available, q]);

  function toggle(id: string) {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  }

  async function add() {
    if (checked.size === 0) {
      onClose();
      return;
    }
    const now = new Date().toISOString();
    const recs = Array.from(checked).map((buyerId) => {
      const b = buyers.find((x) => x.id === buyerId);
      return {
        id: uid("rcp"),
        campaignId,
        buyerId,
        status: b?.status ?? "new",
        createdAt: now,
      };
    });
    await recipientRepo.bulkPut(recs);
    await logActivity(
      "campaign.recipients",
      `${recs.length} buyer${recs.length === 1 ? "" : "s"} added to campaign`,
    );
    toast.success(`${recs.length} buyer${recs.length === 1 ? "" : "s"} added`);
    setChecked(new Set());
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add buyers to campaign"
      subtitle={`${available.length} buyer${available.length === 1 ? "" : "s"} not yet in this campaign.`}
      size="lg"
      actions={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-brand" onClick={add}>
            Add {checked.size > 0 ? `${checked.size} ` : ""}buyer{checked.size === 1 ? "" : "s"}
          </button>
        </>
      }
    >
      <div className="p-6">
        <div className="relative mb-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted pointer-events-none" />
          <input
            className="input pl-8"
            placeholder="Search buyers…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="border border-brand-border rounded-xl max-h-[400px] overflow-y-auto">
          {filtered.length === 0 && (
            <div className="p-8 text-center text-sm text-brand-muted">
              No buyers left to add. Import or create buyers on the Buyers page.
            </div>
          )}
          <ul className="divide-y divide-brand-border">
            {filtered.map((b) => (
              <li
                key={b.id}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-brand-canvas/60 cursor-pointer"
                onClick={() => toggle(b.id)}
              >
                <input type="checkbox" checked={checked.has(b.id)} onChange={() => toggle(b.id)} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium text-brand-charcoal truncate">
                    {b.company || `${b.firstName} ${b.lastName}`.trim() || b.email}
                  </div>
                  <div className="text-[12px] text-brand-muted truncate">
                    {b.email} · {b.country}
                  </div>
                </div>
                <StatusPill status={b.status} small />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
