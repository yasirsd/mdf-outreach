import { serverRepositories } from "@/lib/repositories/server";
import { RecipientsView } from "./RecipientsView";

export const dynamic = "force-dynamic";

export default async function RecipientsPage({ params }: { params: { id: string } }) {
  const { repos } = await serverRepositories();
  // F9 — Only the actual recipients + their buyer records are loaded
  // eagerly. The "Add buyers" modal uses a bounded server search
  // (searchAvailableRecipientsAction) instead of downloading every
  // workspace buyer.
  const recipients = await repos.recipients.listByCampaign(params.id);
  const buyerIds = recipients.map((r) => r.buyerId);
  const buyers = await repos.buyers.listByIds(buyerIds);
  return <RecipientsView campaignId={params.id} recipients={recipients} buyers={buyers} />;
}
