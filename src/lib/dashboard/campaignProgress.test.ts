import { describe, expect, it } from "vitest";
import type { Campaign, CampaignRecipient } from "@/lib/types";
import { computeCampaignProgress } from "./campaignProgress";

function campaign(id: string, over?: Partial<Campaign>): Campaign {
  return {
    id,
    name: `Camp ${id}`,
    country: "India",
    product: "Chilli",
    templateId: "t1",
    status: "active",
    subject: "Hi",
    preheader: "",
    fromName: "MDF",
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
    ...over,
  };
}

function recipient(campaignId: string, buyerId: string): CampaignRecipient {
  return {
    id: `${campaignId}:${buyerId}`,
    campaignId,
    buyerId,
    status: "ready",
    createdAt: "2026-08-01T09:00:00.000Z",
  };
}

describe("computeCampaignProgress — Overview delivery semantics", () => {
  it("progress uses UNIQUE delivered recipients / totalRecipients", () => {
    const c = campaign("A");
    const rows = computeCampaignProgress({
      campaigns: [c],
      recipientsByCampaign: new Map([
        ["A", [recipient("A", "b1"), recipient("A", "b2"), recipient("A", "b3")]],
      ]),
      successfulBuyerIdsByCampaign: new Map([["A", new Set(["b1"])]]),
      lastDeliveryByCampaign: new Map([["A", "2026-08-27T10:00:00.000Z"]]),
      suppressedBuyerIds: new Set(),
    });
    expect(rows[0].totalRecipients).toBe(3);
    expect(rows[0].delivered).toBe(1);
    expect(rows[0].remaining).toBe(2);
    expect(rows[0].suppressed).toBe(0);
    expect(rows[0].progressPct).toBe(33);
  });

  it("failed attempts / safety-gate refusals do NOT count towards delivered", () => {
    // The aggregator is passed only successful buyer ids by construction.
    const c = campaign("A");
    const rows = computeCampaignProgress({
      campaigns: [c],
      recipientsByCampaign: new Map([
        ["A", [recipient("A", "b1"), recipient("A", "b2")]],
      ]),
      successfulBuyerIdsByCampaign: new Map(),
      lastDeliveryByCampaign: new Map(),
      suppressedBuyerIds: new Set(),
    });
    expect(rows[0].delivered).toBe(0);
    expect(rows[0].progressPct).toBe(0);
  });

  it("duplicate successful events for the same buyer collapse to 1", () => {
    const c = campaign("A");
    const success = new Set<string>();
    success.add("b1");
    success.add("b1");
    const rows = computeCampaignProgress({
      campaigns: [c],
      recipientsByCampaign: new Map([["A", [recipient("A", "b1"), recipient("A", "b2")]]]),
      successfulBuyerIdsByCampaign: new Map([["A", success]]),
      lastDeliveryByCampaign: new Map(),
      suppressedBuyerIds: new Set(),
    });
    expect(rows[0].delivered).toBe(1);
  });

  it("suppressed recipients that have not been delivered count towards suppressed, not remaining", () => {
    const c = campaign("A");
    const rows = computeCampaignProgress({
      campaigns: [c],
      recipientsByCampaign: new Map([
        ["A", [recipient("A", "b1"), recipient("A", "b2"), recipient("A", "b3")]],
      ]),
      successfulBuyerIdsByCampaign: new Map([["A", new Set(["b1"])]]),
      lastDeliveryByCampaign: new Map(),
      suppressedBuyerIds: new Set(["b3"]),
    });
    expect(rows[0].suppressed).toBe(1);
    expect(rows[0].remaining).toBe(1); // b2
    expect(rows[0].delivered).toBe(1); // b1
  });

  it("suppressed AFTER delivery still counts as delivered — delivery takes precedence", () => {
    const c = campaign("A");
    const rows = computeCampaignProgress({
      campaigns: [c],
      recipientsByCampaign: new Map([["A", [recipient("A", "b1")]]]),
      successfulBuyerIdsByCampaign: new Map([["A", new Set(["b1"])]]),
      lastDeliveryByCampaign: new Map(),
      suppressedBuyerIds: new Set(["b1"]), // suppressed now
    });
    expect(rows[0].delivered).toBe(1);
    expect(rows[0].suppressed).toBe(0);
  });

  it("Overview terminology uses Delivered / Remaining / Suppressed — never Ready / Blocked", () => {
    // Guardrail on the exported shape.
    const rows = computeCampaignProgress({
      campaigns: [campaign("A")],
      recipientsByCampaign: new Map(),
      successfulBuyerIdsByCampaign: new Map(),
      lastDeliveryByCampaign: new Map(),
      suppressedBuyerIds: new Set(),
    });
    expect(rows[0]).toHaveProperty("delivered");
    expect(rows[0]).toHaveProperty("remaining");
    expect(rows[0]).toHaveProperty("suppressed");
    // The old contract's fields must be gone.
    expect(rows[0]).not.toHaveProperty("ready");
    expect(rows[0]).not.toHaveProperty("blocked");
    expect(rows[0]).not.toHaveProperty("alreadySent");
    expect(rows[0]).not.toHaveProperty("successful");
  });

  it("delivered tone when every recipient has a successful send", () => {
    const c = campaign("A");
    const rows = computeCampaignProgress({
      campaigns: [c],
      recipientsByCampaign: new Map([["A", [recipient("A", "b1"), recipient("A", "b2")]]]),
      successfulBuyerIdsByCampaign: new Map([["A", new Set(["b1", "b2"])]]),
      lastDeliveryByCampaign: new Map([["A", "2026-08-27T10:00:00.000Z"]]),
      suppressedBuyerIds: new Set(),
    });
    expect(rows[0].statusTone).toBe("delivered");
    expect(rows[0].progressPct).toBe(100);
  });

  it("attention tone when every remaining recipient is suppressed", () => {
    const c = campaign("A");
    const rows = computeCampaignProgress({
      campaigns: [c],
      recipientsByCampaign: new Map([["A", [recipient("A", "b1"), recipient("A", "b2")]]]),
      successfulBuyerIdsByCampaign: new Map(),
      lastDeliveryByCampaign: new Map(),
      suppressedBuyerIds: new Set(["b1", "b2"]),
    });
    expect(rows[0].statusTone).toBe("attention");
  });

  it("historical delivery to a buyer NO LONGER on the recipient list does NOT count", () => {
    const c = campaign("A");
    // Current recipients are only B and C; historical successful send
    // happened to A (since removed from the campaign).
    const rows = computeCampaignProgress({
      campaigns: [c],
      recipientsByCampaign: new Map([["A", [recipient("A", "b"), recipient("A", "c")]]]),
      successfulBuyerIdsByCampaign: new Map([["A", new Set(["a"])]]),
      lastDeliveryByCampaign: new Map(),
      suppressedBuyerIds: new Set(),
    });
    expect(rows[0].totalRecipients).toBe(2);
    expect(rows[0].delivered).toBe(0);
    expect(rows[0].remaining).toBe(2);
    expect(rows[0].progressPct).toBe(0);
  });

  it("progressPct is bounded [0, 100] even when successfulByCampaign carries stale ids", () => {
    // 3 current recipients (b1, b2, b3), and successfulByCampaign lists
    // FIVE buyers — b4, b5 are no longer on the campaign. Progress must
    // never exceed 100%.
    const c = campaign("A");
    const rows = computeCampaignProgress({
      campaigns: [c],
      recipientsByCampaign: new Map([
        ["A", [recipient("A", "b1"), recipient("A", "b2"), recipient("A", "b3")]],
      ]),
      successfulBuyerIdsByCampaign: new Map([["A", new Set(["b1", "b2", "b3", "b4", "b5"])]]),
      lastDeliveryByCampaign: new Map(),
      suppressedBuyerIds: new Set(),
    });
    expect(rows[0].delivered).toBe(3);
    expect(rows[0].progressPct).toBe(100);
    expect(rows[0].delivered).toBeLessThanOrEqual(rows[0].totalRecipients);
  });

  it("current recipient WITH a historical successful send is delivered", () => {
    // The core happy-path: buyer on the recipient list AND has a
    // historical successful send → delivered.
    const c = campaign("A");
    const rows = computeCampaignProgress({
      campaigns: [c],
      recipientsByCampaign: new Map([["A", [recipient("A", "b1"), recipient("A", "b2")]]]),
      successfulBuyerIdsByCampaign: new Map([["A", new Set(["b1"])]]),
      lastDeliveryByCampaign: new Map(),
      suppressedBuyerIds: new Set(),
    });
    expect(rows[0].delivered).toBe(1);
    expect(rows[0].remaining).toBe(1);
  });

  it("orders active campaigns before other statuses, respects limit", () => {
    const rows = computeCampaignProgress({
      campaigns: [
        campaign("draft-1", { status: "draft", name: "Draft one" }),
        campaign("active-1", { status: "active", name: "Active one" }),
        campaign("active-2", { status: "active", name: "Active two" }),
        campaign("completed-1", { status: "completed", name: "Completed one" }),
        campaign("active-3", { status: "active", name: "Active three" }),
      ],
      recipientsByCampaign: new Map(),
      successfulBuyerIdsByCampaign: new Map(),
      lastDeliveryByCampaign: new Map(),
      suppressedBuyerIds: new Set(),
      limit: 3,
    });
    expect(rows.length).toBe(3);
    for (const r of rows) expect(r.campaign.status).toBe("active");
  });
});
