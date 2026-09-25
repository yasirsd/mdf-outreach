import { describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  FdaFsvpParserError,
  extractUsState,
  fetchFdaFsvpDataset,
  matchFdaFsvpCompany,
  normalizeCompanyName,
  parseFdaFsvpRows,
  parseFdaFsvpXlsx,
  type FdaFsvpRow,
} from "./fdaFsvp";

const rows: FdaFsvpRow[] = [
  { companyName: "BC FOODS, INC.", stateCode: "CA" },
  { companyName: "Acme Foods LLC", stateCode: "NY" },
  { companyName: "Acme Foods, Inc", stateCode: "TX" },
];

describe("FDA FSVP format and conservative matching", () => {
  it("normalizes punctuation, accents, ampersands, and legal suffixes", () => {
    expect(normalizeCompanyName("B.C. Foods, Inc.")).toBe("B C FOODS");
    expect(normalizeCompanyName("Café & Spice LLC")).toBe("CAFE AND SPICE");
  });

  it("returns strong only for normalized company plus matching state", () => {
    expect(matchFdaFsvpCompany({ companyName: "BC FOODS INC", address: "Fresno, CA 93721", rows }).decision).toBe("strong");
  });

  it("never upgrades the name/state-only FDA source to exact", () => {
    expect(matchFdaFsvpCompany({ companyName: "BC FOODS, INC.", address: "Fresno, California", rows }).decision).not.toBe("exact");
  });

  it("rejects a similar normalized name when state conflicts", () => {
    const result = matchFdaFsvpCompany({ companyName: "BC FOODS LLC", address: "Portland, OR 97205", rows });
    expect(result.decision).toBe("rejected");
    expect(result.reason).toMatch(/conflicting state/i);
  });

  it("marks multiple name matches ambiguous when candidate state is missing", () => {
    const result = matchFdaFsvpCompany({ companyName: "Acme Foods", city: "Springfield", rows });
    expect(result.decision).toBe("ambiguous");
    expect(result.matchedRows).toHaveLength(2);
  });

  it("returns none when no credible normalized match exists", () => {
    expect(matchFdaFsvpCompany({ companyName: "Different Foods", address: "Austin, TX", rows }).decision).toBe("none");
  });

  it("extracts an explicit state name/abbreviation but not an unqualified city", () => {
    expect(extractUsState("10 Main St, Austin, TX 78701")).toBe("TX");
    expect(extractUsState("10 Main St, Austin, Texas")).toBe("TX");
    expect(extractUsState(undefined, "Austin")).toBeUndefined();
  });

  it("skips malformed rows and deduplicates duplicate FDA rows", () => {
    const parsed = parseFdaFsvpRows([
      { B: "Foreign Supplier Verification Programs - List of Participants (Name and State Only) April 1, 2026 – June 30, 2026" },
      { B: "Firm Legal Name", C: "State Code" },
      { B: "BC FOODS, INC.", C: "CA" },
      { B: "BC FOODS, INC.", C: "CA" },
      { B: "Broken", C: "California" },
      { B: "", C: "TX" },
    ]);
    expect(parsed.rows).toEqual([{ companyName: "BC FOODS, INC.", stateCode: "CA" }]);
    expect(parsed.malformedRowCount).toBe(2);
  });

  it("parses the actual semantic XLSX headers without depending on column A", () => {
    const shared = [
      "Foreign Supplier Verification Programs - List of Participants (Name and State Only) April 1, 2026 – June 30, 2026",
      "Firm Legal Name", "State Code", "BC FOODS, INC.", "CA",
    ];
    const workbook = zipSync({
      "xl/sharedStrings.xml": strToU8(`<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`),
      "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData><row><c r="B1" t="s"><v>0</v></c></row><row><c r="B2" t="s"><v>1</v></c><c r="C2" t="s"><v>2</v></c></row><row><c r="B3" t="s"><v>3</v></c><c r="C3" t="s"><v>4</v></c></row></sheetData></worksheet>`),
    });
    expect(parseFdaFsvpXlsx(workbook).rows).toEqual([{ companyName: "BC FOODS, INC.", stateCode: "CA" }]);
  });

  it("fails terminally on parser/header drift", () => {
    expect(() => parseFdaFsvpRows([{ A: "Unknown" }])).toThrow(FdaFsvpParserError);
  });

  it("uses conditional headers and accepts a cache-preserving 304", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("if-none-match")).toBe("abc");
      return new Response(null, { status: 304 });
    }) as unknown as typeof fetch;
    await expect(fetchFdaFsvpDataset({ etag: "abc", fetchImpl })).resolves.toMatchObject({ outcome: "not_modified" });
  });

  it("rejects HTML or other unexpected source formats", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html/>", { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    await expect(fetchFdaFsvpDataset({ fetchImpl })).rejects.toBeInstanceOf(FdaFsvpParserError);
  });
});

