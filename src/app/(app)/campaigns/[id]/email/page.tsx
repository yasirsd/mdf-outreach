import { notFound } from "next/navigation";
import { serverRepositories } from "@/lib/repositories/server";
import { getCachedCampaign } from "@/lib/repositories/campaignCache";
import { EmailComposerView } from "./EmailComposerView";
import { PRODUCT_THEMES } from "@/lib/email/themes/registry";
import { inferThemeKey } from "@/lib/email/themes/catalogue";
import type { ProductKey } from "@/lib/email/themes/types";

export const dynamic = "force-dynamic";

export default async function EmailComposerPage({ params }: { params: { id: string } }) {
  const { repos } = await serverRepositories();
  const campaign = await getCachedCampaign(params.id);
  if (!campaign) notFound();

  // Effective theme first so we can filter the template query.
  const explicit = campaign.themeKey as ProductKey | undefined;
  const inferred = explicit ? undefined : inferThemeKey(campaign.product) ?? undefined;
  const themeKey = explicit ?? inferred;

  // Composer needs full recipient list to preview per-recipient
  // personalization — keep list() here (all workspace buyers can be
  // added). Templates now filtered server-side by theme + approved.
  const [compatibleTemplates, recipients, buyers, assets, currentMaster] =
    await Promise.all([
      repos.templates.listByFilter({
        status: "approved",
        ...(themeKey ? { themeKey } : {}),
      }),
      repos.recipients.listByCampaign(params.id),
      repos.buyers.list(),
      repos.assets.list(),
      campaign.templateId && campaign.templateId !== ""
        ? repos.templates.get(campaign.templateId)
        : Promise.resolve(undefined),
    ]);

  return (
    <EmailComposerView
      campaign={campaign}
      compatibleTemplates={compatibleTemplates}
      currentMaster={currentMaster ?? undefined}
      knownTheme={themeKey && themeKey in PRODUCT_THEMES ? themeKey : undefined}
      recipients={recipients}
      buyers={buyers}
      assets={assets}
    />
  );
}
