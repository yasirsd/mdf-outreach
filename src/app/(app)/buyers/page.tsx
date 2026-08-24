import { serverRepositories } from "@/lib/repositories/server";
import { BuyersView } from "./BuyersView";

export const dynamic = "force-dynamic";

export default async function BuyersPage() {
  const { repos } = await serverRepositories();
  const buyers = await repos.buyers.list();
  return <BuyersView initialBuyers={buyers} />;
}
