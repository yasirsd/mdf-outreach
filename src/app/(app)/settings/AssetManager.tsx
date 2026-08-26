"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, UploadCloud, Trash2, Check, Circle, RotateCw } from "lucide-react";
import type { AssetRecord, AssetStatus } from "@/lib/types";
import type { ProductKey } from "@/lib/email/themes/types";
import { PRODUCT_THEMES } from "@/lib/email/themes/registry";
import { PRODUCT_KEYS } from "@/lib/email/themes/types";
import { slotsFor, type SlotSpec } from "@/lib/assets/slots";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import {
  deleteEmailAssetAction,
  setAssetAltTextAction,
  setAssetStatusAction,
  uploadEmailAssetAction,
} from "./assetActions";
import { ALLOWED_EMAIL_MIME_TYPES, MAX_ASSET_BYTES } from "@/lib/assets/storage";

interface Props {
  initialAssets: AssetRecord[];
}

export function AssetManager({ initialAssets }: Props) {
  const [assets, setAssets] = useState<AssetRecord[]>(initialAssets);
  const router = useRouter();

  const byThemeSlot = useMemo(() => {
    const map = new Map<string, AssetRecord>();
    for (const a of assets) {
      if (a.themeKey) map.set(`${a.themeKey}:${a.slot}`, a);
    }
    return map;
  }, [assets]);

  function replaceAsset(next: AssetRecord) {
    setAssets((prev) => {
      const idx = prev.findIndex((a) => a.id === next.id);
      if (idx === -1) return [...prev, next];
      const cp = [...prev];
      cp[idx] = next;
      return cp;
    });
  }

  function removeAsset(id: string) {
    setAssets((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="space-y-8">
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
          Only <strong>Production</strong> assets with a hosted URL are eligible when live sending
          is enabled. JPEG / PNG / GIF, max {(MAX_ASSET_BYTES / 1024 / 1024).toFixed(0)} MB per
          file.
        </div>
      </div>

      {PRODUCT_KEYS.map((key) => (
        <ProductGroup
          key={key}
          themeKey={key}
          specs={slotsFor(key)}
          bySlot={(slot) => byThemeSlot.get(`${key}:${slot}`)}
          onChange={replaceAsset}
          onRemove={removeAsset}
          onRefreshRouter={() => router.refresh()}
        />
      ))}
    </div>
  );
}

function ProductGroup({
  themeKey,
  specs,
  bySlot,
  onChange,
  onRemove,
  onRefreshRouter,
}: {
  themeKey: ProductKey;
  specs: SlotSpec[];
  bySlot: (slot: string) => AssetRecord | undefined;
  onChange: (next: AssetRecord) => void;
  onRemove: (id: string) => void;
  onRefreshRouter: () => void;
}) {
  const theme = PRODUCT_THEMES[themeKey];
  return (
    <section>
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange font-medium">
            {theme.category}
          </div>
          <h3 className="mt-1 text-[16px] font-semibold tracking-tight text-text-primary">
            {theme.name}
          </h3>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {specs.map((spec) => (
          <SlotRow
            key={`${themeKey}:${spec.slot}`}
            themeKey={themeKey}
            spec={spec}
            asset={bySlot(spec.slot)}
            onChange={onChange}
            onRemove={onRemove}
            onRefreshRouter={onRefreshRouter}
          />
        ))}
      </div>
    </section>
  );
}

function SlotRow({
  themeKey,
  spec,
  asset,
  onChange,
  onRemove,
  onRefreshRouter,
}: {
  themeKey: ProductKey;
  spec: SlotSpec;
  asset: AssetRecord | undefined;
  onChange: (next: AssetRecord) => void;
  onRemove: (id: string) => void;
  onRefreshRouter: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [alt, setAlt] = useState(asset?.altText ?? "");

  async function onFile(file: File) {
    if (!ALLOWED_EMAIL_MIME_TYPES.includes(file.type as (typeof ALLOWED_EMAIL_MIME_TYPES)[number])) {
      toast.error(
        `Unsupported image type. Use JPEG, PNG, or GIF.`,
      );
      return;
    }
    if (file.size > MAX_ASSET_BYTES) {
      toast.error(
        `File too large. Max ${(MAX_ASSET_BYTES / 1024 / 1024).toFixed(0)} MB.`,
      );
      return;
    }
    setBusy(true);
    try {
      const base64 = await toBase64(file);
      const saved = await uploadEmailAssetAction({
        themeKey,
        slot: spec.slot,
        mimeType: file.type,
        size: file.size,
        fileName: file.name,
        base64,
        altText: alt || undefined,
      });
      onChange(saved);
      onRefreshRouter();
      toast.success("Uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(next: AssetStatus) {
    if (!asset) return;
    setBusy(true);
    try {
      const saved = await setAssetStatusAction(asset.id, next);
      onChange(saved);
      onRefreshRouter();
      toast.success(`Marked ${next}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update status");
    } finally {
      setBusy(false);
    }
  }

  async function saveAlt() {
    if (!asset || alt === (asset.altText ?? "")) return;
    setBusy(true);
    try {
      const saved = await setAssetAltTextAction(asset.id, alt);
      onChange(saved);
    } catch {
      toast.error("Could not save alt text");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!asset) return;
    if (!confirm(`Delete ${spec.label}? The stored file will be removed.`)) return;
    setBusy(true);
    try {
      await deleteEmailAssetAction(asset.id);
      onRemove(asset.id);
      setAlt("");
      onRefreshRouter();
      toast.success("Deleted");
    } catch {
      toast.error("Could not delete asset");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded-[10px] p-4 flex items-start gap-4"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
    >
      <PreviewTile url={asset?.productionUrl || asset?.localDataUrl} label={spec.label} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-[13px] font-medium text-text-primary">{spec.label}</div>
          {spec.required && (
            <span className="chip" style={{ borderColor: "rgba(243,107,33,0.28)", color: "var(--brand-orange)" }}>
              Required
            </span>
          )}
          {spec.decorative && <span className="chip">Decorative</span>}
          <StatusChip status={asset?.status ?? "missing"} />
        </div>
        <div className="text-[11.5px] text-text-muted mt-1 mb-3 leading-relaxed">
          {spec.description}
        </div>

        <div className="grid md:grid-cols-[1fr_auto] gap-2 items-center">
          <input
            className="input h-9 text-[12.5px]"
            placeholder={
              spec.decorative
                ? "Alt text (optional — decorative)"
                : "Alt text (required for production)"
            }
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            onBlur={saveAlt}
            disabled={!asset}
          />
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              className="btn-secondary"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              {asset ? <RotateCw size={13} /> : <UploadCloud size={13} />}
              {asset ? "Replace" : "Upload"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/gif"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
            {asset && (
              <StatusMenu
                current={asset.status}
                onSelect={changeStatus}
                canPromote={
                  !!asset.productionUrl && (spec.decorative || !!alt.trim())
                }
                disabled={busy}
              />
            )}
            {asset && (
              <button
                className="btn-ghost"
                onClick={remove}
                disabled={busy}
                aria-label="Delete asset"
                title="Delete"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>

        {asset?.fileSize ? (
          <div className="mt-2 text-[11px] text-text-muted">
            {(asset.fileSize / 1024).toFixed(0)} KB · {asset.mimeType ?? "image"}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PreviewTile({ url, label }: { url: string | undefined; label: string }) {
  return (
    <div
      className="w-20 h-20 rounded-md overflow-hidden shrink-0"
      style={{
        backgroundColor: "var(--app-elevated)",
        border: "1px solid var(--app-border)",
      }}
    >
      {url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={url} alt={label} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full grid place-items-center text-text-muted">
          <UploadCloud size={16} />
        </div>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: AssetStatus }) {
  const spec: Record<AssetStatus, { fg: string; bg: string; border: string }> = {
    missing: { fg: "#71717A", bg: "rgba(255,255,255,0.02)", border: "rgba(255,255,255,0.08)" },
    draft: { fg: "#A1A1AA", bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.10)" },
    approved: { fg: "#93C5FD", bg: "rgba(59,130,246,0.10)", border: "rgba(59,130,246,0.28)" },
    production: { fg: "#4ADE80", bg: "rgba(34,197,94,0.14)", border: "rgba(34,197,94,0.40)" },
  };
  const s = spec[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full text-[10.5px] font-medium px-2 py-0.5"
      style={{ color: s.fg, backgroundColor: s.bg, border: `1px solid ${s.border}` }}
    >
      <Circle size={6} fill={s.fg} stroke="none" />
      {status}
    </span>
  );
}

function StatusMenu({
  current,
  onSelect,
  canPromote,
  disabled,
}: {
  current: AssetStatus;
  onSelect: (s: AssetStatus) => void;
  canPromote: boolean;
  disabled: boolean;
}) {
  const options: AssetStatus[] = ["draft", "approved", "production"];
  return (
    <div className="inline-flex overflow-hidden rounded-[8px]" style={{ border: "1px solid var(--app-border-strong)" }}>
      {options.map((s) => {
        const active = current === s;
        const disabledOption =
          disabled || (s === "production" && !canPromote && current !== "production");
        return (
          <button
            key={s}
            className={cn(
              "px-2.5 h-9 text-[11.5px] font-medium transition-colors",
              active ? "text-text-primary" : "text-text-muted hover:text-text-primary",
            )}
            style={{
              backgroundColor: active ? "var(--app-hover)" : "transparent",
              opacity: disabledOption ? 0.5 : 1,
              cursor: disabledOption ? "not-allowed" : "pointer",
            }}
            disabled={disabledOption}
            onClick={() => onSelect(s)}
            title={
              s === "production" && !canPromote
                ? "Requires production URL + alt text"
                : `Mark ${s}`
            }
          >
            {active ? <Check size={11} className="inline mr-1" /> : null}
            {s}
          </button>
        );
      })}
    </div>
  );
}

async function toBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}
