"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Search, Download, Upload, Filter, MoreHorizontal } from "lucide-react";
import { buyerRepo } from "@/lib/repositories";
import type { Buyer, BuyerStatus } from "@/lib/types";
import { BUYER_STATUS_LABELS, BUYER_STATUS_ORDER } from "@/lib/types";
import { PageContainer, PageHeader } from "@/components/ui/Page";
import { StatusPill } from "@/components/StatusPill";
import { Drawer } from "@/components/ui/Drawer";
import { Modal } from "@/components/ui/Modal";
import { BuyerForm } from "@/components/buyers/BuyerForm";
import { BuyerDetail } from "@/components/buyers/BuyerDetail";
import { CsvImportModal } from "@/components/buyers/CsvImportModal";
import { buyersToCsv } from "@/lib/csv";
import { logActivity } from "@/lib/activity";
import { toast } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/utils";

export default function BuyersPage() {
  const buyers = useLiveQuery(() => buyerRepo.list(), [], []);
  const [q, setQ] = useState("");
  const [country, setCountry] = useState<string>("");
  const [status, setStatus] = useState<BuyerStatus | "">("");
  const [product, setProduct] = useState<string>("");
  const [selected, setSelected] = useState<Buyer | null>(null);
  const [editing, setEditing] = useState<Buyer | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const countries = useMemo(
    () => Array.from(new Set(buyers.map((b) => b.country).filter(Boolean))).sort(),
    [buyers],
  );
  const products = useMemo(
    () => Array.from(new Set(buyers.map((b) => b.productInterest).filter(Boolean))) as string[],
    [buyers],
  );

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return buyers.filter((b) => {
      if (country && b.country !== country) return false;
      if (status && b.status !== status) return false;
      if (product && b.productInterest !== product) return false;
      if (!query) return true;
      const bag = [b.firstName, b.lastName, b.company, b.email, b.city, b.country, b.productInterest]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return bag.includes(query);
    });
  }, [buyers, q, country, status, product]);

  function toggleCheck(id: string) {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  }
  function toggleAll() {
    if (checked.size === filtered.length) setChecked(new Set());
    else setChecked(new Set(filtered.map((b) => b.id)));
  }

  async function saveBuyer(b: Buyer) {
    const existing = await buyerRepo.get(b.id);
    if (existing) {
      await buyerRepo.update(b.id, b);
      await logActivity("buyer.updated", `${b.company || b.firstName} updated`, { type: "buyer", id: b.id });
      toast.success("Buyer updated");
    } else {
      await buyerRepo.create(b);
      await logActivity("buyer.added", `${b.firstName} ${b.lastName} added`, { type: "buyer", id: b.id });
      toast.success("Buyer added");
    }
    setAdding(false);
    setEditing(null);
    setSelected(null);
  }

  function exportCsv(kind: "all" | "filtered" | "selected") {
    const rows =
      kind === "all"
        ? buyers
        : kind === "filtered"
          ? filtered
          : filtered.filter((b) => checked.has(b.id));
    if (rows.length === 0) {
      toast.info("No buyers to export.");
      return;
    }
    const csv = buyersToCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mdf-buyers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <PageContainer>
      <PageHeader
        title="Buyers"
        subtitle="Your international buyer network — importers, distributors, and food ingredient companies."
        actions={
          <>
            <button className="btn-outline" onClick={() => setImporting(true)}>
              <Upload size={14} /> Import
            </button>
            <button className="btn-outline" onClick={() => exportCsv(checked.size > 0 ? "selected" : "filtered")}>
              <Download size={14} /> Export
            </button>
            <button className="btn-brand" onClick={() => setAdding(true)}>
              <Plus size={14} /> Add buyer
            </button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted pointer-events-none"
          />
          <input
            className="input pl-8"
            placeholder="Search company, contact, email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1 text-brand-muted text-[12px] mr-1">
          <Filter size={12} />
        </div>
        <select className="input h-9 w-auto text-[13px]" value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">All countries</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          className="input h-9 w-auto text-[13px]"
          value={status}
          onChange={(e) => setStatus(e.target.value as BuyerStatus | "")}
        >
          <option value="">All statuses</option>
          {BUYER_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {BUYER_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select className="input h-9 w-auto text-[13px]" value={product} onChange={(e) => setProduct(e.target.value)}>
          <option value="">All products</option>
          {products.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState onAdd={() => setAdding(true)} onImport={() => setImporting(true)} isEmpty={buyers.length === 0} />
      ) : (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-[36px_minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_140px_120px_36px] items-center px-5 py-3 border-b border-brand-border text-[10.5px] uppercase tracking-[0.14em] text-brand-muted bg-white">
            <div>
              <input
                type="checkbox"
                aria-label="Select all"
                checked={checked.size > 0 && checked.size === filtered.length}
                onChange={toggleAll}
              />
            </div>
            <div>Company · Contact</div>
            <div>Email</div>
            <div>Country</div>
            <div>Status</div>
            <div>Updated</div>
            <div></div>
          </div>
          <ul className="divide-y divide-brand-border">
            {filtered.map((b) => (
              <li
                key={b.id}
                className="grid grid-cols-[36px_minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_140px_120px_36px] items-center px-5 py-3.5 hover:bg-brand-canvas/60 transition-colors cursor-pointer"
                onClick={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.closest("input,button,a,select")) return;
                  setSelected(b);
                }}
              >
                <div>
                  <input
                    type="checkbox"
                    aria-label={`Select ${b.company}`}
                    checked={checked.has(b.id)}
                    onChange={() => toggleCheck(b.id)}
                  />
                </div>
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-brand-charcoal truncate">
                    {b.company || `${b.firstName} ${b.lastName}`.trim() || b.email}
                  </div>
                  <div className="text-[12.5px] text-brand-muted truncate">
                    {[b.firstName, b.lastName].filter(Boolean).join(" ") || "—"}
                    {b.buyerType ? ` · ${b.buyerType}` : ""}
                  </div>
                </div>
                <div className="text-[13px] text-brand-muted truncate">{b.email}</div>
                <div className="text-[13px] text-brand-charcoal/80 truncate">
                  {b.country || "—"}
                  {b.city ? <span className="text-brand-muted">, {b.city}</span> : null}
                </div>
                <div>
                  <StatusPill status={b.status} small />
                </div>
                <div className="text-[12px] text-brand-muted">{formatRelative(b.updatedAt)}</div>
                <div className="justify-self-end text-brand-muted">
                  <MoreHorizontal size={14} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Drawer
        open={!!selected && !editing}
        onClose={() => setSelected(null)}
        title={selected?.company || `${selected?.firstName ?? ""} ${selected?.lastName ?? ""}`}
        subtitle={selected?.email}
        width="520px"
      >
        {selected && (
          <BuyerDetail
            buyer={selected}
            onEdit={() => setEditing(selected)}
            onClose={() => setSelected(null)}
          />
        )}
      </Drawer>

      <Modal
        open={adding || !!editing}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        title={editing ? "Edit buyer" : "Add buyer"}
        subtitle={editing ? "Update this buyer's details." : "Add a new buyer to your network."}
        size="lg"
      >
        <BuyerForm
          initial={editing ?? undefined}
          onSubmit={saveBuyer}
          onCancel={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      </Modal>

      <CsvImportModal open={importing} onClose={() => setImporting(false)} />
    </PageContainer>
  );
}

function EmptyState({
  onAdd,
  onImport,
  isEmpty,
}: {
  onAdd: () => void;
  onImport: () => void;
  isEmpty: boolean;
}) {
  return (
    <div className="card p-16 text-center">
      <div className="mx-auto max-w-md">
        <div className="text-[11px] tracking-[0.16em] uppercase text-brand-orange mb-4">
          {isEmpty ? "Empty" : "No matches"}
        </div>
        <h2 className="font-serif text-[26px] leading-tight tracking-[-0.015em] text-brand-charcoal">
          {isEmpty ? "Your buyer network starts here." : "No buyers match those filters."}
        </h2>
        <p className="mt-3 text-[14px] text-brand-muted leading-relaxed">
          {isEmpty
            ? "Import a CSV of importers, distributors and food ingredient companies — or add your first buyer."
            : "Adjust or clear filters to see more buyers."}
        </p>
        {isEmpty && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <button className="btn-outline" onClick={onImport}>
              <Upload size={14} /> Import CSV
            </button>
            <button className="btn-brand" onClick={onAdd}>
              <Plus size={14} /> Add buyer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
