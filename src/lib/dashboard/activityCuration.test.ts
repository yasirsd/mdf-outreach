import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "@/lib/types";
import { curateOverviewActivity, isOverviewActivityKind } from "./activityCuration";

function ev(kind: string, at = "2026-08-27T09:00:00.000Z", i = ""): ActivityEvent {
  return { id: `${kind}-${i}`, at, kind, message: `${kind} — ${i}` };
}

describe("Overview activity curation", () => {
  it("shows meaningful operator events", () => {
    for (const k of [
      "buyer.added",
      "buyer.status",
      "buyer.suppressed",
      "campaign.created",
      "campaign.deleted",
      "campaign.status",
      "buyer-send.success",
      "buyer-send.failure",
      "gmail.connected",
      "gmail.disconnected",
    ]) {
      expect(isOverviewActivityKind(k)).toBe(true);
    }
  });

  it("excludes campaign.updated and email.prepared — the repetitive editing noise", () => {
    // These fire once per subject / template / section edit or per
    // recipient prepared. Full audit still visible on /activity.
    expect(isOverviewActivityKind("campaign.updated")).toBe(false);
    expect(isOverviewActivityKind("email.prepared")).toBe(false);
  });

  it("excludes noisy / technical / autosave kinds", () => {
    for (const k of [
      "settings.updated",
      "settings.brand.tab",
      "backup.exported",
      "gmail.testRecipient.added",
      "gmail.testRecipient.removed",
      "workspace.migrated",
      "autosave.pending",
      "tick",
      "buyer.updated",
    ]) {
      expect(isOverviewActivityKind(k)).toBe(false);
    }
  });

  it("does NOT surface repeated 'campaign.updated' events even when there are many", () => {
    // The primary regression this guards: an editing burst that produced
    // 6 identical "<name> updated" rows must be hidden from Overview.
    const events = Array.from({ length: 6 }, (_, i) => ({
      id: `evt-${i}`,
      at: `2026-08-27T09:0${i}:00.000Z`,
      kind: "campaign.updated",
      message: `Thailand 1st Sessions email updated`,
    }));
    const out = curateOverviewActivity(events, 8);
    expect(out.length).toBe(0);
  });

  it("caps to `limit` rows and preserves newest-first order — hides both noise kinds", () => {
    const events: ActivityEvent[] = [
      ev("buyer.added", "2026-08-27T09:00:00.000Z", "1"),
      ev("settings.updated", "2026-08-27T08:59:30.000Z", "noise-settings"),
      ev("campaign.updated", "2026-08-27T08:59:00.000Z", "noise-camp"),
      ev("campaign.created", "2026-08-27T08:58:00.000Z", "2"),
      ev("buyer.added", "2026-08-27T08:57:00.000Z", "3"),
      ev("buyer.added", "2026-08-27T08:56:00.000Z", "4"),
    ];
    const out = curateOverviewActivity(events, 3);
    expect(out.length).toBe(3);
    expect(out.map((e) => e.id)).toEqual(["buyer.added-1", "campaign.created-2", "buyer.added-3"]);
    expect(out.some((e) => e.kind === "settings.updated")).toBe(false);
    expect(out.some((e) => e.kind === "campaign.updated")).toBe(false);
  });

  it("attaches a semantic tone for the UI to pick an icon", () => {
    const out = curateOverviewActivity([
      ev("buyer-send.success", "2026-08-27T09:00:00.000Z", "s"),
      ev("buyer-send.failure", "2026-08-27T08:59:00.000Z", "f"),
      ev("campaign.created", "2026-08-27T08:58:00.000Z", "c"),
      ev("buyer.added", "2026-08-27T08:57:00.000Z", "b"),
      ev("gmail.disconnected", "2026-08-27T08:56:00.000Z", "g"),
    ]);
    const byId = Object.fromEntries(out.map((r) => [r.id, r.tone]));
    expect(byId["buyer-send.success-s"]).toBe("email");
    expect(byId["buyer-send.failure-f"]).toBe("email-fail");
    expect(byId["campaign.created-c"]).toBe("campaign");
    expect(byId["buyer.added-b"]).toBe("buyer");
    expect(byId["gmail.disconnected-g"]).toBe("gmail");
    expect(out.length).toBe(5);
  });
});
