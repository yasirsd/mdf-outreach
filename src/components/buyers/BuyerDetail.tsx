"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Building2,
  Globe,
  MapPin,
  Mail,
  Phone,
  MessageCircle,
  Edit2,
  Trash2,
  Send,
  ShieldOff,
  ShieldCheck,
} from "lucide-react";
import type { Buyer, BuyerStatus, BuyerSuppressionReason } from "@/lib/types";
import {
  BUYER_STATUS_LABELS,
  BUYER_STATUS_ORDER,
  BUYER_SUPPRESSION_REASON_LABELS,
} from "@/lib/types";
import { StatusPill } from "@/components/StatusPill";
import { formatDateTime } from "@/lib/utils";
import {
  deleteBuyerAction,
  getBuyerContactHistoryAction,
  suppressBuyerAction,
  unsuppressBuyerAction,
  updateBuyerStatusAction,
  type BuyerContactHistoryResult,
} from "@/app/(app)/buyers/actions";
import { toast } from "@/components/ui/Toast";
import { SuppressionModal, UnsuppressionModal } from "@/components/buyers/SuppressionModal";
import { BuyerContactHistory } from "@/components/buyers/BuyerContactHistory";

interface Props {
  buyer: Buyer;
  onEdit: () => void;
  onClose: () => void;
}

export function BuyerDetail({ buyer, onEdit, onClose }: Props) {
  const [status, setStatus] = useState<BuyerStatus>(buyer.status);
  const [deleting, setDeleting] = useState(false);
  const [suppressed, setSuppressed] = useState<boolean>(!!buyer.suppressed);
  const [suppressionReason, setSuppressionReason] = useState<
    BuyerSuppressionReason | undefined
  >(buyer.suppressionReason);
  const [suppressionBusy, setSuppressionBusy] = useState(false);

  const [suppressModalOpen, setSuppressModalOpen] = useState(false);
  const [unsuppressModalOpen, setUnsuppressModalOpen] = useState(false);
  const [history, setHistory] = useState<BuyerContactHistoryResult | null>(null);

  useEffect(() => {
    setStatus(buyer.status);
    setSuppressed(!!buyer.suppressed);
    setSuppressionReason(buyer.suppressionReason);
    setHistory(null);
    let cancelled = false;
    getBuyerContactHistoryAction(buyer.id)
      .then((res) => {
        if (!cancelled) setHistory(res);
      })
      .catch(() => {
        if (!cancelled) setHistory({ history: [], campaigns: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [buyer.id, buyer.status, buyer.suppressed, buyer.suppressionReason]);

  async function doSuppress(input: { reason: BuyerSuppressionReason; note?: string }) {
    setSuppressionBusy(true);
    try {
      await suppressBuyerAction({ id: buyer.id, reason: input.reason, note: input.note });
      setSuppressed(true);
      setSuppressionReason(input.reason);
      setSuppressModalOpen(false);
      toast.success('Marked "Do not contact"');
    } catch {
      toast.error("Could not update suppression");
    } finally {
      setSuppressionBusy(false);
    }
  }

  async function doUnsuppress() {
    setSuppressionBusy(true);
    try {
      await unsuppressBuyerAction(buyer.id);
      setSuppressed(false);
      setSuppressionReason(undefined);
      setUnsuppressModalOpen(false);
      toast.success("Suppression removed");
    } catch {
      toast.error("Could not remove suppression");
    } finally {
      setSuppressionBusy(false);
    }
  }

  async function changeStatus(s: BuyerStatus) {
    setStatus(s);
    try {
      await updateBuyerStatusAction(buyer.id, s);
      toast.success("Status updated");
    } catch {
      toast.error("Could not update status");
      setStatus(buyer.status);
    }
  }

  async function del() {
    if (!confirm(`Delete ${buyer.company || buyer.firstName || "this buyer"}? This cannot be undone.`))
      return;
    setDeleting(true);
    try {
      await deleteBuyerAction(buyer.id);
      toast.success("Buyer removed");
      onClose();
    } catch {
      toast.error("Could not remove buyer");
      setDeleting(false);
    }
  }

  const name = [buyer.firstName, buyer.lastName].filter(Boolean).join(" ") || "—";

  return (
    <div>
      <div className="px-6 pt-6 pb-5">
        <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium">
          {buyer.country || "—"}
          {buyer.city ? ` · ${buyer.city}` : ""}
        </div>
        <div className="mt-2 text-[22px] font-semibold tracking-tight text-text-primary leading-tight">
          {buyer.company || name}
        </div>
        {buyer.company && (
          <div className="mt-1 text-[13px] text-text-secondary">{name}</div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <StatusPill status={status} />
          {suppressed ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
              style={{
                backgroundColor: "rgba(239,108,92,0.12)",
                color: "#F08B7E",
                border: "1px solid rgba(239,108,92,0.32)",
              }}
              title={`Suppressed since ${buyer.suppressedAt ? formatDateTime(buyer.suppressedAt) : "—"}`}
            >
              <ShieldOff size={11} /> Do not contact
              {suppressionReason
                ? ` · ${BUYER_SUPPRESSION_REASON_LABELS[suppressionReason]}`
                : ""}
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
              style={{
                backgroundColor: "rgba(74,222,128,0.10)",
                color: "#86EFAC",
                border: "1px solid rgba(74,222,128,0.24)",
              }}
              title="Eligible for production Buyer Send when all preflight checks pass"
            >
              <ShieldCheck size={11} /> Active for outreach
            </span>
          )}
          <select
            className="text-[11.5px] px-2 py-1 rounded-md focus-ring-quiet"
            value={status}
            onChange={(e) => changeStatus(e.target.value as BuyerStatus)}
            style={{
              backgroundColor: "var(--app-elevated)",
              color: "var(--text-secondary)",
              border: "1px solid var(--app-border-strong)",
            }}
            aria-label="Change status"
          >
            {BUYER_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                Change to: {BUYER_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        className="px-6 py-4 grid grid-cols-1 gap-3"
        style={{ borderTop: "1px solid var(--app-border)" }}
      >
        <Row icon={<Mail size={13} />} label="Email">
          <a
            href={`mailto:${buyer.email}`}
            className="text-text-primary hover:text-brand-orange transition-colors"
          >
            {buyer.email}
          </a>
        </Row>
        {buyer.phone && <Row icon={<Phone size={13} />} label="Phone">{buyer.phone}</Row>}
        {buyer.whatsapp && (
          <Row icon={<MessageCircle size={13} />} label="WhatsApp">{buyer.whatsapp}</Row>
        )}
        {buyer.website && (
          <Row icon={<Globe size={13} />} label="Website">
            <a
              href={buyer.website}
              target="_blank"
              rel="noreferrer"
              className="text-text-primary hover:text-brand-orange transition-colors"
            >
              {buyer.website.replace(/^https?:\/\//, "")}
            </a>
          </Row>
        )}
        {(buyer.country || buyer.city) && (
          <Row icon={<MapPin size={13} />} label="Location">
            {[buyer.city, buyer.country].filter(Boolean).join(", ")}
          </Row>
        )}
        {buyer.buyerType && (
          <Row icon={<Building2 size={13} />} label="Buyer type">{buyer.buyerType}</Row>
        )}
      </div>

      {buyer.productInterest && (
        <MetaBlock label="Product interest" style={{ borderTop: "1px solid var(--app-border)" }}>
          {buyer.productInterest}
        </MetaBlock>
      )}

      {buyer.notes && (
        <MetaBlock label="Notes" style={{ borderTop: "1px solid var(--app-border)" }}>
          <div className="whitespace-pre-wrap leading-relaxed">{buyer.notes}</div>
        </MetaBlock>
      )}

      <MetaBlock label="History" style={{ borderTop: "1px solid var(--app-border)" }}>
        <div className="text-[12px] text-text-muted">
          Added {formatDateTime(buyer.createdAt)}
          {buyer.lastContactedAt && (
            <> · Last contacted {formatDateTime(buyer.lastContactedAt)}</>
          )}
          {buyer.nextFollowUpAt && (
            <> · Next follow-up {formatDateTime(buyer.nextFollowUpAt)}</>
          )}
        </div>
      </MetaBlock>

      <div className="px-6 py-5" style={{ borderTop: "1px solid var(--app-border)" }}>
        {history === null ? (
          <div className="text-[12px] text-text-muted">Loading contact history…</div>
        ) : (
          <BuyerContactHistory
            history={history.history}
            campaigns={history.campaigns}
            buyerCreatedAt={buyer.createdAt}
          />
        )}
      </div>

      <div
        className="px-6 py-4 flex flex-wrap gap-2"
        style={{ borderTop: "1px solid var(--app-border)" }}
      >
        <button className="btn-secondary" onClick={onEdit}>
          <Edit2 size={13} /> Edit
        </button>
        <Link href="/campaigns" className="btn-secondary">
          <Send size={13} /> Add to campaign
        </Link>
        {suppressed ? (
          <button
            className="btn-secondary"
            onClick={() => setUnsuppressModalOpen(true)}
            disabled={suppressionBusy}
            title="Buyer will become eligible for production Buyer Send again"
          >
            <ShieldCheck size={13} /> Remove suppression
          </button>
        ) : (
          <button
            className="btn-secondary"
            onClick={() => setSuppressModalOpen(true)}
            disabled={suppressionBusy}
            title="Production Buyer Send will refuse to send to this buyer"
          >
            <ShieldOff size={13} /> Do not contact
          </button>
        )}
        <button className="btn-danger ml-auto" onClick={del} disabled={deleting}>
          <Trash2 size={13} /> {deleting ? "Removing…" : "Remove"}
        </button>
      </div>

      <SuppressionModal
        open={suppressModalOpen}
        buyer={buyer}
        onClose={() => setSuppressModalOpen(false)}
        onConfirm={doSuppress}
        busy={suppressionBusy}
      />
      <UnsuppressionModal
        open={unsuppressModalOpen}
        buyer={buyer}
        onClose={() => setUnsuppressModalOpen(false)}
        onConfirm={doUnsuppress}
        busy={suppressionBusy}
      />
    </div>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 text-text-muted">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium">
          {label}
        </div>
        <div className="mt-0.5 text-[13px] text-text-primary truncate">{children}</div>
      </div>
    </div>
  );
}

function MetaBlock({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className="px-6 py-4" style={style}>
      <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium mb-1.5">
        {label}
      </div>
      <div className="text-[13px] text-text-primary">{children}</div>
    </div>
  );
}
