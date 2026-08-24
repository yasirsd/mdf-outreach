import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { serverRepositories } from "@/lib/repositories/server";
import { PageContainer, PageHeader } from "@/components/ui/Page";
import { EmailPreviewFrame } from "@/components/email/EmailPreviewFrame";
import { renderEmailHtml } from "@/lib/email/renderer";
import { createDefaultSettings } from "@/lib/workspace/defaults";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const { repos } = await serverRepositories();
  const [templates, assets, campaigns, settings] = await Promise.all([
    repos.templates.list(),
    repos.assets.list(),
    repos.campaigns.list(),
    repos.settings.get(),
  ]);
  const effectiveSettings = settings ?? { ...createDefaultSettings(), onboardingComplete: true };
  const assetsBySlot = Object.fromEntries(assets.map((a) => [a.slot, a]));

  return (
    <PageContainer>
      <PageHeader
        title="Templates"
        subtitle="Editable email templates for MDF outreach. Open a template to edit it inside a campaign."
      />

      <div className="grid md:grid-cols-2 gap-6">
        {templates.map((t) => {
          const html = renderEmailHtml({
            template: t,
            buyer: null,
            settings: effectiveSettings,
            assetsBySlot,
          });
          const linkedCampaign = campaigns.find((c) => c.templateId === t.id);
          const editHref = linkedCampaign ? `/campaigns/${linkedCampaign.id}/email` : "/campaigns";
          return (
            <div key={t.id} className="card overflow-hidden group">
              <div className="p-6 pb-4">
                <div className="text-[11px] tracking-[0.16em] uppercase text-brand-orange">
                  {t.label ?? "Template"}
                </div>
                <div className="mt-2 font-serif text-[22px] tracking-[-0.015em] text-brand-charcoal">
                  {t.name}
                </div>
              </div>
              <div className="bg-brand-canvas h-[280px] overflow-hidden border-t border-brand-border">
                <div className="scale-[0.5] origin-top-left w-[200%] h-[560px] pointer-events-none">
                  <EmailPreviewFrame html={html} width="100%" minHeight={560} />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-brand-border flex items-center justify-between">
                <div className="text-[12px] text-brand-muted">MDF Master template</div>
                <Link
                  href={editHref}
                  className="text-[13px] text-brand-charcoal hover:text-brand-orange inline-flex items-center gap-1"
                >
                  Open in campaign <ArrowRight size={13} />
                </Link>
              </div>
            </div>
          );
        })}
        {templates.length === 0 && (
          <div className="card p-14 text-center col-span-full">
            <div className="text-[11px] tracking-[0.16em] uppercase text-brand-orange mb-3">Empty</div>
            <div className="font-serif text-[24px] text-brand-charcoal">No templates yet.</div>
            <div className="mt-2 text-brand-muted text-[13.5px]">
              Templates are created and edited inside a campaign.
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
