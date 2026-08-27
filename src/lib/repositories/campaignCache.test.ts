import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * F2 — the request-scoped cached campaign getter uses React.cache().
 * Within a single React render pass, calling getCachedCampaign(id) twice
 * with the same id must run the underlying serverRepositories/get once.
 *
 * The mock here counts underlying calls to prove dedupe. React.cache is
 * request-scoped in the app; in a node test we get one "logical request"
 * per module import.
 */

const getSpy = vi.fn(async (id: string) => ({ id, name: `Campaign ${id}` }));

// React's `cache` is a Server Components API — undefined in jsdom. Mock
// it with a real Map-backed memoiser so the dedupe contract can be
// asserted in tests. Production Next.js supplies the real implementation.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
      const store = new Map<string, R>();
      return ((...args: A): R => {
        const key = JSON.stringify(args);
        if (store.has(key)) return store.get(key) as R;
        const result = fn(...args);
        store.set(key, result);
        return result;
      }) as (...args: A) => R;
    },
  };
});

vi.mock("./server", () => ({
  serverRepositories: async () => ({
    session: { userId: "u", email: "e", membership: { workspaceId: "w" } },
    repos: {
      campaigns: {
        get: (id: string) => getSpy(id),
      },
    },
  }),
}));

// Import AFTER the mocks.
const { getCachedCampaign } = await import("./campaignCache");

afterEach(() => {
  getSpy.mockClear();
});

describe("getCachedCampaign — request-scoped dedupe", () => {
  it("returns the same result and calls the underlying repo once for repeat calls", async () => {
    const [a, b, c] = await Promise.all([
      getCachedCampaign("c1"),
      getCachedCampaign("c1"),
      getCachedCampaign("c1"),
    ]);
    expect(a).toEqual({ id: "c1", name: "Campaign c1" });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it("still resolves distinct ids independently (one call per unique id)", async () => {
    await Promise.all([
      getCachedCampaign("c-alpha"),
      getCachedCampaign("c-beta"),
      getCachedCampaign("c-alpha"),
    ]);
    // c-alpha and c-beta each get resolved once.
    expect(getSpy.mock.calls.map((c) => c[0]).sort()).toEqual([
      "c-alpha",
      "c-beta",
    ]);
  });
});
