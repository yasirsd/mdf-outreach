import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BaciProviderError } from "../providers/baci/normalize";
import { BaciOecConfigError } from "../providers/baci/server";

vi.mock("server-only", () => ({}));

const requireMdfSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/require", () => ({ requireMdfSession }));

const executeControlledMalaysiaChilliProof = vi.hoisted(() => vi.fn());
vi.mock("../providers/baci/proofExecution", () => ({
  executeControlledMalaysiaChilliProof,
}));

vi.mock("../marketReadRepository", () => ({
  createMarketReadRepository: () => ({}),
}));

vi.mock("./writer", () => ({
  getMarketIntelligenceWriter: () => ({}),
  MarketIntelligenceServiceRoleConfigError: class extends Error {
    constructor() { super("stub"); this.name = "MarketIntelligenceServiceRoleConfigError"; }
  },
}));

vi.mock("next/headers", () => ({
  cookies: () => ({}),
}));

vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({}),
}));

const ownerSession = {
  membership: { role: "owner" as const },
  user: { id: "user-1" },
};

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  requireMdfSession.mockReset();
  executeControlledMalaysiaChilliProof.mockReset();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("MI1D.3 BaciProofMaintenance sanitized diagnostic surfacing", () => {
  it("attaches provider diagnostic + emits sanitized single-line log on provider failure", async () => {
    requireMdfSession.mockResolvedValueOnce(ownerSession);
    executeControlledMalaysiaChilliProof.mockRejectedValueOnce(
      new BaciProviderError(
        "invalid_request",
        "BACI/OEC rejected the controlled query credentials",
        undefined, undefined, 0,
        {
          stage: "provider_http",
          httpStatus: 401,
          category: "auth_error",
          responseContentType: "application/json",
          providerRequestId: "req-abc",
          sanitizedBody: "invalid bearer",
        },
      ),
    );
    const { runControlledBaciProof } = await import("./baciProofMaintenance");
    const result = await runControlledBaciProof();
    expect(result.outcome).toBe("invalid_request");
    expect(result.diagnostic).toMatchObject({
      stage: "provider_http",
      category: "auth_error",
      httpStatus: 401,
      providerRequestId: "req-abc",
      sanitizedBody: "invalid bearer",
      scope: {
        dataset: "baci-hs17",
        importer: "mys",
        hsCode: "090421",
        yearsStart: 2017,
        yearsEnd: 2024,
      },
    });
    const logged = consoleErrorSpy.mock.calls.at(-1)?.[0] as string;
    expect(logged).toContain("[BACI proof]");
    expect(logged).toContain("outcome=invalid_request");
    expect(logged).toContain("category=auth_error");
    expect(logged).toContain("http=401");
    expect(logged).toContain("hs=090421");
    expect(logged).toContain("importer=mys");
    expect(logged).toContain("years=2017-2024");
    expect(logged).not.toMatch(/bot_market_ak_|sb_secret_|eyJ[\w-]+\.[\w-]+\.[\w-]+/);
  });

  it("configuration_error surfaces without leaking BACI_OEC_API_KEY", async () => {
    requireMdfSession.mockResolvedValueOnce(ownerSession);
    executeControlledMalaysiaChilliProof.mockRejectedValueOnce(new BaciOecConfigError());
    const { runControlledBaciProof } = await import("./baciProofMaintenance");
    const result = await runControlledBaciProof();
    expect(result.outcome).toBe("configuration_error");
    expect(result.diagnostic).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/BACI_OEC_API_KEY|bot_market_ak_/);
  });

  it("even the log line for provider partial keeps the reason without leaking data", async () => {
    requireMdfSession.mockResolvedValueOnce(ownerSession);
    executeControlledMalaysiaChilliProof.mockRejectedValueOnce(
      new BaciProviderError(
        "partial",
        "BACI/OEC result could not be proven complete",
        undefined,
        "proof_budget_exceeded",
        1000,
        { stage: "provider_pagination", category: "proof_budget_exceeded" },
      ),
    );
    const { runControlledBaciProof } = await import("./baciProofMaintenance");
    const result = await runControlledBaciProof();
    expect(result.outcome).toBe("partial");
    expect(result.diagnostic?.category).toBe("proof_budget_exceeded");
    const logged = consoleErrorSpy.mock.calls.at(-1)?.[0] as string;
    expect(logged).toContain("outcome=partial");
    expect(logged).toContain("reason=proof_budget_exceeded");
    expect(logged).toContain("category=proof_budget_exceeded");
  });
});
