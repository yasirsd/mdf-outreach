import { describe, expect, it } from "vitest";
import { isSameCompanySite, registrableDomain } from "./sameSite";

describe("same-company site policy", () => {
  it("treats www and contact subdomains as the same company", () => {
    expect(isSameCompanySite("company.com", "www.company.com")).toBe(true);
    expect(isSameCompanySite("company.com", "contact.company.com")).toBe(true);
    expect(isSameCompanySite("company.com", "company.com")).toBe(true);
  });

  it("does not treat a deceptive suffix as same-site", () => {
    expect(isSameCompanySite("company.com", "evilcompany.com")).toBe(false);
    expect(isSameCompanySite("company.com", "notcompany.com")).toBe(false);
    expect("evilcompany.com".endsWith("company.com")).toBe(true);
  });

  it("rejects suffix tricks and sibling-looking hosts", () => {
    expect(isSameCompanySite("company.com", "company.com.attacker.net")).toBe(false);
    expect(isSameCompanySite("company.com", "companycom")).toBe(false);
    expect(isSameCompanySite("company.com", "attacker-company.com")).toBe(false);
    expect(isSameCompanySite("com", "evil.com")).toBe(false);
  });

  it("normalizes case and trailing dots", () => {
    expect(isSameCompanySite("Company.COM.", "WWW.Company.com")).toBe(true);
  });

  it("normalizes IDN via punycode and rejects malformed candidate domains", () => {
    expect(isSameCompanySite("bücher.de", "www.bücher.de")).toBe(true);
    expect(isSameCompanySite("xn--bcher-kva.de", "www.bücher.de")).toBe(true);
    expect(isSameCompanySite("", "company.com")).toBe(false);
    expect(isSameCompanySite("not a domain!!!", "company.com")).toBe(false);
    expect(isSameCompanySite("..", "company.com")).toBe(false);
  });
});
