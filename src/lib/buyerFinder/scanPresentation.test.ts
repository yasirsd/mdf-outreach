import { describe, expect, it } from "vitest";
import { countryScanLabel, productMatchScanLabel } from "./scanPresentation";

describe("scanPresentation", () => {
  it("shortens United Arab Emirates to UAE", () => {
    expect(countryScanLabel("United Arab Emirates")).toBe("UAE");
    expect(countryScanLabel("Kuwait")).toBe("Kuwait");
  });

  it("shortens directory keyword match for cards", () => {
    expect(
      productMatchScanLabel({
        id: "1",
        candidateId: "2",
        productId: "guntur-dry-red-chilli",
        relevance: 50,
        source: "hunter",
        evidence: [],
      }),
    ).toBe("Directory signal");
  });
});
