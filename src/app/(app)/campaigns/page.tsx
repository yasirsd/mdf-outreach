import { serverRepositories } from "@/lib/repositories/server";
import { CampaignsListView } from "./CampaignsListView";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const { repos } = await serverRepositories();
  const [campaigns, templates] = await Promise.all([
    repos.campaigns.list(),
    repos.templates.list(),
  ]);
  const withRecipients = await Promise.all(
    campaigns.map(async (campaign) => ({
      campaign,
      recipients: await repos.recipients.listByCampaign(campaign.id),
    })),
  );
  return <CampaignsListView initial={withRecipients} templates={templates} />;
}
