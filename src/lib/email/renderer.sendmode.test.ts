import { describe, it, expect } from "vitest";
import { renderEmailHtml } from "./renderer";
import { buildProductTemplate } from "./templates/build";
import { createDefaultSettings } from "@/test/fixtures/demo";
import type { AssetRecord, WorkspaceSettings } from "@/lib/types";
import { preflightAssetsForSend } from "./sendPreflight";

const settings: WorkspaceSettings = {
  ...createDefaultSettings(),
  onboardingComplete: true,
};

function asset(over: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id: "asset-1",
    themeKey: "guntur-chilli",
    slot: "hero",
    name: "hero.jpg",
    productionUrl: "https://cdn.example/hero.jpg",
    localDataUrl: "data:image/jpeg;base64,AAAA",
    storagePath: "ws/guntur-chilli/hero/hero.jpg",
    status: "production",
    altText: "Guntur chilli hero",
    mimeType: "image/jpeg",
    fileSize: 100000,
    isDecorative: false,
    updatedAt: "2026-08-25T00:00:00Z",
    ...over,
  };
}

describe("renderer — send mode never inlines Base64", () => {
  const template = buildProductTemplate("guntur-chilli", "signature");

  it("preview mode: falls back to the localDataUrl when no production URL is set", () => {
    const localOnly = asset({ productionUrl: undefined, status: "draft" });
    const html = renderEmailHtml({
      template,
      buyer: null,
      settings,
      assetsBySlot: { hero: localOnly },
      mode: "preview",
    });
    expect(html).toContain("data:image/jpeg;base64,AAAA");
  });

  it("send mode: refuses to inline the Base64 preview", () => {
    const localOnly = asset({ productionUrl: undefined, status: "draft" });
    const html = renderEmailHtml({
      template,
      buyer: null,
      settings,
      assetsBySlot: { hero: localOnly },
      mode: "send",
    });
    expect(html).not.toContain("data:image/jpeg;base64,AAAA");
    // Falls back to the intentional placeholder instead.
    expect(html).toContain("Awaiting approved production asset");
  });

  it("send mode: rejects an approved asset that isn't in production status", () => {
    const approvedButNotLive = asset({ status: "approved" });
    const html = renderEmailHtml({
      template,
      buyer: null,
      settings,
      assetsBySlot: { hero: approvedButNotLive },
      mode: "send",
    });
    expect(html).not.toContain("https://cdn.example/hero.jpg");
    expect(html).toContain("Awaiting approved production asset");
  });

  it("send mode: uses the production URL when status === 'production'", () => {
    const html = renderEmailHtml({
      template,
      buyer: null,
      settings,
      assetsBySlot: { hero: asset() },
      mode: "send",
    });
    expect(html).toContain("https://cdn.example/hero.jpg");
  });
});

describe("preflightAssetsForSend", () => {
  const template = buildProductTemplate("guntur-chilli", "signature");

  it("flags missing required assets", () => {
    const findings = preflightAssetsForSend(template, {});
    expect(findings.some((f) => f.slot === "hero" && f.reason === "missing")).toBe(true);
  });

  it("passes when the required asset is in production with alt text", () => {
    const findings = preflightAssetsForSend(template, { hero: asset() });
    expect(findings.some((f) => f.slot === "hero")).toBe(false);
  });

  it("flags production asset with no alt text (unless decorative)", () => {
    const noAlt = asset({ altText: "" });
    const findings = preflightAssetsForSend(template, { hero: noAlt });
    expect(findings.some((f) => f.reason === "no-alt-text")).toBe(true);
  });

  it("flags a hosted-but-draft asset as not-production-status", () => {
    const findings = preflightAssetsForSend(template, {
      hero: asset({ status: "draft" }),
    });
    expect(findings.some((f) => f.reason === "not-production-status")).toBe(true);
  });
});
