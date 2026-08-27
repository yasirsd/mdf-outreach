import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getCachedCampaign } from "@/lib/repositories/campaignCache";
import { PageContainer } from "@/components/ui/Page";
import { CampaignHeader } from "@/components/campaigns/CampaignHeader";
import { CampaignTabs } from "@/components/campaigns/CampaignTabs";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Campaign shell — SYNCHRONOUS.
 *
 * Renders the container, the CampaignTabs strip (which only needs
 * campaignId from params — no data fetch) and a Suspense boundary that
 * streams the campaign-dependent header.
 *
 * Making the layout itself synchronous means:
 *   • the tabs are interactive as soon as the layout commits, even
 *     while the header data is still resolving;
 *   • Next.js does NOT need to await this layout before rendering
 *     child `loading.tsx` / page skeletons — the whole shell is
 *     already in place;
 *   • per-child skeletons ([id]/{email,preview,send,recipients,activity}/loading.tsx)
 *     render inside the shell instead of replacing it.
 *
 * The `notFound()` guard still runs — it lives inside the async
 * header component. A missing campaign propagates up to the app-level
 * not-found handling.
 */
export default function CampaignLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  return (
    <PageContainer>
      <Suspense fallback={<CampaignHeaderSkeleton />}>
        <CampaignHeaderAsync id={params.id} />
      </Suspense>
      <CampaignTabs campaignId={params.id} />
      {children}
    </PageContainer>
  );
}

async function CampaignHeaderAsync({ id }: { id: string }) {
  const campaign = await getCachedCampaign(id);
  if (!campaign) notFound();
  return <CampaignHeader campaign={campaign} />;
}

function CampaignHeaderSkeleton() {
  return (
    <div className="mb-6 flex items-start justify-between gap-6" aria-hidden>
      <div className="min-w-0 flex-1">
        <Skeleton height={11} width="14%" />
        <div className="mt-3">
          <Skeleton height={22} width="46%" />
        </div>
        <div className="mt-2">
          <Skeleton height={12} width="30%" />
        </div>
      </div>
      <Skeleton height={26} width={80} />
    </div>
  );
}
