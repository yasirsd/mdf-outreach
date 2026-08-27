import { describe, expect, it } from "vitest";
import { searchCitiesAction } from "./citySearch";

describe("searchCitiesAction — country scoping", () => {
  it("returns Dubai when searching 'Dub' in United Arab Emirates", async () => {
    const results = await searchCitiesAction({
      country: "United Arab Emirates",
      query: "Dub",
    });
    expect(results.some((r) => r.name === "Dubai")).toBe(true);
  });

  it("returns Bangkok when searching 'Bang' in Thailand", async () => {
    const results = await searchCitiesAction({
      country: "Thailand",
      query: "Bang",
    });
    expect(results.some((r) => r.name === "Bangkok")).toBe(true);
  });

  it("returns Ongole when searching 'Ong' in India", async () => {
    const results = await searchCitiesAction({
      country: "India",
      query: "Ong",
    });
    expect(results.some((r) => r.name === "Ongole")).toBe(true);
  });

  it("cannot return another country's city (e.g. no Bangkok when country=UAE)", async () => {
    const results = await searchCitiesAction({
      country: "United Arab Emirates",
      query: "Bangkok",
    });
    expect(results.some((r) => r.name === "Bangkok")).toBe(false);
  });

  it("empty query short-circuits with no results (no DB scan)", async () => {
    const results = await searchCitiesAction({
      country: "India",
      query: "   ",
    });
    expect(results).toEqual([]);
  });

  it("unknown / legacy country name returns [] — custom entry still handled by combobox", async () => {
    const results = await searchCitiesAction({
      country: "Ancient Wakanda",
      query: "Dubai",
    });
    expect(results).toEqual([]);
  });

  it("null country returns [] (custom-entry path)", async () => {
    const results = await searchCitiesAction({
      country: null,
      query: "Dubai",
    });
    expect(results).toEqual([]);
  });

  it("limits results to ≤ 20", async () => {
    const results = await searchCitiesAction({ country: "India", query: "a" });
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it("ranks prefix matches before substring matches", async () => {
    // Ongole starts with "Ong" — should appear before any substring
    // "ong" matches like "Kongo" if such existed.
    const results = await searchCitiesAction({ country: "India", query: "Ong" });
    const firstOngole = results.findIndex((r) => r.name === "Ongole");
    // Every earlier result (if any) also starts with Ong.
    for (let i = 0; i < firstOngole; i++) {
      expect(results[i].name.toLowerCase().startsWith("ong")).toBe(true);
    }
  });

  it("deduplicates records with the SAME name AND SAME admin (identity)", async () => {
    const results = await searchCitiesAction({ country: "India", query: "a" });
    const seen = new Set(
      results.map((r) => `${r.name.toLowerCase()}|${(r.admin ?? "").toLowerCase()}`),
    );
    expect(seen.size).toBe(results.length);
  });

  it("keeps same-name cities in DIFFERENT admin regions as distinct rows (Springfield, IL vs MA)", async () => {
    const results = await searchCitiesAction({
      country: "United States",
      query: "Spring",
    });
    const springfields = results.filter((r) => r.name === "Springfield");
    // Multiple Springfields exist in the US dataset — the dedupe must
    // not collapse them into one row.
    expect(springfields.length).toBeGreaterThanOrEqual(2);
    // Each must carry a distinct admin so the operator can tell them
    // apart in the UI.
    const admins = new Set(springfields.map((s) => s.admin));
    expect(admins.size).toBe(springfields.length);
    // Illinois and Massachusetts both present.
    expect(springfields.some((s) => s.admin === "Illinois")).toBe(true);
    expect(springfields.some((s) => s.admin === "Massachusetts")).toBe(true);
  });

  it("cannot leak a same-name city from another country", async () => {
    // Query 'Spring' in Thailand → must return NO Springfield-anywhere
    // even though Springfield exists in the US dataset.
    const results = await searchCitiesAction({
      country: "Thailand",
      query: "Spring",
    });
    for (const r of results) {
      expect(r.name).not.toBe("Springfield");
    }
  });

  it("result rows surface the admin field so the UI can render context", async () => {
    const results = await searchCitiesAction({
      country: "United States",
      query: "Spring",
    });
    // At least one result carries a non-empty admin. City-timezones
    // does not always populate admin (a handful of rows are blank),
    // but for real US cities like Springfield/Illinois it does.
    expect(results.some((r) => r.admin && r.admin.length > 0)).toBe(true);
  });
});
