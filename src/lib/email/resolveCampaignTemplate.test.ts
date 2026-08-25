import { describe, it, expect } from "vitest";
import { resolveCampaignTemplate } from "./resolveCampaignTemplate";
import type { Campaign, EmailSection, EmailTemplate } from "@/lib/types";

const now = "2026-08-25T00:00:00.000Z";

const master: EmailTemplate = {
  id: "master-1",
  name: "Master template",
  label: "Signature",
  sections: [
    { id: "s1", type: "intro", visible: true, data: { body: "Master intro" } },
    { id: "s2", type: "hero", visible: true, data: { headline: "Master hero" } },
  ],
  themeKey: "guntur-chilli",
  variant: "signature",
  version: 2,
  status: "approved",
  createdAt: now,
  updatedAt: now,
};

const baseCampaign: Campaign = {
  id: "campaign-1",
  name: "Thailand — Guntur",
  country: "Thailand",
  product: "Guntur Dry Red Chilli",
  templateId: master.id,
  status: "draft",
  subject: "Hi",
  preheader: "Preheader",
  fromName: "MDF",
  themeKey: "guntur-chilli",
  templateVariant: "signature",
  createdAt: now,
  updatedAt: now,
};

describe("resolveCampaignTemplate", () => {
  it("uses the campaign snapshot when present", () => {
    const snapshot: EmailSection[] = [
      { id: "cs1", type: "intro", visible: true, data: { body: "Campaign-specific intro" } },
      { id: "cs2", type: "hero", visible: false, data: {} },
    ];
    const t = resolveCampaignTemplate({ ...baseCampaign, emailSections: snapshot }, master);
    expect(t).not.toBeNull();
    expect(t!.sections).toBe(snapshot);
    expect(t!.themeKey).toBe("guntur-chilli");
  });

  it("does not mutate the master when a snapshot is used", () => {
    const snapshot: EmailSection[] = [
      { id: "cs1", type: "intro", visible: true, data: { body: "Edited" } },
    ];
    const originalMasterSections = master.sections;
    const t = resolveCampaignTemplate({ ...baseCampaign, emailSections: snapshot }, master);
    // Mutate the resolved snapshot — master must remain untouched.
    t!.sections[0].data.body = "Further edit";
    expect(master.sections).toBe(originalMasterSections);
    expect(master.sections[0].data.body).toBe("Master intro");
  });

  it("falls back to the master when there is no snapshot", () => {
    const t = resolveCampaignTemplate({ ...baseCampaign, emailSections: undefined }, master);
    expect(t).toBe(master);
  });

  it("returns null when neither snapshot nor master exists", () => {
    const t = resolveCampaignTemplate({ ...baseCampaign, emailSections: undefined }, null);
    expect(t).toBeNull();
  });
});
