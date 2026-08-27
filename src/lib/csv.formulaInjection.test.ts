import { describe, expect, it } from "vitest";
import type { Buyer } from "@/lib/types";
import { buyersToCsv, neutralizeFormula } from "./csv";

/**
 * F9-follow-up — CSV formula-injection guardrail.
 *
 * A buyer value beginning with =, +, -, @, TAB, or CR must NOT become a
 * spreadsheet formula when the CSV export is opened. We prefix such
 * values with a leading single quote per OWASP guidance.
 */

describe("neutralizeFormula — cell-level guardrail", () => {
  it("prefixes = / + / - / @ with a single quote", () => {
    expect(neutralizeFormula("=CMD()")).toBe("'=CMD()");
    expect(neutralizeFormula("+cmd|calc")).toBe("'+cmd|calc");
    expect(neutralizeFormula("-2+3+cmd")).toBe("'-2+3+cmd");
    expect(neutralizeFormula("@SUM(1,2)")).toBe("'@SUM(1,2)");
  });

  it("prefixes leading TAB and CR", () => {
    expect(neutralizeFormula("\t=danger")).toBe("'\t=danger");
    expect(neutralizeFormula("\r=danger")).toBe("'\r=danger");
  });

  it("passes through ordinary strings unchanged", () => {
    expect(neutralizeFormula("ABC Foods")).toBe("ABC Foods");
    expect(neutralizeFormula("hello@example.com")).toBe("hello@example.com");
    // `@` is only dangerous when it is the very first character.
    expect(neutralizeFormula("email is hello@example.com")).toBe(
      "email is hello@example.com",
    );
  });

  it("handles null / undefined / non-string safely", () => {
    expect(neutralizeFormula(null)).toBe("");
    expect(neutralizeFormula(undefined)).toBe("");
    expect(neutralizeFormula(42)).toBe("42");
  });
});

function b(over: Partial<Buyer> = {}): Buyer {
  return {
    id: "id",
    firstName: "",
    lastName: "",
    company: "",
    email: "",
    country: "",
    status: "new",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("buyersToCsv — file-level guardrail", () => {
  it("neutralises a malicious company name so it does NOT open as a formula", () => {
    const csv = buyersToCsv([b({ id: "1", company: "=HYPERLINK(\"http://evil\",\"click\")" })]);
    // The row for company must have the quoted-safe prefix. We look for
    // the exact escaped substring inside the CSV.
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/,=HYPERLINK/); // no unquoted formula start
  });

  it("preserves standard content unchanged", () => {
    const csv = buyersToCsv([b({ id: "1", company: "ABC Foods", email: "hi@abc.com" })]);
    expect(csv).toContain("ABC Foods");
    expect(csv).toContain("hi@abc.com");
  });

  it("still escapes commas, quotes and newlines via papaparse", () => {
    const csv = buyersToCsv([
      b({ id: "1", notes: 'has,comma "and" quote' }),
    ]);
    // Papaparse doubles the internal quotes and wraps the cell in quotes.
    expect(csv).toContain('"has,comma ""and"" quote"');
  });
});
