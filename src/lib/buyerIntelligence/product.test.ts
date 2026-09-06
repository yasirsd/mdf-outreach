import { describe, expect, it } from "vitest";
import { isMdfBusinessProductId, requireMdfBusinessProductId } from "./product";

describe("BI1 canonical MDF product interpretation", () => {
  it("accepts only canonical business catalogue ids", () => {
    expect(isMdfBusinessProductId("guntur-dry-red-chilli")).toBe(true);
    expect(requireMdfBusinessProductId("guntur-dry-red-chilli")).toBe(
      "guntur-dry-red-chilli",
    );
    expect(isMdfBusinessProductId("invented-product")).toBe(false);
    expect(() => requireMdfBusinessProductId("invented-product")).toThrow(/Unknown MDF/);
  });

  it("treats a missing interpretation as missing", () => {
    expect(isMdfBusinessProductId(undefined)).toBe(true);
  });
});
