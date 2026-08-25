import { describe, it, expect } from "vitest";
import type { Buyer, Campaign, CampaignRecipient, EmailTemplate } from "@/lib/types";
import {
  buyerFromRow,
  buyerToPatchRow,
  buyerToRow,
  campaignFromRow,
  campaignToPatchRow,
  campaignToRow,
  recipientFromRow,
  recipientToPatchRow,
  recipientToRow,
  templateFromRow,
  templateToPatchRow,
  templateToRow,
  type BuyerRow,
  type CampaignRow,
  type CampaignRecipientRow,
  type EmailTemplateRow,
} from "./mappers";

const WORKSPACE = "00000000-0000-0000-0000-000000000001";
const BUYER_ID = "00000000-0000-0000-0000-0000000000aa";
const CAMPAIGN_ID = "00000000-0000-0000-0000-0000000000bb";
const RECIPIENT_ID = "00000000-0000-0000-0000-0000000000cc";
const TEMPLATE_ID = "00000000-0000-0000-0000-0000000000dd";

describe("buyer mapper round-trip", () => {
  it("round-trips every field", () => {
    const buyer: Buyer = {
      id: BUYER_ID,
      firstName: "Anna",
      lastName: "Rao",
      company: "Anna Trading",
      email: "anna@example.com",
      phone: "+91 99999 00001",
      whatsapp: "+91 99999 00002",
      website: "https://anna.example",
      country: "India",
      city: "Chennai",
      buyerType: "Importer",
      productInterest: "Dry Red Chilli",
      source: "Trade show",
      notes: "Prefers 20ft container",
      status: "qualified",
      lastContactedAt: "2026-08-25T10:00:00.000Z",
      nextFollowUpAt: "2026-09-01T10:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
    };
    const row = { ...buyerToRow(buyer, WORKSPACE), created_at: buyer.createdAt, updated_at: buyer.updatedAt } as BuyerRow;
    const back = buyerFromRow(row);
    expect(back).toEqual(buyer);
  });

  it("preserves undefined optional fields as absence", () => {
    const buyer: Buyer = {
      id: BUYER_ID,
      firstName: "Anna",
      lastName: "",
      company: "",
      email: "anna@example.com",
      country: "India",
      status: "new",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    const row = { ...buyerToRow(buyer, WORKSPACE), created_at: buyer.createdAt, updated_at: buyer.updatedAt } as BuyerRow;
    expect(row.phone).toBeNull();
    expect(row.city).toBeNull();
    const back = buyerFromRow(row);
    expect(back.phone).toBeUndefined();
    expect(back.city).toBeUndefined();
  });
});

describe("buyerToPatchRow (partial-update safety)", () => {
  it("emits only the fields present in the patch", () => {
    const patch = buyerToPatchRow({ status: "contacted" });
    expect(patch).toEqual({ status: "contacted" });
    // Critical: no first_name/email/country/etc. that would clobber existing values.
    expect("first_name" in patch).toBe(false);
    expect("email" in patch).toBe(false);
    expect("country" in patch).toBe(false);
    expect("phone" in patch).toBe(false);
  });

  it("maps camelCase → snake_case for provided fields only", () => {
    const patch = buyerToPatchRow({
      buyerType: "Distributor",
      productInterest: "Chilli Powder",
      lastContactedAt: "2026-08-25T00:00:00.000Z",
    });
    expect(patch).toEqual({
      buyer_type: "Distributor",
      product_interest: "Chilli Powder",
      last_contacted_at: "2026-08-25T00:00:00.000Z",
    });
  });

  it("passes through explicit undefined as null (nullable columns)", () => {
    const patch = buyerToPatchRow({ notes: undefined });
    expect(patch).toEqual({ notes: null });
  });
});

describe("campaign / recipient / template partial patches", () => {
  it("campaignToPatchRow emits only provided fields", () => {
    expect(campaignToPatchRow({ status: "paused" })).toEqual({ status: "paused" });
    expect(campaignToPatchRow({ subject: "Hi", fromName: "MDF" })).toEqual({
      subject: "Hi",
      from_name: "MDF",
    });
  });

  it("recipientToPatchRow does not include campaign_id or buyer_id", () => {
    const patch = recipientToPatchRow({
      preparedAt: "2026-08-25T00:00:00.000Z",
      status: "contacted",
    });
    expect(patch).toEqual({
      prepared_at: "2026-08-25T00:00:00.000Z",
      status: "contacted",
    });
    expect("campaign_id" in patch).toBe(false);
    expect("buyer_id" in patch).toBe(false);
  });

  it("templateToPatchRow emits only provided fields", () => {
    const sections = [{ id: "s1", type: "intro" as const, visible: true, data: {} }];
    expect(templateToPatchRow({ sections })).toEqual({ sections });
    expect("name" in templateToPatchRow({ sections })).toBe(false);
  });
});

describe("campaign / recipient / template full mapper round-trip", () => {
  it("campaign round-trips", () => {
    const c: Campaign = {
      id: CAMPAIGN_ID,
      name: "Thailand campaign",
      country: "Thailand",
      product: "Guntur Dry Red Chilli",
      description: "Intro outreach",
      templateId: TEMPLATE_ID,
      status: "active",
      subject: "Sample",
      preheader: "Preheader",
      fromName: "MDF",
      replyTo: "hi@mdfexport.com",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
    };
    const row = { ...campaignToRow(c, WORKSPACE), created_at: c.createdAt, updated_at: c.updatedAt } as CampaignRow;
    expect(campaignFromRow(row)).toEqual(c);
  });

  it("recipient round-trips", () => {
    const r: CampaignRecipient = {
      id: RECIPIENT_ID,
      campaignId: CAMPAIGN_ID,
      buyerId: BUYER_ID,
      status: "ready",
      preparedAt: "2026-08-25T00:00:00.000Z",
      simulatedSentAt: "2026-08-25T01:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    const row = { ...recipientToRow(r, WORKSPACE), created_at: r.createdAt } as CampaignRecipientRow;
    expect(recipientFromRow(row)).toEqual(r);
  });

  it("template round-trips including metadata", () => {
    const t: EmailTemplate = {
      id: TEMPLATE_ID,
      name: "MDF Master — Signature",
      label: "Signature",
      sections: [{ id: "s1", type: "intro", visible: true, data: { headline: "Hi" } }],
      themeKey: "guntur-chilli",
      variant: "signature",
      version: 2,
      status: "approved",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
    };
    const row = {
      ...templateToRow(t, WORKSPACE),
      created_at: t.createdAt,
      updated_at: t.updatedAt,
    } as EmailTemplateRow;
    expect(templateFromRow(row)).toEqual(t);
  });
});
