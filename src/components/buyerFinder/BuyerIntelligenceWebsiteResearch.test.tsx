import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/ui/Toast", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("@/app/(app)/buyer-finder/websiteIntelligenceActions", () => ({
  researchCandidateWebsiteAction: vi.fn(),
}));

import { BuyerIntelligenceWebsiteResearch } from "./BuyerIntelligenceWebsiteResearch";
import { researchCandidateWebsiteAction } from "@/app/(app)/buyer-finder/websiteIntelligenceActions";

afterEach(() => cleanup());

describe("BI3 BuyerIntelligenceWebsiteResearch — manual action UI", () => {
  it("renders the free-labelled action and helper copy while idle", () => {
    render(<BuyerIntelligenceWebsiteResearch candidateId="00000000-0000-4000-8000-0000000000cc" />);
    expect(screen.getByRole("button", { name: /Research company website · Free/ })).toBeTruthy();
    expect(screen.getByText(/Manual only/)).toBeTruthy();
  });

  it("disables the action when the caller says the candidate has no usable website", () => {
    render(
      <BuyerIntelligenceWebsiteResearch
        candidateId="00000000-0000-4000-8000-0000000000cc"
        canResearch={false}
      />,
    );
    const btn = screen.getByRole("button", { name: /Research company website · Free/ });
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("invokes the server action and surfaces a truthful summary line on completion", async () => {
    vi.mocked(researchCandidateWebsiteAction).mockResolvedValue({
      outcome: "researched",
      message: "Website research complete.",
      pagesFetched: 3,
      claimsCreated: 2,
      claimsExisting: 0,
      claimsConflicting: 0,
      sourcesCreated: 1,
      sourcesExisting: 0,
      pages: [],
    });
    render(<BuyerIntelligenceWebsiteResearch candidateId="00000000-0000-4000-8000-0000000000cc" />);
    fireEvent.click(screen.getByRole("button", { name: /Research company website · Free/ }));
    await waitFor(() =>
      expect(researchCandidateWebsiteAction).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-0000000000cc",
      ),
    );
    await waitFor(() =>
      expect(screen.getByText(/2 business facts recorded · 3 pages checked · No verified trade evidence found/)).toBeTruthy(),
    );
  });
});
