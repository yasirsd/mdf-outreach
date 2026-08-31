import { describe, expect, it } from "vitest";
import { sanitizeLinkedinProfileUrl } from "./linkedinUrl";

describe("sanitizeLinkedinProfileUrl", () => {
  it("accepts https linkedin.com and www.linkedin.com profile URLs", () => {
    expect(sanitizeLinkedinProfileUrl("https://linkedin.com/in/person")).toBe(
      "https://linkedin.com/in/person",
    );
    expect(sanitizeLinkedinProfileUrl("https://www.linkedin.com/in/person")).toBe(
      "https://www.linkedin.com/in/person",
    );
  });

  it("rejects lookalikes, javascript, data, credentials, and http", () => {
    expect(sanitizeLinkedinProfileUrl("https://evil-linkedin.example/in/person")).toBeUndefined();
    expect(sanitizeLinkedinProfileUrl("javascript:alert(1)")).toBeUndefined();
    expect(sanitizeLinkedinProfileUrl("data:text/html,hi")).toBeUndefined();
    expect(sanitizeLinkedinProfileUrl("https://user:pass@www.linkedin.com/in/person")).toBeUndefined();
    expect(sanitizeLinkedinProfileUrl("http://www.linkedin.com/in/person")).toBeUndefined();
  });
});
