import { serverRepositories } from "@/lib/repositories/server";
import { RecipientsView } from "./RecipientsView";

export const dynamic = "force-dynamic";

export default async function RecipientsPage({ params }: { params: { id: string } }) {
  const { repos } = await serverRepositories();
  // Recipients tab shows a picker of all workspace buyers PLUS the
  // current recipients. We still need the full workspace buyer list
  // here because the operator can add any buyer to the campaign.
  // No consolidation possible without breaking the add-recipient UX.
  const [recipients, buyers] = await Promise.all([
    repos.recipients.listByCampaign(params.id),
    repos.buyers.list(),
  ]);
  return <RecipientsView campaignId={params.id} recipients={recipients} buyers={buyers} />;
}
