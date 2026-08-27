import { SkeletonTable } from "@/components/ui/Skeleton";

/**
 * Loads INSIDE the campaign layout — the header + tabs stripe is
 * already rendered by [id]/layout.tsx, so this only fills the body slot.
 */
export default function CampaignRecipientsLoading() {
  return <SkeletonTable rows={10} columns={5} />;
}
