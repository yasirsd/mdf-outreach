import { describe, it, expect } from "vitest";
import { renderEmailHtml, renderEmailText } from "./renderer";
import { createDefaultTemplate } from "./defaultTemplate";
import { createDefaultSettings } from "@/test/fixtures/demo";
import type { Buyer } from "@/lib/types";

const now = new Date().toISOString();
const buyer: Buyer = {
  id: "b1",
  firstName: "Somchai",
  lastName: "Prasert",
  company: "Siam Spice",
  email: "s@example.com",
  country: "Thailand",
  status: "ready",
  createdAt: now,
  updatedAt: now,
};

describe("email renderer", () => {
  it("renders HTML containing personalization", () => {
    const html = renderEmailHtml({
      template: createDefaultTemplate(),
      buyer,
      settings: createDefaultSettings(),
      assetsBySlot: {},
    });
    expect(html).toContain("Hi Somchai");
    expect(html).toContain("Guntur");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<table");
    expect(html).not.toContain("{{first_name}}");
  });

  it("renders greeting fallback for missing first name", () => {
    const html = renderEmailHtml({
      template: createDefaultTemplate(),
      buyer: { ...buyer, firstName: "" },
      settings: createDefaultSettings(),
      assetsBySlot: {},
    });
    expect(html).toContain("Hello,");
    expect(html).not.toContain("Hi ,");
  });

  it("renders plain-text alternative", () => {
    const text = renderEmailText({
      template: createDefaultTemplate(),
      buyer,
      settings: createDefaultSettings(),
      assetsBySlot: {},
    });
    expect(text).toContain("Hi Somchai");
    expect(text).toContain("MDF Exports & Imports");
    expect(text).toContain("WITH STEM");
  });
});
