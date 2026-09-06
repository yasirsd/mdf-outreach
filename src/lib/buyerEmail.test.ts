import { describe, expect, it } from "vitest";
import {
  BUYER_EMAIL_REQUIRED_MESSAGE,
  normalizeValidBuyerEmail,
  requireValidBuyerEmail,
} from "./buyerEmail";

describe("permanent Buyer email invariant", () => {
  it.each([undefined, null, "", "   ", "missing-at.example.com", "a@b", "a @b.com"])(
    "rejects missing, blank, or structurally unusable value %j",
    (email) => {
      expect(normalizeValidBuyerEmail(email)).toBeUndefined();
      expect(() => requireValidBuyerEmail(email)).toThrow(BUYER_EMAIL_REQUIRED_MESSAGE);
    },
  );

  it("normalizes a usable address consistently with the existing validator", () => {
    expect(requireValidBuyerEmail("  Buyer@Example.COM ")).toBe("buyer@example.com");
  });
});
