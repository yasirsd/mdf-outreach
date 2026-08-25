"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Download, Upload, X as XIcon } from "lucide-react";
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
import { toast } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/utils";
import { saveBuyerAction } from "./actions";

export function BuyersView({ initialBuyers }: { initialBuyers: Buyer[] }) {
  const router = useRouter();
  const buyers = initialBuyers;
  const [q, setQ] = useState("");
  const [country, setCountry] = useState<string>("");
  const [status, setStatus] = useState<BuyerStatus | "">("");
  const [product, setProduct] = useState<string>("");
  const [selected, setSelected] = useState<Buyer | null>(null);
  const [editing, setEditing] = useState<Buyer | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

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

  const activeFilters = [country, status, product].filter(Boolean).length;

  async function saveBuyer(b: Buyer) {
    try {
      const isNew = !buyers.some((x) => x.id === b.id);
      await saveBuyerAction(b);
      toast.success(isNew ? "Buyer added" : "Buyer updated");
      setAdding(false);
      setEditing(null);
      setSelected(null);
      router.refresh();
    } catch {
      toast.error("Could not save buyer");
    }
  }

  function exportCsv() {
    const rows = filtered;
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

  function clearFilters() {
    setCountry("");
    setStatus("");
    setProduct("");
  }

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Buyers"
        subtitle="Your international buyer network — importers, distributors, and food ingredient companies."
        actions={
          <>
            <button className="btn-secondary" onClick={() => setImporting(true)}>
              <Upload size={13} /> Import
            </button>
            <button className="btn-secondary" onClick={exportCsv}>
              <Download size={13} /> Export
            </button>
            <button className="btn-primary" onClick={() => setAdding(true)}>
              <Plus size={13} /> Add buyer
            </button>
          </>
        }
      />

      <div
        className="rounded-[12px] mb-4"
        style={{ backgroundColor: "var(--app-surface)", border: "1px solid var(--app-border)" }}
      >
        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
            />
            <input
              className="input pl-8 h-9"
              placeholder="Search company, contact, email…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search buyers"
            />
          </div>
          <FilterSelect
            value={country}
            onChange={setCountry}
            placeholder="All countries"
            options={countries}
          />
          <FilterSelect
            value={status}
            onChange={(v) => setStatus(v as BuyerStatus | "")}
            placeholder="All statuses"
            options={BUYER_STATUS_ORDER.map((s) => ({ value: s, label: BUYER_STATUS_LABELS[s] }))}
          />
          <FilterSelect
            value={product}
            onChange={setProduct}
            placeholder="All products"
            options={products}
          />
          {activeFilters > 0 && (
            <button
              className="text-[11.5px] text-text-muted hover:text-text-primary flex items-center gap-1 px-2"
              onClick={clearFilters}
            >
              <XIcon size={11} /> Clear
            </button>
          )}
          <div className="ml-auto text-[11.5px] text-text-muted tabular-nums pr-1">
            {filtered.length} of {buyers.length}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          onAdd={() => setAdding(true)}
          onImport={() => setImporting(true)}
          isEmpty={buyers.length === 0}
        />
      ) : (
        <div
          className="rounded-[12px] overflow-hidden"
          style={{ backgroundColor: "var(--app-surface)", border: "1px solid var(--app-border)" }}
        >
          <div
            className="grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.2fr)_140px_100px] items-center px-5 py-2.5 text-[10.5px] uppercase tracking-[0.14em] text-text-muted font-medium"
            style={{ borderBottom: "1px solid var(--app-border)" }}
          >
            <div>Company · Contact</div>
            <div>Email</div>
            <div>Country</div>
            <div>Product</div>
            <div>Status</div>
            <div className="text-right">Last activity</div>
          </div>
          <ul className="divide-y" style={{ borderColor: "var(--app-border)" }}>
            {filtered.map((b) => (
              <li
                key={b.id}
                className="grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.2fr)_140px_100px] items-center px-5 py-3 cursor-pointer row-hover"
                onClick={() => setSelected(b)}
                tabIndex={0}
                role="button"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(b);
                  }
                }}
              >
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium text-text-primary truncate">
                    {b.company || `${b.firstName} ${b.lastName}`.trim() || b.email}
                  </div>
                  <div className="text-[11.5px] text-text-muted truncate">
                    {[b.firstName, b.lastName].filter(Boolean).join(" ") || "—"}
                    {b.buyerType ? ` · ${b.buyerType}` : ""}
                  </div>
                </div>
                <div className="text-[12.5px] text-text-secondary truncate">{b.email}</div>
                <div className="text-[12.5px] text-text-secondary truncate">
                  {b.country || "—"}
                  {b.city && <span className="text-text-muted">, {b.city}</span>}
                </div>
                <div className="text-[12.5px] text-text-secondary truncate">
                  {b.productInterest || "—"}
                </div>
                <div>
                  <StatusPill status={b.status} small />
                </div>
                <div className="text-[11.5px] text-text-muted text-right tabular-nums">
                  {formatRelative(b.updatedAt)}
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
        width="560px"
      >
        {selected && (
          <BuyerDetail
            buyer={selected}
            onEdit={() => setEditing(selected)}
            onClose={() => {
              setSelected(null);
              router.refresh();
            }}
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
          key={editing?.id ?? (adding ? "new" : "closed")}
          initial={editing ?? undefined}
          onSubmit={saveBuyer}
          onCancel={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      </Modal>

      <CsvImportModal
        open={importing}
        onClose={() => {
          setImporting(false);
          router.refresh();
        }}
      />
    </PageContainer>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: Array<string | { value: string; label: string }>;
}) {
  return (
    <select
      className="input h-9 w-auto text-[12.5px] max-w-[200px]"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={placeholder}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => {
        const value = typeof o === "string" ? o : o.value;
        const label = typeof o === "string" ? o : o.label;
        return (
          <option key={value} value={value}>
            {label}
          </option>
        );
      })}
    </select>
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
    <div
      className="rounded-[16px] p-14 text-center"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px dashed var(--app-border-strong)",
      }}
    >
      <div className="mx-auto max-w-md">
        <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange font-medium mb-3">
          {isEmpty ? "No buyers yet" : "No matches"}
        </div>
        <h2 className="text-[22px] font-semibold tracking-tight text-text-primary">
          {isEmpty ? "Your buyer network starts here." : "No buyers match those filters."}
        </h2>
        <p className="mt-2 text-[13.5px] text-text-secondary leading-relaxed">
          {isEmpty
            ? "Import a CSV of importers, distributors and food ingredient companies — or add your first buyer."
            : "Adjust or clear filters to see more buyers."}
        </p>
        {isEmpty && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <button className="btn-secondary" onClick={onImport}>
              <Upload size={13} /> Import CSV
            </button>
            <button className="btn-primary" onClick={onAdd}>
              <Plus size={13} /> Add buyer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
