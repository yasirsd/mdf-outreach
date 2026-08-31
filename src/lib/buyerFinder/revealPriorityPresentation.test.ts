import { describe, expect, it } from "vitest";
import { revealPriorityReason } from "./revealPriorityPresentation";

describe("revealPriorityReason", () => {
  it("uses specific deterministic explanations", () => {
    expect(revealPriorityReason("Category Manager", "high")).toBe("Category management / buying role");
    expect(revealPriorityReason("Procurement Manager", "high")).toBe("Procurement / purchasing role");
    expect(revealPriorityReason("Purchasing Manager", "high")).toBe("Procurement / purchasing role");
    expect(revealPriorityReason("Sourcing Manager", "high")).toBe("Sourcing role");
    expect(revealPriorityReason("Import Manager", "high")).toBe("Import / sourcing role");
    expect(revealPriorityReason("Director of Agricultural Commodities", "high")).toBe(
      "Agricultural commodities / trading leadership",
    );
    expect(revealPriorityReason("Commodity Trader", "high")).toBe("Commodity trading role");
    expect(revealPriorityReason("Head of Trading", "high")).toBe("Trading leadership");
    expect(revealPriorityReason("Supply Chain Manager", "medium")).toBe("Supply-chain leadership");
    expect(revealPriorityReason("Commercial Manager", "medium")).toBe("Commercial leadership");
    expect(revealPriorityReason("Managing Director", "medium")).toBe("Senior executive fallback");
    expect(revealPriorityReason("Sales Executive", "low")).toBe("Sales-focused role");
    expect(revealPriorityReason("Accountant", "low")).toBe("Finance / accounting");
  });

  it("does not call anyone a buyer", () => {
    expect(revealPriorityReason("Category Manager", "high")).not.toMatch(/buyer/i);
    expect(revealPriorityReason("Director", "medium")).toBe("Executive fallback");
  });
});
