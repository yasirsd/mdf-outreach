import Link from "next/link";
import { notFound } from "next/navigation";
import { serverRepositories } from "@/lib/repositories/server";
import { getCachedCampaign } from "@/lib/repositories/campaignCache";
import { resolveCampaignTemplate } from "@/lib/email/resolveCampaignTemplate";
import { PreviewView } from "./PreviewView";

export const dynamic = "force-dynamic";

export default async function PreviewPage({ params }: { params: { id: string } }) {
  const { repos } = await serverRepositories();
  const campaign = await getCachedCampaign(params.id);
  if (!campaign) notFound();
  // Preview only needs recipient buyers for the "preview as buyer"
  // dropdown — never the entire workspace roster.
  const recipients = await repos.recipients.listByCampaign(params.id);
  const [buyers, assets, master] = await Promise.all([
    repos.buyers.listByIds(recipients.map((r) => r.buyerId)),
    repos.assets.list(),
    campaign.templateId
      ? repos.templates.get(campaign.templateId).then((t) => t ?? null)
      : Promise.resolve(null),
  ]);
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
          Choose an email template on the Email tab to preview this campaign.
        </p>
        <Link
          href={`/campaigns/${params.id}/email`}
          className="btn-primary mt-5 inline-flex"
        >
          Choose template
        </Link>
      </div>
    );
  }
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
