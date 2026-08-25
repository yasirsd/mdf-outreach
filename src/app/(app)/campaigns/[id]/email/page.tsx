import { notFound } from "next/navigation";
import { serverRepositories } from "@/lib/repositories/server";
import { EmailComposerView } from "./EmailComposerView";
import { PRODUCT_THEMES } from "@/lib/email/themes/registry";
import { inferThemeKey } from "@/lib/email/themes/catalogue";
import type { ProductKey } from "@/lib/email/themes/types";

export const dynamic = "force-dynamic";

export default async function EmailComposerPage({ params }: { params: { id: string } }) {
  const { repos } = await serverRepositories();
  const campaign = await repos.campaigns.get(params.id);
  if (!campaign) notFound();

  const [allTemplates, recipients, buyers, assets] = await Promise.all([
    repos.templates.list(),
    repos.recipients.listByCampaign(params.id),
    repos.buyers.list(),
    repos.assets.list(),
  ]);

  // Effective theme: explicit on the campaign, or inferred from the free-text
  // product name for legacy campaigns created before the theme_key column
  // existed. Never invents an association when the product name is unrecognised.
  const explicit = campaign.themeKey as ProductKey | undefined;
  const inferred = explicit ? undefined : inferThemeKey(campaign.product) ?? undefined;
  const themeKey = explicit ?? inferred;

  // Compatible masters: same product family only. When we have no theme at
  // all, we surface all approved masters so the operator can pick anything.
  const compatibleTemplates = themeKey
    ? allTemplates.filter((t) => t.themeKey === themeKey && t.status === "approved")
    : allTemplates.filter((t) => t.status === "approved");

  const currentMaster =
    campaign.templateId && campaign.templateId !== ""
      ? await repos.templates.get(campaign.templateId)
      : null;

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
