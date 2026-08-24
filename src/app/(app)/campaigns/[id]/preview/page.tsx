import { notFound } from "next/navigation";
import { serverRepositories } from "@/lib/repositories/server";
import { PreviewView } from "./PreviewView";

export const dynamic = "force-dynamic";

export default async function PreviewPage({ params }: { params: { id: string } }) {
  const { repos } = await serverRepositories();
  const campaign = await repos.campaigns.get(params.id);
  if (!campaign) notFound();
  const [templates, recipients, buyers, assets] = await Promise.all([
    repos.templates.list(),
    repos.recipients.listByCampaign(params.id),
    repos.buyers.list(),
    repos.assets.list(),
  ]);
  const template =
    (campaign.templateId && (await repos.templates.get(campaign.templateId))) ?? templates[0];
  if (!template) return null;
  return (
    <PreviewView
      campaign={campaign}
      template={template}
      recipients={recipients}
      buyers={buyers}
      assets={assets}
    />
  );
}
