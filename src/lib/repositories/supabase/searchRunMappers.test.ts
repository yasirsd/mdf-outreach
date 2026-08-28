import { describe, expect, it } from "vitest";
import { searchRunToInsertRow, searchRunToPatchRow } from "./searchRunMappers";

describe("search run mappers", () => {
  it("insert always stamps hunter / free / 0 credits / queued", () => {
    const row = searchRunToInsertRow(
      {
        country: "Thailand",
        businessProductId: "guntur-dry-red-chilli",
        desiredBuyerTypes: [],
        contactPriorities: [],
      },
      "ws-from-session",
    );
    expect(row.workspace_id).toBe("ws-from-session");
    expect(row.provider).toBe("hunter");
    expect(row.credits_used).toBe(0);
    expect(row.cost_class).toBe("free");
    expect(row.status).toBe("queued");
    expect(row.stage).toBe("preparing");
  });

  it("patch never writes credits, cost class, workspace, or provider", () => {
    const row = searchRunToPatchRow({
      discoveredCount: 4,
      processedCount: 2,
      usableCount: 4,
      status: "running",
    });
    expect(row).not.toHaveProperty("credits_used");
    expect(row).not.toHaveProperty("cost_class");
    expect(row).not.toHaveProperty("workspace_id");
    expect(row).not.toHaveProperty("provider");
    expect(row.discovered_count).toBe(4);
  });
});
