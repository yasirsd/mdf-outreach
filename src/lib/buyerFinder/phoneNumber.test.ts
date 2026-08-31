import { describe, expect, it } from "vitest";
import { sanitizePhoneNumber } from "./phoneNumber";

describe("sanitizePhoneNumber", () => {
  it("trims a reasonable phone string", () => {
    expect(sanitizePhoneNumber("  +971 50 123 4567  ")).toBe("+971 50 123 4567");
  });

  it("rejects CR/LF/NUL and over-long values", () => {
    expect(sanitizePhoneNumber("123\n456")).toBeUndefined();
    expect(sanitizePhoneNumber("1".repeat(41))).toBeUndefined();
    expect(sanitizePhoneNumber("")).toBeUndefined();
  });
});
