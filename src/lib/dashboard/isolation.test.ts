import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard rail: the F6 dashboard is a READ surface only. It must never
 * import Buyer Send mutation actions or the send loop, and it must not
 * flip the BUYER_SEND_ENABLED gate. This file greps the shipped source
 * to prove it.
 */
const DASH_DIR = path.resolve(process.cwd(), "src/lib/dashboard");

function readAll(file: string): string {
  return readFileSync(path.join(DASH_DIR, file), "utf8");
}

describe("Dashboard module isolation from Buyer Send", () => {
  const FILES = [
    "loadOverviewDashboard.ts",
    "range.ts",
    "timeSeries.ts",
    "timezone.ts",
    "pipeline.ts",
    "needsAttention.ts",
    "campaignProgress.ts",
    "activityCuration.ts",
  ];

  for (const f of FILES) {
    it(`${f} contains no buyer-send mutation imports`, () => {
      const src = readAll(f);
      expect(src).not.toMatch(/recordBuyerSendEvent/);
      expect(src).not.toMatch(/sendBuyerEmail/);
      expect(src).not.toMatch(/BUYER_SEND_ENABLED/);
      // No writes to email_send_events either.
      expect(src).not.toMatch(/\.insert\(\s*\{[^}]*email_send_events/);
      expect(src).not.toMatch(/from\("email_send_events"\)[\s\S]*\.insert\(/);
    });
  }
});

describe("Dashboard module isolation from Buyer Finder", () => {
  it("dashboard imports nothing from buyerFinder or hunter", () => {
    for (const f of [
      "loadOverviewDashboard.ts",
      "range.ts",
      "timeSeries.ts",
      "timezone.ts",
      "pipeline.ts",
      "needsAttention.ts",
      "campaignProgress.ts",
      "activityCuration.ts",
    ]) {
      const src = readAll(f);
      expect(src).not.toMatch(/buyerFinder|buyer-finder|hunter/i);
    }
  });
});
