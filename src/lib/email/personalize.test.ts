import { describe, it, expect } from "vitest";
import { buildContext, personalize, detectUnresolvedTokens } from "./personalize";
import type { Buyer } from "@/lib/types";

const now = new Date().toISOString();
const buyer = (overrides: Partial<Buyer>): Buyer => ({
  id: "b1",
  firstName: "Somchai",
  lastName: "Prasert",
  company: "Siam Spice",
  email: "s@example.com",
  country: "Thailand",
  status: "ready",
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

describe("personalize", () => {
  it("replaces known tokens", () => {
    const ctx = buildContext(buyer({}));
    expect(personalize("Hi {{first_name}} at {{company}}", ctx)).toBe("Hi Somchai at Siam Spice");
  });

  it("falls back gracefully when first name is missing", () => {
    const ctx = buildContext(buyer({ firstName: "" }));
    expect(ctx.greeting).toBe("Hello");
    expect(personalize("{{greeting}},", ctx)).toBe("Hello,");
    expect(personalize("Hi {{first_name}}", ctx)).toBe("Hi ");
  });

  it("uses productInterest when set, otherwise product default", () => {
    const withInterest = buildContext(buyer({ productInterest: "Chilli Powder" }));
    expect(withInterest.product).toBe("Chilli Powder");
    const withoutInterest = buildContext(buyer({ productInterest: undefined }));
    expect(withoutInterest.product).toBe("Guntur Dry Red Chilli");
  });

  it("detects unresolved tokens in text", () => {
    expect(detectUnresolvedTokens("Hello {{unknown_field}}")).toEqual(["{{unknown_field}}"]);
    expect(detectUnresolvedTokens("Hi Somchai")).toEqual([]);
  });
});
