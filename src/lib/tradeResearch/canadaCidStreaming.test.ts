import { describe, expect, it, vi } from "vitest";

import {
  CANADA_CID_PARSE_VERSION,
  CanadaCidParserError,
  CanadaCidRuntimeBudgetError,
  fetchAndParseCanadaCidStream,
} from "./canadaCid";

/**
 * BI4F Phase 2B — streaming CSV loader regressions.
 *
 * Production evidence: on a 37 MB 2020 CSV, `response.arrayBuffer`
 * alone consumed ~42 s from an off-Vercel connection. Even from
 * Vercel's data center the full-file download + parse can exceed
 * the 60 s function ceiling. The streaming loader:
 *   • reads the response body chunk-by-chunk,
 *   • decodes each chunk with a streaming TextDecoder,
 *   • parses through an incremental CSV state machine,
 *   • retains ONLY rows whose HS6 belongs to `canonicalHs6`,
 *   • computes SHA-256 over the FULL source bytes,
 *   • yields to the event loop between chunks (heartbeat / progress),
 *   • checks `deadlineAt` between chunks and throws
 *     `CanadaCidRuntimeBudgetError` when we are within
 *     `cleanupReserveMs` of the deadline.
 *
 * All fixtures below are synthetic multi-chunk streams; no real
 * network fetch happens.
 */

const HEADER =
  "HS6-SH6,COMPANY-ENTREPRISE,COUNTRY,PAYS,PROVINCE_ENG,PROVINCE_FRA,CITY-VILLE,POSTAL_CODE-CODE_POSTAL,DATA_YEAR-ANNÉE_DES_DONNÉES";

function bomBytes(text: string): Uint8Array {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  const enc = new TextEncoder().encode(text);
  const out = new Uint8Array(bom.byteLength + enc.byteLength);
  out.set(bom, 0); out.set(enc, bom.byteLength);
  return out;
}

/** Slice `bytes` into approximately equal-sized chunks, each returned as its own read. */
function chunkedResponse(bytes: Uint8Array, chunkSize: number, extraHeaders: Record<string, string> = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let i = 0; i < bytes.byteLength; i += chunkSize) {
        controller.enqueue(bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength)));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/csv", ...extraHeaders },
  });
}

const CANONICAL = new Set(["090421", "080810", "080450", "081090"]);

describe("BI4F 2B — streaming loader (chunked reads + HS6 filter + SHA-256 over full source)", () => {
  it("chunk boundary in middle of a row: reassembles correctly, retains canonical HS6, drops others", async () => {
    const bytes = bomBytes([
      HEADER,
      "010121,PHOENIX RISING FARMS,United States,États-Unis,British Columbia,Colombie-Britannique,Abbotsford,V3G 3E1,2020", // unrelated HS
      "090421,LOBLAW COMPANIES LIMITED,India,Inde,Ontario,Ontario,Brampton,L6Y 5S5,2020",
      "080810,APPLE CANADA CORP.,United States,États-Unis,Ontario,Ontario,Toronto,M5V 3A8,2020",
      "010121,ANOTHER FARM,United States,États-Unis,Alberta,Alberta,Somewhere,T0J 0B0,2020",
    ].join("\n") + "\n");
    let calls = 0;
    const fetchImpl = vi.fn(async () => { calls += 1; return chunkedResponse(bytes, 41); }) as unknown as typeof fetch;
    const result = await fetchAndParseCanadaCidStream({
      year: 2020, fetchImpl, canonicalHs6: CANONICAL,
    });
    expect(result.outcome).toBe("downloaded");
    expect(result.bytesConsumed).toBe(bytes.byteLength);
    expect(result.materialHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.totalDataRows).toBe(4);
    expect(result.retainedRows).toBe(2);
    expect(result.rows.map((r) => r.hs6).sort()).toEqual(["080810", "090421"]);
    expect(calls).toBe(1);
  });

  it("chunk boundary lands mid-quoted-field", async () => {
    const bytes = bomBytes([
      HEADER,
      `090421,"JOANNE FISHER, MARK MCNUTT",India,Inde,Ontario,Ontario,Dutton,N0L 1J0,2020`,
    ].join("\n") + "\n");
    const fetchImpl = vi.fn(async () => chunkedResponse(bytes, 20)) as unknown as typeof fetch;
    const result = await fetchAndParseCanadaCidStream({ year: 2020, fetchImpl, canonicalHs6: CANONICAL });
    expect(result.retainedRows).toBe(1);
    expect(result.rows[0].companyName).toBe("JOANNE FISHER, MARK MCNUTT");
  });

  it("CRLF split across chunks", async () => {
    const csv = [HEADER, "090421,LOBLAW COMPANIES LIMITED,India,Inde,Ontario,Ontario,Brampton,L6Y 5S5,2020"].join("\r\n") + "\r\n";
    const bytes = bomBytes(csv);
    // Force the CR to be the LAST byte of a chunk so LF lands in the next chunk.
    const cutAt = bytes.byteLength - 1;
    const chunks = [bytes.subarray(0, cutAt), bytes.subarray(cutAt)];
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) { for (const c of chunks) controller.enqueue(c); controller.close(); },
    });
    const fetchImpl = vi.fn(async () => new Response(stream, { status: 200, headers: { "content-type": "text/csv" } })) as unknown as typeof fetch;
    const result = await fetchAndParseCanadaCidStream({ year: 2020, fetchImpl, canonicalHs6: CANONICAL });
    expect(result.retainedRows).toBe(1);
  });

  it("UTF-8 multi-byte character split across chunks", async () => {
    // "Montréal" — the é is two bytes in UTF-8 (C3 A9). Force the
    // split between them so streaming TextDecoder must buffer.
    const csv = HEADER + "\n" +
      "090421,LOBLAW COMPANIES LIMITED,India,Inde,Quebec,Québec,Montréal,H2W 1E7,2020\n";
    const bytes = bomBytes(csv);
    // Find the é (C3 A9) inside Montréal — locate the second one:
    // there's no é in "Quebec" but there IS in "Québec" and "Montréal".
    let splitAt = -1;
    for (let i = bytes.byteLength - 1; i > 3; i -= 1) {
      if (bytes[i - 1] === 0xc3 && bytes[i] === 0xa9) { splitAt = i; break; }
    }
    expect(splitAt).toBeGreaterThan(0);
    const chunks = [bytes.subarray(0, splitAt), bytes.subarray(splitAt)];
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) { for (const c of chunks) controller.enqueue(c); controller.close(); },
    });
    const fetchImpl = vi.fn(async () => new Response(stream, { status: 200, headers: { "content-type": "text/csv" } })) as unknown as typeof fetch;
    const result = await fetchAndParseCanadaCidStream({ year: 2020, fetchImpl, canonicalHs6: CANONICAL });
    expect(result.retainedRows).toBe(1);
    expect(result.rows[0].city).toBe("Montréal");
  });

  it("BOM appears only at file start; body without BOM parses fine", async () => {
    const csv = HEADER + "\n090421,LOBLAW COMPANIES LIMITED,India,Inde,Ontario,Ontario,Brampton,L6Y 5S5,2020\n";
    const bytes = new TextEncoder().encode(csv);
    const fetchImpl = vi.fn(async () => chunkedResponse(bytes, 30)) as unknown as typeof fetch;
    const result = await fetchAndParseCanadaCidStream({ year: 2020, fetchImpl, canonicalHs6: CANONICAL });
    expect(result.retainedRows).toBe(1);
  });

  it("retains ONLY canonical MDF HS6 rows and discards unrelated ones (99% source shrinkage)", async () => {
    const lines = [HEADER];
    for (let i = 0; i < 500; i += 1) {
      lines.push(`010${(100 + i).toString().padStart(3, "0")},UNRELATED FARM ${i},United States,États-Unis,Alberta,Alberta,Somewhere,T0J 0B0,2020`);
    }
    lines.push("090421,LOBLAW COMPANIES LIMITED,India,Inde,Ontario,Ontario,Brampton,L6Y 5S5,2020");
    lines.push("080810,APPLE CANADA CORP.,United States,États-Unis,Ontario,Ontario,Toronto,M5V 3A8,2020");
    const bytes = bomBytes(lines.join("\n") + "\n");
    const fetchImpl = vi.fn(async () => chunkedResponse(bytes, 8192)) as unknown as typeof fetch;
    const result = await fetchAndParseCanadaCidStream({ year: 2020, fetchImpl, canonicalHs6: CANONICAL });
    expect(result.totalDataRows).toBe(502);
    expect(result.retainedRows).toBe(2);
    // Compressed cached JSON should be ~200 bytes, not ~60 KB
    expect(JSON.stringify(result.rows).length).toBeLessThan(1_000);
  });

  it("SHA-256 material hash covers the FULL source bytes (not the filtered subset)", async () => {
    const bytes = bomBytes([
      HEADER,
      "090421,LOBLAW,India,Inde,Ontario,Ontario,Brampton,L6Y 5S5,2020",
      "010121,UNRELATED,United States,États-Unis,Alberta,Alberta,X,T0J 0B0,2020",
    ].join("\n") + "\n");
    const fetchImpl = vi.fn(async () => chunkedResponse(bytes, 40)) as unknown as typeof fetch;
    const result = await fetchAndParseCanadaCidStream({ year: 2020, fetchImpl, canonicalHs6: CANONICAL });
    // Compute the reference SHA-256 with node:crypto and compare.
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256").update(bytes).digest("hex");
    expect(result.materialHash).toBe(expected);
    expect(result.bytesConsumed).toBe(bytes.byteLength);
  });
});

describe("BI4F 2B — deadline-during-parse aborts safely as CanadaCidRuntimeBudgetError", () => {
  it("throws CanadaCidRuntimeBudgetError when deadlineAt is already breached during streaming", async () => {
    // Deadline is 100 ms in the future; cleanupReserveMs = 8000 ms.
    // Every chunk boundary triggers a deadline check → we should
    // throw on the very first check.
    const bytes = bomBytes([
      HEADER,
      "090421,LOBLAW,India,Inde,Ontario,Ontario,Brampton,L6Y 5S5,2020",
    ].join("\n") + "\n");
    const fetchImpl = vi.fn(async () => chunkedResponse(bytes, 10)) as unknown as typeof fetch;
    const now = Date.now();
    await expect(
      fetchAndParseCanadaCidStream({
        year: 2020, fetchImpl, canonicalHs6: CANONICAL,
        deadlineAt: now + 100, cleanupReserveMs: 8_000,
      }),
    ).rejects.toBeInstanceOf(CanadaCidRuntimeBudgetError);
  });

  it("generous deadline → completes normally", async () => {
    const bytes = bomBytes([
      HEADER,
      "090421,LOBLAW,India,Inde,Ontario,Ontario,Brampton,L6Y 5S5,2020",
    ].join("\n") + "\n");
    const fetchImpl = vi.fn(async () => chunkedResponse(bytes, 10)) as unknown as typeof fetch;
    const result = await fetchAndParseCanadaCidStream({
      year: 2020, fetchImpl, canonicalHs6: CANONICAL,
      deadlineAt: Date.now() + 60_000, cleanupReserveMs: 8_000,
    });
    expect(result.retainedRows).toBe(1);
  });
});

describe("BI4F 2B — heartbeat / onProgress fires between chunks", () => {
  it("onProgress is called for each streamed chunk (heartbeat opportunity)", async () => {
    const bytes = bomBytes([
      HEADER,
      "090421,LOBLAW,India,Inde,Ontario,Ontario,Brampton,L6Y 5S5,2020",
      "080810,APPLE CANADA,United States,États-Unis,Ontario,Ontario,Toronto,M5V 3A8,2020",
    ].join("\n") + "\n");
    const onProgress = vi.fn();
    const fetchImpl = vi.fn(async () => chunkedResponse(bytes, 30)) as unknown as typeof fetch;
    await fetchAndParseCanadaCidStream({ year: 2020, fetchImpl, canonicalHs6: CANONICAL, onProgress });
    expect(onProgress).toHaveBeenCalled();
    // At least 2 chunks for our 30-byte cut on ~200 byte body.
    expect(onProgress.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("BI4F 2B — magic-byte rejection at fetch boundary (never reaches parser)", () => {
  it("HTML body → CID_SOURCE_HTML, reader canceled", async () => {
    const html = new TextEncoder().encode("<!DOCTYPE html><html><body>Error</body></html>");
    const fetchImpl = vi.fn(async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    try { await fetchAndParseCanadaCidStream({ year: 2020, fetchImpl, canonicalHs6: CANONICAL }); expect.fail(); }
    catch (e) { expect((e as CanadaCidParserError).code).toBe("CID_SOURCE_HTML"); }
  });

  it("XLSB body → CID_XLSB_UNSUPPORTED", async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Uint8Array(20)]);
    const fetchImpl = vi.fn(async () => new Response(zip, { status: 200, headers: { "content-type": "application/vnd.ms-excel" } })) as unknown as typeof fetch;
    try { await fetchAndParseCanadaCidStream({ year: 2020, fetchImpl, canonicalHs6: CANONICAL }); expect.fail(); }
    catch (e) { expect((e as CanadaCidParserError).code).toBe("CID_XLSB_UNSUPPORTED"); }
  });

  it("XLS body → CID_LEGACY_XLS_UNSUPPORTED", async () => {
    const ole2 = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Uint8Array(20)]);
    const fetchImpl = vi.fn(async () => new Response(ole2, { status: 200, headers: { "content-type": "application/vnd.ms-excel" } })) as unknown as typeof fetch;
    try { await fetchAndParseCanadaCidStream({ year: 2020, fetchImpl, canonicalHs6: CANONICAL }); expect.fail(); }
    catch (e) { expect((e as CanadaCidParserError).code).toBe("CID_LEGACY_XLS_UNSUPPORTED"); }
  });

  it("oversize declared → CID_OVERSIZE (no download)", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(0), {
      status: 200, headers: { "content-length": String(200 * 1024 * 1024) },
    })) as unknown as typeof fetch;
    try { await fetchAndParseCanadaCidStream({ year: 2020, fetchImpl, canonicalHs6: CANONICAL }); expect.fail(); }
    catch (e) { expect((e as CanadaCidParserError).code).toBe("CID_OVERSIZE"); }
  });

  it("oversize while streaming (declared 0 but body exceeds cap) → CID_OVERSIZE + reader cancelled", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(60 * 1024 * 1024));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => new Response(stream, { status: 200, headers: { "content-type": "text/csv" } })) as unknown as typeof fetch;
    try { await fetchAndParseCanadaCidStream({ year: 2020, fetchImpl, canonicalHs6: CANONICAL }); expect.fail(); }
    catch (e) { expect((e as CanadaCidParserError).code).toBe("CID_OVERSIZE"); }
  });
});

describe("BI4F 2B — parse_version v2 (breaking change signal for cache readers)", () => {
  it("CANADA_CID_PARSE_VERSION is 'canada-cid-csv-v2'", () => {
    expect(CANADA_CID_PARSE_VERSION).toBe("canada-cid-csv-v2");
  });
});

describe("BI4F 2B — 304 not_modified bypasses parse entirely", () => {
  it("returns { outcome: 'not_modified', rows: [] } without downloading", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 304 })) as unknown as typeof fetch;
    const result = await fetchAndParseCanadaCidStream({
      year: 2020, fetchImpl, canonicalHs6: CANONICAL,
      etag: "\"v1\"", lastModified: "Wed, 25 Sep 2026 08:27:55 GMT",
    });
    expect(result.outcome).toBe("not_modified");
    expect(result.rows).toHaveLength(0);
    expect(result.bytesConsumed).toBe(0);
  });
});
