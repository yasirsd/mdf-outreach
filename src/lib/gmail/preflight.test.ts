import { describe, it, expect } from "vitest";
import { fullPreflight } from "./preflight";
import type { AssetRecord, Campaign, EmailTemplate } from "@/lib/types";

const campaign: Campaign = {
  id: "c1",
  name: "Guntur test",
  country: "Thailand",
  product: "Guntur Dry Red Chilli",
  templateId: "t1",
  status: "draft",
  subject: "Guntur — offer",
  preheader: "",
  fromName: "MDF",
  createdAt: "2026-08-25T00:00:00Z",
  updatedAt: "2026-08-25T00:00:00Z",
};

const template: EmailTemplate = {
  id: "t1",
  name: "MDF Master",
  sections: [],
  themeKey: "guntur-chilli",
  variant: "signature",
  version: 1,
  status: "approved",
  createdAt: "2026-08-25T00:00:00Z",
  updatedAt: "2026-08-25T00:00:00Z",
};

const productionHero: AssetRecord = {
  id: "a1",
  themeKey: "guntur-chilli",
  slot: "hero",
  name: "hero.jpg",
  productionUrl: "https://cdn.example/hero.jpg",
  storagePath: "ws/guntur-chilli/hero/hero.jpg",
  status: "production",
  altText: "Guntur hero",
  isDecorative: false,
  updatedAt: "2026-08-25T00:00:00Z",
};

describe("fullPreflight", () => {
  it("passes on a valid payload with a production hero", () => {
    const res = fullPreflight({
      campaign,
      template,
      html: "<html><body>Hi</body></html>",
      text: "Hi",
      assetsBySlot: { hero: productionHero },
      recipient: "test@mdfexport.com",
    });
    expect(res.ok).toBe(true);
    expect(res.blockers).toEqual([]);
  });

  it("blocks a payload that still contains a Base64 image", () => {
    const res = fullPreflight({
      campaign,
      template,
      html: '<img src="data:image/jpeg;base64,AAAA" />',
      text: "Hi",
      assetsBySlot: { hero: productionHero },
      recipient: "test@mdfexport.com",
    });
    expect(res.ok).toBe(false);
    expect(res.blockers.join(" ")).toMatch(/Base64/);
  });

  it("blocks a payload with unresolved personalization tokens", () => {
    const res = fullPreflight({
      campaign,
      template,
      html: "Hi {{first_name}}",
      text: "Hi",
      assetsBySlot: { hero: productionHero },
      recipient: "test@mdfexport.com",
    });
    expect(res.ok).toBe(false);
    expect(res.blockers.join(" ")).toMatch(/Unresolved personalization/);
  });

  it("blocks an invalid recipient", () => {
    const res = fullPreflight({
      campaign,
      template,
      html: "x",
      text: "x",
      assetsBySlot: { hero: productionHero },
      recipient: "not-an-email",
    });
    expect(res.ok).toBe(false);
    expect(res.blockers.join(" ")).toMatch(/Recipient email is invalid/);
  });

  it("blocks empty subject / html / text", () => {
    expect(
      fullPreflight({
        campaign: { ...campaign, subject: "" },
        template,
        html: "x",
        text: "x",
        assetsBySlot: { hero: productionHero },
        recipient: "test@mdfexport.com",
      }).ok,
    ).toBe(false);
    expect(
      fullPreflight({
        campaign,
        template,
        html: "",
        text: "x",
        assetsBySlot: { hero: productionHero },
        recipient: "test@mdfexport.com",
      }).ok,
    ).toBe(false);
    expect(
      fullPreflight({
        campaign,
        template,
        html: "x",
        text: "",
        assetsBySlot: { hero: productionHero },
        recipient: "test@mdfexport.com",
      }).ok,
    ).toBe(false);
  });

  it("blocks when required production assets are missing", () => {
    const res = fullPreflight({
      campaign,
      template,
      html: "x",
      text: "x",
      assetsBySlot: {},
      recipient: "test@mdfexport.com",
    });
    expect(res.ok).toBe(false);
    expect(res.assetFindings.some((f) => f.slot === "hero")).toBe(true);
  });
});
