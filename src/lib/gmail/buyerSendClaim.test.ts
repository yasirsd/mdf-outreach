import { describe, it, expect } from "vitest";
import { buyerSendClaimKey } from "./buyerSendClaim";

describe("buyerSendClaimKey", () => {
  it("is stable and distinguishes per-buyer within a campaign", () => {
    expect(buyerSendClaimKey("c1", "b1")).toBe("buyer:c1:b1");
    expect(buyerSendClaimKey("c1", "b2")).toBe("buyer:c1:b2");
    expect(buyerSendClaimKey("c2", "b1")).toBe("buyer:c2:b1");
  });
  it("differs from the batch nonce namespace so the two claim types cannot collide", () => {
    expect(buyerSendClaimKey("c1", "b1").startsWith("buyer:")).toBe(true);
    expect(buyerSendClaimKey("c1", "b1").startsWith("batch:")).toBe(false);
  });
});
