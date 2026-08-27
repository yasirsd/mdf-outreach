import { serverRepositories } from "@/lib/repositories/server";
import { getCachedSettings } from "@/lib/repositories/settingsCache";
import { PageContainer, PageHeader } from "@/components/ui/Page";
import { catalogueByCategory } from "@/lib/email/themes/catalogue";
import { getProductTheme } from "@/lib/email/themes/registry";
import type { ProductKey } from "@/lib/email/themes/types";
import { createDefaultSettings } from "@/lib/workspace/defaults";
import { TemplatesLibrary } from "./TemplatesLibrary";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const { repos } = await serverRepositories();
  // Only approved masters appear in the gallery — filter server-side so
  // draft/archived templates never leave the DB. Settings is cached so
  // any other server component in this request tree shares the read.
  const [templates, assets, settings] = await Promise.all([
    repos.templates.listByFilter({ status: "approved" }),
    repos.assets.list(),
    getCachedSettings(),
  ]);
  const effectiveSettings = settings ?? { ...createDefaultSettings(), onboardingComplete: true };
  const assetsBySlot = Object.fromEntries(assets.map((a) => [a.slot, a]));

  const catalog = catalogueByCategory();
  const groups = catalog.map((cat) => ({
    category: cat.category,
    products: cat.products.map((p) => {
      const key = p.key as ProductKey;
      const signature = templates.find((t) => t.themeKey === key && t.variant === "signature");
      const direct = templates.find((t) => t.themeKey === key && t.variant === "direct");
      return { theme: getProductTheme(key), signature, direct };
    }),
  }));

  const uncategorised = templates.filter(
    (t) => !t.themeKey || !t.variant || !catalog.some((cat) => cat.products.some((p) => p.key === t.themeKey)),
  );

  return (
    <PageContainer size="wide">
      <PageHeader
        title="MDF Creative Library"
        subtitle="MDF's approved email designs. Each product family has a Signature (rich storytelling) and Direct (procurement-focused) master."
      />
      <TemplatesLibrary
        groups={groups}
        uncategorised={uncategorised}
        settings={effectiveSettings}
        assetsBySlot={assetsBySlot}
      />
    </PageContainer>
  );
}
