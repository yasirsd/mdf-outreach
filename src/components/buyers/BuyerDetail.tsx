"use client";

import Link from "next/link";
import { useState } from "react";
import { Building2, Globe, MapPin, Mail, Phone, MessageCircle, Edit2, Trash2, Send } from "lucide-react";
import type { Buyer, BuyerStatus } from "@/lib/types";
import { BUYER_STATUS_LABELS, BUYER_STATUS_ORDER } from "@/lib/types";
import { StatusPill } from "@/components/StatusPill";
import { formatDateTime } from "@/lib/utils";
import { deleteBuyerAction, updateBuyerStatusAction } from "@/app/(app)/buyers/actions";
import { toast } from "@/components/ui/Toast";

interface Props {
  buyer: Buyer;
  onEdit: () => void;
  onClose: () => void;
}

export function BuyerDetail({ buyer, onEdit, onClose }: Props) {
  const [status, setStatus] = useState<BuyerStatus>(buyer.status);
  const [deleting, setDeleting] = useState(false);

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
      <div className="px-6 pt-6 pb-4">
        <div className="text-[11px] uppercase tracking-[0.14em] text-brand-muted">
          {buyer.country || "—"}
          {buyer.city ? ` · ${buyer.city}` : ""}
        </div>
        <div className="mt-2 font-serif text-[28px] leading-tight tracking-[-0.015em] text-brand-charcoal">
          {buyer.company || name}
        </div>
        {buyer.company && (
          <div className="mt-1 text-[14px] text-brand-charcoal/70">{name}</div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <StatusPill status={status} />
          <select
            className="text-[12px] px-2 py-1 rounded-md border border-brand-border bg-white text-brand-charcoal/80"
            value={status}
            onChange={(e) => changeStatus(e.target.value as BuyerStatus)}
          >
            {BUYER_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                Change to: {BUYER_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="px-6 py-4 border-t border-brand-border grid grid-cols-1 gap-3">
        <Row icon={<Mail size={14} />} label="Email">
          <a href={`mailto:${buyer.email}`} className="text-brand-charcoal hover:underline">
            {buyer.email}
          </a>
        </Row>
        {buyer.phone && (
          <Row icon={<Phone size={14} />} label="Phone">
            {buyer.phone}
          </Row>
        )}
        {buyer.whatsapp && (
          <Row icon={<MessageCircle size={14} />} label="WhatsApp">
            {buyer.whatsapp}
          </Row>
        )}
        {buyer.website && (
          <Row icon={<Globe size={14} />} label="Website">
            <a
              href={buyer.website}
              target="_blank"
              rel="noreferrer"
              className="text-brand-charcoal hover:underline"
            >
              {buyer.website.replace(/^https?:\/\//, "")}
            </a>
          </Row>
        )}
        {(buyer.country || buyer.city) && (
          <Row icon={<MapPin size={14} />} label="Location">
            {[buyer.city, buyer.country].filter(Boolean).join(", ")}
          </Row>
        )}
        {buyer.buyerType && (
          <Row icon={<Building2 size={14} />} label="Buyer type">
            {buyer.buyerType}
          </Row>
        )}
      </div>

      {buyer.productInterest && (
        <div className="px-6 py-4 border-t border-brand-border">
          <div className="text-[11px] tracking-[0.14em] uppercase text-brand-muted mb-1.5">Product interest</div>
          <div className="text-[14px] text-brand-charcoal">{buyer.productInterest}</div>
        </div>
      )}

      {buyer.notes && (
        <div className="px-6 py-4 border-t border-brand-border">
          <div className="text-[11px] tracking-[0.14em] uppercase text-brand-muted mb-1.5">Notes</div>
          <div className="text-[14px] text-brand-charcoal/85 whitespace-pre-wrap leading-relaxed">
            {buyer.notes}
          </div>
        </div>
      )}

      <div className="px-6 py-4 border-t border-brand-border">
        <div className="text-[11px] tracking-[0.14em] uppercase text-brand-muted mb-1.5">History</div>
        <div className="text-[12.5px] text-brand-muted">
          Added {formatDateTime(buyer.createdAt)}
          {buyer.lastContactedAt && <> · Last contacted {formatDateTime(buyer.lastContactedAt)}</>}
        </div>
      </div>

      <div className="px-6 py-5 border-t border-brand-border flex flex-wrap gap-2">
        <button className="btn-outline" onClick={onEdit}>
          <Edit2 size={14} /> Edit
        </button>
        <Link
          href="/campaigns"
          className="btn-outline"
        >
          <Send size={14} /> Add to campaign
        </Link>
        <button className="btn-danger ml-auto" onClick={del} disabled={deleting}>
          <Trash2 size={14} /> {deleting ? "Removing…" : "Remove"}
        </button>
      </div>
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
      <div className="mt-0.5 text-brand-muted">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] tracking-[0.14em] uppercase text-brand-muted">{label}</div>
        <div className="mt-0.5 text-[13.5px] text-brand-charcoal truncate">{children}</div>
      </div>
    </div>
  );
}
