"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X, CheckCircle2, AlertCircle } from "lucide-react";
import type { Buyer, BuyerStatus, CampaignRecipient } from "@/lib/types";
import { StatusPill } from "@/components/StatusPill";
import { toast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { isValidEmail } from "@/lib/utils";
import { BUYER_STATUS_LABELS, BUYER_STATUS_ORDER } from "@/lib/types";
import { addRecipientsAction, removeRecipientAction } from "@/app/(app)/campaigns/actions";

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
        allBuyers={buyers}
        existingBuyerIds={new Set(recipients.map((r) => r.buyerId))}
      />
    </div>
  );
}

function AddBuyersModal({
  open,
  onClose,
  campaignId,
  allBuyers,
  existingBuyerIds,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  allBuyers: Buyer[];
  existingBuyerIds: Set<string>;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const available = useMemo(
    () => allBuyers.filter((b) => !existingBuyerIds.has(b.id)),
    [allBuyers, existingBuyerIds],
  );
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
    try {
      const { added } = await addRecipientsAction(campaignId, Array.from(checked));
      toast.success(`${added} buyer${added === 1 ? "" : "s"} added`);
      setChecked(new Set());
      onClose();
      router.refresh();
    } catch {
      toast.error("Could not add buyers");
    }
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
          <button className="btn-primary" onClick={add}>
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
            placeholder="Search buyers…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="border border-white/[0.08] rounded-xl max-h-[400px] overflow-y-auto">
          {filtered.length === 0 && (
            <div className="p-8 text-center text-sm text-text-muted">
              No buyers left to add. Import or create buyers on the Buyers page.
            </div>
          )}
          <ul className="divide-y divide-white/[0.06]">
            {filtered.map((b) => (
              <li
                key={b.id}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-[color:var(--app-sidebar)]/[0.03] cursor-pointer"
                onClick={() => toggle(b.id)}
              >
                <input type="checkbox" checked={checked.has(b.id)} onChange={() => toggle(b.id)} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium text-text-primary truncate">
                    {b.company || `${b.firstName} ${b.lastName}`.trim() || b.email}
                  </div>
                  <div className="text-[12px] text-text-muted truncate">
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
