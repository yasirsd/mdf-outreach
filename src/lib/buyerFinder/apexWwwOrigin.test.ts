import { describe, expect, it } from "vitest";
import { httpsApexWwwAlternate, originHomeUrl } from "./apexWwwOrigin";

describe("apex/www origin pairing", () => {
  it("pairs apex with www over HTTPS only", () => {
    expect(httpsApexWwwAlternate("https://company.com/", "company.com")).toBe("https://www.company.com/");
    expect(httpsApexWwwAlternate("https://www.company.com/", "company.com")).toBe("https://company.com/");
  });

  it("does not invent other subdomains", () => {
    expect(httpsApexWwwAlternate("https://contact.company.com/", "company.com")).toBeUndefined();
    expect(httpsApexWwwAlternate("https://shop.company.com/", "company.com")).toBeUndefined();
    expect(httpsApexWwwAlternate("https://www2.company.com/", "company.com")).toBeUndefined();
  });

  it("normalizes observed origin to a homepage URL", () => {
    expect(originHomeUrl("https://www.company.com/contact")).toBe("https://www.company.com/");
  });
});
