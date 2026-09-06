import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import { QueueView, type QueueRowInput } from "./QueueView";

afterEach(() => cleanup());

function makeCandidate(over: Partial<BuyerCandidate> = {}): BuyerCandidate {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    companyName: "Alpha",
    country: "Kuwait",
    discoveryStatus: "ready",
    reviewStatus: "pending",
    ...over,
  };
}

function row(over: Partial<QueueRowInput> = {}): QueueRowInput {
  return {
    candidate: makeCandidate(),
    productMatches: [],
    contactCount: 0,
    ...over,
  };
}

describe("BF5B QueueView — Converted filter", () => {
  it("hides converted candidates from the default All view and lists only converted ones under Converted", () => {
    const rows: QueueRowInput[] = [
      row({
        candidate: makeCandidate({
          id: "00000000-0000-4000-8000-00000000a001",
          companyName: "Natureland",
          reviewStatus: "approved",
        }),
        convertedBuyerId: "00000000-0000-4000-8000-0000000000b1",
      }),
      row({
        candidate: makeCandidate({
          id: "00000000-0000-4000-8000-00000000a002",
          companyName: "Pending Co",
        }),
      }),
    ];
    render(<QueueView rows={rows} />);
    // All view — both companies remain in history (converted rows are
    // NOT removed from All).
    expect(screen.getByText("Natureland")).toBeTruthy();
    expect(screen.getByText("Pending Co")).toBeTruthy();

    // Switch to Converted — only the converted row remains.
    fireEvent.click(screen.getByRole("tab", { name: "Converted" }));
    expect(screen.getByText("Natureland")).toBeTruthy();
    expect(screen.queryByText("Pending Co")).toBeNull();
  });

  it("shows the converted empty state when nothing has been converted yet", () => {
    render(<QueueView rows={[row()]} />);
    fireEvent.click(screen.getByRole("tab", { name: "Converted" }));
    expect(screen.getByText("No converted companies yet")).toBeTruthy();
  });
});
