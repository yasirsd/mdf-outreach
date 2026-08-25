import Link from "next/link";
import { notFound } from "next/navigation";
import { serverRepositories } from "@/lib/repositories/server";
import { resolveCampaignTemplate } from "@/lib/email/resolveCampaignTemplate";
import { SendView } from "./SendView";

export const dynamic = "force-dynamic";

export default async function SendPage({ params }: { params: { id: string } }) {
  const { repos } = await serverRepositories();
  const campaign = await repos.campaigns.get(params.id);
  if (!campaign) notFound();
  const [recipients, buyers, assets] = await Promise.all([
    repos.recipients.listByCampaign(params.id),
    repos.buyers.list(),
    repos.assets.list(),
  ]);
  const master = campaign.templateId
    ? (await repos.templates.get(campaign.templateId)) ?? null
    : null;
  const template = resolveCampaignTemplate(campaign, master);
  if (!template) {
    return (
      <div
        className="rounded-[14px] p-10 text-center"
        style={{
          backgroundColor: "var(--app-surface)",
          border: "1px dashed var(--app-border-strong)",
        }}
      >
        <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange font-medium mb-2">
          No template chosen
        </div>
        <p className="text-[13px] text-text-secondary max-w-md mx-auto leading-relaxed">
          Choose an email template on the Email tab before running a simulated send.
        </p>
        <Link href={`/campaigns/${params.id}/email`} className="btn-primary mt-5 inline-flex">
          Choose template
        </Link>
      </div>
    );
  }
  return (
    <SendView
      campaign={campaign}
      template={template}
      recipients={recipients}
      buyers={buyers}
      assets={assets}
    />
  );
}
