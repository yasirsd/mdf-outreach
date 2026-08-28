import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SESSION = { userId: "user-a", membership: { workspaceId: "ws-a" } };

const harness = {
  requireMdfSession: vi.fn(async () => SESSION),
  isEnabled: vi.fn(() => false),
  isConfigured: vi.fn(() => true),
  requireKey: vi.fn(() => "server-only-key"),
  getUsage: vi.fn(async () => ({
    provider: "hunter" as const,
    resetDate: "2026-09-01",
    searches: { used: 0, available: 50, remaining: 50, percentUsed: 0 },
  })),
};

vi.mock("@/lib/auth/require", () => ({
  requireMdfSession: () => harness.requireMdfSession(),
}));

vi.mock("@/lib/buyerFinder/config", () => ({
  isBuyerFinderHunterConfigured: () => harness.isConfigured(),
  isBuyerFinderHunterEnabled: () => harness.isEnabled(),
  isBuyerFinderHunterReady: () => harness.isEnabled() && harness.isConfigured(),
  requireBuyerFinderHunterApiKey: () => harness.requireKey(),
  HUNTER_DISCOVERY_DISABLED_MESSAGE: "Hunter company discovery is disabled on this server.",
  HUNTER_NOT_CONFIGURED_MESSAGE: "Hunter is not configured on this server. Contact MDF admin.",
}));

vi.mock("@/lib/buyerFinder/providers/hunter/usage", () => ({
  createHunterUsageProvider: (opts: { apiKey: string }) => {
    expect(opts.apiKey).toBe("server-only-key");
    return { getUsage: harness.getUsage };
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: () => ({}) }));
vi.mock("@/lib/repositories/server", () => ({
  serverRepositories: async () => ({ session: SESSION, repos: {} }),
}));

import { getHunterUsageAction } from "./actions";

describe("getHunterUsageAction runtime gate", () => {
  beforeEach(() => {
    harness.requireMdfSession.mockImplementation(async () => SESSION);
    harness.isEnabled.mockReturnValue(false);
    harness.isConfigured.mockReturnValue(true);
    harness.requireKey.mockReturnValue("server-only-key");
    harness.getUsage.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("gate false + API key present does not instantiate Hunter usage", async () => {
    const r = await getHunterUsageAction();
    expect(r.outcome).toBe("disabled");
    expect(r.usage).toBeNull();
    expect(r.message).toMatch(/disabled/i);
    expect(harness.getUsage).not.toHaveBeenCalled();
    expect(harness.requireKey).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toMatch(/server-only-key|BUYER_FINDER/i);
  });

  it("gate true + key absent is not_configured and does not fetch usage", async () => {
    harness.isEnabled.mockReturnValue(true);
    harness.isConfigured.mockReturnValue(false);
    const r = await getHunterUsageAction();
    expect(r.outcome).toBe("not_configured");
    expect(harness.getUsage).not.toHaveBeenCalled();
  });

  it("gate true + key present fetches usage", async () => {
    harness.isEnabled.mockReturnValue(true);
    harness.isConfigured.mockReturnValue(true);
    const r = await getHunterUsageAction();
    expect(r.outcome).toBe("ok");
    expect(harness.getUsage).toHaveBeenCalledTimes(1);
    expect(r.usage).toBeTruthy();
  });
});
