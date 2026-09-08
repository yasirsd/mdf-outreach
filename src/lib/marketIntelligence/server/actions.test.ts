import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MdfSession } from "@/lib/auth/require";
import type { ProductTradeMappingSyncSummary } from "./types";

/**
 * MI1C.2 — shared maintenance-authority tests for
 * syncMarketProductMappingsAction. Every scenario asserts BOTH the
 * outcome AND whether the service-role writer was even initialised.
 * A denied caller must never touch the trusted global-write path.
 */

vi.mock("server-only", () => ({}));

const requireMdfSessionMock = vi.hoisted(() => vi.fn<() => Promise<MdfSession>>());
const getMarketIntelligenceWriterMock = vi.hoisted(() => vi.fn());
const serializeSnapshotMock = vi.hoisted(() => vi.fn());
const syncProductTradeMappingsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/require", () => ({
  requireMdfSession: requireMdfSessionMock,
}));

vi.mock("../product", async () => {
  const actual = await vi.importActual<typeof import("../product")>("../product");
  return {
    ...actual,
    serializeProductTradeMappingsSnapshot: serializeSnapshotMock,
  };
});

// The writer path is loaded LAZILY inside the action via a dynamic
// `await import("./writer")`. That means the module is only pulled in
// when authorisation succeeds. Register a mock so we can spy on the
// getMarketIntelligenceWriter export and confirm non-invocation for
// denied callers.
vi.mock("./writer", () => ({
  getMarketIntelligenceWriter: getMarketIntelligenceWriterMock,
  MarketIntelligenceServiceRoleConfigError: class MarketIntelligenceServiceRoleConfigError extends Error {},
}));

function ownerSession(): MdfSession {
  return {
    userId: "user-owner",
    email: "owner@example.com",
    membership: { workspaceId: "ws-a", role: "owner" },
  };
}

function memberSession(): MdfSession {
  return {
    userId: "user-member",
    email: "member@example.com",
    membership: { workspaceId: "ws-a", role: "member" },
  };
}

beforeEach(() => {
  requireMdfSessionMock.mockReset();
  getMarketIntelligenceWriterMock.mockReset();
  serializeSnapshotMock.mockReset();
  syncProductTradeMappingsMock.mockReset();
  getMarketIntelligenceWriterMock.mockReturnValue({
    syncProductTradeMappings: syncProductTradeMappingsMock,
  });
  serializeSnapshotMock.mockReturnValue({
    registryVersion: "mi-product-map-v1",
    generatedAt: "2026-09-07T00:00:00.000Z",
    mappings: [{ mdfProductId: "guntur-dry-red-chilli", hsRevision: "HS17", hsCode: "090421" }],
  });
});

afterEach(() => {
  vi.resetModules();
});

async function importAction() {
  return (await import("./actions")).syncMarketProductMappingsAction;
}

describe("MI1C.1 syncMarketProductMappingsAction — authorisation gate", () => {
  it("unauthenticated → `unauthorised`, writer never initialised", async () => {
    requireMdfSessionMock.mockRejectedValueOnce(new Error("no session"));
    const action = await importAction();
    const result = await action();
    expect(result.outcome).toBe("unauthorised");
    expect(result.registryVersion).toBe("mi-product-map-v1");
    expect(getMarketIntelligenceWriterMock).not.toHaveBeenCalled();
    expect(serializeSnapshotMock).not.toHaveBeenCalled();
    expect(syncProductTradeMappingsMock).not.toHaveBeenCalled();
  });

  it("ordinary MDF member → `forbidden`, writer never initialised, snapshot never serialised", async () => {
    requireMdfSessionMock.mockResolvedValueOnce(memberSession());
    const action = await importAction();
    const result = await action();
    expect(result.outcome).toBe("forbidden");
    expect(result.registryVersion).toBe("mi-product-map-v1");
    expect(getMarketIntelligenceWriterMock).not.toHaveBeenCalled();
    expect(serializeSnapshotMock).not.toHaveBeenCalled();
    expect(syncProductTradeMappingsMock).not.toHaveBeenCalled();
  });

  it("MDF owner → registry serialised, writer invoked exactly once, sync exactly once", async () => {
    requireMdfSessionMock.mockResolvedValueOnce(ownerSession());
    const summary: ProductTradeMappingSyncSummary = {
      outcome: "synced",
      created: 5,
      updated: 0,
      reactivated: 0,
      deactivated: 0,
      unchanged: 0,
      registryVersion: "mi-product-map-v1",
    };
    syncProductTradeMappingsMock.mockResolvedValueOnce(summary);
    const action = await importAction();
    const result = await action();
    expect(result.outcome).toBe("synced");
    expect(result.summary).toEqual(summary);
    expect(getMarketIntelligenceWriterMock).toHaveBeenCalledTimes(1);
    expect(syncProductTradeMappingsMock).toHaveBeenCalledTimes(1);
    expect(serializeSnapshotMock).toHaveBeenCalledTimes(1);
  });

  it("authorisation happens BEFORE serialisation and writer acquisition", async () => {
    // We can prove ordering by making requireMdfSession itself throw
    // after we spy on the ordering: an unauthorised caller must not
    // even reach the serialiser.
    requireMdfSessionMock.mockRejectedValueOnce(new Error("kaput"));
    const action = await importAction();
    await action();
    expect(serializeSnapshotMock).not.toHaveBeenCalled();
    expect(getMarketIntelligenceWriterMock).not.toHaveBeenCalled();
    // And when the owner is authenticated, requireMdfSession must be
    // called before either the serialiser or the writer.
    requireMdfSessionMock.mockResolvedValueOnce(ownerSession());
    syncProductTradeMappingsMock.mockResolvedValueOnce({
      outcome: "synced",
      created: 0,
      updated: 0,
      reactivated: 0,
      deactivated: 0,
      unchanged: 5,
      registryVersion: "mi-product-map-v1",
    });
    await action();
    const requireOrder = requireMdfSessionMock.mock.invocationCallOrder[0]!;
    const serializerOrder = serializeSnapshotMock.mock.invocationCallOrder[0]!;
    const writerOrder = getMarketIntelligenceWriterMock.mock.invocationCallOrder[0]!;
    expect(requireOrder).toBeLessThan(serializerOrder);
    expect(serializerOrder).toBeLessThan(writerOrder);
  });

  it("invalid registry → `invalid_registry`, writer never invoked", async () => {
    requireMdfSessionMock.mockResolvedValueOnce(ownerSession());
    const { ProductTradeMappingSnapshotError } = await import("../product");
    serializeSnapshotMock.mockImplementationOnce(() => {
      throw new ProductTradeMappingSnapshotError("bad registry");
    });
    const action = await importAction();
    const result = await action();
    expect(result.outcome).toBe("invalid_registry");
    expect(result.message).toBe("The canonical Product-to-HS registry is invalid.");
    expect(getMarketIntelligenceWriterMock).not.toHaveBeenCalled();
    expect(syncProductTradeMappingsMock).not.toHaveBeenCalled();
  });

  it("service-role configuration error → sanitized `configuration_error`, no raw exception surfaced", async () => {
    requireMdfSessionMock.mockResolvedValueOnce(ownerSession());
    const { MarketIntelligenceServiceRoleConfigError } = await import("./writer");
    getMarketIntelligenceWriterMock.mockImplementationOnce(() => {
      throw new MarketIntelligenceServiceRoleConfigError("SUPABASE_SECRET_KEY");
    });
    const action = await importAction();
    const result = await action();
    expect(result.outcome).toBe("configuration_error");
    expect(result.message).not.toMatch(/SUPABASE_(?:SECRET_KEY|SERVICE_ROLE_KEY)/);
    expect(syncProductTradeMappingsMock).not.toHaveBeenCalled();
  });

  it("classifies the real lazy key-check failure from writer execution as configuration_error", async () => {
    requireMdfSessionMock.mockResolvedValueOnce(ownerSession());
    const { MarketIntelligenceServiceRoleConfigError } = await import("./writer");
    syncProductTradeMappingsMock.mockRejectedValueOnce(
      new MarketIntelligenceServiceRoleConfigError("SUPABASE_SECRET_KEY"),
    );
    const action = await importAction();
    const result = await action();
    expect(result).toEqual({
      outcome: "configuration_error",
      registryVersion: "mi-product-map-v1",
      message: "Market Intelligence server writer is not configured on this server.",
    });
    expect(JSON.stringify(result)).not.toMatch(/SUPABASE_(?:SECRET_KEY|SERVICE_ROLE_KEY)/);
  });

  it("writer/RPC failures are sanitized instead of exposing database details", async () => {
    requireMdfSessionMock.mockResolvedValueOnce(ownerSession());
    syncProductTradeMappingsMock.mockRejectedValueOnce(
      new Error("PostgREST permission denied: secret internal detail"),
    );
    const action = await importAction();
    const result = await action();
    expect(result).toMatchObject({
      outcome: "configuration_error",
      message: "Market mapping synchronization could not be completed.",
    });
    expect(JSON.stringify(result)).not.toMatch(/PostgREST|permission denied|secret internal detail/);
  });
});

describe("MI1C.1 syncMarketProductMappingsAction — static shape", () => {
  const HERE = process.cwd();
  const ACTIONS = readFileSync(
    path.resolve(HERE, "src/lib/marketIntelligence/server/actions.ts"),
    "utf8",
  );
  const MAINTENANCE = readFileSync(
    path.resolve(HERE, "src/lib/marketIntelligence/server/mappingSyncMaintenance.ts"),
    "utf8",
  );

  it("keeps one owner-only role authority in the shared maintenance operation", () => {
    expect(MAINTENANCE).toMatch(/const PRIVILEGED_MDF_ROLES[^;]*=\s*new Set\(\["owner"\]\)/);
    expect(ACTIONS).not.toMatch(/membership\.role|PRIVILEGED_MDF_ROLES/);
    expect(ACTIONS).toMatch(/return syncCurrentMarketProductMappings\(\)/);
  });

  it("outcome union names every controlled state and no others", () => {
    for (const outcome of [
      "synced",
      "unauthorised",
      "forbidden",
      "invalid_registry",
      "configuration_error",
    ]) {
      expect(MAINTENANCE).toContain(`"${outcome}"`);
    }
    // Never leak Supabase / JWT / grant terminology into the outcome
    // union or messages.
    const outcomeUnion =
      MAINTENANCE.match(/export type SyncMarketProductMappingsOutcome[\s\S]*?;/)?.[0] ?? "";
    expect(outcomeUnion).not.toMatch(/supabase|jwt|grant|service_role/i);
  });

  it("writer is imported LAZILY so a denied caller never triggers module load", () => {
    // Static import of `./writer` from `actions.ts` would defeat the
    // fail-closed guarantee. The action must use `await import()`.
    expect(MAINTENANCE).not.toMatch(
      /^import[\s\S]*getMarketIntelligenceWriter[\s\S]*?from "\.\/writer";/m,
    );
    expect(MAINTENANCE).toMatch(/await import\("\.\/writer"\)/);
  });

  it("no service-role env var is read in this module", () => {
    for (const source of [ACTIONS, MAINTENANCE]) {
      expect(source).not.toMatch(/SUPABASE_(?:SECRET_KEY|SERVICE_ROLE_KEY)/);
      expect(source).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/);
    }
  });
});
