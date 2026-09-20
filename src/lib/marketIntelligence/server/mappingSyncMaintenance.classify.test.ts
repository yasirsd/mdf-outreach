import { describe, expect, it } from "vitest";
import { classifySyncFailure } from "./mappingSyncMaintenance";

/**
 * MI1C.4 — the maintenance layer previously collapsed every RPC
 * failure into `configuration_error`. That production bug hid the
 * real cause of the 503. `classifySyncFailure` now distinguishes:
 *   - authorization_error       (28000 / PGRST301 — bad JWT / apikey)
 *   - database_permission_error (42501 — service_role missing EXECUTE)
 *   - rpc_error                 (function not found, or any other code)
 *   - network_error             (fetch failed / DNS / TCP)
 *   - unexpected_server_error   (nothing else matched)
 * The classification is server-side-only; the browser never sees these
 * codes. This test proves the mapping for every documented shape.
 */
describe("MI1C.4 classifySyncFailure", () => {
  it("classifies insufficient_privilege (42501) as database_permission_error", () => {
    const c = classifySyncFailure({ code: "42501", message: "permission denied for function" });
    expect(c.outcome).toBe("database_permission_error");
    expect(c.logLabel).toBe("42501");
  });

  it("classifies PGRST301 / 28000 (JWT/apikey rejected) as authorization_error", () => {
    expect(classifySyncFailure({ code: "PGRST301" }).outcome).toBe("authorization_error");
    expect(classifySyncFailure({ code: "28000" }).outcome).toBe("authorization_error");
  });

  it("classifies function-not-found (PGRST202 / 42883) as rpc_error", () => {
    expect(classifySyncFailure({ code: "PGRST202" }).outcome).toBe("rpc_error");
    expect(classifySyncFailure({ code: "42883" }).outcome).toBe("rpc_error");
  });

  it("classifies undici / node-fetch network shapes as network_error", () => {
    expect(
      classifySyncFailure({ name: "TypeError", message: "fetch failed" }).outcome,
    ).toBe("network_error");
    expect(
      classifySyncFailure({ name: "TypeError", message: "network", cause: { code: "ECONNRESET" } })
        .outcome,
    ).toBe("network_error");
    expect(
      classifySyncFailure({ name: "AbortError", message: "socket hang up" }).outcome,
    ).toBe("network_error");
  });

  it("classifies text-fallback signals when there is no code", () => {
    expect(classifySyncFailure(new Error("permission denied")).outcome).toBe(
      "database_permission_error",
    );
    expect(
      classifySyncFailure(new Error("function sync_product_trade_mappings does not exist")).outcome,
    ).toBe("rpc_error");
    expect(classifySyncFailure(new Error("network unreachable")).outcome).toBe("network_error");
  });

  it("everything else lands in unexpected_server_error", () => {
    expect(classifySyncFailure(new Error("something odd")).outcome).toBe(
      "unexpected_server_error",
    );
    expect(classifySyncFailure(undefined).outcome).toBe("unexpected_server_error");
    expect(classifySyncFailure({}).outcome).toBe("unexpected_server_error");
  });

  it("never returns a code / label that echoes a secret / snapshot payload", () => {
    const c = classifySyncFailure({
      code: "42501",
      message: 'sb_secret_ABC123 permission denied "mdf_product_id":"guntur-dry-red-chilli"',
    });
    // The classification object never contains the secret or payload text.
    expect(JSON.stringify(c)).not.toMatch(/sb_secret_/);
    expect(JSON.stringify(c)).not.toMatch(/guntur-dry-red-chilli/);
    expect(c.code).toBe("42501");
    expect(c.logLabel).toBe("42501");
  });
});
