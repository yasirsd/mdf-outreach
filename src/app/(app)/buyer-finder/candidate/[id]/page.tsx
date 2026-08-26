import Link from "next/link";
import { PageContainer, PageHeader } from "@/components/ui/Page";
import { getMockCandidate } from "@/lib/buyerFinder/mock/candidates";
import { CandidateView } from "./CandidateView";

export default function CandidatePage({ params }: { params: { id: string } }) {
  const record = getMockCandidate(params.id);
  if (!record) {
    return (
      <PageContainer>
        <PageHeader title="Candidate not found" subtitle="This mock candidate is not in the local sample set." />
        <Link href="/buyer-finder" className="btn-secondary">
          Back to Buyer Finder
        </Link>
      </PageContainer>
    );
  }
  return <CandidateView record={record} />;
}
