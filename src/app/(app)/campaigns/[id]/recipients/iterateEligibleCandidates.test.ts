import { describe, expect, it, vi } from "vitest";
import type { Buyer } from "@/lib/types";
import { iterateEligibleCandidates } from "./actions";

function buyer(id: string): Buyer {
  return {
    id,
    firstName: `First-${id}`,
    lastName: `Last-${id}`,
    company: `Co-${id}`,
    email: `${id}@example.com`,
    country: "India",
    status: "new",
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
  };
}

function makeSource(allIds: string[]) {
  const rows = allIds.map((id) => ({ id, buyer: buyer(id) }));
  const fetchPage = vi.fn(async (page: number, chunkSize: number) => {
    const from = (page - 1) * chunkSize;
    const to = from + chunkSize;
    return { rows: rows.slice(from, to), total: rows.length };
  });
  return { rows, fetchPage };
}

describe("iterateEligibleCandidates — the F9 false-empty regression", () => {
  it("first 50 matching buyers are already recipients, eligible buyers exist at 51-75 — action still returns eligible rows", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `b${i + 1}`);
    const excludedIds = new Set(ids.slice(0, 50)); // first 50 already recipients
    const { fetchPage } = makeSource(ids);
    const result = await iterateEligibleCandidates({
      fetchPage,
      excludedIds,
      pageSize: 25,
      scanChunkSize: 100,
    });
    expect(result.rows.length).toBe(25);
    // Rows should be the 51st through 75th eligible buyers.
    expect(result.rows[0].id).toBe("b51");
    expect(result.rows[24].id).toBe("b75");
  });

  it("returns TRUE empty ONLY when every match is already a recipient", async () => {
    const ids = Array.from({ length: 40 }, (_, i) => `b${i + 1}`);
    const excludedIds = new Set(ids);
    const { fetchPage } = makeSource(ids);
    const result = await iterateEligibleCandidates({
      fetchPage,
      excludedIds,
      pageSize: 25,
      scanChunkSize: 100,
    });
    expect(result.rows.length).toBe(0);
    expect(result.exhausted).toBe(true);
    expect(result.hitScanCap).toBe(false);
  });

  it("returns at most pageSize rows", async () => {
    const ids = Array.from({ length: 500 }, (_, i) => `b${i + 1}`);
    const { fetchPage } = makeSource(ids);
    const result = await iterateEligibleCandidates({
      fetchPage,
      excludedIds: new Set(),
      pageSize: 25,
      scanChunkSize: 100,
    });
    expect(result.rows.length).toBe(25);
  });

  it("no returned buyer is already a recipient", async () => {
    const ids = Array.from({ length: 200 }, (_, i) => `b${i + 1}`);
    const excludedIds = new Set([
      "b1", "b5", "b7", "b30", "b50", "b100", "b120",
    ]);
    const { fetchPage } = makeSource(ids);
    const result = await iterateEligibleCandidates({
      fetchPage,
      excludedIds,
      pageSize: 25,
      scanChunkSize: 100,
    });
    for (const r of result.rows) {
      expect(excludedIds.has(r.id)).toBe(false);
    }
  });

  it("same buyer never returned twice even if a source page returns duplicates", async () => {
    // Corrupt source: chunk 1 returns b1..b3, chunk 2 also returns b3
    // (simulating an unstable source ordering during pagination).
    const b1 = buyer("b1");
    const b2 = buyer("b2");
    const b3 = buyer("b3");
    const b4 = buyer("b4");
    const fetchPage = vi.fn(async (page: number) => {
      if (page === 1)
        return {
          rows: [
            { id: "b1", buyer: b1 },
            { id: "b2", buyer: b2 },
            { id: "b3", buyer: b3 },
          ],
          total: 100,
        };
      if (page === 2)
        return {
          rows: [
            { id: "b3", buyer: b3 }, // duplicate on purpose
            { id: "b4", buyer: b4 },
          ],
          total: 100,
        };
      return { rows: [], total: 100 };
    });
    const result = await iterateEligibleCandidates({
      fetchPage,
      excludedIds: new Set(),
      pageSize: 25,
      scanChunkSize: 3,
    });
    const ids = result.rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["b1", "b2", "b3", "b4"]);
  });

  it("total DB rows scanned is bounded by maxScanRows", async () => {
    // 5_000 buyers, all excluded → we scan 1000 (cap), find nothing.
    const ids = Array.from({ length: 5_000 }, (_, i) => `b${i + 1}`);
    const { fetchPage } = makeSource(ids);
    const result = await iterateEligibleCandidates({
      fetchPage,
      excludedIds: new Set(ids),
      pageSize: 25,
      scanChunkSize: 100,
      maxScanRows: 1000,
    });
    expect(result.rows.length).toBe(0);
    expect(result.scannedRows).toBe(1000);
    expect(result.hitScanCap).toBe(true);
    expect(result.exhausted).toBe(false);
  });

  it("stops as soon as pageSize eligible rows are collected — does NOT scan the full cap unnecessarily", async () => {
    // 500 rows; none excluded; pageSize 25; expect exactly one chunk read.
    const ids = Array.from({ length: 500 }, (_, i) => `b${i + 1}`);
    const { fetchPage } = makeSource(ids);
    const result = await iterateEligibleCandidates({
      fetchPage,
      excludedIds: new Set(),
      pageSize: 25,
      scanChunkSize: 100,
    });
    expect(result.rows.length).toBe(25);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.scannedRows).toBe(100);
  });

  it("exhausted=true when source runs out mid-search", async () => {
    const ids = ["b1", "b2", "b3", "b4"];
    const { fetchPage } = makeSource(ids);
    const result = await iterateEligibleCandidates({
      fetchPage,
      excludedIds: new Set(),
      pageSize: 25,
      scanChunkSize: 100,
    });
    expect(result.rows.length).toBe(4);
    expect(result.exhausted).toBe(true);
    expect(result.hitScanCap).toBe(false);
  });
});
