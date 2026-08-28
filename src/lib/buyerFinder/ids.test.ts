import { describe, expect, it } from "vitest";
import { isEntityUuid, newEntityId } from "./ids";

describe("Buyer Finder entity UUID helpers", () => {
  it("accepts a standard UUID and rejects slug ids", () => {
    expect(isEntityUuid("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).toBe(true);
    expect(isEntityUuid("cand-example-com")).toBe(false);
    expect(isEntityUuid("ctc-cand-example-com-owner")).toBe(false);
    expect(isEntityUuid("match-cand-1-guntur-dry-red-chilli")).toBe(false);
    expect(isEntityUuid("probe")).toBe(false);
  });

  it("newEntityId returns a valid UUID", () => {
    const id = newEntityId();
    expect(isEntityUuid(id)).toBe(true);
  });
});
