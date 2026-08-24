"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Monitor, Smartphone, Code, Download, Copy } from "lucide-react";
import {
  assetRepo,
  buyerRepo,
  campaignRepo,
  recipientRepo,
  templateRepo,
} from "@/lib/repositories";
import { renderEmailHtml, renderEmailText } from "@/lib/email/renderer";
import { EmailPreviewFrame } from "@/components/email/EmailPreviewFrame";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { cn } from "@/lib/utils";
import type { Buyer } from "@/lib/types";
import { toast } from "@/components/ui/Toast";

export default function CampaignPreviewPage() {
  const { id } = useParams<{ id: string }>();
  const campaign = useLiveQuery(() => campaignRepo.get(id), [id]);
  const template = useLiveQuery(
    () => (campaign ? templateRepo.get(campaign.templateId) : Promise.resolve(undefined)),
    [campaign?.templateId],
  );
  const recipients = useLiveQuery(() => recipientRepo.listByCampaign(id), [id], []);
  const buyers = useLiveQuery(() => buyerRepo.list(), [], []);
  const assets = useLiveQuery(() => assetRepo.list(), [], []);
  const { settings } = useWorkspace();

  const [view, setView] = useState<"desktop" | "mobile">("desktop");
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

  const html = useMemo(() => {
    if (!template || !settings) return "";
    return renderEmailHtml({ template, buyer: previewBuyer, settings, assetsBySlot });
  }, [template, previewBuyer, settings, assetsBySlot]);
  const text = useMemo(() => {
    if (!template || !settings) return "";
    return renderEmailText({ template, buyer: previewBuyer, settings, assetsBySlot });
  }, [template, previewBuyer, settings, assetsBySlot]);

  if (!campaign || !template || !settings) return null;

  const previewWidth = view === "desktop" ? 720 : 400;

  function download(kind: "html" | "text") {
    const content = kind === "html" ? html : text;
    const blob = new Blob([content], { type: kind === "html" ? "text/html" : "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${campaign?.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${kind === "html" ? "html" : "txt"}`;
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
          <span className="text-[11px] tracking-[0.14em] uppercase text-brand-muted">Preview as</span>
          <select
            className="input h-8 text-[13px]"
            value={previewBuyer?.id ?? ""}
            onChange={(e) => setPreviewBuyerId(e.target.value)}
          >
            {recipientBuyers.length === 0 && <option value="">No recipients</option>}
            {recipientBuyers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.firstName} {b.lastName} · {b.company}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex bg-white border border-brand-border rounded-lg p-0.5">
            <button
              className={cn(
                "px-2.5 h-7 rounded-md text-[12px] flex items-center gap-1.5",
                view === "desktop" ? "bg-brand-canvas text-brand-charcoal" : "text-brand-muted",
              )}
              onClick={() => setView("desktop")}
            >
              <Monitor size={12} /> Desktop
            </button>
            <button
              className={cn(
                "px-2.5 h-7 rounded-md text-[12px] flex items-center gap-1.5",
                view === "mobile" ? "bg-brand-canvas text-brand-charcoal" : "text-brand-muted",
              )}
              onClick={() => setView("mobile")}
            >
              <Smartphone size={12} /> Mobile
            </button>
          </div>
          <div className="inline-flex bg-white border border-brand-border rounded-lg p-0.5">
            <button
              className={cn(
                "px-2.5 h-7 rounded-md text-[12px]",
                tab === "html" ? "bg-brand-canvas text-brand-charcoal" : "text-brand-muted",
              )}
              onClick={() => setTab("html")}
            >
              HTML
            </button>
            <button
              className={cn(
                "px-2.5 h-7 rounded-md text-[12px]",
                tab === "text" ? "bg-brand-canvas text-brand-charcoal" : "text-brand-muted",
              )}
              onClick={() => setTab("text")}
            >
              Plain text
            </button>
          </div>
        </div>
      </div>

      {tab === "html" ? (
        <div className="rounded-2xl bg-brand-canvas p-6 md:p-10 flex items-start justify-center min-h-[600px]">
          <div
            className="bg-white shadow-card rounded-md overflow-hidden"
            style={{ width: previewWidth, maxWidth: "100%" }}
          >
            <div className="bg-white px-5 py-3 border-b border-brand-border">
              <div className="text-[12px] text-brand-muted">
                From <span className="text-brand-charcoal/85">{campaign.fromName}</span>
              </div>
              <div className="text-[14px] font-medium text-brand-charcoal mt-0.5 truncate">
                {subject}
              </div>
              {campaign.preheader && (
                <div className="text-[12px] text-brand-muted mt-0.5 truncate">
                  {campaign.preheader}
                </div>
              )}
            </div>
            <EmailPreviewFrame html={html} width="100%" minHeight={900} />
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-brand-border bg-white p-6">
          <pre className="text-[13px] leading-relaxed text-brand-charcoal font-mono whitespace-pre-wrap">
            {text}
          </pre>
        </div>
      )}

      <div className="mt-8 border-t border-brand-border pt-6">
        <button
          className="text-[12px] text-brand-muted hover:text-brand-charcoal inline-flex items-center gap-1"
          onClick={() => setShowCode((v) => !v)}
        >
          <Code size={12} /> {showCode ? "Hide" : "View"} generated email HTML (developer)
        </button>
        {showCode && (
          <div className="mt-4">
            <div className="flex items-center justify-end gap-2 mb-2">
              <button className="btn-outline text-[12px] h-8" onClick={() => copy("html")}>
                <Copy size={12} /> Copy HTML
              </button>
              <button className="btn-outline text-[12px] h-8" onClick={() => download("html")}>
                <Download size={12} /> Download HTML
              </button>
              <button className="btn-outline text-[12px] h-8" onClick={() => download("text")}>
                <Download size={12} /> Download text
              </button>
            </div>
            <pre className="text-[11.5px] leading-relaxed text-brand-charcoal/80 font-mono bg-brand-canvas rounded-xl p-4 overflow-x-auto max-h-[400px] overflow-y-auto">
              {html}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
