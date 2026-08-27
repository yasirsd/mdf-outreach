"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Plus,
  Search,
  Download,
  Upload,
  X as XIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { Buyer, BuyerStatus } from "@/lib/types";
import { BUYER_STATUS_LABELS, BUYER_STATUS_ORDER } from "@/lib/types";
import { PageContainer, PageHeader } from "@/components/ui/Page";
import { StatusPill } from "@/components/StatusPill";
import { Drawer } from "@/components/ui/Drawer";
import { Modal } from "@/components/ui/Modal";
import { BuyerForm } from "@/components/buyers/BuyerForm";
import { BuyerDetail } from "@/components/buyers/BuyerDetail";
import { CsvImportModal } from "@/components/buyers/CsvImportModal";
import { toast } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/utils";
import { saveBuyerAction } from "./actions";
import { exportFilteredBuyersAction } from "./exportAction";
import { SearchableCombobox, type ComboboxOption } from "@/components/ui/SearchableCombobox";
import { Select } from "@/components/ui/Select";
import { activeProducts } from "@/lib/catalogue/products";
import { COUNTRIES } from "@/lib/catalogue/countries";

interface Filters {
  search: string;
  status: string;
  country: string;
  product: string;
}

interface Props {
  initialRows: Buyer[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  initialFilters: Filters;
}

/**
 * F9 — server-side paginated Buyers view.
 *
 * State lives in the URL (search / status / country / product / page /
 * pageSize). Every filter change performs a `router.replace` and Next
 * re-runs the server loader — which calls repos.buyers.listPaginated —
 * and returns the authoritative bounded slice. Nothing is client-filtered.
 */
export function BuyersView({
  initialRows,
  total,
  page,
  pageSize,
  pageCount,
  initialFilters,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Local UI-only state.
  const [selected, setSelected] = useState<Buyer | null>(null);
  const [editing, setEditing] = useState<Buyer | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  // Debounced search input. The URL is the source of truth; the local
  // state exists only so keystrokes feel immediate.
  const [searchDraft, setSearchDraft] = useState(initialFilters.search);

  useEffect(() => {
    // Sync draft when the URL changes from elsewhere (e.g. back/forward).
    setSearchDraft(initialFilters.search);
  }, [initialFilters.search]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      const current = params?.get("q") ?? "";
      if (searchDraft === current) return;
      pushFilters({ search: searchDraft, page: 1 });
    }, 300);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  function pushFilters(partial: Partial<Filters & { page: number; pageSize: number }>) {
    const sp = new URLSearchParams(params?.toString() ?? "");
    const write = (key: string, value: string | undefined | null) => {
      if (value === undefined || value === null || value === "") sp.delete(key);
      else sp.set(key, value);
    };
    if ("search" in partial) write("q", partial.search);
    if ("status" in partial) write("status", partial.status);
    if ("country" in partial) write("country", partial.country);
    if ("product" in partial) write("product", partial.product);
    if ("page" in partial) write("page", partial.page ? String(partial.page) : undefined);
    if ("pageSize" in partial)
      write("pageSize", partial.pageSize ? String(partial.pageSize) : undefined);
    startTransition(() => {
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    });
  }

  const activeFilterCount = [initialFilters.status, initialFilters.country, initialFilters.product]
    .filter(Boolean).length;

  // Canonical options + LEGACY passthrough. If the current URL-state
  // value is not present in the canonical set, we append it as a
  // "Legacy" option so the selected chip renders correctly and the
  // operator can clear/change it. Selecting a canonical value in the
  // dropdown replaces the legacy one; the legacy value never appears
  // in `BuyerForm` (that stays canonical-only).
  const countryOptions = useMemo<ComboboxOption[]>(() => {
    const opts: ComboboxOption[] = COUNTRIES.map((c) => ({
      value: c.name,
      label: c.name,
    }));
    const legacy = initialFilters.country.trim();
    if (legacy && !opts.some((o) => o.value === legacy)) {
      opts.push({ value: legacy, label: legacy, description: "Legacy" });
    }
    return opts;
  }, [initialFilters.country]);

  const productOptions = useMemo<ComboboxOption[]>(() => {
    const opts: ComboboxOption[] = activeProducts().map((p) => ({
      value: p.displayName,
      label: p.displayName,
    }));
    const legacy = initialFilters.product.trim();
    if (legacy && !opts.some((o) => o.value === legacy)) {
      opts.push({ value: legacy, label: legacy, description: "Legacy" });
    }
    return opts;
  }, [initialFilters.product]);

  async function saveBuyer(b: Buyer) {
    try {
      const isNew = !initialRows.some((x) => x.id === b.id);
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

  const [exporting, setExporting] = useState(false);
  async function exportCsv() {
    if (total === 0) {
      toast.info("No buyers to export.");
      return;
    }
    setExporting(true);
    try {
      const result = await exportFilteredBuyersAction({
        search: initialFilters.search || undefined,
        status: initialFilters.status || undefined,
        country: initialFilters.country || undefined,
        product: initialFilters.product || undefined,
      });
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mdf-buyers-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        `Exported ${result.rowCount.toLocaleString()} buyer${result.rowCount === 1 ? "" : "s"}`,
      );
    } catch (err) {
      const message =
        err instanceof Error && err.message.includes("safety limit")
          ? err.message
          : "Could not export buyers.";
      toast.error(message);
    } finally {
      setExporting(false);
    }
  }

  function clearFilters() {
    pushFilters({ search: "", status: "", country: "", product: "", page: 1 });
    setSearchDraft("");
  }

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

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
            <button className="btn-secondary" onClick={exportCsv} disabled={exporting}>
              <Download size={13} /> {exporting ? "Exporting…" : "Export"}
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
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value.slice(0, 128))}
              aria-label="Search buyers"
            />
          </div>
          <div className="w-[200px]">
            <SearchableCombobox
              value={initialFilters.country || null}
              onChange={(v) => pushFilters({ country: v ?? "", page: 1 })}
              onClear={() => pushFilters({ country: "", page: 1 })}
              options={countryOptions}
              placeholder="Search country…"
              emptyLabel="All countries"
            />
          </div>
          <div className="w-[180px]">
            <Select
              value={initialFilters.status || null}
              onChange={(v) => pushFilters({ status: (v ?? "") as string, page: 1 })}
              emptyLabel="All statuses"
              options={BUYER_STATUS_ORDER.map<ComboboxOption>((s) => ({
                value: s,
                label: BUYER_STATUS_LABELS[s],
              }))}
            />
          </div>
          <div className="w-[200px]">
            <SearchableCombobox
              value={initialFilters.product || null}
              onChange={(v) => pushFilters({ product: v ?? "", page: 1 })}
              onClear={() => pushFilters({ product: "", page: 1 })}
              options={productOptions}
              placeholder="Search product…"
              emptyLabel="All products"
            />
          </div>
          {activeFilterCount > 0 && (
            <button
              className="text-[11.5px] text-text-muted hover:text-text-primary flex items-center gap-1 px-2"
              onClick={clearFilters}
            >
              <XIcon size={11} /> Clear
            </button>
          )}
          <div className="ml-auto text-[11.5px] text-text-muted tabular-nums pr-1">
            {total === 0 ? "0 buyers" : `${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}`}
            {isPending ? " · loading…" : ""}
          </div>
        </div>
      </div>

      {initialRows.length === 0 ? (
        <EmptyState
          onAdd={() => setAdding(true)}
          onImport={() => setImporting(true)}
          isEmpty={total === 0}
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
          <ul
            className="divide-y"
            style={{ borderColor: "var(--app-border)" }}
            aria-busy={isPending}
          >
            {initialRows.map((b) => (
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

      {pageCount > 1 && (
        <PaginationBar
          page={page}
          pageCount={pageCount}
          pageSize={pageSize}
          total={total}
          onChangePage={(next) => pushFilters({ page: next })}
          onChangePageSize={(size) => pushFilters({ pageSize: size, page: 1 })}
          isPending={isPending}
        />
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

function PaginationBar({
  page,
  pageCount,
  pageSize,
  total,
  onChangePage,
  onChangePageSize,
  isPending,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onChangePage: (page: number) => void;
  onChangePageSize: (size: number) => void;
  isPending: boolean;
}) {
  const canPrev = page > 1;
  const canNext = page < pageCount;
  return (
    <div
      className="mt-4 flex items-center gap-3 flex-wrap px-1"
      role="navigation"
      aria-label="Buyers pagination"
    >
      <button
        type="button"
        className="btn-secondary h-9 px-3"
        onClick={() => onChangePage(page - 1)}
        disabled={!canPrev || isPending}
        aria-label="Previous page"
      >
        <ChevronLeft size={14} /> Previous
      </button>
      <div className="text-[12px] text-text-muted tabular-nums" aria-live="polite">
        Page <span className="text-text-primary font-medium">{page.toLocaleString()}</span> of{" "}
        <span className="text-text-primary font-medium">{pageCount.toLocaleString()}</span>
      </div>
      <button
        type="button"
        className="btn-secondary h-9 px-3"
        onClick={() => onChangePage(page + 1)}
        disabled={!canNext || isPending}
        aria-label="Next page"
      >
        Next <ChevronRight size={14} />
      </button>
      <div className="ml-auto flex items-center gap-2 text-[11.5px] text-text-muted">
        <span className="tabular-nums">{total.toLocaleString()} total</span>
        <span>·</span>
        <label className="flex items-center gap-1.5">
          <span>Rows</span>
          <select
            className="input h-8 text-[12px] py-0 w-[70px]"
            value={pageSize}
            onChange={(e) => onChangePageSize(Number(e.target.value))}
            aria-label="Rows per page"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
      </div>
    </div>
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
