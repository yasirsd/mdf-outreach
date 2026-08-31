import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BuyerCandidateContact } from "@/lib/buyerFinder/types";

const reveal = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/app/(app)/buyer-finder/revealActions", () => ({
  revealCandidatePersonalContactAction: (...args: unknown[]) => reveal(...args),
}));

vi.mock("@/components/ui/Toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ContactBlock } from "./ContactBlock";

afterEach(() => {
  cleanup();
  reveal.mockReset();
});

const masked: BuyerCandidateContact = {
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
  emailType: "personal",
};

const revealed: BuyerCandidateContact = {
  ...masked,
  fullName: "Amina Khan",
  businessEmail: "amina@company.com",
  linkedinUrl: "https://www.linkedin.com/in/amina",
  phoneNumber: "+97150000000",
  revealedAt: "2026-08-29T00:00:00.000Z",
};

describe("ContactBlock", () => {
  it("shows masked role, contact score, Not revealed, and availability flags", () => {
    render(<ContactBlock contact={masked} recommended />);
    expect(screen.getByText("Amina K.")).toBeTruthy();
    expect(screen.getByText("Head of Procurement")).toBeTruthy();
    expect(screen.getByText("finance · senior")).toBeTruthy();
    expect(screen.getByText("Decision maker")).toBeTruthy();
    expect(screen.getByText(/Contact quality 16/)).toBeTruthy();
    expect(screen.queryByText(/Role score/)).toBeNull();
    expect(screen.getByText("Not revealed")).toBeTruthy();
    expect(screen.getByText("Email reveal is locked.")).toBeTruthy();
    expect(screen.getByText("LinkedIn Available")).toBeTruthy();
    expect(screen.getByText("Phone Not available")).toBeTruthy();
    expect(screen.queryByText(/linkedin\.com/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Review personal reveal" })).toBeNull();
  });

  it("first click opens confirmation only and does not call the server", () => {
    render(
      <ContactBlock
        contact={masked}
        hunterReveal="ready"
        generalEmail="sales@company.com"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review personal reveal" }));
    expect(screen.getByText(/up to 1 Search credit/i)).toBeTruthy();
    expect(screen.getByText(/Free company email already available: sales@company.com/)).toBeTruthy();
    expect(reveal).not.toHaveBeenCalled();
  });

  it("Cancel closes confirmation without a server call", () => {
    render(<ContactBlock contact={masked} hunterReveal="ready" />);
    fireEvent.click(screen.getByRole("button", { name: "Review personal reveal" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(reveal).not.toHaveBeenCalled();
  });

  it("confirmation triggers one action with contactId only", async () => {
    reveal.mockResolvedValue({
      outcome: "success",
      creditsCharged: 1,
      message: "Contact revealed · 1 Hunter credit used.",
    });
    render(<ContactBlock contact={masked} hunterReveal="ready" />);
    fireEvent.click(screen.getByRole("button", { name: "Review personal reveal" }));
    fireEvent.click(screen.getByRole("button", { name: /Reveal contact · up to 1 credit/ }));
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledWith(masked.id);
  });

  it("shows no free public company email copy when generalEmail is absent", () => {
    render(<ContactBlock contact={masked} hunterReveal="ready" />);
    fireEvent.click(screen.getByRole("button", { name: "Review personal reveal" }));
    expect(screen.getByText("No free public company email found")).toBeTruthy();
  });

  it("renders revealed email, safe LinkedIn, phone, and does not say Not revealed", () => {
    render(<ContactBlock contact={revealed} hunterReveal="ready" />);
    expect(screen.getByText("amina@company.com")).toBeTruthy();
    expect(screen.queryByText("Not revealed")).toBeNull();
    expect(screen.getByText("Hunter · Revealed")).toBeTruthy();
    expect(screen.getByText("+97150000000")).toBeTruthy();
    const link = screen.getByRole("link", { name: /View profile/ });
    expect(link.getAttribute("href")).toBe("https://www.linkedin.com/in/amina");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.queryByRole("button", { name: "Review personal reveal" })).toBeNull();
  });

  it("does not render an unsafe LinkedIn href", () => {
    render(
      <ContactBlock
        contact={{ ...revealed, linkedinUrl: "https://evil-linkedin.example/in/amina" }}
      />,
    );
    expect(screen.queryByRole("link", { name: /View profile/ })).toBeNull();
  });
});
