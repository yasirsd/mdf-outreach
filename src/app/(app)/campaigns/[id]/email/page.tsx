import { notFound } from "next/navigation";
import { serverRepositories } from "@/lib/repositories/server";
import { EmailComposerView } from "./EmailComposerView";

export const dynamic = "force-dynamic";

export default async function EmailComposerPage({ params }: { params: { id: string } }) {
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
  if (!template) {
    return (
      <div className="card p-14 text-center">
        <div className="text-[11px] tracking-[0.16em] uppercase text-brand-orange mb-3">Empty</div>
        <div className="font-serif text-[22px] text-brand-charcoal">No template configured.</div>
        <p className="mt-2 text-brand-muted text-[13.5px]">
          Templates are provisioned during workspace setup — contact your MDF administrator.
        </p>
      </div>
    );
  }
  return (
    <EmailComposerView
      campaign={campaign}
      template={template}
      recipients={recipients}
      buyers={buyers}
      assets={assets}
    />
  );
}
