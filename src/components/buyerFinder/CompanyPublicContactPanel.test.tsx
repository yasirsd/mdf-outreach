import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CompanyPublicContactPanel } from "./CompanyPublicContactPanel";
import type { BuyerCandidatePublicEmail } from "@/lib/buyerFinder/types";

const run = vi.fn();
vi.mock("@/app/(app)/buyer-finder/publicContactActions", () => ({
  findCandidatePublicCompanyContactsAction: (...args: unknown[]) => run(...args),
}));

afterEach(() => {
  cleanup();
  run.mockReset();
});

const CANDIDATE_ID = "00000000-0000-4000-8000-0000000000aa";

const primary: BuyerCandidatePublicEmail = {
  id: "00000000-0000-4000-8000-0000000000e1",
  candidateId: CANDIDATE_ID,
  email: "imports@example.com",
  mailboxType: "imports",
  mailboxKind: "corporate",
  source: "company_website",
  sourceUrl: "https://example.com/contact",
  isPrimary: true,
};

const extra: BuyerCandidatePublicEmail = {
  id: "00000000-0000-4000-8000-0000000000e2",
  candidateId: CANDIDATE_ID,
  email: "sales@example.com",
  mailboxType: "sales",
  mailboxKind: "corporate",
  source: "company_website",
  sourceUrl: "https://example.com/contact",
  isPrimary: false,
};

function renderPanel(
  over?: Partial<Parameters<typeof CompanyPublicContactPanel>[0]>,
) {
  return render(
    <CompanyPublicContactPanel
      candidateId={CANDIDATE_ID}
      emails={[]}
      publicWebsite="ready"
      canSearch
      onComplete={vi.fn()}
      onError={vi.fn()}
      {...over}
    />,
  );
}

describe("CompanyPublicContactPanel", () => {
  it("shows the not-searched state", () => {
    renderPanel();
    expect(screen.getByText("Not searched yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Find public company contacts · Free/ })).toBeTruthy();
    expect(screen.getByText(/No credits used/)).toBeTruthy();
    expect(screen.queryByText(/Verified/i)).toBeNull();
  });

  it("shows a successful primary email with a safe source link", () => {
    renderPanel({
      emails: [primary, extra],
      searchedAt: "2026-08-28T00:00:00.000Z",
    });
    expect(screen.getByText("imports@example.com")).toBeTruthy();
    expect(screen.getByText(/Published on company website · Free/)).toBeTruthy();
    const link = screen.getByRole("link", { name: /View source/ });
    expect(link.getAttribute("href")).toBe("https://example.com/contact");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByText("sales@example.com")).toBeTruthy();
    expect(screen.queryByText(/Verified/i)).toBeNull();
  });

  it("does not render javascript or credentialed source URLs", () => {
    renderPanel({
      emails: [{ ...primary, sourceUrl: "javascript:alert(1)" }],
      searchedAt: "2026-08-28T00:00:00.000Z",
    });
    expect(screen.queryByRole("link", { name: /View source/ })).toBeNull();
  });

  it("bounds alternatives", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      ...extra,
      id: `00000000-0000-4000-8000-0000000000e${i + 2}`,
      email: `alt${i}@example.com`,
    }));
    renderPanel({ emails: [primary, ...many], searchedAt: "2026-08-28T00:00:00.000Z" });
    expect(screen.getAllByText(/@example.com/).length).toBeLessThanOrEqual(5);
  });

  it("shows the no-result state", () => {
    renderPanel({ emails: [], searchedAt: "2026-08-28T00:00:00.000Z" });
    expect(screen.getByText("No public company email found")).toBeTruthy();
    expect(screen.getByText(/Checked company website · No credits used/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Check again/ })).toBeTruthy();
  });

  it("passes only candidateId on click", async () => {
    run.mockImplementation(() => new Promise(() => {}));
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Find public company contacts · Free/ }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run).toHaveBeenCalledWith(CANDIDATE_ID);
  });

  it("shows the incomplete lookup state without claiming no email was found", async () => {
    run.mockResolvedValue({
      outcome: "incomplete",
      message: "Some website pages could not be checked.",
      discovered: 0,
      persisted: 0,
      updatedExisting: 0,
      pagesFetched: 1,
      emails: [],
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Find public company contacts · Free/ }));
    await waitFor(() => expect(screen.getByText("Lookup incomplete")).toBeTruthy());
    expect(screen.getByText(/Some public website pages could not be checked/)).toBeTruthy();
    expect(screen.getByText(/No credits used/)).toBeTruthy();
    expect(screen.queryByText("No public company email found")).toBeNull();
    expect(screen.getByRole("button", { name: /Check again/ })).toBeTruthy();
  });

  it("relabels a failed auto job as Retry now", () => {
    renderPanel({ jobStatus: "failed" });
    expect(screen.getByRole("button", { name: /Retry now/ })).toBeTruthy();
  });
});
