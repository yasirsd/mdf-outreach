import { describe, expect, it } from "vitest";
import {
  extractCandidatePageLinks,
  extractPublishedEmails,
  normalizeDiscoveredEmail,
  rankCandidatePageLinks,
} from "./publicEmailExtract";

describe("public email normalization", () => {
  it("lowercases, strips mailto query, and trailing punctuation", () => {
    expect(normalizeDiscoveredEmail("mailto:Sales@Company.com?subject=Hi")).toBe("sales@company.com");
    expect(normalizeDiscoveredEmail("imports@company.com.")).toBe("imports@company.com");
    expect(normalizeDiscoveredEmail("info@company.com,")).toBe("info@company.com");
  });

  it("drops obvious junk and noreply", () => {
    expect(normalizeDiscoveredEmail("noreply@company.com")).toBeUndefined();
    expect(normalizeDiscoveredEmail("no-reply@company.com")).toBeUndefined();
    expect(normalizeDiscoveredEmail("example@example.com")).toBeUndefined();
    expect(normalizeDiscoveredEmail("postmaster@company.com")).toBeUndefined();
    expect(normalizeDiscoveredEmail("sales@company.com\r\nBcc:evil@x.com")).toBeUndefined();
    expect(normalizeDiscoveredEmail("sales&foo@company.com")).toBeUndefined();
    expect(normalizeDiscoveredEmail(`${"a".repeat(250)}@x.co`)).toBeUndefined();
  });
});

describe("extractPublishedEmails", () => {
  it("extracts mailto and visible public emails", () => {
    const html = `
      <html><body>
        <a href="mailto:procurement@company.com">mail us</a>
        <p>Also write to sales@company.com</p>
      </body></html>
    `;
    expect(extractPublishedEmails(html)).toEqual(["procurement@company.com", "sales@company.com"]);
  });

  it("dedupes normalized duplicates", () => {
    const html = `<a href="mailto:Info@Company.com">x</a><p>info@company.com</p>`;
    expect(extractPublishedEmails(html)).toEqual(["info@company.com"]);
  });

  it("ignores emails inside script and style", () => {
    const html = `
      <script>const e = "hidden@company.com";</script>
      <style>.x::after { content: "styled@company.com"; }</style>
      <p>Visible only.</p>
    `;
    expect(extractPublishedEmails(html)).toEqual([]);
  });

  it("does not invent a guessed info@ address", () => {
    const html = `<html><body><h1>Welcome to Company</h1><p>Call us instead.</p></body></html>`;
    expect(extractPublishedEmails(html)).not.toContain("info@company.com");
    expect(extractPublishedEmails(html)).toEqual([]);
  });

  it("reads a JSON-LD email field", () => {
    const html = `<script type="application/ld+json">{"@type":"Organization","email":"office@company.com"}</script>`;
    expect(extractPublishedEmails(html)).toEqual(["office@company.com"]);
  });

  it("extracts a visible mail@ address from a contact-page style layout", () => {
    const html = `
      <html><body>
        <h2>Contact Us</h2>
        <div>Send us an E-mail at</div>
        <div>mail@company.com</div>
      </body></html>
    `;
    expect(extractPublishedEmails(html)).toEqual(["mail@company.com"]);
  });

  it("extracts a footer email from the homepage", () => {
    const html = `<html><body><footer>info@company.com</footer></body></html>`;
    expect(extractPublishedEmails(html)).toEqual(["info@company.com"]);
  });
});

describe("extractCandidatePageLinks", () => {
  it("finds contact and about hrefs", () => {
    const html = `<a href="/contact-us">Contact us</a><a href="/about">About</a><a href="/blog">Blog</a>`;
    const hrefs = extractCandidatePageLinks(html).map((l) => l.href);
    expect(hrefs).toContain("/contact-us");
    expect(hrefs).toContain("/about");
    expect(hrefs).not.toContain("/blog");
  });

  it("ranks contact ahead of about even when about appears first", () => {
    const html = `<a href="/about-us">About Us</a><a href="/contact">Contact</a>`;
    const ranked = rankCandidatePageLinks(extractCandidatePageLinks(html));
    expect(ranked.map((l) => l.href)).toEqual(["/contact", "/about-us"]);
  });

  it("treats Connect with us as a contact link", () => {
    const html = `<a href="/contact">Connect with us</a>`;
    const links = extractCandidatePageLinks(html);
    expect(links[0]?.kind).toBe("contact");
    expect(links[0]?.href).toBe("/contact");
  });

  it("accepts an absolute same-site contact URL and HTML-entity hrefs", () => {
    const html = `
      <a href="https://www.company.com/contact">Contact</a>
      <a href="/contact-us?ref=1&amp;src=nav">Contact Us</a>
    `;
    const hrefs = extractCandidatePageLinks(html).map((l) => l.href);
    expect(hrefs).toContain("https://www.company.com/contact");
    expect(hrefs).toContain("/contact-us?ref=1&src=nav");
  });

  it("does not require both path and anchor text to match", () => {
    expect(extractCandidatePageLinks(`<a href="/misc">Contact Us</a>`)[0]?.kind).toBe("contact");
    expect(extractCandidatePageLinks(`<a href="/contact">Click here</a>`)[0]?.kind).toBe("contact");
  });
});
