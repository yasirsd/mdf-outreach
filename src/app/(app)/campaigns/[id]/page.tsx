import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Send, Eye, FileText, Users } from "lucide-react";
import { serverRepositories } from "@/lib/repositories/server";
import { inferThemeKey, themeForKey } from "@/lib/email/themes/catalogue";

export const dynamic = "force-dynamic";

export default async function CampaignOverviewPage({ params }: { params: { id: string } }) {
  const { repos } = await serverRepositories();
  const campaign = await repos.campaigns.get(params.id);
  if (!campaign) notFound();
  const [recipients, master, buyers] = await Promise.all([
    repos.recipients.listByCampaign(params.id),
    campaign.templateId ? repos.templates.get(campaign.templateId) : Promise.resolve(undefined),
    repos.buyers.list(),
  ]);

  const byId = new Map(buyers.map((b) => [b.id, b]));
  const recBuyers = recipients.map((r) => byId.get(r.buyerId)).filter(Boolean);
  const readyCount = recBuyers.filter(
    (b) =>
      !!b &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email) &&
      !!b.firstName &&
      !!b.company,
  ).length;

  const effectiveThemeKey =
    campaign.themeKey ?? inferThemeKey(campaign.product) ?? undefined;
  const theme = themeForKey(effectiveThemeKey);
  const hasTemplate = !!campaign.emailSections?.length;
  const templateLabel = hasTemplate
    ? `${theme?.name ?? campaign.product} — ${campaign.templateVariant === "direct" ? "Direct" : "Signature"}`
    : "Not chosen yet";

  return (
    <div>
      <div className="grid md:grid-cols-4 gap-3 mb-8">
        <Metric label="Recipients" value={recipients.length} />
        <Metric label="Ready" value={readyCount} accent />
        <Metric label="Template" value={templateLabel} textMode />
        <Metric label="Subject" value={campaign.subject || "—"} textMode />
      </div>

      {!hasTemplate && (
        <div
          className="rounded-[14px] p-6 mb-6 flex items-center justify-between gap-4 flex-wrap"
          style={{
            backgroundColor: "rgba(243,107,33,0.06)",
            border: "1px solid rgba(243,107,33,0.24)",
          }}
        >
          <div>
            <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange font-medium">
              Next step
            </div>
            <div className="mt-1 text-[14px] text-text-primary font-medium">
              Choose an email template for this campaign.
            </div>
            <div className="text-[12.5px] text-text-secondary mt-0.5">
              Only templates compatible with{" "}
              <strong className="text-text-primary">{theme?.name ?? campaign.product}</strong> will
              be shown.
            </div>
          </div>
          <Link href={`/campaigns/${params.id}/email`} className="btn-primary">
            Choose template
          </Link>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <QuickCard
          href={`/campaigns/${params.id}/recipients`}
          icon={<Users size={15} className="text-brand-orange" />}
          title="Choose recipients"
          body={`${recipients.length} buyer${recipients.length === 1 ? "" : "s"} in this campaign.`}
        />
        <QuickCard
          href={`/campaigns/${params.id}/email`}
          icon={<FileText size={15} className="text-brand-orange" />}
          title={hasTemplate ? "Edit the campaign email" : "Choose a template"}
          body={
            hasTemplate
              ? `Editing ${master?.name ?? "the campaign email"}. The master library is untouched.`
              : "Signature or Direct — pick the approach for this outreach."
          }
        />
        <QuickCard
          href={`/campaigns/${params.id}/preview`}
          icon={<Eye size={15} className="text-brand-orange" />}
          title="Preview desktop & mobile"
          body="Distraction-free preview with subject and preheader."
        />
        <QuickCard
          href={`/campaigns/${params.id}/send`}
          icon={<Send size={15} className="text-brand-orange" />}
          title="Prepare & simulate send"
          body="Validate personalization, HTML, plain text, and asset readiness."
        />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
  textMode,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
  textMode?: boolean;
}) {
  return (
    <div className="metric-card">
      <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium">
        {label}
      </div>
      {textMode ? (
        <div className="mt-2 text-[13px] text-text-primary leading-snug line-clamp-2">{value}</div>
      ) : (
        <div
          className="mt-2 text-[26px] font-semibold tracking-tight tabular-nums"
          style={{ color: accent ? "var(--brand-orange)" : "var(--text-primary)" }}
        >
          {value}
        </div>
      )}
    </div>
  );
}

function QuickCard({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-[12px] p-5 flex items-start gap-3 transition-colors duration-180 focus-ring-quiet"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
    >
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1">
        <div className="text-[13.5px] font-medium text-text-primary">{title}</div>
        <div className="text-[12px] text-text-secondary mt-1 leading-relaxed">{body}</div>
      </div>
      <ArrowRight
        size={14}
        className="text-text-muted mt-0.5 group-hover:text-text-primary group-hover:translate-x-0.5 transition-all"
      />
    </Link>
  );
}
