import { describe, it, expect } from "vitest";
import {
  DECORATIVE_SLOTS,
  requiredSlotsForRendering,
} from "./sectionAssetRequirements";
import type { EmailSection } from "@/lib/types";

function sec(type: EmailSection["type"], visible = true): EmailSection {
  return { id: `${type}-1`, type, visible, data: {} };
}

describe("requiredSlotsForRendering — Signature", () => {
  it("empty section list requires nothing", () => {
    expect([...requiredSlotsForRendering([], "signature")]).toEqual([]);
  });

  it("visible hero requires 'hero'", () => {
    expect([...requiredSlotsForRendering([sec("hero")], "signature")]).toEqual(["hero"]);
  });

  it("visible origin requires 'origin' (never hero — hero is a graceful fallback)", () => {
    expect([...requiredSlotsForRendering([sec("origin")], "signature")]).toEqual(["origin"]);
  });

  it("visible packing requires 'packing'", () => {
    expect([...requiredSlotsForRendering([sec("packing")], "signature")]).toEqual(["packing"]);
  });

  it("formats requires no slots (per-format cells fall back gracefully)", () => {
    expect([...requiredSlotsForRendering([sec("formats")], "signature")]).toEqual([]);
  });

  it.each(["intro", "heritage", "why", "cta", "footer"] as const)(
    "%s requires no slots",
    (type) => {
      expect([...requiredSlotsForRendering([sec(type)], "signature")]).toEqual([]);
    },
  );

  it("aggregates required slots across multiple visible sections without duplicates", () => {
    const set = requiredSlotsForRendering(
      [sec("intro"), sec("hero"), sec("origin"), sec("packing")],
      "signature",
    );
    expect(new Set(set)).toEqual(new Set(["hero", "origin", "packing"]));
  });
});

describe("requiredSlotsForRendering — Direct", () => {
  it("requires 'hero' only when the hero section is present in the effective set", () => {
    // Hero present ⇒ required.
    expect([...requiredSlotsForRendering([sec("hero")], "direct")]).toEqual(["hero"]);
    // Hero missing (e.g. operator hid it in the composer) ⇒ not required.
    expect([...requiredSlotsForRendering([sec("intro"), sec("cta")], "direct")]).toEqual([]);
    // Empty effective set ⇒ nothing required.
    expect([...requiredSlotsForRendering([], "direct")]).toEqual([]);
  });
});

describe("Decorative slots", () => {
  it("texture / divider / doodle are decorative and never required", () => {
    expect(DECORATIVE_SLOTS.has("texture")).toBe(true);
    expect(DECORATIVE_SLOTS.has("divider")).toBe(true);
    expect(DECORATIVE_SLOTS.has("doodle")).toBe(true);
  });
});
