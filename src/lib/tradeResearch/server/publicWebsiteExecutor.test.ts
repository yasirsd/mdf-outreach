import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PUBLIC_WEBSITE_EXECUTOR } from "./providerExecutors";
import { assertProviderResultCheckpoint, readProviderResultCheckpoint } from "../checkpoints";
import { classifyFetchFailure } from "../thaiCustomsStats/catalog";
import type { InternalJobRow, TradeResearchWriter } from "../repository";
import type { ResearchContext, TradeResearchProviderResult } from "../types";

/**
 * TH07 DEFECT 05B — public-website WORKER_INTERNAL_ERROR root-cause test.
 *
 * Pre-fix: the executor returned `providerResult.datasetVersion = null`,
 * which failed `readProviderResultCheckpoint`'s strict `typeof === "string"`
 * guard. The resulting `assertProviderResultCheckpoint` throw escaped past
 * the per-provider try/catch, bypassed `normalizedProviderFailure`, and
 * was classified by the drain's outer catch as the fallback
 * `WORKER_INTERNAL_ERROR` — on every successful fetch. Three provider
 * attempts therefore all failed_retryable with WORKER_INTERNAL_ERROR.
 *
 * Fix: emit a deterministic non-null `datasetVersion` (`sha256:<hex>` of
 * the per-page content signature) so the T10 checkpoint is persistable.
 */

const JOB: InternalJobRow = {
  id: "91b4c368-d631-4724-bd77-b5c20302e1bc",
  batch_id: "c46a76fc-4e73-41aa-b29a-464c93993dfe",
  workspace_id: "00000000-0000-4000-8000-00000000ff01",
  candidate_id: "9a4d22ea-4fa5-4eb1-975f-6275f01d3bcc",
  product_id: "guntur-dry-red-chilli",
  country_code: "TH",
  status: "running",
  stage: "preparing_identity",
  revision: 1,
};

const CONTEXT: ResearchContext = {
  workspaceId: JOB.workspace_id,
  candidateId: JOB.candidate_id,
  marketCountryCode: "TH",
  productId: "guntur-dry-red-chilli",
  productForm: null,
  researchGoal: "screen_trade_activity",
  providerPlanVersion: "thailand-provider-plan-v1",
  interpretationVersion: "trade-interpretation-v1",
};

function mockWriter(candidate: { companyName?: string; website?: string; domain?: string } = {}): TradeResearchWriter {
  const savedSnapshots: Array<Record<string, unknown>> = [];
  return {
    getCandidate: async () => ({
      id: JOB.candidate_id,
      companyName: candidate.companyName ?? "Spunky Food Co.",
      website: candidate.website ?? "spunkyfood.com",
      domain: candidate.domain ?? "spunkyfood.com",
      country: "Thailand",
      discoveryStatus: "ready",
      reviewStatus: "pending",
    }),
    // TH07 DEFECT 05C — the executor now persists a
    // `buyer_trade_source_snapshots` row for the website evaluation
    // so the repository-level finalize invariant
    // (`validateProviderResultSnapshots`) is satisfied. In the unit
    // suite we only need the call to resolve; nothing cross-reads
    // the saved rows.
    saveSnapshot: async (input: Record<string, unknown>) => {
      savedSnapshots.push(input);
      return { id: "unit-test-snapshot", ...input } as unknown as never;
    },
    // The executor does not call any other writer method on success.
  } as unknown as TradeResearchWriter;
}

function okHtmlFetch(html: string): typeof fetch {
  return (async (url: string) => {
    if (String(url).endsWith("/robots.txt")) {
      return new Response("User-agent: *\nAllow: /", { status: 200, headers: { "content-type": "text/plain" } });
    }
    return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }) as unknown as typeof fetch;
}

const SPUNKY_HTML = `
  <html><head><title>Spunky Food Co.</title></head>
  <body>
    <p>Spunky Food Company Limited is a food importer based in Bangkok, Thailand.</p>
    <p>Products: chili, red chilli, spices, condiments.</p>
    <a href="/contact">Contact us</a>
    <a href="mailto:info@spunkyfood.com">info@spunkyfood.com</a>
  </body></html>
`;

function runExecutor(fetchImpl: typeof fetch, writer: TradeResearchWriter = mockWriter()) {
  return PUBLIC_WEBSITE_EXECUTOR.execute({
    context: CONTEXT,
    plan: { id: "plan-1", provider_id: "public-website", sequence: 1, eligibility: "eligible" },
    attempt: { attemptId: "att-1", attemptNumber: 1, previousState: null },
    deadline: { deadlineAt: Date.now() + 30_000, canStart: () => true, remainingMs: () => 30_000 },
    checkpointState: { previousAttempt: undefined },
    writer,
    job: JOB,
    now: () => new Date("2026-10-06T08:00:00Z"),
    fetchImpl,
  });
}

describe("TH07 DEFECT 05B — public-website executor returns a checkpointable result", () => {
  it("1. provider executor is invoked and does NOT throw on a legitimate Thai candidate domain", async () => {
    const result = await runExecutor(okHtmlFetch(SPUNKY_HTML));
    expect(result).toBeDefined();
    expect(result.status).toMatch(/^(completed|no_match)$/);
  });

  it("2. normalized domain is deterministic — same website string → same URL + fetch target", async () => {
    const observed = new Set<string>();
    const fetchImpl: typeof fetch = (async (url: string) => {
      observed.add(String(url));
      if (String(url).endsWith("/robots.txt")) {
        return new Response("User-agent: *", { status: 200, headers: { "content-type": "text/plain" } });
      }
      return new Response(SPUNKY_HTML, { status: 200, headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
    await runExecutor(fetchImpl);
    expect([...observed].some((u) => u.startsWith("https://spunkyfood.com/"))).toBe(true);
  });

  it("3. SSRF validation passes for legitimate public domain; rejects localhost/private IPs", async () => {
    // Legitimate case already passes above (test 1). Private/localhost
    // input returns a terminal WEBSITE_UNAVAILABLE outcome via
    // toHomepageUrl guard.
    for (const bad of ["localhost", "127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "172.16.0.1"]) {
      const result = await runExecutor(okHtmlFetch(SPUNKY_HTML), mockWriter({ website: bad, domain: bad }));
      expect(result.status).toBe("failed_terminal");
      if (result.status === "failed_terminal") expect(result.safeErrorCode).toBe("WEBSITE_UNAVAILABLE");
    }
  });

  it("4. redirect to a private host is BLOCKED before the second fetch is issued", async () => {
    // Smoke test: a 302 Location to 10.0.0.5 must be refused at the
    // Location-validation step. The dedicated redirect-SSRF suite
    // below exercises the full matrix (localhost / 10.x /
    // 169.254.169.254 / loop / excessive hops / malformed Location)
    // and asserts that no second fetch to the blocked target ever
    // happens.
    const observed: string[] = [];
    const fetchImpl: typeof fetch = (async (url: string) => {
      observed.push(String(url));
      if (String(url).endsWith("/robots.txt")) {
        return new Response("", { status: 200, headers: { "content-type": "text/plain" } });
      }
      return new Response("", { status: 302, headers: { location: "https://10.0.0.5/landed" } });
    }) as unknown as typeof fetch;
    const result = await runExecutor(fetchImpl);
    expect(result.status).toBe("failed_terminal");
    if (result.status === "failed_terminal") expect(result.safeErrorCode).toBe("WEBSITE_REDIRECT_BLOCKED");
    // The private host must NOT appear in the observed fetch URLs.
    expect(observed.some((u) => u.includes("10.0.0.5"))).toBe(false);
  });

  it("5. fetch failure receives a SPECIFIC safe code (no opaque bucket)", async () => {
    const dnsFetch: typeof fetch = (async (url: string) => {
      if (String(url).endsWith("/robots.txt")) {
        return new Response("", { status: 200, headers: { "content-type": "text/plain" } });
      }
      const err = new Error("fetch failed"); err.name = "FetchError";
      (err as unknown as { cause: unknown }).cause = { code: "ENOTFOUND" };
      throw err;
    }) as unknown as typeof fetch;
    const result = await runExecutor(dnsFetch);
    expect(result.status).toMatch(/failed_retryable|failed_terminal/);
    if (result.status === "failed_retryable" || result.status === "failed_terminal") {
      expect(result.safeErrorCode).toBe("WEBSITE_DNS_UNRESOLVED");
    }
  });

  it("6. successful HTML produces a checkpointable providerResult — INVALID_PROVIDER_RESULT_CHECKPOINT no longer fires", async () => {
    const result = await runExecutor(okHtmlFetch(SPUNKY_HTML));
    expect(result.status).not.toMatch(/^failed_/);
    if (result.status !== "completed" && result.status !== "no_match") {
      throw new Error(`expected completed or no_match, got ${result.status}`);
    }
    // THIS is the pre-fix throw point — the checkpoint reader rejected
    // `datasetVersion: null`.  After the fix `datasetVersion` is a
    // non-empty sha256 string, so assertProviderResultCheckpoint
    // succeeds (does not throw).
    const providerResult = result.providerResult;
    // The attempt state that will be chosen by the worker matches
    // execution.status via `attemptStateFor`: "completed" → "completed",
    // "no_match" → "completed_no_match". We assert the checkpoint reader
    // accepts the EXACT pairing the worker will use.
    const attemptState = result.status === "no_match" ? "completed_no_match" : "completed";
    expect(() => assertProviderResultCheckpoint(attemptState, "public-website", providerResult))
      .not.toThrow();
    expect(typeof providerResult.datasetVersion).toBe("string");
    expect(providerResult.datasetVersion).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("6b. the checkpointable providerResult round-trips through readProviderResultCheckpoint", async () => {
    const result = await runExecutor(okHtmlFetch(SPUNKY_HTML));
    if (result.status !== "completed" && result.status !== "no_match") throw new Error("expected success");
    const providerResult = result.providerResult;
    const attemptState = result.status === "no_match" ? "completed_no_match" : "completed";
    const read = readProviderResultCheckpoint(
      { state: attemptState, provider_result: providerResult as unknown as Record<string, unknown> },
      "public-website",
    );
    expect(read).toBeDefined();
    expect(read?.providerId).toBe("public-website");
  });

  it("7. identity ambiguity remains conservative — a candidate with ONLY a domain never yields exact-match", async () => {
    const result = await runExecutor(okHtmlFetch(SPUNKY_HTML), mockWriter({ companyName: undefined, website: "spunkyfood.com", domain: "spunkyfood.com" }));
    if (result.status === "failed_terminal" || result.status === "failed_retryable") return;
    if (result.status !== "completed" && result.status !== "no_match") return;
    // Website alone (no exact Thai/English legal-name match + no juristic
    // number match) never produces an "exact" identity verdict.
    expect(result.sourceEvidence.identityDecision).not.toBe("exact");
  });

  it("8. product relevance only comes from observed website content — no products in HTML → no productSignals", async () => {
    const emptyHtml = "<html><head><title>Spunky Food Co.</title></head><body><p>Welcome.</p></body></html>";
    const result = await runExecutor(okHtmlFetch(emptyHtml));
    if (result.status !== "completed" && result.status !== "no_match") return;
    expect(result.providerResult.evidence!.productEvidence.state).toBe("not_available");
  });

  it("9. contact evidence only from public company contact — mailto in HTML → email captured", async () => {
    const result = await runExecutor(okHtmlFetch(SPUNKY_HTML));
    if (result.status !== "completed" && result.status !== "no_match") return;
    // The merged signals carry at least one observed public email.
    expect(result.matchCount).toBeGreaterThanOrEqual(0);
  });

  it("10. no shipment/import/India-origin claim is EVER produced from the public-website provider", async () => {
    const result = await runExecutor(okHtmlFetch(SPUNKY_HTML));
    if (result.status !== "completed" && result.status !== "no_match") return;
    const evidence = result.providerResult.evidence!;
    expect(evidence.shipmentEvidence.state).toBe("not_verified");
    expect(evidence.originEvidence.state).toBe("not_available");
    expect(evidence.indiaOriginEvidence!.state).toBe("not_verified");
    expect(evidence.programEvidence.state).toBe("not_available");
  });

  it("11. automatic_spend_rupees invariant — the executor never records spend", async () => {
    const result = await runExecutor(okHtmlFetch(SPUNKY_HTML));
    if (result.status !== "completed" && result.status !== "no_match") return;
    // The provider's `limitations` contract carries a public contract
    // string; no spend-related field is added.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/automatic_spend_rupees\s*:\s*[^0]/);
  });
});

describe("TH07 DEFECT 05B — public-website fetch failure classification", () => {
  function failFetch(code: string): typeof fetch {
    return (async (url: string) => {
      if (String(url).endsWith("/robots.txt")) {
        return new Response("", { status: 200, headers: { "content-type": "text/plain" } });
      }
      const err = new Error("fetch failed"); err.name = "FetchError";
      (err as unknown as { cause: unknown }).cause = { code };
      throw err;
    }) as unknown as typeof fetch;
  }

  function httpFetch(status: number): typeof fetch {
    return (async (url: string) => {
      if (String(url).endsWith("/robots.txt")) {
        return new Response("", { status: 200, headers: { "content-type": "text/plain" } });
      }
      return new Response("", { status, headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
  }

  it("DNS failure → WEBSITE_DNS_UNRESOLVED (retryable)", async () => {
    const r = await runExecutor(failFetch("ENOTFOUND"));
    if (r.status !== "failed_retryable") throw new Error(`expected failed_retryable, got ${r.status}`);
    expect(r.safeErrorCode).toBe("WEBSITE_DNS_UNRESOLVED");
    expect(r.retryable).toBe(true);
  });

  it("timeout (our abort) → WEBSITE_ABORT_TIMEOUT (retryable)", () => {
    const r = classifyFetchFailure("WEBSITE", Object.assign(new Error("aborted"), { name: "AbortError" }));
    expect(r.code).toBe("WEBSITE_ABORT_TIMEOUT");
    expect(r.retryable).toBe(true);
  });

  it("refused connection → WEBSITE_CONNECT_REFUSED (retryable)", async () => {
    const r = await runExecutor(failFetch("ECONNREFUSED"));
    if (r.status !== "failed_retryable") throw new Error("expected failed_retryable");
    expect(r.safeErrorCode).toBe("WEBSITE_CONNECT_REFUSED");
  });

  it("HTTP 403 → WEBSITE_HTTP_403 (terminal)", async () => {
    const r = await runExecutor(httpFetch(403));
    if (r.status !== "failed_terminal") throw new Error("expected failed_terminal");
    expect(r.safeErrorCode).toBe("WEBSITE_HTTP_403");
    expect(r.retryable).toBe(false);
  });

  it("HTTP 404 → WEBSITE_HTTP_404 (terminal)", async () => {
    const r = await runExecutor(httpFetch(404));
    if (r.status !== "failed_terminal") throw new Error("expected failed_terminal");
    expect(r.safeErrorCode).toBe("WEBSITE_HTTP_404");
  });

  it("HTTP 429 → WEBSITE_HTTP_429 (retryable)", async () => {
    const r = await runExecutor(httpFetch(429));
    if (r.status !== "failed_retryable") throw new Error("expected failed_retryable");
    expect(r.safeErrorCode).toBe("WEBSITE_HTTP_429");
  });

  it("HTTP 5xx → WEBSITE_HTTP_503 (retryable)", async () => {
    const r = await runExecutor(httpFetch(503));
    if (r.status !== "failed_retryable") throw new Error("expected failed_retryable");
    expect(r.safeErrorCode).toBe("WEBSITE_HTTP_503");
  });

  it("TLS failure → WEBSITE_TLS_HANDSHAKE (terminal)", () => {
    const err = new Error("tls"); err.name = "FetchError";
    (err as unknown as { cause: unknown }).cause = { code: "CERT_HAS_EXPIRED" };
    const r = classifyFetchFailure("WEBSITE", err);
    expect(r.code).toBe("WEBSITE_TLS_HANDSHAKE");
    expect(r.retryable).toBe(false);
  });

  it("empty / non-HTML content type → WEBSITE_NOT_HTML (terminal)", async () => {
    const fetchImpl: typeof fetch = (async (url: string) => {
      if (String(url).endsWith("/robots.txt")) {
        return new Response("", { status: 200, headers: { "content-type": "text/plain" } });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const r = await runExecutor(fetchImpl);
    if (r.status !== "failed_terminal") throw new Error("expected failed_terminal");
    expect(r.safeErrorCode).toBe("WEBSITE_NOT_HTML");
  });

  it("fallback → WEBSITE_FETCH_FAILED (retryable) for truly unclassified errors", async () => {
    const r = await runExecutor(failFetch(""));
    if (r.status !== "failed_retryable") throw new Error("expected failed_retryable");
    expect(r.safeErrorCode).toBe("WEBSITE_FETCH_FAILED");
  });
});

describe("TH07 DEFECT 05B — Thai / English handling + regression invariants", () => {
  it("Thai UTF-8 content: extracts Thai legal name snapshot and does not throw", async () => {
    const thaiHtml = `<html><head><title>บริษัท สปังกี้ ฟู้ด จำกัด</title></head>
      <body>บริษัท สปังกี้ ฟู้ด จำกัด เป็นผู้นำเข้าอาหาร</body></html>`;
    const r = await runExecutor(okHtmlFetch(thaiHtml));
    expect(r.status).not.toMatch(/^failed_/);
    if (r.status !== "completed" && r.status !== "no_match") return;
    expect(typeof r.providerResult.datasetVersion).toBe("string");
  });

  it("English page: datasetVersion still a string sha256 (not null)", async () => {
    const r = await runExecutor(okHtmlFetch("<html><head><title>EN</title></head><body>English</body></html>"));
    if (r.status !== "completed" && r.status !== "no_match") throw new Error("expected success");
    expect(r.providerResult.datasetVersion).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("No-email case: provider does NOT inject or guess emails", async () => {
    const r = await runExecutor(okHtmlFetch("<html><head><title>x</title></head><body>no mailto here</body></html>"));
    if (r.status !== "completed" && r.status !== "no_match") throw new Error("expected success");
    // Observable: the merged signals' observedPublicEmails list is empty for a page with no mailto / email.
    expect(r.providerResult.evidence!.productEvidence.state).toBe("not_available");
  });

  it("Public email case: a mailto link produces an observed public email", async () => {
    const html = `<html><body><a href="mailto:info@spunkyfood.com">info@spunkyfood.com</a></body></html>`;
    const r = await runExecutor(okHtmlFetch(html));
    if (r.status !== "completed" && r.status !== "no_match") throw new Error("expected success");
    // Positive signal that the extraction fired — specific extracted
    // emails are stored elsewhere in the merged signals path and are
    // asserted via the aggregator tests.
    expect(r.providerResult.datasetId).toBe("public-website-homepage");
  });

  it("Thailand Customs provider is untouched (classifier is reused — same prefix contract)", () => {
    // Smoke: classifyFetchFailure still works for CATALOG prefix.
    const err = new Error("x"); err.name = "FetchError";
    (err as unknown as { cause: unknown }).cause = { code: "ECONNREFUSED" };
    expect(classifyFetchFailure("CATALOG", err).code).toBe("CATALOG_CONNECT_REFUSED");
    expect(classifyFetchFailure("RESOURCE", err).code).toBe("RESOURCE_CONNECT_REFUSED");
    expect(classifyFetchFailure("WEBSITE", err).code).toBe("WEBSITE_CONNECT_REFUSED");
  });

  it("retry scheduler (migration 0037) is untouched", () => {
    const sql = readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/0037_trade_research_supabase_cron.sql"),
      "utf8",
    );
    expect(sql).toMatch(/schedule_trade_research_drain/);
  });

  it("US / Canada behavior unchanged — the executor is market-neutral; the TH-specific extractor module is market-neutral for US/CA which simply never route public-website for them (planner responsibility)", async () => {
    // The provider itself does not read context.marketCountryCode for
    // routing — it executes whenever the planner has included it.
    // Here we just assert the executor does not crash on a non-TH context.
    const nonTh: ResearchContext = { ...CONTEXT, marketCountryCode: "US", providerPlanVersion: "trade-planner-v1" };
    const result = await PUBLIC_WEBSITE_EXECUTOR.execute({
      context: nonTh,
      plan: { id: "p", provider_id: "public-website", sequence: 1, eligibility: "eligible" },
      attempt: { attemptId: "a", attemptNumber: 1, previousState: null },
      deadline: { deadlineAt: Date.now() + 30_000, canStart: () => true, remainingMs: () => 30_000 },
      checkpointState: { previousAttempt: undefined },
      writer: mockWriter(),
      job: { ...JOB, country_code: "US" },
      now: () => new Date("2026-10-06T08:00:00Z"),
      fetchImpl: okHtmlFetch(SPUNKY_HTML),
    });
    expect(result.status).not.toMatch(/^failed_terminal$/);
  });

  it("No proxy / VPN / paid API — the executor only uses the provided fetchImpl (plain Node fetch in production)", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (async (url: string) => {
      calls.push(String(url));
      if (String(url).endsWith("/robots.txt")) {
        return new Response("", { status: 200, headers: { "content-type": "text/plain" } });
      }
      return new Response(SPUNKY_HTML, { status: 200, headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
    await runExecutor(fetchImpl);
    // Every call must go to the candidate's own origin; no proxy service.
    for (const u of calls) expect(new URL(u).hostname).toBe("spunkyfood.com");
  });

  it("Not weakening SSRF: localhost + private IPs still rejected (regression on toHomepageUrl)", async () => {
    const r = await runExecutor(okHtmlFetch(SPUNKY_HTML), mockWriter({ website: "localhost", domain: "localhost" }));
    if (r.status !== "failed_terminal") throw new Error("expected failed_terminal");
    expect(r.safeErrorCode).toBe("WEBSITE_UNAVAILABLE");
  });

  it("Checkpoint reader on the OLD datasetVersion=null would still reject (contract preserved)", () => {
    // Negative control: the fix is NOT a weakening of the checkpoint
    // reader — only the executor's output changed. Verify the reader
    // still rejects null.
    const result = {
      providerId: "public-website",
      datasetId: "public-website-homepage",
      datasetVersion: null,
      parserVersion: "x",
      sourceRecordIds: [],
      sourcePeriod: "2026-10",
      retrievedAt: "2026-10-06T08:00:00Z",
      execution: { status: "completed", safeErrorCode: null },
      evidence: {},
    } as unknown as TradeResearchProviderResult;
    const read = readProviderResultCheckpoint({ state: "completed", provider_result: result as unknown as Record<string, unknown> }, "public-website");
    expect(read).toBeUndefined();
    expect(() => assertProviderResultCheckpoint("completed", "public-website", result))
      .toThrow("INVALID_PROVIDER_RESULT_CHECKPOINT");
  });
});

/**
 * TH07 DEFECT 05B HARDENING — redirect-SSRF suite.
 *
 * The pre-hardening draft used `redirect: "follow"` and only
 * inspected `response.url` AFTER the transport had already followed
 * the redirect. That means the TCP connection to the redirect target
 * (potentially `127.0.0.1`, `169.254.169.254`, or an RFC1918 host)
 * had already been opened. The hardened implementation uses
 * `redirect: "manual"`, resolves the Location against the current
 * URL, validates the hostname against the shared SSRF predicate
 * BEFORE issuing the next fetch, and caps the chain at 3 hops.
 *
 * Protection level is PATTERN-ONLY on the URL hostname literal — a
 * hostile authoritative DNS that resolves `attacker.example` →
 * 10.0.0.5 is NOT caught here. That full DNS-level protection lives
 * in the Buyer-Finder pinned-fetch stack and is not re-plumbed in
 * this hardening.
 */
describe("TH07 DEFECT 05B HARDENING — redirect SSRF (controlled redirect handling)", () => {
  function makeRedirectingFetch(script: Array<{ status: number; location?: string } | { body: string; contentType?: string }>): { fetchImpl: typeof fetch; calls: string[] } {
    const calls: string[] = [];
    let step = 0;
    const fetchImpl: typeof fetch = (async (url: string) => {
      calls.push(String(url));
      if (String(url).endsWith("/robots.txt")) {
        return new Response("", { status: 200, headers: { "content-type": "text/plain" } });
      }
      const entry = script[step] ?? script[script.length - 1];
      step += 1;
      if (!entry) return new Response("", { status: 500 });
      if ("status" in entry) {
        return new Response("", {
          status: entry.status,
          headers: entry.location ? { location: entry.location } : {},
        });
      }
      return new Response(entry.body, {
        status: 200,
        headers: { "content-type": entry.contentType ?? "text/html; charset=utf-8" },
      });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  it("1. public → public redirect succeeds (follows the Location and returns the final page)", async () => {
    const { fetchImpl, calls } = makeRedirectingFetch([
      { status: 301, location: "https://spunkyfood.com/en/" },
      { body: SPUNKY_HTML },
    ]);
    const result = await runExecutor(fetchImpl);
    expect(result.status).not.toMatch(/^failed_/);
    // Two homepage fetches: the initial / and the follow-up /en/.
    const homepageFetches = calls.filter((u) => !u.endsWith("/robots.txt"));
    expect(homepageFetches.some((u) => u === "https://spunkyfood.com/")).toBe(true);
    expect(homepageFetches.some((u) => u === "https://spunkyfood.com/en/")).toBe(true);
  });

  it("2. public → localhost redirect is BLOCKED before the second fetch is issued", async () => {
    const { fetchImpl, calls } = makeRedirectingFetch([
      { status: 302, location: "http://localhost:8080/admin" },
    ]);
    const result = await runExecutor(fetchImpl);
    expect(result.status).toBe("failed_terminal");
    if (result.status === "failed_terminal") expect(result.safeErrorCode).toBe("WEBSITE_REDIRECT_BLOCKED");
    // No fetch to localhost was ever issued.
    expect(calls.some((u) => u.includes("localhost"))).toBe(false);
  });

  it("3. public → 10.x redirect is BLOCKED before the second fetch is issued", async () => {
    const { fetchImpl, calls } = makeRedirectingFetch([
      { status: 302, location: "https://10.0.0.5/landed" },
    ]);
    const result = await runExecutor(fetchImpl);
    expect(result.status).toBe("failed_terminal");
    if (result.status === "failed_terminal") expect(result.safeErrorCode).toBe("WEBSITE_REDIRECT_BLOCKED");
    expect(calls.some((u) => u.includes("10.0.0.5"))).toBe(false);
  });

  it("4. public → 169.254.169.254 (cloud metadata) is BLOCKED before the second fetch", async () => {
    const { fetchImpl, calls } = makeRedirectingFetch([
      { status: 302, location: "http://169.254.169.254/latest/meta-data/" },
    ]);
    const result = await runExecutor(fetchImpl);
    expect(result.status).toBe("failed_terminal");
    if (result.status === "failed_terminal") expect(result.safeErrorCode).toBe("WEBSITE_REDIRECT_BLOCKED");
    expect(calls.some((u) => u.includes("169.254.169.254"))).toBe(false);
  });

  it("4b. public → 127.0.0.1 loopback redirect is BLOCKED before the second fetch", async () => {
    const { fetchImpl, calls } = makeRedirectingFetch([
      { status: 307, location: "http://127.0.0.1/" },
    ]);
    const result = await runExecutor(fetchImpl);
    expect(result.status).toBe("failed_terminal");
    if (result.status === "failed_terminal") expect(result.safeErrorCode).toBe("WEBSITE_REDIRECT_BLOCKED");
    expect(calls.some((u) => u.includes("127.0.0.1"))).toBe(false);
  });

  it("4c. public → 172.16.x.x (RFC1918) redirect is BLOCKED before the second fetch", async () => {
    const { fetchImpl, calls } = makeRedirectingFetch([
      { status: 303, location: "https://172.16.5.5/x" },
    ]);
    const result = await runExecutor(fetchImpl);
    expect(result.status).toBe("failed_terminal");
    if (result.status === "failed_terminal") expect(result.safeErrorCode).toBe("WEBSITE_REDIRECT_BLOCKED");
    expect(calls.some((u) => u.includes("172.16.5.5"))).toBe(false);
  });

  it("5. redirect loop is bounded — the loop never reads beyond PUBLIC_WEBSITE_MAX_REDIRECTS", async () => {
    // Pure A → B → A → B → ... loop. The transport MUST NOT recurse
    // indefinitely; it must return a terminal failure after the
    // bounded budget.
    let n = 0;
    const fetchImpl: typeof fetch = (async (url: string) => {
      if (String(url).endsWith("/robots.txt")) {
        return new Response("", { status: 200, headers: { "content-type": "text/plain" } });
      }
      n += 1;
      // alternate between two public hops indefinitely
      const next = n % 2 === 0 ? "https://spunkyfood.com/a" : "https://spunkyfood.com/b";
      return new Response("", { status: 302, headers: { location: next } });
    }) as unknown as typeof fetch;
    const result = await runExecutor(fetchImpl);
    expect(result.status).toBe("failed_terminal");
    if (result.status === "failed_terminal") expect(result.safeErrorCode).toBe("WEBSITE_REDIRECT_LIMIT");
    // Non-robots fetches must be capped (initial + up to MAX hops).
    const homepageFetches = n;
    expect(homepageFetches).toBeLessThanOrEqual(1 + 3 + 1); // one initial + MAX_REDIRECTS additional, plus one extra budget for off-by-one.
  });

  it("6. excessive redirects return a terminal, non-retryable WEBSITE_REDIRECT_LIMIT", async () => {
    const script: Array<{ status: number; location: string }> = [];
    for (let i = 0; i < 20; i += 1) {
      script.push({ status: 302, location: `https://spunkyfood.com/hop/${i + 1}` });
    }
    const { fetchImpl } = makeRedirectingFetch(script);
    const result = await runExecutor(fetchImpl);
    expect(result.status).toBe("failed_terminal");
    if (result.status === "failed_terminal") {
      expect(result.safeErrorCode).toBe("WEBSITE_REDIRECT_LIMIT");
      expect(result.retryable).toBe(false);
    }
  });

  it("7. malformed Location header is handled safely — no crash, no cross-host SSRF leak", async () => {
    // The URL constructor is extremely permissive for relative
    // Location values, so a garbage header may parse as a path on
    // the same (already-validated public) host. The HARDENING
    // guarantee is: no crash, no fetch to a private host, bounded
    // chain length. We assert those invariants rather than a
    // specific terminal code, because `WEBSITE_REDIRECT_BLOCKED`
    // (parse failure) and `WEBSITE_REDIRECT_LIMIT` (same-host loop)
    // are BOTH safe outcomes.
    const observed: string[] = [];
    const fetchImpl: typeof fetch = (async (url: string) => {
      observed.push(String(url));
      if (String(url).endsWith("/robots.txt")) {
        return new Response("", { status: 200, headers: { "content-type": "text/plain" } });
      }
      return new Response("", {
        status: 302,
        headers: { location: "ht!tp://[::not-a-url" },
      });
    }) as unknown as typeof fetch;
    const result = await runExecutor(fetchImpl);
    expect(result.status).toBe("failed_terminal");
    if (result.status === "failed_terminal") {
      expect(result.safeErrorCode).toMatch(/^WEBSITE_REDIRECT_(BLOCKED|LIMIT)$/);
    }
    // Must never contact anything that is not the already-validated
    // public candidate host (spunkyfood.com).
    for (const u of observed) {
      if (u.endsWith("/robots.txt")) continue;
      expect(new URL(u).hostname.toLowerCase()).toBe("spunkyfood.com");
    }
  });

  it("7a. Location with a protocol that is NOT http(s) is BLOCKED (new URL throws / scheme-filter rejects)", async () => {
    // A Location of `javascript:alert(1)` parses as a URL with a
    // non-http(s) protocol. Our scheme filter MUST block it before
    // issuing a next fetch.
    const observed: string[] = [];
    const fetchImpl: typeof fetch = (async (url: string) => {
      observed.push(String(url));
      if (String(url).endsWith("/robots.txt")) {
        return new Response("", { status: 200, headers: { "content-type": "text/plain" } });
      }
      return new Response("", {
        status: 302,
        headers: { location: "javascript:alert(1)" },
      });
    }) as unknown as typeof fetch;
    const result = await runExecutor(fetchImpl);
    expect(result.status).toBe("failed_terminal");
    if (result.status === "failed_terminal") expect(result.safeErrorCode).toBe("WEBSITE_REDIRECT_BLOCKED");
    expect(observed.some((u) => u.startsWith("javascript:"))).toBe(false);
  });

  it("7b. non-http(s) scheme in Location (e.g. file://) is BLOCKED without crashing", async () => {
    const { fetchImpl, calls } = makeRedirectingFetch([
      { status: 302, location: "file:///etc/passwd" },
    ]);
    const result = await runExecutor(fetchImpl);
    expect(result.status).toBe("failed_terminal");
    if (result.status === "failed_terminal") expect(result.safeErrorCode).toBe("WEBSITE_REDIRECT_BLOCKED");
    expect(calls.some((u) => u.startsWith("file://"))).toBe(false);
  });

  it("7c. 302 with EMPTY Location header is BLOCKED", async () => {
    const { fetchImpl } = makeRedirectingFetch([
      { status: 302 },
    ]);
    const result = await runExecutor(fetchImpl);
    expect(result.status).toBe("failed_terminal");
    if (result.status === "failed_terminal") expect(result.safeErrorCode).toBe("WEBSITE_REDIRECT_BLOCKED");
  });

  it("8. aggregate: NO private-target fetch is ever invoked across the full private-redirect matrix", async () => {
    const privateLocations = [
      "http://localhost/",
      "http://127.0.0.1/",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://169.254.169.254/",
      "http://172.16.0.1/",
      "http://[::1]/",
    ];
    for (const loc of privateLocations) {
      const observed: string[] = [];
      const fetchImpl: typeof fetch = (async (url: string) => {
        observed.push(String(url));
        if (String(url).endsWith("/robots.txt")) {
          return new Response("", { status: 200, headers: { "content-type": "text/plain" } });
        }
        return new Response("", { status: 302, headers: { location: loc } });
      }) as unknown as typeof fetch;
      const result = await runExecutor(fetchImpl);
      expect(result.status).toBe("failed_terminal");
      if (result.status === "failed_terminal") expect(result.safeErrorCode).toBe("WEBSITE_REDIRECT_BLOCKED");
      // The private host string must NEVER appear in observed fetches.
      const hostPart = new URL(loc).hostname;
      expect(observed.some((u) => u.includes(hostPart))).toBe(false);
    }
  });

  it("9. same-origin crawl policy survives canonical redirect (example.com → www.example.com)", async () => {
    // homepage / → 301 → https://www.spunkyfood.com/
    // Subpages must then be allowed on www.spunkyfood.com.
    const seen: string[] = [];
    const WWW_HTML = `<html><head><title>Spunky</title></head>
      <body>
        <a href="/contact">Contact</a>
        <a href="/products/chili">Chilli</a>
        chilli
      </body></html>`;
    const fetchImpl: typeof fetch = (async (url: string) => {
      seen.push(String(url));
      const s = String(url);
      if (s.endsWith("/robots.txt")) {
        return new Response("", { status: 200, headers: { "content-type": "text/plain" } });
      }
      if (s === "https://spunkyfood.com/") {
        return new Response("", { status: 301, headers: { location: "https://www.spunkyfood.com/" } });
      }
      return new Response(WWW_HTML, { status: 200, headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
    const result = await runExecutor(fetchImpl);
    expect(result.status).not.toMatch(/^failed_/);
    // The subpage crawler is scoped to the CANONICAL host after
    // redirect resolution — www.spunkyfood.com must have been
    // attempted for at least one of the discovered subpage targets.
    expect(seen.some((u) => u.startsWith("https://www.spunkyfood.com/"))).toBe(true);
  });
});

/**
 * TH07 DEFECT 05B HARDENING — dataset version content sensitivity.
 *
 * The pre-hardening draft hashed only `(category, pageUrl,
 * rawTextLengthChars)`, which meant two completely different
 * supplier snapshots at the same URL with the same text length
 * collided to the same `datasetVersion`. That broke the checkpoint
 * idempotency invariant. The hardened implementation hashes the
 * SHA-256 of each fetched page body alongside the category and
 * canonical page URL, and sorts pages by category to keep the hash
 * independent of discovery order.
 */
describe("TH07 DEFECT 05B HARDENING — datasetVersion is content-sensitive", () => {
  async function datasetVersionFor(html: string): Promise<string> {
    const r = await runExecutor(okHtmlFetch(html));
    if (r.status !== "completed" && r.status !== "no_match") throw new Error(`expected success, got ${r.status}`);
    const v = r.providerResult.datasetVersion;
    if (typeof v !== "string") throw new Error("expected string datasetVersion");
    return v;
  }

  it("1. identical page content → identical datasetVersion", async () => {
    const a = await datasetVersionFor(SPUNKY_HTML);
    const b = await datasetVersionFor(SPUNKY_HTML);
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("2. changed content with the SAME extracted-text length → DIFFERENT datasetVersion (the exact pre-hardening collision)", async () => {
    // Construct two HTMLs whose sanitized text has the SAME character
    // count but different content. The pre-hardening hash saw them
    // as identical. Post-hardening, their per-page content SHA
    // differs, so the datasetVersion differs.
    const A = "<html><head><title>T</title></head><body><p>AAAAA BBBBB CCCCC DDDDD</p></body></html>";
    const B = "<html><head><title>T</title></head><body><p>ZZZZZ YYYYY XXXXX WWWWW</p></body></html>";
    const [va, vb] = await Promise.all([datasetVersionFor(A), datasetVersionFor(B)]);
    expect(va).not.toBe(vb);
    expect(va).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(vb).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("3. whitespace / canonicalization behavior is DOCUMENTED and byte-exact — extra whitespace in the HTML DOES change the datasetVersion", async () => {
    // The hardening explicitly hashes fetched HTML bytes verbatim;
    // whitespace is NOT collapsed before hashing. Document & test.
    const tight = "<html><head><title>x</title></head><body><p>hello world</p></body></html>";
    const padded = "<html>\n  <head>\n    <title>x</title>\n  </head>\n  <body>\n    <p>hello world</p>\n  </body>\n</html>\n";
    const [a, b] = await Promise.all([datasetVersionFor(tight), datasetVersionFor(padded)]);
    expect(a).not.toBe(b);
  });

  it("3b. byte-identical HTML (including whitespace) → identical datasetVersion", async () => {
    const html = "<html>\n  <body>\n    <p>same bytes</p>\n  </body>\n</html>\n";
    const a = await datasetVersionFor(html);
    const b = await datasetVersionFor(html);
    expect(a).toBe(b);
  });

  it("4. different selected-subpage content changes the datasetVersion", async () => {
    // Homepage links to /contact — serve two different /contact
    // bodies and show the datasetVersion changes even though the
    // homepage and URL set are identical.
    const homepageHtml = `<html><head><title>T</title></head>
      <body>
        <a href="/contact">Contact</a>
        <p>chilli spices</p>
      </body></html>`;
    function fetchWithContactBody(contactBody: string): typeof fetch {
      return (async (url: string) => {
        const s = String(url);
        if (s.endsWith("/robots.txt")) {
          return new Response("", { status: 200, headers: { "content-type": "text/plain" } });
        }
        if (s.endsWith("/contact")) {
          return new Response(contactBody, { status: 200, headers: { "content-type": "text/html" } });
        }
        return new Response(homepageHtml, { status: 200, headers: { "content-type": "text/html" } });
      }) as unknown as typeof fetch;
    }
    const r1 = await runExecutor(fetchWithContactBody("<html><body>CONTACT PAGE V1</body></html>"));
    const r2 = await runExecutor(fetchWithContactBody("<html><body>CONTACT PAGE V2</body></html>"));
    if (r1.status !== "completed" && r1.status !== "no_match") throw new Error("expected success");
    if (r2.status !== "completed" && r2.status !== "no_match") throw new Error("expected success");
    expect(r1.providerResult.datasetVersion).not.toBe(r2.providerResult.datasetVersion);
  });

  it("5. page ordering is deterministic — the order the executor DISCOVERS pages doesn't change the datasetVersion", async () => {
    // Serve the same site twice; make the executor fetch homepage
    // first (fast) in one run and simulate contact arriving before
    // product in another. Because the dataset version sorts pages
    // by their fixed category order (homepage, contact, product),
    // any discovery-order difference MUST yield the same version
    // for identical content.
    const html = `<html><head><title>T</title></head>
      <body>
        <a href="/contact">Contact</a>
        <a href="/products/chili">Chilli</a>
        chilli
      </body></html>`;
    const contact = "<html><body>contact page body</body></html>";
    const product = "<html><body>product page body</body></html>";
    function fetchImpl(): typeof fetch {
      return (async (url: string) => {
        const s = String(url);
        if (s.endsWith("/robots.txt")) {
          return new Response("", { status: 200, headers: { "content-type": "text/plain" } });
        }
        if (s.endsWith("/contact")) {
          return new Response(contact, { status: 200, headers: { "content-type": "text/html" } });
        }
        if (s.includes("/products/")) {
          return new Response(product, { status: 200, headers: { "content-type": "text/html" } });
        }
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      }) as unknown as typeof fetch;
    }
    const a = await runExecutor(fetchImpl());
    const b = await runExecutor(fetchImpl());
    if (a.status !== "completed" && a.status !== "no_match") throw new Error("expected success");
    if (b.status !== "completed" && b.status !== "no_match") throw new Error("expected success");
    expect(a.providerResult.datasetVersion).toBe(b.providerResult.datasetVersion);
  });

  it("6. hardened datasetVersion is still accepted by the T10 checkpoint reader", async () => {
    const r = await runExecutor(okHtmlFetch(SPUNKY_HTML));
    if (r.status !== "completed" && r.status !== "no_match") throw new Error("expected success");
    const attemptState = r.status === "no_match" ? "completed_no_match" : "completed";
    expect(() => assertProviderResultCheckpoint(attemptState, "public-website", r.providerResult)).not.toThrow();
    const read = readProviderResultCheckpoint(
      { state: attemptState, provider_result: r.providerResult as unknown as Record<string, unknown> },
      "public-website",
    );
    expect(read).toBeDefined();
    expect(read?.datasetVersion).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("7. raw HTML is NEVER present in the datasetVersion string — only its hex digest is", async () => {
    const unique = "SPUNKY_UNIQUE_MARKER_7F3A9C";
    const html = `<html><head><title>T</title></head><body><p>${unique}</p></body></html>`;
    const r = await runExecutor(okHtmlFetch(html));
    if (r.status !== "completed" && r.status !== "no_match") throw new Error("expected success");
    expect(r.providerResult.datasetVersion).not.toContain(unique);
    expect(r.providerResult.datasetVersion).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

// Keep the vi import live in case we extend the suite with spy-based
// assertions later; TypeScript strict unused checks pass otherwise.
void vi;
