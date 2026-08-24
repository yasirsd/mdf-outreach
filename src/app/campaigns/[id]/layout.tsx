"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { notFound, useParams } from "next/navigation";
import { campaignRepo } from "@/lib/repositories";
import { PageContainer } from "@/components/ui/Page";
import { CampaignHeader } from "@/components/campaigns/CampaignHeader";
import { CampaignTabs } from "@/components/campaigns/CampaignTabs";

export default function CampaignLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const campaign = useLiveQuery(() => campaignRepo.get(id), [id]);

  if (campaign === undefined) {
    return (
      <PageContainer>
        <div className="text-brand-muted text-sm">Loading…</div>
      </PageContainer>
    );
  }
  if (!campaign) {
    return notFound();
  }
  return (
    <PageContainer>
      <CampaignHeader campaign={campaign} />
      <CampaignTabs campaignId={id} />
      {children}
    </PageContainer>
  );
}
