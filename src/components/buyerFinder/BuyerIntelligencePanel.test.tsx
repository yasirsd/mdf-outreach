import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BuyerIntelligencePanel } from "./BuyerIntelligencePanel";
import {
  controlledBuyerIntelligenceViewModel,
} from "@/lib/buyerIntelligence/testUtils/fixtures";
import { emptyBuyerIntelligenceViewModel } from "@/lib/buyerIntelligence/viewModel";

afterEach(() => cleanup());

describe("BuyerIntelligencePanel", () => {
  it("renders a neutral empty state and keeps Candidate intelligence separate from conversion", () => {
    render(
      <BuyerIntelligencePanel
        model={emptyBuyerIntelligenceViewModel({ contacts: [], publicEmails: [] })}
      />,
    );
    expect(screen.getByText("No verified trade intelligence yet.")).toBeTruthy();
    expect(screen.getByText("No evidence found")).toBeTruthy();
    expect(screen.getByText("Insufficient evidence")).toBeTruthy();
    expect(screen.getByText("Needs review")).toBeTruthy();
    expect(screen.getByText("Company only")).toBeTruthy();
    expect(screen.getByText(/remains separate from Buyer conversion/i)).toBeTruthy();
  });

  it("renders deterministic overview metrics from controlled fixtures", () => {
    render(<BuyerIntelligencePanel model={controlledBuyerIntelligenceViewModel()} />);
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.getByText("Jul 10, 2026")).toBeTruthy();
    expect(screen.getByText("1 of 2 (50%)")).toBeTruthy();
    expect(screen.getByText("2 verified trade")).toBeTruthy();
    expect(screen.getByText("1 business evidence")).toBeTruthy();
  });

  it("shows company-specific trade rows and provenance without making provider calls", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<BuyerIntelligencePanel model={controlledBuyerIntelligenceViewModel()} />);

    fireEvent.click(screen.getByRole("tab", { name: "Trade Intelligence" }));
    expect(screen.getByText("IN → AE")).toBeTruthy();
    expect(screen.getByText("Dried red chilli whole")).toBeTruthy();
    expect(screen.getAllByText("HS 090421")).toHaveLength(2);
    expect(screen.getAllByText("Verified trade").length).toBe(2);

    fireEvent.click(screen.getByRole("tab", { name: "Sources" }));
    expect(screen.getByText("controlled-trade-fixture")).toBeTruthy();
    expect(screen.getByText("company-website")).toBeTruthy();
    expect(screen.getByText("TRADE-FIXTURE-001", { exact: false })).toBeTruthy();
    expect(screen.queryByText(/fixture:trade:/)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
