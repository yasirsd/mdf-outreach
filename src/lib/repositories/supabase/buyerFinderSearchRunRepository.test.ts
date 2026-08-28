import { describe, expect, it, vi } from "vitest";
import { createBuyerFinderSearchRunRepository } from "./buyerFinderSearchRunRepository";

function chain(capture: Record<string, unknown>[], result: { data: unknown; error: null }) {
  const state: Record<string, unknown> = { filters: [] as unknown[] };
  const api: Record<string, unknown> = {};
  api.insert = (row: unknown) => {
    state.op = "insert";
    state.payload = row;
    return api;
  };
  api.update = (row: unknown) => {
    state.op = "update";
    state.payload = row;
    return api;
  };
  api.select = () => api;
  api.eq = (k: string, v: unknown) => {
    (state.filters as unknown[]).push(["eq", k, v]);
    return api;
  };
  api.in = (k: string, v: unknown) => {
    (state.filters as unknown[]).push(["in", k, v]);
    return api;
  };
  api.order = () => api;
  api.limit = () => api;
  api.maybeSingle = async () => {
    capture.push({ ...state });
    return result;
  };
  api.single = async () => {
    capture.push({ ...state });
    return result;
  };
  return api;
}

describe("Supabase Search Run claim SQL shape", () => {
  it("claimQueued issues a single update filtered by id AND status=queued", async () => {
    const capture: Record<string, unknown>[] = [];
    const supabase = {
      from: (table: string) => {
        expect(table).toBe("buyer_finder_search_runs");
        return chain(capture, { data: null, error: null });
      },
    };
    const repo = createBuyerFinderSearchRunRepository(supabase as never, "ws-a");
    await repo.claimQueued("00000000-0000-4000-8000-000000000001");
    expect(capture).toHaveLength(1);
    expect(capture[0]?.op).toBe("update");
    expect(capture[0]?.payload).toMatchObject({ status: "running", stage: "preparing" });
    expect(capture[0]?.filters).toEqual([
      ["eq", "id", "00000000-0000-4000-8000-000000000001"],
      ["eq", "status", "queued"],
    ]);
  });

  it("getLatestActive filters queued/running only", async () => {
    const capture: Record<string, unknown>[] = [];
    const supabase = {
      from: () => chain(capture, { data: null, error: null }),
    };
    const repo = createBuyerFinderSearchRunRepository(supabase as never, "ws-a");
    await repo.getLatestActive();
    expect(capture[0]?.filters).toContainEqual(["in", "status", ["queued", "running"]]);
  });
});
