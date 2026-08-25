import type { Campaign } from "@/lib/types";

const STATUS_TONE: Record<Campaign["status"], { fg: string; bg: string; border: string }> = {
  draft: { fg: "#A1A1AA", bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.12)" },
  active: { fg: "#4ADE80", bg: "rgba(34,197,94,0.10)", border: "rgba(34,197,94,0.28)" },
  paused: { fg: "#FCD34D", bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.28)" },
  completed: { fg: "#93C5FD", bg: "rgba(59,130,246,0.10)", border: "rgba(59,130,246,0.28)" },
};

const STATUS_LABEL: Record<Campaign["status"], string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
};

export function CampaignHeader({ campaign }: { campaign: Campaign }) {
  const tone = STATUS_TONE[campaign.status];
  return (
    <div className="mb-6 flex items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange font-medium">
          {campaign.country} · Export Campaign
        </div>
        <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-text-primary">
          {campaign.name}
        </h1>
        {campaign.description && (
          <p className="mt-1.5 text-[13px] text-text-secondary max-w-2xl leading-relaxed">
            {campaign.description}
          </p>
        )}
      </div>
      <span
        className="text-[11px] px-2.5 py-1 rounded-full font-medium shrink-0"
        style={{ color: tone.fg, backgroundColor: tone.bg, border: `1px solid ${tone.border}` }}
      >
        {STATUS_LABEL[campaign.status]}
      </span>
    </div>
  );
}
