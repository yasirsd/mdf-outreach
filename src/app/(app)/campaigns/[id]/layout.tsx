import { notFound } from "next/navigation";
import { serverRepositories } from "@/lib/repositories/server";
import { PageContainer } from "@/components/ui/Page";
import { CampaignHeader } from "@/components/campaigns/CampaignHeader";
import { CampaignTabs } from "@/components/campaigns/CampaignTabs";

export const dynamic = "force-dynamic";

export default async function CampaignLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const { repos } = await serverRepositories();
  const campaign = await repos.campaigns.get(params.id);
  if (!campaign) notFound();
  return (
    <PageContainer>
      <CampaignHeader campaign={campaign} />
      <CampaignTabs campaignId={params.id} />
      {children}
    </PageContainer>
  );
}
