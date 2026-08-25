"use client";

import { useMemo, useState } from "react";
import { Monitor, Smartphone, Code, Download, Copy } from "lucide-react";
import type {
  AssetRecord,
  Buyer,
  Campaign,
  CampaignRecipient,
  EmailTemplate,
} from "@/lib/types";
import { renderEmailHtml, renderEmailText } from "@/lib/email/renderer";
import { EmailPreviewFrame } from "@/components/email/EmailPreviewFrame";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/Toast";

interface SegOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

function SegmentedGroup({
  options,
  value,
  onChange,
}: {
  options: SegOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      className="inline-flex rounded-[8px] p-0.5"
      style={{
        backgroundColor: "var(--app-elevated)",
        border: "1px solid var(--app-border)",
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            className={cn(
              "px-2.5 h-7 rounded-[6px] text-[11.5px] font-medium flex items-center gap-1.5 transition-colors focus-ring-quiet",
              active ? "text-text-primary" : "text-text-muted hover:text-text-secondary",
            )}
            style={active ? { backgroundColor: "var(--app-hover)" } : undefined}
            onClick={() => onChange(o.value)}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

interface Props {
  campaign: Campaign;
  template: EmailTemplate;
  recipients: CampaignRecipient[];
  buyers: Buyer[];
  assets: AssetRecord[];
}

export function PreviewView({ campaign, template, recipients, buyers, assets }: Props) {
  const { settings } = useWorkspace();

  const [view, setView] = useState<"desktop" | "mobile">("desktop");
  const [clientMode, setClientMode] = useState<"light" | "dark">("light");
  const [tab, setTab] = useState<"html" | "text">("html");
  const [showCode, setShowCode] = useState(false);
  const [previewBuyerId, setPreviewBuyerId] = useState("");

  const buyerById = useMemo(() => new Map(buyers.map((b) => [b.id, b])), [buyers]);
  const recipientBuyers = recipients
    .map((r) => buyerById.get(r.buyerId))
    .filter((b): b is Buyer => !!b);
  const previewBuyer =
    (previewBuyerId ? recipientBuyers.find((b) => b.id === previewBuyerId) : recipientBuyers[0]) ??
    null;

  const assetsBySlot = useMemo(
    () => Object.fromEntries(assets.map((a) => [a.slot, a])),
    [assets],
  );

  const html = useMemo(
    () => renderEmailHtml({ template, buyer: previewBuyer, settings, assetsBySlot }),
    [template, previewBuyer, settings, assetsBySlot],
  );
  const text = useMemo(
    () => renderEmailText({ template, buyer: previewBuyer, settings, assetsBySlot }),
    [template, previewBuyer, settings, assetsBySlot],
  );

  const previewWidth = view === "desktop" ? 680 : 390;

  function download(kind: "html" | "text") {
    const content = kind === "html" ? html : text;
    const blob = new Blob([content], { type: kind === "html" ? "text/html" : "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${campaign.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${kind === "html" ? "html" : "txt"}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function copy(kind: "html" | "text") {
    await navigator.clipboard.writeText(kind === "html" ? html : text);
    toast.success(`${kind.toUpperCase()} copied`);
  }

  const subject = campaign.subject.replace(
    /\{\{company\}\}/g,
    previewBuyer?.company ?? "your company",
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <span className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium">
            Preview as
          </span>
          <select
            className="input h-8 text-[12.5px] w-auto"
            value={previewBuyer?.id ?? ""}
            onChange={(e) => setPreviewBuyerId(e.target.value)}
            aria-label="Preview as buyer"
          >
            {recipientBuyers.length === 0 && <option value="">No recipients yet</option>}
            {recipientBuyers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.firstName} {b.lastName} · {b.company}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SegmentedGroup
            options={[
              { value: "desktop", label: "Desktop", icon: <Monitor size={12} /> },
              { value: "mobile", label: "Mobile", icon: <Smartphone size={12} /> },
            ]}
            value={view}
            onChange={(v) => setView(v as "desktop" | "mobile")}
          />
          <SegmentedGroup
            options={[
              { value: "light", label: "Light client" },
              { value: "dark", label: "Dark client" },
            ]}
            value={clientMode}
            onChange={(v) => setClientMode(v as "light" | "dark")}
          />
          <SegmentedGroup
            options={[
              { value: "html", label: "HTML" },
              { value: "text", label: "Plain text" },
            ]}
            value={tab}
            onChange={(v) => setTab(v as "html" | "text")}
          />
        </div>
      </div>

      {tab === "html" ? (
        <div
          className="rounded-[18px] flex items-start justify-center min-h-[720px] py-6 md:py-10 px-3 md:px-6"
          style={{
            backgroundColor: clientMode === "dark" ? "#0F0F10" : "#ECE7DB",
          }}
        >
          <div
            className="shadow-panel rounded-md overflow-hidden"
            style={{
              width: previewWidth,
              maxWidth: "100%",
              backgroundColor: clientMode === "dark" ? "#1B1A18" : "#FFFFFF",
              border: clientMode === "dark" ? "1px solid rgba(255,255,255,0.08)" : "1px solid #E6E1D9",
            }}
          >
            <div
              className="px-5 py-3"
              style={{
                borderBottom: clientMode === "dark" ? "1px solid rgba(255,255,255,0.08)" : "1px solid #E6E1D9",
              }}
            >
              <div
                className="text-[12px]"
                style={{ color: clientMode === "dark" ? "rgba(245,245,244,0.55)" : "#737373" }}
              >
                From{" "}
                <span style={{ color: clientMode === "dark" ? "#F5F5F4" : "#151515" }}>
                  {campaign.fromName}
                </span>
              </div>
              <div
                className="text-[14px] font-medium mt-0.5 truncate"
                style={{ color: clientMode === "dark" ? "#F5F5F4" : "#151515" }}
              >
                {subject}
              </div>
              {campaign.preheader && (
                <div
                  className="text-[12px] mt-0.5 truncate"
                  style={{ color: clientMode === "dark" ? "rgba(245,245,244,0.55)" : "#737373" }}
                >
                  {campaign.preheader}
                </div>
              )}
            </div>
            <EmailPreviewFrame html={html} width="100%" minHeight={900} />
          </div>
        </div>
      ) : (
        <div
          className="rounded-[12px] p-6"
          style={{
            backgroundColor: "var(--app-surface)",
            border: "1px solid var(--app-border)",
          }}
        >
          <pre className="text-[13px] leading-relaxed text-text-secondary font-mono whitespace-pre-wrap">
            {text}
          </pre>
        </div>
      )}

      <div className="mt-8 pt-6" style={{ borderTop: "1px solid var(--app-border)" }}>
        <button
          className="text-[12px] text-text-muted hover:text-text-primary inline-flex items-center gap-1.5 focus-ring-quiet"
          onClick={() => setShowCode((v) => !v)}
        >
          <Code size={12} /> {showCode ? "Hide" : "View"} generated email HTML (developer)
        </button>
        {showCode && (
          <div className="mt-4">
            <div className="flex items-center justify-end gap-2 mb-2">
              <button className="btn-secondary text-[11.5px] h-8" onClick={() => copy("html")}>
                <Copy size={12} /> Copy HTML
              </button>
              <button className="btn-secondary text-[11.5px] h-8" onClick={() => download("html")}>
                <Download size={12} /> Download HTML
              </button>
              <button className="btn-secondary text-[11.5px] h-8" onClick={() => download("text")}>
                <Download size={12} /> Download text
              </button>
            </div>
            <pre
              className="text-[11px] leading-relaxed font-mono rounded-[10px] p-4 overflow-x-auto max-h-[400px] overflow-y-auto"
              style={{
                backgroundColor: "var(--app-elevated)",
                color: "var(--text-secondary)",
                border: "1px solid var(--app-border)",
              }}
            >
              {html}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
