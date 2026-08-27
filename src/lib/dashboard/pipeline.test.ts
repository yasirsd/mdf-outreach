import { describe, expect, it } from "vitest";
import type { Buyer, BuyerStatus } from "@/lib/types";
import { computePipeline } from "./pipeline";

function buyer(status: BuyerStatus): Buyer {
  return {
    id: `${status}-${Math.random()}`,
    firstName: "A",
    lastName: "B",
    company: "Co",
    email: "a@b.com",
    country: "India",
    status,
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
  };
}

describe("computePipeline — status → stage mapping", () => {
  it("groups statuses into visual stages without inventing counts", () => {
    const buyers: Buyer[] = [
      buyer("new"),
      buyer("qualified"),
      buyer("ready"),
      buyer("contacted"),
      buyer("contacted"),
      buyer("replied"),
      buyer("interested"),
      buyer("quotation-sent"),
      buyer("negotiating"),
      buyer("converted"),
      buyer("not-interested"),
    ];
    const p = computePipeline(buyers);
    const stageByKey = Object.fromEntries(p.stages.map((s) => [s.key, s]));

    expect(stageByKey.prospects.count).toBe(3); // new + qualified + ready
    expect(stageByKey.contacted.count).toBe(2);
    expect(stageByKey.engaged.count).toBe(2); // replied + interested
    expect(stageByKey.in_deal.count).toBe(2); // quotation-sent + negotiating
    expect(stageByKey.won.count).toBe(1); // converted
    expect(stageByKey.not_interested.count).toBe(1);
  });

  it("every buyer is represented in exactly ONE stage — sum equals total", () => {
    const buyers: Buyer[] = [
      buyer("new"),
      buyer("qualified"),
      buyer("contacted"),
      buyer("replied"),
      buyer("interested"),
      buyer("quotation-sent"),
      buyer("converted"),
      buyer("not-interested"),
    ];
    const p = computePipeline(buyers);
    const sum = p.stages.reduce((n, s) => n + s.count, 0);
    expect(sum).toBe(buyers.length);
    expect(p.total).toBe(buyers.length);
  });

  it("empty workspace yields total=0 and every stage=0", () => {
    const p = computePipeline([]);
    expect(p.total).toBe(0);
    for (const s of p.stages) expect(s.count).toBe(0);
  });

  it("breakdown surfaces the underlying canonical status counts", () => {
    const buyers: Buyer[] = [
      buyer("quotation-sent"),
      buyer("quotation-sent"),
      buyer("negotiating"),
    ];
    const p = computePipeline(buyers);
    const inDeal = p.stages.find((s) => s.key === "in_deal");
    expect(inDeal?.count).toBe(3);
    const bd = Object.fromEntries(inDeal!.breakdown.map((b) => [b.status, b.count]));
    expect(bd["quotation-sent"]).toBe(2);
    expect(bd["negotiating"]).toBe(1);
  });
});
