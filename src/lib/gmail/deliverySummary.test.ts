import { describe, it, expect } from "vitest";
import { computeDeliverySummary } from "./deliverySummary";
import type { BuyerReadinessRow } from "./buyerSendReadiness";
import type { BuyerSendHistoryRow } from "./buyerSendAudit";

const T1 = "2026-08-26T10:00:00.000Z";
const T2 = "2026-08-26T10:05:00.000Z";
const T3 = "2026-08-26T10:10:00.000Z";

function ready(id: string): BuyerReadinessRow {
  return { buyerId: id, status: "ready", reasons: [] };
}
function blocked(id: string, reason = "Do not contact."): BuyerReadinessRow {
  return { buyerId: id, status: "blocked", reasons: [reason] };
}
function alreadySent(id: string): BuyerReadinessRow {
  return { buyerId: id, status: "already-sent", reasons: ["Already sent this campaign."] };
}
function ev(over: Partial<BuyerSendHistoryRow>): BuyerSendHistoryRow {
  return {
    id: `ev-${over.buyerId}-${over.createdAt}`,
    createdAt: T1,
    campaignId: "c1",
    buyerId: null,
    recipientEmail: "x@y.z",
    subject: "",
    ok: true,
    error: null,
    gmailMessageId: null,
    gmailThreadId: null,
    templateId: null,
    templateVariant: null,
    templateVersion: null,
    ...over,
  };
}

describe("computeDeliverySummary", () => {
  it("counts Ready / Blocked / Already-sent from the readiness rows", () => {
    const s = computeDeliverySummary({
      rows: [ready("a"), blocked("b"), alreadySent("c")],
      history: [],
    });
    expect(s.totalRecipients).toBe(3);
    expect(s.ready).toBe(1);
    expect(s.blocked).toBe(1);
    expect(s.alreadySent).toBe(1);
  });

  it("counts a successful buyer exactly ONCE even if they have multiple ok=true rows", () => {
    const s = computeDeliverySummary({
      rows: [alreadySent("a")],
      history: [
        ev({ buyerId: "a", ok: true, createdAt: T1 }),
        ev({ buyerId: "a", ok: true, createdAt: T2 }),
      ],
    });
    expect(s.successful).toBe(1);
    expect(s.failed).toBe(0);
    expect(s.lastDeliveryAt).toBe(T2);
  });

  it("does NOT count a failed historical attempt as Already sent — historical failures ONLY populate `failed` when the buyer has no success", () => {
    const s = computeDeliverySummary({
      rows: [ready("a")],
      history: [ev({ buyerId: "a", ok: false, error: "network", createdAt: T1 })],
    });
    expect(s.alreadySent).toBe(0);
    expect(s.failed).toBe(1);
    expect(s.successful).toBe(0);
  });

  it("prefers latest attempt: buyer with a later successful send is counted successful, not failed", () => {
    const s = computeDeliverySummary({
      rows: [alreadySent("a")],
      history: [
        ev({ buyerId: "a", ok: false, error: "x", createdAt: T1 }),
        ev({ buyerId: "a", ok: true, createdAt: T2 }),
      ],
    });
    expect(s.successful).toBe(1);
    expect(s.failed).toBe(0);
  });

  it("Never attempted = recipients with zero events (of any kind)", () => {
    const s = computeDeliverySummary({
      rows: [ready("a"), ready("b"), ready("c")],
      history: [ev({ buyerId: "b", ok: true, createdAt: T1 })],
    });
    expect(s.neverAttempted).toBe(2); // a + c
  });

  it("Blocked-by-safety-gate event (ok=false) does NOT mark buyer as Already sent", () => {
    const s = computeDeliverySummary({
      rows: [ready("a")],
      history: [
        ev({
          buyerId: "a",
          ok: false,
          error: "BUYER_SEND_ENABLED is false — production Buyer Send is not enabled on this server.",
          createdAt: T1,
        }),
      ],
    });
    // Readiness engine already excluded the buyer from Already-sent
    // (this test just proves the summary agrees).
    expect(s.alreadySent).toBe(0);
    expect(s.failed).toBe(1);
  });

  it("campaignDeliveryComplete is true only when every eligible recipient succeeded", () => {
    const s = computeDeliverySummary({
      rows: [alreadySent("a"), alreadySent("b")],
      history: [
        ev({ buyerId: "a", ok: true, createdAt: T1 }),
        ev({ buyerId: "b", ok: true, createdAt: T2 }),
      ],
    });
    expect(s.campaignDeliveryComplete).toBe(true);
  });

  it("campaignDeliveryComplete is false when there is still a Ready buyer", () => {
    const s = computeDeliverySummary({
      rows: [alreadySent("a"), ready("b")],
      history: [ev({ buyerId: "a", ok: true, createdAt: T1 })],
    });
    expect(s.campaignDeliveryComplete).toBe(false);
  });

  it("empty campaign returns zeroed but valid summary", () => {
    const s = computeDeliverySummary({ rows: [], history: [] });
    expect(s.totalRecipients).toBe(0);
    expect(s.campaignDeliveryComplete).toBe(false);
    expect(s.lastDeliveryAt).toBeNull();
  });

  it("lastDeliveryAt is the newest ok=true timestamp, ignoring failures", () => {
    const s = computeDeliverySummary({
      rows: [alreadySent("a"), alreadySent("b")],
      history: [
        ev({ buyerId: "a", ok: true, createdAt: T1 }),
        ev({ buyerId: "b", ok: false, error: "x", createdAt: T3 }),
        ev({ buyerId: "b", ok: true, createdAt: T2 }),
      ],
    });
    expect(s.lastDeliveryAt).toBe(T2);
  });
});
