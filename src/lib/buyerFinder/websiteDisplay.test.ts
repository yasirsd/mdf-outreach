import { describe, expect, it } from "vitest";
import { candidateWebsiteLabel, safeCandidateWebsiteHref } from "./websiteDisplay";

describe("candidate website display", () => {
  it("uses the persisted URL without forcing www", () => {
    expect(safeCandidateWebsiteHref("https://www.company.com/", "company.com")).toBe(
      "https://www.company.com/",
    );
    expect(candidateWebsiteLabel("https://www.company.com/")).toBe("www.company.com");
    expect(safeCandidateWebsiteHref("https://company.com/", "company.com")).toBe("https://company.com/");
    expect(candidateWebsiteLabel("https://company.com/")).toBe("company.com");
  });

  it("rejects javascript, credentials, and off-domain hosts", () => {
    expect(safeCandidateWebsiteHref("javascript:alert(1)", "company.com")).toBeUndefined();
    expect(safeCandidateWebsiteHref("https://user:pass@company.com/", "company.com")).toBeUndefined();
    expect(safeCandidateWebsiteHref("https://evil.com/", "company.com")).toBeUndefined();
  });
});
