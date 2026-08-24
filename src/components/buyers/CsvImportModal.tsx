"use client";

import { useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { parseCsvFile, mapCsvToBuyers, type CsvMapping, type CsvParseResult } from "@/lib/csv";
import { buyerRepo } from "@/lib/repositories";
import { logActivity } from "@/lib/activity";
import { toast } from "@/components/ui/Toast";
import type { Buyer } from "@/lib/types";
import { Upload, FileText, CheckCircle2, AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Step = "upload" | "map" | "preview" | "done";
type DuplicateMode = "skip" | "update";

const FIELDS: Array<{ value: keyof Buyer | ""; label: string }> = [
  { value: "", label: "— Ignore —" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "company", label: "Company" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "website", label: "Website" },
  { value: "country", label: "Country" },
  { value: "city", label: "City" },
  { value: "buyerType", label: "Buyer type" },
  { value: "productInterest", label: "Product interest" },
  { value: "source", label: "Source" },
  { value: "notes", label: "Notes" },
  { value: "status", label: "Status" },
];

export function CsvImportModal({ open, onClose }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [mapping, setMapping] = useState<CsvMapping>({});
  const [dupMode, setDupMode] = useState<DuplicateMode>("skip");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; updated: number; skipped: number; invalid: number } | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStep("upload");
    setParsed(null);
    setMapping({});
    setDupMode("skip");
    setImporting(false);
    setResult(null);
  }

  async function handleFile(file: File) {
    try {
      const res = await parseCsvFile(file);
      setParsed(res);
      setMapping(res.autoMapping);
      setStep("map");
    } catch (e) {
      toast.error("Could not read CSV. Please check the file.");
    }
  }

  const drafts = useMemo(() => {
    if (!parsed) return [];
    return mapCsvToBuyers(parsed.rows, mapping);
  }, [parsed, mapping]);

  const valid = drafts.filter((d) => d.valid);
  const invalid = drafts.filter((d) => !d.valid);

  async function computeDupes(): Promise<{ readyBuyers: Buyer[]; dupBuyers: Array<{ draft: Buyer; existingId: string }> }> {
    const readyBuyers: Buyer[] = [];
    const dupBuyers: Array<{ draft: Buyer; existingId: string }> = [];
    const seen = new Set<string>();
    for (const d of valid) {
      const email = d.buyer.email;
      if (seen.has(email)) continue;
      seen.add(email);
      const existing = await buyerRepo.findByEmail(email);
      if (existing) dupBuyers.push({ draft: d.buyer, existingId: existing.id });
      else readyBuyers.push(d.buyer);
    }
    return { readyBuyers, dupBuyers };
  }

  const [dupPreview, setDupPreview] = useState<{ ready: number; dupes: number } | null>(null);

  async function goToPreview() {
    const { readyBuyers, dupBuyers } = await computeDupes();
    setDupPreview({ ready: readyBuyers.length, dupes: dupBuyers.length });
    setStep("preview");
  }

  async function commitImport() {
    setImporting(true);
    const { readyBuyers, dupBuyers } = await computeDupes();
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    if (readyBuyers.length) {
      await buyerRepo.bulkPut(readyBuyers);
      imported = readyBuyers.length;
    }
    if (dupBuyers.length) {
      if (dupMode === "update") {
        for (const { draft, existingId } of dupBuyers) {
          const { id: _drop, createdAt: _c, ...rest } = draft;
          await buyerRepo.update(existingId, rest);
          updated++;
        }
      } else {
        skipped = dupBuyers.length;
      }
    }
    await logActivity(
      "buyers.imported",
      `${imported} buyer${imported === 1 ? "" : "s"} imported${updated ? ` · ${updated} updated` : ""}${skipped ? ` · ${skipped} skipped` : ""}`,
    );
    toast.success(`${imported + updated} buyer${imported + updated === 1 ? "" : "s"} imported`);
    setResult({ imported, updated, skipped, invalid: invalid.length });
    setImporting(false);
    setStep("done");
  }

  function handleClose() {
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="lg"
      title="Import buyers from CSV"
      subtitle="Upload a CSV, map its columns to buyer fields, then preview before importing."
      actions={
        step === "upload" ? (
          <button className="btn-ghost" onClick={handleClose}>
            Cancel
          </button>
        ) : step === "map" ? (
          <>
            <button className="btn-ghost" onClick={() => reset()}>
              Back
            </button>
            <button className="btn-primary" onClick={goToPreview}>
              Continue
            </button>
          </>
        ) : step === "preview" ? (
          <>
            <button className="btn-ghost" onClick={() => setStep("map")}>
              Back
            </button>
            <button className="btn-brand" onClick={commitImport} disabled={importing}>
              {importing ? "Importing…" : "Import buyers"}
            </button>
          </>
        ) : (
          <button className="btn-primary" onClick={handleClose}>
            Done
          </button>
        )
      }
    >
      <div className="p-6">
        {step === "upload" && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
            className="border-2 border-dashed border-brand-border rounded-2xl p-10 text-center hover:border-brand-charcoal/30 transition-colors"
          >
            <div className="mx-auto w-10 h-10 rounded-full bg-brand-canvas grid place-items-center mb-4">
              <Upload size={18} className="text-brand-charcoal/70" />
            </div>
            <div className="text-[15px] font-medium text-brand-charcoal">Drop a CSV file, or</div>
            <div className="mt-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn-outline"
              >
                Choose file
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </div>
            <div className="mt-5 text-[12.5px] text-brand-muted max-w-md mx-auto leading-relaxed">
              Common headers detected automatically: <span className="text-brand-charcoal/70">first_name, last_name, company, email, phone, whatsapp, website, country, city, product, notes</span>.
            </div>
          </div>
        )}

        {step === "map" && parsed && (
          <div>
            <div className="text-[13px] text-brand-muted mb-4 flex items-center gap-2">
              <FileText size={14} /> {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"} · {parsed.headers.length} column
              {parsed.headers.length === 1 ? "" : "s"}
            </div>
            <div className="border border-brand-border rounded-xl overflow-hidden">
              <table className="w-full text-[13px]">
                <thead className="bg-brand-canvas text-brand-muted uppercase tracking-[0.12em] text-[10.5px]">
                  <tr>
                    <th className="text-left px-4 py-3">CSV column</th>
                    <th className="text-left px-4 py-3">Sample value</th>
                    <th className="text-left px-4 py-3 w-[220px]">Map to</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border">
                  {parsed.headers.map((h) => (
                    <tr key={h}>
                      <td className="px-4 py-3 font-medium text-brand-charcoal">{h}</td>
                      <td className="px-4 py-3 text-brand-muted truncate max-w-[280px]">
                        {parsed.rows[0]?.[h] ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className="input h-9 text-[13px]"
                          value={mapping[h] ?? ""}
                          onChange={(e) => setMapping({ ...mapping, [h]: e.target.value as keyof Buyer | "" })}
                        >
                          {FIELDS.map((f) => (
                            <option key={f.value} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {invalid.length > 0 && (
              <div className="mt-4 text-[12.5px] text-brand-chilli flex items-center gap-2">
                <AlertTriangle size={14} /> {invalid.length} row{invalid.length === 1 ? "" : "s"} will be skipped due to missing or invalid data.
              </div>
            )}
          </div>
        )}

        {step === "preview" && (
          <div>
            <div className="grid grid-cols-3 gap-3 mb-6">
              <PreviewStat label="Ready to import" value={dupPreview?.ready ?? 0} />
              <PreviewStat label="Duplicates detected" value={dupPreview?.dupes ?? 0} accent />
              <PreviewStat label="Invalid rows skipped" value={invalid.length} muted />
            </div>
            {(dupPreview?.dupes ?? 0) > 0 && (
              <div className="border border-brand-border rounded-xl p-4 mb-4">
                <div className="text-[13px] font-medium text-brand-charcoal mb-2">Duplicate handling</div>
                <div className="flex gap-2">
                  <label className="flex items-center gap-2 text-[13px] text-brand-charcoal/85 cursor-pointer">
                    <input
                      type="radio"
                      name="dup"
                      checked={dupMode === "skip"}
                      onChange={() => setDupMode("skip")}
                    />
                    Skip duplicates
                  </label>
                  <label className="flex items-center gap-2 text-[13px] text-brand-charcoal/85 ml-4 cursor-pointer">
                    <input
                      type="radio"
                      name="dup"
                      checked={dupMode === "update"}
                      onChange={() => setDupMode("update")}
                    />
                    Update existing
                  </label>
                </div>
              </div>
            )}
            <div className="border border-brand-border rounded-xl overflow-hidden max-h-72 overflow-y-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-brand-canvas text-brand-muted uppercase tracking-[0.12em] text-[10.5px] sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-3">Name</th>
                    <th className="text-left px-4 py-3">Company</th>
                    <th className="text-left px-4 py-3">Email</th>
                    <th className="text-left px-4 py-3">Country</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border">
                  {valid.slice(0, 20).map((d) => (
                    <tr key={d.buyer.id}>
                      <td className="px-4 py-2.5 text-brand-charcoal">
                        {[d.buyer.firstName, d.buyer.lastName].filter(Boolean).join(" ") || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-brand-charcoal/80">{d.buyer.company || "—"}</td>
                      <td className="px-4 py-2.5 text-brand-muted">{d.buyer.email}</td>
                      <td className="px-4 py-2.5 text-brand-muted">{d.buyer.country || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {valid.length > 20 && (
              <div className="mt-2 text-[12px] text-brand-muted">Showing first 20 of {valid.length}.</div>
            )}
          </div>
        )}

        {step === "done" && result && (
          <div className="text-center py-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 grid place-items-center mb-4">
              <CheckCircle2 size={22} className="text-emerald-700" />
            </div>
            <div className="text-[18px] font-serif text-brand-charcoal">Import complete</div>
            <div className="mt-2 text-[13px] text-brand-muted">
              {result.imported} imported · {result.updated} updated · {result.skipped} skipped · {result.invalid} invalid
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function PreviewStat({
  label,
  value,
  accent,
  muted,
}: {
  label: string;
  value: number;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="border border-brand-border rounded-xl p-4">
      <div className="text-[10.5px] tracking-[0.14em] uppercase text-brand-muted">{label}</div>
      <div
        className={`mt-2 font-serif text-[24px] tracking-[-0.02em] ${accent ? "text-brand-orange" : muted ? "text-brand-muted" : "text-brand-charcoal"}`}
      >
        {value}
      </div>
    </div>
  );
}
