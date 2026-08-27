import { describe, expect, it } from "vitest";
import type { Buyer, Campaign, CampaignRecipient } from "@/lib/types";
import { computeNeedsAttention } from "./needsAttention";

const NOW = new Date(2026, 7, 27, 10, 0, 0); // Aug 27 2026 local
const TODAY_ANCHOR = "2026-08-27T09:00:00.000Z";
const YESTERDAY_ANCHOR = "2026-08-26T09:00:00.000Z";
const TOMORROW_ANCHOR = "2026-08-28T09:00:00.000Z";

function buyer(over: Partial<Buyer> = {}): Buyer {
  return {
    id: `b-${Math.random()}`,
    firstName: "A",
    lastName: "B",
    company: "Co",
    email: "a@b.com",
    country: "India",
    status: "new",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function campaign(over: Partial<Campaign> = {}): Campaign {
  return {
    id: `c-${Math.random()}`,
    name: "Camp",
    country: "India",
    product: "Chilli",
    templateId: "t1",
    status: "active",
    subject: "Hello",
    preheader: "",
    fromName: "MDF",
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
    ...over,
  };
}

describe("computeNeedsAttention", () => {
  it("surfaces Gmail-disconnected as the highest-severity item", () => {
    const items = computeNeedsAttention({
      buyers: [],
      campaigns: [],
      activeRecipientsByCampaign: new Map(),
      suppressedBuyerIds: new Set(),
      gmailConnected: false,
      now: NOW,
    });
    expect(items[0].kind).toBe("gmail_disconnected");
    expect(items[0].severity).toBe("danger");
  });

  it("all-clear when everything is green", () => {
    const items = computeNeedsAttention({
      buyers: [buyer({ status: "new" })],
      campaigns: [],
      activeRecipientsByCampaign: new Map(),
      suppressedBuyerIds: new Set(),
      gmailConnected: true,
      now: NOW,
    });
    expect(items.length).toBe(0);
  });

  it("counts overdue follow-ups using F5 date helpers (yesterday counts)", () => {
    const items = computeNeedsAttention({
      buyers: [
        buyer({ nextFollowUpAt: YESTERDAY_ANCHOR }),
        buyer({ nextFollowUpAt: YESTERDAY_ANCHOR }),
        buyer({ nextFollowUpAt: TOMORROW_ANCHOR }),
      ],
      campaigns: [],
      activeRecipientsByCampaign: new Map(),
      suppressedBuyerIds: new Set(),
      gmailConnected: true,
      now: NOW,
    });
    const overdue = items.find((i) => i.kind === "follow_ups_overdue");
    expect(overdue?.count).toBe(2);
  });

  it("today is NOT overdue — surfaces as a separate info item", () => {
    const items = computeNeedsAttention({
      buyers: [buyer({ nextFollowUpAt: TODAY_ANCHOR })],
      campaigns: [],
      activeRecipientsByCampaign: new Map(),
      suppressedBuyerIds: new Set(),
      gmailConnected: true,
      now: NOW,
    });
    const overdue = items.find((i) => i.kind === "follow_ups_overdue");
    const today = items.find((i) => i.kind === "follow_ups_today");
    expect(overdue).toBeUndefined();
    expect(today?.count).toBe(1);
    expect(today?.severity).toBe("info");
  });

  it("suppression title uses the word 'suppressed' — not the ambiguous 'blocked'", () => {
    // The dashboard evaluates ONLY the suppression bit, not full Buyer
    // Send readiness. User-facing copy must be truthful about that.
    const items = computeNeedsAttention({
      buyers: [buyer({ id: "b-supp", suppressed: true })],
      campaigns: [campaign({ id: "c1", name: "Alpha" })],
      activeRecipientsByCampaign: new Map([
        [
          "c1",
          [{ id: "r1", campaignId: "c1", buyerId: "b-supp", status: "new", createdAt: "" }],
        ],
      ]),
      suppressedBuyerIds: new Set(["b-supp"]),
      gmailConnected: true,
      now: NOW,
    });
    const row = items.find((i) => i.kind === "campaign_blocked_recipients");
    expect(row?.title).toContain("suppressed");
    expect(row?.title).not.toContain("blocked");
    expect(row?.detail).toContain("Do not contact");
  });

  it("blocks per-active-campaign when suppressed buyers are recipients", () => {
    const c1 = campaign({ id: "c1", name: "Alpha" });
    const c2 = campaign({ id: "c2", name: "Beta" });
    const items = computeNeedsAttention({
      buyers: [buyer({ id: "b-supp", suppressed: true })],
      campaigns: [c1, c2],
      activeRecipientsByCampaign: new Map([
        [
          "c1",
          [
            { id: "r1", campaignId: "c1", buyerId: "b-supp", status: "new", createdAt: "" },
            { id: "r2", campaignId: "c1", buyerId: "b-other", status: "new", createdAt: "" },
          ],
        ],
        [
          "c2",
          [{ id: "r3", campaignId: "c2", buyerId: "b-other", status: "new", createdAt: "" }],
        ],
      ]),
      suppressedBuyerIds: new Set(["b-supp"]),
      gmailConnected: true,
      now: NOW,
    });
    const blocked = items.filter((i) => i.kind === "campaign_blocked_recipients");
    expect(blocked.length).toBe(1);
    expect(blocked[0].count).toBe(1);
    expect(blocked[0].title).toContain("Alpha");
  });

  it("flags active campaigns missing template or subject", () => {
    const items = computeNeedsAttention({
      buyers: [],
      campaigns: [
        campaign({ id: "no-tpl", name: "NoTpl", templateId: "" }),
        campaign({ id: "no-sub", name: "NoSub", subject: "  " }),
      ],
      activeRecipientsByCampaign: new Map(),
      suppressedBuyerIds: new Set(),
      gmailConnected: true,
      now: NOW,
    });
    expect(items.some((i) => i.kind === "campaign_missing_template")).toBe(true);
    expect(items.some((i) => i.kind === "campaign_missing_subject")).toBe(true);
  });

  it("draft campaigns do NOT trigger missing-template/subject alerts", () => {
    const items = computeNeedsAttention({
      buyers: [],
      campaigns: [campaign({ status: "draft", templateId: "", subject: "" })],
      activeRecipientsByCampaign: new Map(),
      suppressedBuyerIds: new Set(),
      gmailConnected: true,
      now: NOW,
    });
    expect(items.length).toBe(0);
  });

  it("evaluates EVERY active campaign — no cap that could produce a false all-clear", () => {
    // Simulate 20 active campaigns (well past the previous 12-cap).
    // Only the 20th has a blocked recipient. If the aggregator skips it,
    // the result would be an empty all-clear — the bug this guards.
    const campaigns = Array.from({ length: 20 }).map((_, i) =>
      campaign({ id: `c${i}`, name: `Camp ${i}` }),
    );
    const activeRecipientsByCampaign = new Map<string, CampaignRecipient[]>();
    // Only c19 has a suppressed-buyer recipient.
    activeRecipientsByCampaign.set("c19", [
      { id: "r", campaignId: "c19", buyerId: "b-supp", status: "new", createdAt: "" },
    ]);
    const items = computeNeedsAttention({
      buyers: [buyer({ id: "b-supp", suppressed: true })],
      campaigns,
      activeRecipientsByCampaign,
      suppressedBuyerIds: new Set(["b-supp"]),
      gmailConnected: true,
      now: NOW,
    });
    const blocked = items.filter((i) => i.kind === "campaign_blocked_recipients");
    expect(blocked.length).toBe(1);
    expect(blocked[0].title).toContain("Camp 19");
  });
});
