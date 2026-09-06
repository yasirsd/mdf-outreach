import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BuyerCandidateContact } from "@/lib/buyerFinder/types";
import type { CandidateDetailRecord } from "@/app/(app)/buyer-finder/actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/app/(app)/buyer-finder/actions", () => ({
  approveCandidateAction: vi.fn(),
  archiveCandidateAction: vi.fn(),
  rejectCandidateAction: vi.fn(),
}));

vi.mock("@/app/(app)/buyer-finder/personActions", () => ({
  findCandidateDecisionMakersAction: vi.fn(),
}));

vi.mock("@/app/(app)/buyer-finder/publicContactActions", () => ({
  findCandidatePublicCompanyContactsAction: vi.fn(),
}));

vi.mock("@/app/(app)/buyer-finder/revealActions", () => ({
  revealCandidatePersonalContactAction: vi.fn(),
}));

vi.mock("@/app/(app)/buyer-finder/conversionActions", () => ({
  previewCandidateConversionAction: vi.fn(),
  convertCandidateToBuyerAction: vi.fn(),
}));

import { CandidateView } from "./CandidateView";
import { findCandidateDecisionMakersAction } from "@/app/(app)/buyer-finder/personActions";
import { approveCandidateAction } from "@/app/(app)/buyer-finder/actions";
import {
  convertCandidateToBuyerAction,
  previewCandidateConversionAction,
} from "@/app/(app)/buyer-finder/conversionActions";

afterEach(() => cleanup());

const HUNTER_EVIDENCE = [
  {
    note: "Hunter Discover company match. Country United Arab Emirates (AE). Directory match only — not proof of import or distribution.",
    confidence: 40,
  },
];

function hunterRecord(over?: Partial<CandidateDetailRecord>): CandidateDetailRecord {
  return {
    candidate: {
      id: "00000000-0000-4000-8000-0000000000aa",
      companyName: "Mahmood & Sons",
      website: "https://mahmoodsons.com",
      domain: "mahmoodsons.com",
      country: "United Arab Emirates",
      source: "hunter",
      companyScore: 23,
      evidence: HUNTER_EVIDENCE,
      discoveryStatus: "ready",
      reviewStatus: "pending",
    },
    contacts: [],
    productMatches: [
      {
        id: "00000000-0000-4000-8000-0000000000bb",
        candidateId: "00000000-0000-4000-8000-0000000000aa",
        productId: "guntur-dry-red-chilli",
        relevance: 50,
        evidence: HUNTER_EVIDENCE,
        source: "hunter",
      },
    ],
    ...over,
  };
}

describe("CandidateView provenance and score copy", () => {
  it("renders Source · Hunter for a persisted hunter row", () => {
    render(<CandidateView record={hunterRecord()} />);
    expect(screen.getByText("Source · Hunter")).toBeTruthy();
    expect(screen.queryByText(/Source · mock/i)).toBeNull();
  });

  it("does not present directory placeholder as 50% relevance", () => {
    render(<CandidateView record={hunterRecord()} />);
    expect(screen.getByText("Directory signal")).toBeTruthy();
    expect(screen.queryByText(/50% relevance/)).toBeNull();
  });

  it("distinguishes overall score from unevaluated contact quality", () => {
    render(<CandidateView record={hunterRecord()} />);
    expect(screen.getByText(/Overall 23/)).toBeTruthy();
    expect(screen.getByText(/Company fit 23/)).toBeTruthy();
    expect(screen.getByText("Contact quality not evaluated")).toBeTruthy();
    expect(screen.queryByText(/Buyer 23/)).toBeNull();
  });

  it("does not display Hunter directory Confidence 40%", () => {
    render(<CandidateView record={hunterRecord()} />);
    expect(screen.queryByText(/Confidence 40%/)).toBeNull();
    expect(screen.getByText(/Directory match only/)).toBeTruthy();
  });

  it("shows Find decision makers · Free before person search", () => {
    render(<CandidateView record={hunterRecord()} />);
    expect(screen.getByText("Decision makers have not been searched yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Find decision makers · Free/ })).toBeTruthy();
    expect(screen.getByText(/No contact credits are used/)).toBeTruthy();
  });

  it("relabels the free people search as refresh after a completed search", () => {
    render(
      <CandidateView
        record={hunterRecord({
          candidate: {
            ...hunterRecord().candidate,
            peopleSearchedAt: "2026-08-01T00:00:00.000Z",
          },
        })}
      />,
    );
    expect(screen.getByRole("button", { name: /Refresh decision makers · Free/ })).toBeTruthy();
  });

  it("shows Retry now when the auto job failed", () => {
    render(<CandidateView record={hunterRecord()} peopleJobStatus="failed" />);
    expect(screen.getByRole("button", { name: /Retry now/ })).toBeTruthy();
  });

  it("disables repeat click while the search is pending", async () => {
    vi.mocked(findCandidateDecisionMakersAction).mockImplementation(() => new Promise(() => {}));
    render(<CandidateView record={hunterRecord()} />);
    fireEvent.click(screen.getByRole("button", { name: /Find decision makers · Free/ }));
    await waitFor(() => {
      const button = screen.getByRole("button", { name: /Searching/ });
      expect(button.hasAttribute("disabled")).toBe(true);
    });
    expect(findCandidateDecisionMakersAction).toHaveBeenCalledTimes(1);
    expect(findCandidateDecisionMakersAction).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-0000000000aa",
    );
  });

  it("shows a calm no-result state after an empty search", () => {
    render(
      <CandidateView
        record={hunterRecord({
          candidate: {
            ...hunterRecord().candidate,
            peopleSearchedAt: "2026-08-28T00:00:00.000Z",
          },
        })}
      />,
    );
    expect(screen.getByText("No matching people were found at this company domain.")).toBeTruthy();
    expect(screen.queryByText("Decision makers have not been searched yet.")).toBeNull();
  });

  it("renders masked people with role, contact score, and availability — not fake URLs or emails", () => {
    const people: BuyerCandidateContact[] = [
      {
        id: "00000000-0000-4000-8000-0000000000c1",
        candidateId: "00000000-0000-4000-8000-0000000000aa",
        firstName: "",
        lastName: "",
        fullName: "Amina K.",
        jobTitle: "Head of Procurement",
        businessEmail: "",
        isPrimary: true,
        contactScore: 16,
        department: "finance",
        seniority: "senior",
        isDecisionMaker: true,
        linkedinAvailable: true,
        phoneAvailable: false,
        source: "hunter",
      },
      {
        id: "00000000-0000-4000-8000-0000000000c2",
        candidateId: "00000000-0000-4000-8000-0000000000aa",
        firstName: "",
        lastName: "",
        fullName: "Omar S.",
        jobTitle: "Sales Manager",
        businessEmail: "",
        isPrimary: false,
        contactScore: 6,
        linkedinAvailable: false,
        phoneAvailable: true,
        source: "hunter",
      },
    ];
    render(<CandidateView record={hunterRecord({ contacts: people })} />);
    expect(screen.getByText(/Overall 42/)).toBeTruthy();
    expect(screen.getByText(/Company fit 23/)).toBeTruthy();
    expect(screen.getByText(/Candidate contact quality 19/)).toBeTruthy();
    expect(screen.queryByText("Best role: Head of Procurement")).toBeNull();
    expect(screen.getByText("Amina K.")).toBeTruthy();
    expect(screen.getByText("Head of Procurement")).toBeTruthy();
    expect(screen.getByText("Decision maker")).toBeTruthy();
    expect(screen.getAllByText(/Not revealed/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("LinkedIn ✓")).toBeTruthy();
    expect(screen.queryByText("Phone Not available")).toBeNull();
    expect(screen.queryByText(/linkedin\.com/i)).toBeNull();
    expect(screen.getAllByText(/Approving does NOT create a Buyer/).length).toBeGreaterThanOrEqual(1);
  });

  it("separates public company email from decision makers and never says verified", () => {
    render(
      <CandidateView
        record={hunterRecord({
          candidate: {
            ...hunterRecord().candidate,
            publicContactsSearchedAt: "2026-08-28T00:00:00.000Z",
            generalEmail: "imports@mahmoodsons.com",
          },
          publicEmails: [
            {
              id: "00000000-0000-4000-8000-0000000000e1",
              candidateId: "00000000-0000-4000-8000-0000000000aa",
              email: "imports@mahmoodsons.com",
              mailboxType: "imports",
              mailboxKind: "corporate",
              source: "company_website",
              sourceUrl: "https://mahmoodsons.com/contact",
              isPrimary: true,
            },
          ],
          contacts: [
            {
              id: "00000000-0000-4000-8000-0000000000c1",
              candidateId: "00000000-0000-4000-8000-0000000000aa",
              firstName: "",
              lastName: "",
              fullName: "Aditee G.",
              jobTitle: "Chief Operating Officer",
              businessEmail: "",
              isPrimary: true,
              contactScore: 7,
              source: "hunter",
            },
          ],
        })}
        publicWebsite="ready"
      />,
    );
    expect(screen.getByText("Free company contact")).toBeTruthy();
    expect(screen.getByText("imports@mahmoodsons.com")).toBeTruthy();
    expect(screen.getByText(/Published on company website · Free/)).toBeTruthy();
    expect(screen.getByText("Decision makers")).toBeTruthy();
    expect(screen.getByText("Aditee G.")).toBeTruthy();
    expect(screen.getByText(/Person contact quality 7/)).toBeTruthy();
    expect(screen.queryByText(/Candidate contact quality 7/)).toBeNull();
    // The public mailbox itself must not be labelled verified. BI1 may
    // independently say that no verified *trade* intelligence exists.
    expect(screen.queryByText(/^Verified$/i)).toBeNull();
    expect(screen.queryByText(/^Contacts$/)).toBeNull();
  });

  it("renders the persisted working website without forcing www", () => {
    render(
      <CandidateView
        record={hunterRecord({
          candidate: {
            ...hunterRecord().candidate,
            domain: "company.com",
            website: "https://www.company.com/",
          },
        })}
      />,
    );
    const link = screen.getByRole("link", { name: /www\.company\.com/ });
    expect(link.getAttribute("href")).toBe("https://www.company.com/");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.textContent).not.toMatch(/^www\.www\./);
  });

  it("promotes the HIGH agri contact over an isPrimary accountant and does not contradict score labels", () => {
    render(
      <CandidateView
        record={hunterRecord({
          candidate: {
            ...hunterRecord().candidate,
            companyName: "KSONS Global",
            generalEmail: "info@ksonsglobal.com",
            publicContactsSearchedAt: "2026-08-28T00:00:00.000Z",
          },
          publicEmails: [
            {
              id: "00000000-0000-4000-8000-0000000000e9",
              candidateId: "00000000-0000-4000-8000-0000000000aa",
              email: "info@ksonsglobal.com",
              mailboxType: "general",
              mailboxKind: "corporate",
              source: "company_website",
              sourceUrl: "https://ksonsglobal.com/contact",
              isPrimary: true,
            },
          ],
          contacts: [
            {
              id: "00000000-0000-4000-8000-0000000000c9",
              candidateId: "00000000-0000-4000-8000-0000000000aa",
              firstName: "",
              lastName: "",
              fullName: "Accounts Team",
              jobTitle: "Accountant",
              businessEmail: "",
              isPrimary: true,
              contactScore: 4,
              source: "hunter",
            },
            {
              id: "00000000-0000-4000-8000-0000000000c8",
              candidateId: "00000000-0000-4000-8000-0000000000aa",
              firstName: "",
              lastName: "",
              fullName: "Chandan G.",
              jobTitle: "Director of Agricultural Commodities",
              businessEmail: "",
              isPrimary: false,
              contactScore: 11,
              isDecisionMaker: true,
              linkedinAvailable: true,
              department: "management",
              seniority: "executive",
              source: "hunter",
              emailType: "personal",
            },
          ],
        })}
        publicWebsite="ready"
        hunterReveal="disabled"
      />,
    );
    expect(screen.getByText("Chandan G.")).toBeTruthy();
    expect(screen.getByText("Director of Agricultural Commodities")).toBeTruthy();
    expect(screen.getByText("High priority")).toBeTruthy();
    expect(screen.getByText("Agricultural commodities / trading leadership")).toBeTruthy();
    expect(screen.getByText("info@ksonsglobal.com")).toBeTruthy();
    expect(screen.getByText("Accounts Team")).toBeTruthy();
    expect(screen.getByText("Personal email locked")).toBeTruthy();
    expect(screen.getByText("LinkedIn ✓")).toBeTruthy();
    expect(screen.getByText("Directory signal")).toBeTruthy();
    expect(screen.getByText("View discovery details")).toBeTruthy();
    expect(screen.getByText("Scoring details")).toBeTruthy();
    expect(screen.getByText(/Approving does NOT create a Buyer/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve for Buyer review" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review personal reveal" })).toBeNull();
    expect(screen.queryByText(/Role score/)).toBeNull();
    expect(screen.getByText(/Person contact quality 11/)).toBeTruthy();
    expect(screen.queryByText(/Candidate contact quality 11/)).toBeNull();
    expect(approveCandidateAction).not.toHaveBeenCalled();
  });
});

describe("BF5A conversion UX", () => {
  it("does not show Convert to Buyer on a pending candidate", () => {
    render(<CandidateView record={hunterRecord()} />);
    expect(screen.queryByRole("button", { name: "Convert to Buyer" })).toBeNull();
    expect(screen.queryByText("READY FOR BUYER CONVERSION")).toBeNull();
    expect(screen.getByRole("button", { name: "Approve for Buyer review" })).toBeTruthy();
  });

  it("opens a preview on Convert to Buyer for a public-company-email flow and does not create a Buyer", async () => {
    const PUB_ID = "00000000-0000-4000-8000-0000000000e1";
    vi.mocked(previewCandidateConversionAction).mockResolvedValue({
      eligibility: "ok",
      candidateId: "00000000-0000-4000-8000-0000000000aa",
      companyName: "Mahmood & Sons",
      country: "United Arab Emirates",
      mapping: {
        firstName: "",
        lastName: "",
        company: "Mahmood & Sons",
        email: "info@mahmoodsons.com",
        country: "United Arab Emirates",
        source: "Buyer Finder",
      },
      sourceKind: "public_company_email",
      options: [
        {
          kind: "public_company_email",
          publicEmailId: PUB_ID,
          email: "info@mahmoodsons.com",
          selectable: true,
        },
      ],
      selected: { kind: "public_company_email", publicEmailId: PUB_ID },
      duplicate: "none",
      missingEmail: false,
      createBlocked: false,
    });
    render(
      <CandidateView
        record={hunterRecord({
          candidate: { ...hunterRecord().candidate, reviewStatus: "approved" },
          publicEmails: [
            {
              id: PUB_ID,
              candidateId: "00000000-0000-4000-8000-0000000000aa",
              email: "info@mahmoodsons.com",
              mailboxType: "general",
              mailboxKind: "corporate",
              source: "company_website",
              sourceUrl: "https://mahmoodsons.com",
              isPrimary: true,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("READY FOR BUYER CONVERSION")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve for Buyer review" })).toBeNull();
    expect(screen.queryByText(/Approving does NOT create a Buyer/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Convert to Buyer" }));
    await waitFor(() => {
      expect(previewCandidateConversionAction).toHaveBeenCalledWith({
        candidateId: "00000000-0000-4000-8000-0000000000aa",
        contactId: undefined,
        publicEmailId: undefined,
      });
    });
    expect(convertCandidateToBuyerAction).not.toHaveBeenCalled();
    expect(approveCandidateAction).not.toHaveBeenCalled();
    expect(screen.getByText("Creates one Buyer in MDF Outreach. No email will be sent.")).toBeTruthy();
  });

  // BF5B-final — an approved Candidate with no revealed personal email and
  // no public company email must show the "Needs contact" state, not a
  // Convert button. Buyer creation is impossible without an email.
  it("shows NEEDS CONTACT and hides Convert when an approved Candidate has no usable email", () => {
    vi.mocked(previewCandidateConversionAction).mockClear();
    vi.mocked(convertCandidateToBuyerAction).mockClear();
    render(
      <CandidateView
        record={hunterRecord({
          candidate: { ...hunterRecord().candidate, reviewStatus: "approved" },
          contacts: [],
          publicEmails: [],
        })}
      />,
    );
    expect(screen.getByText("NEEDS CONTACT")).toBeTruthy();
    expect(
      screen.getByText(/A valid email is required before Mahmood & Sons can become an Outreach Buyer/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve for Buyer review" })).toBeNull();
    expect(screen.queryByText(/Approving does NOT create a Buyer/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Convert to Buyer" })).toBeNull();
    expect(screen.queryByText("READY FOR BUYER CONVERSION")).toBeNull();
    expect(convertCandidateToBuyerAction).not.toHaveBeenCalled();
    expect(previewCandidateConversionAction).not.toHaveBeenCalled();
  });

  it("shows converted state with Open Buyer and without Convert", () => {
    render(
      <CandidateView
        record={hunterRecord({
          candidate: { ...hunterRecord().candidate, reviewStatus: "approved" },
          conversion: {
            id: "00000000-0000-4000-8000-0000000000ff",
            candidateId: "00000000-0000-4000-8000-0000000000aa",
            buyerId: "00000000-0000-4000-8000-0000000000b1",
            sourceKind: "company_only",
            createdAt: "2026-08-31T00:00:00.000Z",
          },
          convertedBuyer: {
            id: "00000000-0000-4000-8000-0000000000b1",
            email: "info@mahmoodsons.com",
            company: "Mahmood & Sons",
          },
        })}
      />,
    );
    expect(screen.getByText("CONVERTED TO BUYER")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Buyer" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Convert to Buyer" })).toBeNull();
    expect(screen.getByText("Directory signal")).toBeTruthy();
    expect(approveCandidateAction).not.toHaveBeenCalled();
  });

  // BF5B — after conversion, the redundant Approve/Reject actions and the
  // approval helper copy must be hidden. Archive remains available because
  // it only archives the research record; it does not touch the linked
  // Buyer. The Open Buyer link uses the exact ?buyerId=<uuid> route.
  it("hides Approve/Reject and the approval hint on a converted candidate; Archive stays", () => {
    const BUYER_ID = "00000000-0000-4000-8000-0000000000b1";
    render(
      <CandidateView
        record={hunterRecord({
          candidate: { ...hunterRecord().candidate, reviewStatus: "approved" },
          conversion: {
            id: "00000000-0000-4000-8000-0000000000ff",
            candidateId: "00000000-0000-4000-8000-0000000000aa",
            buyerId: BUYER_ID,
            sourceKind: "company_only",
            createdAt: "2026-08-31T00:00:00.000Z",
          },
          convertedBuyer: {
            id: BUYER_ID,
            email: "",
            company: "Mahmood & Sons",
          },
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: "Approve for Buyer review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    expect(screen.queryByText(/Approving does NOT create a Buyer/)).toBeNull();
    expect(screen.getByRole("button", { name: /Archive/ })).toBeTruthy();
    const openBuyer = screen.getByRole("link", { name: "Open Buyer" });
    expect(openBuyer.getAttribute("href")).toBe(`/buyers?buyerId=${BUYER_ID}`);
    expect(screen.getByText(/Buyer created/)).toBeTruthy();
    expect(approveCandidateAction).not.toHaveBeenCalled();
  });
});
