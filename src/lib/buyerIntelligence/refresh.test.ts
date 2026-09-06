import { describe, expect, it, vi } from "vitest";
import { refreshBuyerIntelligence } from "./refresh";
import { controlledBuyerIntelligenceViewModel, BI_FIXTURE_CANDIDATE_ID } from "./testUtils/fixtures";

describe("BI2 refresh orchestration", () => {
  it("reloads the read model only after the atomic refresh completes", async () => {
    const order: string[] = [];
    const model = controlledBuyerIntelligenceViewModel();
    const result = await refreshBuyerIntelligence(BI_FIXTURE_CANDIDATE_ID, {
      writer: { refreshDerived: vi.fn(async () => { order.push("transaction"); return { outcome: "refreshed" as const, candidateId: BI_FIXTURE_CANDIDATE_ID }; }) },
      loadReadModel: vi.fn(async () => { order.push("read"); return model; }),
    });
    expect(order).toEqual(["transaction", "read"]);
    expect(result).toBe(model);
  });

  it("does not expose a partial read when the transaction fails", async () => {
    const loadReadModel = vi.fn(async () => controlledBuyerIntelligenceViewModel());
    await expect(refreshBuyerIntelligence(BI_FIXTURE_CANDIDATE_ID, {
      writer: { refreshDerived: async () => { throw new Error("transaction failed"); } }, loadReadModel,
    })).rejects.toThrow("transaction failed");
    expect(loadReadModel).not.toHaveBeenCalled();
  });
});
