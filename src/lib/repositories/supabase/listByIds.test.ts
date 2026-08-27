import { describe, it, expect, vi } from "vitest";
import { createSupabaseRepositories } from "./repositories";

/**
 * F3 — BuyerRepository.listByIds contract:
 *   • empty ids ⇒ NO DB query
 *   • dedupes duplicate ids
 *   • chunks large id lists across multiple queries
 *   • workspace scoping remains implicit via RLS (the Supabase client
 *     handed to createSupabaseRepositories is authenticated).
 */

function makeSpyClient() {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  return {
    calls,
    from(table: string) {
      const state = { table, filters: [] as Array<[string, unknown]> };
      const builder: unknown = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          state.filters.push([col, val]);
          return builder;
        },
        ilike() {
          return builder;
        },
        in(col: string, vals: unknown[]) {
          calls.push({ table: state.table, op: "in", args: [col, vals] });
          return Promise.resolve({
            data: vals.map((id) => ({
              id,
              workspace_id: "ws-a",
              first_name: "",
              last_name: "",
              company: "",
              email: `${id}@x`,
              phone: null,
              whatsapp: null,
              website: null,
              country: "",
              city: null,
              buyer_type: null,
              product_interest: null,
              source: null,
              notes: null,
              status: "new",
              last_contacted_at: null,
              next_follow_up_at: null,
              suppressed: false,
              suppression_reason: null,
              suppressed_at: null,
              created_at: "x",
              updated_at: "x",
            })),
            error: null,
          });
        },
      };
      return builder;
    },
  };
}

describe("BuyerRepository.listByIds", () => {
  it("returns [] immediately for an empty id list — no DB query", async () => {
    const client = makeSpyClient();
    // The repository accepts any SupabaseClient shape via structural typing.
    const repos = createSupabaseRepositories(client as never, "ws-a");
    const result = await repos.buyers.listByIds([]);
    expect(result).toEqual([]);
    expect(client.calls).toHaveLength(0);
  });

  it("dedupes duplicate ids in a single call", async () => {
    const client = makeSpyClient();
    const repos = createSupabaseRepositories(client as never, "ws-a");
    const rows = await repos.buyers.listByIds(["a", "b", "a", "b", "a"]);
    expect(client.calls).toHaveLength(1);
    const [call] = client.calls;
    expect(call.op).toBe("in");
    expect(new Set(call.args[1] as string[])).toEqual(new Set(["a", "b"]));
    expect(rows).toHaveLength(2);
  });

  it("chunks large id lists (>200) across multiple in() queries", async () => {
    const client = makeSpyClient();
    const repos = createSupabaseRepositories(client as never, "ws-a");
    const ids = Array.from({ length: 450 }, (_, i) => `id-${i}`);
    const rows = await repos.buyers.listByIds(ids);
    // 200 + 200 + 50 → 3 chunks.
    expect(client.calls).toHaveLength(3);
    expect(rows).toHaveLength(450);
  });
});
