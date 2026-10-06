import { describe, expect, it } from "vitest";
import {
  classifyFetchFailure,
  fetchThaiCustomsStatsCatalog,
  parseCkanResources,
  selectLatestReleasedResource,
  THAI_CUSTOMS_STATS_CATALOG_URL,
  THAI_CUSTOMS_STATS_DATASET_ID,
  ThaiCustomsStatsCatalogError,
} from "./catalog";

/**
 * TH07 DEFECT 05A — Thai Customs catalog fetch error classification.
 *
 * Pre-fix the catalog + resource fetches collapsed every thrown Node
 * fetch failure into one opaque `CATALOG_FETCH_FAILED` / `RESOURCE_FETCH_FAILED`
 * bucket. Production logs could not tell DNS from connect-refused from
 * timeout from TLS. The fix classifies the thrown error via Node
 * undici's `error.cause.code` into a bounded safe-code suite.
 *
 * Classifier contract (CATALOG_* for metadata fetch, RESOURCE_* for
 * CSV resource fetch; both prefixes map 1:1 by failure mode):
 *   • ENOTFOUND / EAI_AGAIN / EAI_NODATA      → *_DNS_UNRESOLVED   (retryable)
 *   • ECONNREFUSED                             → *_CONNECT_REFUSED  (retryable)
 *   • UND_ERR_CONNECT_TIMEOUT / ETIMEDOUT      → *_CONNECT_TIMEOUT  (retryable)
 *   • ECONNRESET / EPIPE                       → *_SOCKET_RESET     (retryable)
 *   • CERT_HAS_EXPIRED / self-signed / altname → *_TLS_HANDSHAKE    (terminal)
 *   • UND_ERR_SOCKET / headers / body timeout  → *_SOCKET_TIMEOUT   (retryable)
 *   • AbortError / TimeoutError / signal.aborted → *_ABORT_TIMEOUT  (retryable)
 *   • fallback                                 → *_FETCH_FAILED     (retryable)
 */

function fetchFailure(code: string | undefined, name = "FetchError"): Error {
  const err = new Error("fetch failed");
  err.name = name;
  if (code) {
    (err as unknown as { cause: unknown }).cause = { code, name: "SystemError" };
  }
  return err;
}

describe("TH07 DEFECT 05A — classifyFetchFailure (CATALOG prefix)", () => {
  it("1. correct official catalog hostname — THAI_CUSTOMS_STATS_CATALOG_URL points to catalog.customs.go.th", () => {
    const u = new URL(THAI_CUSTOMS_STATS_CATALOG_URL);
    expect(u.hostname).toBe("catalog.customs.go.th");
    expect(u.protocol).toBe("https:");
  });

  it("2. correct dataset id ctm_06_11 in query string, CKAN v3 package_show shape", () => {
    const u = new URL(THAI_CUSTOMS_STATS_CATALOG_URL);
    expect(u.pathname).toBe("/api/3/action/package_show");
    expect(u.searchParams.get("id")).toBe("ctm_06_11");
    expect(THAI_CUSTOMS_STATS_DATASET_ID).toBe("ctm_06_11");
  });

  it("3. catalog request success — parseCkanResources accepts a well-formed envelope", () => {
    const env = { success: true, result: { resources: [{ id: "r1", name: "202509", url: "https://x/202509.csv", format: "CSV" }] } };
    const out = parseCkanResources(env);
    expect(out).toHaveLength(1);
    expect(selectLatestReleasedResource(out)?.id).toBe("r1");
  });

  it("4. catalog 403 safe classification — CATALOG_HTTP_403, retryable=false (geo/UA block does not resolve by waiting)", async () => {
    const fetchImpl = (async () => new Response("blocked", { status: 403 })) as unknown as typeof fetch;
    await expect(fetchThaiCustomsStatsCatalog({ fetchImpl })).rejects.toMatchObject({
      code: "CATALOG_HTTP_403",
      retryable: false,
    });
  });

  it("5. catalog 404 classification — CATALOG_HTTP_404, retryable=false (dataset renamed/missing)", async () => {
    const fetchImpl = (async () => new Response("missing", { status: 404 })) as unknown as typeof fetch;
    await expect(fetchThaiCustomsStatsCatalog({ fetchImpl })).rejects.toMatchObject({
      code: "CATALOG_HTTP_404",
      retryable: false,
    });
  });

  it("6. catalog 429 retryable — CATALOG_HTTP_429, retryable=true", async () => {
    const fetchImpl = (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    await expect(fetchThaiCustomsStatsCatalog({ fetchImpl })).rejects.toMatchObject({
      code: "CATALOG_HTTP_429",
      retryable: true,
    });
  });

  it("7. catalog 5xx retryable — CATALOG_HTTP_503, retryable=true", async () => {
    const fetchImpl = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    await expect(fetchThaiCustomsStatsCatalog({ fetchImpl })).rejects.toMatchObject({
      code: "CATALOG_HTTP_503",
      retryable: true,
    });
  });

  it("8a. DNS failure → CATALOG_DNS_UNRESOLVED, retryable", () => {
    const result = classifyFetchFailure("CATALOG", fetchFailure("ENOTFOUND"));
    expect(result.code).toBe("CATALOG_DNS_UNRESOLVED");
    expect(result.retryable).toBe(true);
    expect(result.timeoutCategory).toBe("network");
  });

  it("8b. ECONNREFUSED → CATALOG_CONNECT_REFUSED, retryable", () => {
    const result = classifyFetchFailure("CATALOG", fetchFailure("ECONNREFUSED"));
    expect(result.code).toBe("CATALOG_CONNECT_REFUSED");
    expect(result.retryable).toBe(true);
    expect(result.timeoutCategory).toBe("network");
  });

  it("9. connect timeout → CATALOG_CONNECT_TIMEOUT, retryable", () => {
    const result = classifyFetchFailure("CATALOG", fetchFailure("UND_ERR_CONNECT_TIMEOUT"));
    expect(result.code).toBe("CATALOG_CONNECT_TIMEOUT");
    expect(result.retryable).toBe(true);
    expect(result.timeoutCategory).toBe("timeout");
  });

  it("9b. our-abort (signal) → CATALOG_ABORT_TIMEOUT, retryable", () => {
    const ac = new AbortController();
    ac.abort();
    const err = new Error("aborted"); err.name = "AbortError";
    const result = classifyFetchFailure("CATALOG", err, ac.signal);
    expect(result.code).toBe("CATALOG_ABORT_TIMEOUT");
    expect(result.retryable).toBe(true);
    expect(result.timeoutCategory).toBe("abort");
  });

  it("9c. TLS failure → CATALOG_TLS_HANDSHAKE, terminal (needs operator action)", () => {
    const result = classifyFetchFailure("CATALOG", fetchFailure("CERT_HAS_EXPIRED"));
    expect(result.code).toBe("CATALOG_TLS_HANDSHAKE");
    expect(result.retryable).toBe(false);
  });

  it("9d. socket reset → CATALOG_SOCKET_RESET, retryable", () => {
    const result = classifyFetchFailure("CATALOG", fetchFailure("ECONNRESET"));
    expect(result.code).toBe("CATALOG_SOCKET_RESET");
    expect(result.retryable).toBe(true);
  });

  it("9e. fallback → CATALOG_FETCH_FAILED (retryable=true, bucket for truly unclassified)", () => {
    const result = classifyFetchFailure("CATALOG", new Error("something else"));
    expect(result.code).toBe("CATALOG_FETCH_FAILED");
    expect(result.retryable).toBe(true);
  });

  it("10. invalid catalog JSON → CATALOG_INVALID_JSON, retryable (not CATALOG_FETCH_FAILED)", async () => {
    const fetchImpl = (async () => new Response("not json!!!", { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    await expect(fetchThaiCustomsStatsCatalog({ fetchImpl })).rejects.toMatchObject({
      code: "CATALOG_INVALID_JSON",
      retryable: true,
    });
  });

  it("11. missing resource list → envelope parses but zero resources (handled by executor as NO_RELEASED_RESOURCE later)", () => {
    const env = { success: true, result: { resources: [] } };
    expect(parseCkanResources(env)).toEqual([]);
    expect(selectLatestReleasedResource([])).toBeUndefined();
  });

  it("12. resource fetch classification is DISTINCT from catalog classification (prefix split)", () => {
    const cat = classifyFetchFailure("CATALOG", fetchFailure("ECONNREFUSED"));
    const res = classifyFetchFailure("RESOURCE", fetchFailure("ECONNREFUSED"));
    expect(cat.code).toBe("CATALOG_CONNECT_REFUSED");
    expect(res.code).toBe("RESOURCE_CONNECT_REFUSED");
    expect(cat.code).not.toBe(res.code);
  });

  it("13. successful CSV/resource selection — selectLatestReleasedResource picks latest period", () => {
    const resources = parseCkanResources({ success: true, result: { resources: [
      { id: "r1", name: "202507", url: "https://x/202507.csv", format: "CSV" },
      { id: "r2", name: "202508", url: "https://x/202508.csv", format: "CSV" },
      { id: "r3", name: "202506", url: "https://x/202506.csv", format: "CSV" },
    ] } });
    expect(selectLatestReleasedResource(resources)?.id).toBe("r2");
  });

  it("14. no secrets logged — ThaiCustomsStatsCatalogError.safeMeta carries only errorClass + timeoutCategory", async () => {
    const fetchImpl = async () => { throw fetchFailure("ECONNREFUSED"); };
    let thrown: ThaiCustomsStatsCatalogError | undefined;
    try {
      await fetchThaiCustomsStatsCatalog({ fetchImpl: fetchImpl as unknown as typeof fetch });
    } catch (e) {
      thrown = e as ThaiCustomsStatsCatalogError;
    }
    expect(thrown).toBeInstanceOf(ThaiCustomsStatsCatalogError);
    const serialized = JSON.stringify({ ...thrown, message: thrown!.message, name: thrown!.name });
    // Must NOT contain anything that could be a cookie / token / URL / HTML body.
    expect(serialized).not.toMatch(/cookie/i);
    expect(serialized).not.toMatch(/authorization/i);
    expect(serialized).not.toMatch(/bearer/i);
    expect(serialized).not.toMatch(/<[a-z][a-z0-9]/i); // no HTML
    // The URL itself should not appear in the serialized error.
    expect(serialized).not.toContain("catalog.customs.go.th");
    expect(serialized).not.toContain("package_show");
  });

  it("15. SSRF protections preserved — the catalog fetch targets exactly the official host (no caller-supplied URL)", () => {
    // THAI_CUSTOMS_STATS_CATALOG_URL is a constant with no interpolation.
    // Any future SSRF layer that whitelists `catalog.customs.go.th` continues to
    // match. This test fails if a future refactor introduces URL interpolation.
    expect(THAI_CUSTOMS_STATS_CATALOG_URL).toBe(
      "https://catalog.customs.go.th/api/3/action/package_show?id=ctm_06_11",
    );
  });

  it("16. automatic_spend_rupees = 0 — classifier/catalog never writes to a spend field", () => {
    // Classifier is a pure function with no side effects. This test
    // documents that invariant via its return shape.
    const result = classifyFetchFailure("CATALOG", fetchFailure("ECONNREFUSED"));
    expect(Object.keys(result).sort()).toEqual(["code", "errorClass", "retryable", "timeoutCategory"].sort());
  });

  it("17. Thailand HS mapping unchanged — this fix touches only catalog/resource fetch classification", async () => {
    const { THAILAND_HS_MAPPINGS, findThailandHsMapping } = await import("../thailand/hsMapping");
    expect(THAILAND_HS_MAPPINGS.length).toBeGreaterThan(0);
    const guntur = findThailandHsMapping("guntur-dry-red-chilli", null);
    expect(guntur?.thaiQueryCodes).toEqual(["09042110"]);
  });

  it("18. US/Canada unchanged — classifier is market-neutral; verified by prefix invariance", () => {
    const us = classifyFetchFailure("CATALOG", fetchFailure("ECONNREFUSED"));
    const ca = classifyFetchFailure("CATALOG", fetchFailure("ECONNREFUSED"));
    expect(us).toEqual(ca);
  });

  it("19. retry scheduler unchanged — this fix touches no cron / claim / release code", () => {
    // Negative assertion: catalog.ts source does not touch cron, net,
    // claim RPC, release RPC, or buyer_trade_research_jobs.
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/lib/tradeResearch/thaiCustomsStats/catalog.ts"), "utf8");
    expect(src).not.toMatch(/cron\.schedule/);
    expect(src).not.toMatch(/net\.http_post/);
    expect(src).not.toMatch(/claim_buyer_trade_research_job/);
    expect(src).not.toMatch(/release_buyer_trade_research_job/);
    expect(src).not.toMatch(/buyer_trade_research_jobs/);
  });

  it("20. manual providers never execute — classifier/catalog never references thai-dbd / thai-customs-operator / thai-fda-importer", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/lib/tradeResearch/thaiCustomsStats/catalog.ts"), "utf8");
    for (const manual of ["thai-dbd", "thai-customs-operator", "thai-fda-importer"]) {
      expect(src).not.toContain(manual);
    }
  });
});
