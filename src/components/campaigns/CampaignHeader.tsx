"use client";

import type { Campaign } from "@/lib/types";

export function CampaignHeader({ campaign }: { campaign: Campaign }) {
  return (
    <div className="mb-8">
      <div className="text-[11px] tracking-[0.16em] uppercase text-brand-orange">
        {campaign.country} · Export Campaign
      </div>
      <h1 className="mt-3 font-serif font-medium text-[40px] leading-[1.05] tracking-[-0.02em] text-brand-charcoal">
        {campaign.name}
      </h1>
      {campaign.description && (
        <p className="mt-3 text-brand-muted text-[15px] max-w-xl">{campaign.description}</p>
      )}
    </div>
  );
}
