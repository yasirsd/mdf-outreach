import { describe, expect, it } from "vitest";
import { createSupabaseRepositories } from "./repositories";

/**
 * F8 — Buyers pagination shape tests.
 *
 * We wrap a fake Supabase client that captures every fluent-builder call
 * so we can assert:
 *   • Correct table and select shape (with count: 'exact')
 *   • Range translates page/pageSize into 0-indexed [from, to] inclusive
 *   • search / status / country / product are AND-composed on the server
 *   • search is safely escaped (no injectable commas or parens)
 *   • pageSize is clamped to [1, 200]
 *   • RLS still applies (we don't set workspace_id ourselves — Supabase
 *     policies enforce it)
 *
 * The fake client does NOT contact Supabase — pure unit test.
 */

interface CapturedCall {
  fn: string;
  args: unknown[];
}

function makeFakeSupabase({
  rows = [],
  count = 0,
  error = null,
}: { rows?: unknown[]; count?: number; error?: unknown | null } = {}) {
  const calls: CapturedCall[] = [];
  const builder: Record<string, unknown> = {};
  const chain = new Proxy(builder, {
    get(_target, prop) {
      if (prop === "then") {
        // await point — return the terminal result
        return (resolve: (v: unknown) => void) =>
          resolve({ data: rows, count, error });
      }
      return (...args: unknown[]) => {
        calls.push({ fn: String(prop), args });
        return chain;
      };
    },
  });
  return {
    supabase: {
      from(table: string) {
        calls.push({ fn: "from", args: [table] });
        return chain;
      },
    },
    calls,
  };
}

describe("BuyerRepository.listPaginated — query shape", () => {
  it("selects with count:'exact' and orders by updated_at desc", async () => {
    const { supabase, calls } = makeFakeSupabase();
    const repos = createSupabaseRepositories(supabase as never, "ws-1");
    await repos.buyers.listPaginated({ page: 1, pageSize: 25 });
    expect(calls.some((c) => c.fn === "from" && c.args[0] === "buyers")).toBe(true);
    const select = calls.find((c) => c.fn === "select");
    expect(select?.args[1]).toEqual({ count: "exact" });
    const order = calls.find((c) => c.fn === "order");
    expect(order?.args).toEqual(["updated_at", { ascending: false }]);
  });

  it("translates page/pageSize into inclusive 0-indexed range", async () => {
    const { supabase, calls } = makeFakeSupabase();
    const repos = createSupabaseRepositories(supabase as never, "ws-1");
    await repos.buyers.listPaginated({ page: 3, pageSize: 25 });
    const range = calls.find((c) => c.fn === "range");
    // Page 3 of 25 → rows 50..74 inclusive.
    expect(range?.args).toEqual([50, 74]);
  });

  it("clamps pageSize to [1, 200]", async () => {
    const { supabase, calls } = makeFakeSupabase();
    const repos = createSupabaseRepositories(supabase as never, "ws-1");
    await repos.buyers.listPaginated({ page: 1, pageSize: 9999 });
    const range = calls.find((c) => c.fn === "range");
    // Clamped to 200 → 0..199.
    expect(range?.args).toEqual([0, 199]);
  });

  it("AND-composes status/country/product server-side", async () => {
    const { supabase, calls } = makeFakeSupabase();
    const repos = createSupabaseRepositories(supabase as never, "ws-1");
    await repos.buyers.listPaginated({
      page: 1,
      pageSize: 25,
      status: "contacted",
      country: "India",
      product: "Guntur Dry Red Chilli",
    });
    const eqs = calls.filter((c) => c.fn === "eq");
    const map = Object.fromEntries(eqs.map((e) => [e.args[0] as string, e.args[1]]));
    expect(map.status).toBe("contacted");
    expect(map.country).toBe("India");
    expect(map.product_interest).toBe("Guntur Dry Red Chilli");
  });

  it("search expands into a case-insensitive OR across name/email/company", async () => {
    const { supabase, calls } = makeFakeSupabase();
    const repos = createSupabaseRepositories(supabase as never, "ws-1");
    await repos.buyers.listPaginated({ page: 1, pageSize: 25, search: "smith" });
    const or = calls.find((c) => c.fn === "or");
    expect(typeof or?.args[0]).toBe("string");
    expect(or?.args[0]).toContain("company.ilike.*smith*");
    expect(or?.args[0]).toContain("first_name.ilike.*smith*");
    expect(or?.args[0]).toContain("last_name.ilike.*smith*");
    expect(or?.args[0]).toContain("email.ilike.*smith*");
  });

  it("search string is bounded to 128 characters", async () => {
    const { supabase, calls } = makeFakeSupabase();
    const repos = createSupabaseRepositories(supabase as never, "ws-1");
    // Use a character that never appears in the OR expression's
    // column names / operator syntax so the count of it isolates the
    // needle length precisely.
    const long = "z".repeat(500);
    await repos.buyers.listPaginated({ page: 1, pageSize: 25, search: long });
    const or = calls.find((c) => c.fn === "or");
    const raw = String(or?.args[0]);
    const zCount = (raw.match(/z/g) ?? []).length;
    // Four branches × 128 chars each.
    expect(zCount).toBe(128 * 4);
  });

  it("search value is escaped so a stray comma/paren cannot inject a new filter branch", async () => {
    const { supabase, calls } = makeFakeSupabase();
    const repos = createSupabaseRepositories(supabase as never, "ws-1");
    await repos.buyers.listPaginated({
      page: 1,
      pageSize: 25,
      search: "abc),email.eq.leak@evil.com",
    });
    const or = calls.find((c) => c.fn === "or");
    const raw = String(or?.args[0]);
    // No commas or parens beyond the four we generate.
    // Extra commas would enable injection into the OR expression.
    const dangerous = raw.match(/[(),]/g)?.length ?? 0;
    expect(dangerous).toBe(3); // just the three separators between the 4 branches
  });

  it("returns total + pageCount honestly from the count response", async () => {
    const { supabase } = makeFakeSupabase({ count: 137, rows: [] });
    const repos = createSupabaseRepositories(supabase as never, "ws-1");
    const r = await repos.buyers.listPaginated({ page: 1, pageSize: 25 });
    expect(r.total).toBe(137);
    expect(r.pageCount).toBe(Math.ceil(137 / 25));
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(25);
  });

  it("throws when Supabase returns an error", async () => {
    const { supabase } = makeFakeSupabase({ error: { message: "boom" } });
    const repos = createSupabaseRepositories(supabase as never, "ws-1");
    await expect(
      repos.buyers.listPaginated({ page: 1, pageSize: 25 }),
    ).rejects.toBeTruthy();
  });
});
