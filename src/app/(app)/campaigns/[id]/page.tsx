import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Send, Eye, FileText, Users } from "lucide-react";
import { serverRepositories } from "@/lib/repositories/server";

export const dynamic = "force-dynamic";

export default async function CampaignOverviewPage({ params }: { params: { id: string } }) {
  const { repos } = await serverRepositories();
  const campaign = await repos.campaigns.get(params.id);
  if (!campaign) notFound();
  const [recipients, template, buyers] = await Promise.all([
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

  return (
    <div>
      <div className="grid md:grid-cols-4 gap-3 mb-10">
        <Metric label="Recipients" value={recipients.length} />
        <Metric label="Ready" value={readyCount} accent />
        <Metric label="Template" value={template?.name ?? "—"} textMode />
        <Metric label="Subject" value={campaign.subject || "—"} textMode />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <QuickCard
          href={`/campaigns/${params.id}/recipients`}
          icon={<Users size={16} className="text-brand-orange" />}
          title="Choose recipients"
          body={`${recipients.length} buyer${recipients.length === 1 ? "" : "s"} in this campaign.`}
        />
        <QuickCard
          href={`/campaigns/${params.id}/email`}
          icon={<FileText size={16} className="text-brand-orange" />}
          title="Design the email"
          body="Refine the template and preview it as any buyer."
        />
        <QuickCard
          href={`/campaigns/${params.id}/preview`}
          icon={<Eye size={16} className="text-brand-orange" />}
          title="Preview desktop & mobile"
          body="Distraction-free preview with subject and preheader."
        />
        <QuickCard
          href={`/campaigns/${params.id}/send`}
          icon={<Send size={16} className="text-brand-orange" />}
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
      <div className="text-[10.5px] tracking-[0.14em] uppercase text-brand-muted">{label}</div>
      {textMode ? (
        <div className="mt-2 text-[14px] text-brand-charcoal leading-snug line-clamp-2">{value}</div>
      ) : (
        <div
          className={`mt-2 font-serif text-[32px] tracking-[-0.02em] ${accent ? "text-brand-orange" : "text-brand-charcoal"}`}
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
      className="group card p-6 hover:border-brand-charcoal/25 hover:shadow-card transition-all flex items-start gap-3"
    >
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1">
        <div className="text-[15px] font-medium text-brand-charcoal">{title}</div>
        <div className="text-[13px] text-brand-muted mt-1 leading-relaxed">{body}</div>
      </div>
      <ArrowRight
        size={16}
        className="text-brand-charcoal/30 mt-0.5 group-hover:text-brand-charcoal group-hover:translate-x-0.5 transition-all"
      />
    </Link>
  );
}
