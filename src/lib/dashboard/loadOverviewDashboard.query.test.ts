import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * F6 correctness guardrail: the "successful buyer send" filter must be
 * enforced at the SQL layer, not by post-hoc defence-in-depth in the
 * aggregator. This test inspects the actual loader source to prove
 * both fetchers apply `kind='buyer-send'` AND `ok=true` before rows
 * ever reach `buildSendTimeSeries`.
 */
const LOADER = path.resolve(
  process.cwd(),
  "src/lib/dashboard/loadOverviewDashboard.ts",
);

const SOURCE = readFileSync(LOADER, "utf8");

describe("loadOverviewDashboard — SQL-authoritative send filter", () => {
  it("selects only the three narrow columns from email_send_events", () => {
    // Both fetchers use the same select shape.
    expect(SOURCE).toContain('.select("created_at, buyer_id, campaign_id")');
  });

  it("filters kind='buyer-send' at the SQL layer (not the aggregator)", () => {
    const kindHits = SOURCE.match(/\.eq\(\s*"kind"\s*,\s*"buyer-send"\s*\)/g);
    expect(kindHits).not.toBeNull();
    // Both the range-bounded and the lifetime aggregate fetchers.
    expect(kindHits!.length).toBeGreaterThanOrEqual(2);
  });

  it("filters ok=true at the SQL layer", () => {
    const okHits = SOURCE.match(/\.eq\(\s*"ok"\s*,\s*true\s*\)/g);
    expect(okHits).not.toBeNull();
    expect(okHits!.length).toBeGreaterThanOrEqual(2);
  });

  it("range-bounded fetcher uses .gte/.lt for created_at", () => {
    expect(SOURCE).toContain('.gte("created_at",');
    expect(SOURCE).toContain('.lt("created_at",');
  });

  it("lifetime-scoped aggregate uses .in('campaign_id', ...) (not window-bounded)", () => {
    expect(SOURCE).toMatch(/fetchLifetimeSuccessfulSends[\s\S]{0,600}\.in\("campaign_id"/);
  });

  it("aggregate recipient query uses .in('campaign_id', ...) — one query, not per-campaign fan-out", () => {
    expect(SOURCE).toMatch(/from\("campaign_recipients"\)[\s\S]{0,400}\.in\("campaign_id"/);
  });

  it("has no ACTIVE_CAMPAIGN_CAP that could produce a false all-clear", () => {
    // The cap was removed in the F6 correctness follow-up: needs-attention
    // must see every active campaign.
    expect(SOURCE).not.toMatch(/ACTIVE_CAMPAIGN_CAP/);
  });

  it("fetchLifetimeSuccessfulSends short-circuits on an empty campaign union", () => {
    // Guardrail: PostgREST rejects an empty .in() list. If the union
    // is empty (e.g. no active campaigns AND no non-active fill), the
    // helper must return [] BEFORE issuing the query.
    expect(SOURCE).toMatch(
      /async function fetchLifetimeSuccessfulSends[\s\S]{0,200}if\s*\(\s*campaignIds\.length\s*===\s*0\s*\)\s*return\s*\[\]/,
    );
  });

  it("fetchRecipientsForCampaigns short-circuits on an empty campaign union", () => {
    expect(SOURCE).toMatch(
      /async function fetchRecipientsForCampaigns[\s\S]{0,200}if\s*\(\s*campaignIds\.length\s*===\s*0\s*\)\s*return\s*\[\]/,
    );
  });
});
