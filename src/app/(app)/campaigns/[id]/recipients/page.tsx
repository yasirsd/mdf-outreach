import { serverRepositories } from "@/lib/repositories/server";
import { RecipientsView } from "./RecipientsView";

export const dynamic = "force-dynamic";

export default async function RecipientsPage({ params }: { params: { id: string } }) {
  const { repos } = await serverRepositories();
  const [recipients, buyers] = await Promise.all([
    repos.recipients.listByCampaign(params.id),
    repos.buyers.list(),
  ]);
  return <RecipientsView campaignId={params.id} recipients={recipients} buyers={buyers} />;
}
