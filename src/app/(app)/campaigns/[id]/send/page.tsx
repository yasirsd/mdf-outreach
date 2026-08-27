import Link from "next/link";
import { notFound } from "next/navigation";
import { getCachedCampaign } from "@/lib/repositories/campaignCache";
import { getBuyerSendPageDataAction } from "@/app/(app)/campaigns/buyerSendActions";
import { listTestRecipientsAction } from "@/app/(app)/settings/gmailActions";
import { SendView } from "./SendView";

export const dynamic = "force-dynamic";

/**
 * Send page loader — Phase F3 consolidation.
 *
 * All heavy data (campaign, recipients, buyers, assets, settings,
 * Gmail connection, send history, delivery summary) lives inside
 * `getBuyerSendPageDataAction`. The page fetches ONLY:
 *   • the cached campaign (for notFound + gating on template)
 *   • the Buyer Send bundle
 *   • the workspace test-recipient allowlist (independent, small)
 *
 * All duplicate reads from F2 (campaign/template/recipients/buyers/
 * assets/settings/gmail-connection loaded once by page.tsx and again
 * by the bundle) are eliminated because both sides now share React.cache
 * request-scoped resolvers.
 */
export default async function SendPage({ params }: { params: { id: string } }) {
  const campaign = await getCachedCampaign(params.id);
  if (!campaign) notFound();

  const [buyerSendData, testRecipients] = await Promise.all([
    getBuyerSendPageDataAction(params.id).catch(() => null),
    listTestRecipientsAction().catch(() => []),
  ]);

  if (!buyerSendData || !buyerSendData.template) {
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
      campaign={buyerSendData.campaign}
      template={buyerSendData.template}
      recipients={buyerSendData.recipients}
      buyers={Object.values(buyerSendData.buyersById)}
      assets={buyerSendData.assets}
      gmailSummary={{
        connected: buyerSendData.gmailConnected,
        email: buyerSendData.gmailSenderEmail ?? undefined,
      }}
      testRecipients={testRecipients}
      buyerSendData={buyerSendData}
    />
  );
}
