import { describe, expect, it } from "vitest";
import {
  extractBusinessClaims,
  extractBusinessPageLinks,
  rankBusinessPageLinks,
  visibleText,
} from "./publicWebsiteBusinessExtract";

describe("BI3 publicWebsiteBusinessExtract — page selection", () => {
  it("finds about / company / products / services / contact links and ranks about first", () => {
    const html = `
      <a href="/about-us">About us</a>
      <a href="/services">Our services</a>
      <a href="/products">Product catalogue</a>
      <a href="/company">Company</a>
      <a href="/contact">Contact</a>
      <a href="/blog/post-1">Blog</a>
      <a href="mailto:info@example.com">Email</a>
    `;
    const links = extractBusinessPageLinks(html);
    expect(links.map((l) => l.kind).sort()).toEqual(
      ["about", "company", "contact", "products", "services"].sort(),
    );
    const ranked = rankBusinessPageLinks(links);
    expect(ranked[0]?.kind === "about" || ranked[0]?.kind === "company").toBe(true);
    expect(ranked[ranked.length - 1]?.kind).toBe("contact");
    expect(links.some((l) => l.href.startsWith("mailto:"))).toBe(false);
    expect(links.some((l) => l.href.includes("/blog"))).toBe(false);
  });

  it("visibleText strips scripts and styles", () => {
    const html = `
      <html><head><style>.x{color:red}</style><script>alert(1)</script></head>
      <body><p>We are a leading importer of dry chillies.</p></body></html>
    `;
    const text = visibleText(html);
    expect(text).toContain("We are a leading importer of dry chillies.");
    expect(text).not.toContain("alert(1)");
    expect(text).not.toContain("color:red");
  });
});

describe("BI3 publicWebsiteBusinessExtract — business claim extraction", () => {
  const url = "https://example.com/about";

  it("A: extracts a website_business_description from the meta description", () => {
    const html = `
      <html><head><meta name="description" content="Kuwait-based importer and distributor of specialty ingredients and spices for the food industry." /></head>
      <body><h1>Example</h1></body></html>
    `;
    const out = extractBusinessClaims({ finalUrl: url, html, kind: "homepage" });
    const description = out.claims.find((c) => c.claimType === "website_business_description");
    expect(description).toBeDefined();
    expect(description?.excerpt).toContain("Kuwait-based importer");
  });

  it("B: extracts company_is_importer only from explicit importer language", () => {
    const html = `
      <html><body>
        <p>We are a leading importer of dry red chillies and specialty spices.</p>
      </body></html>
    `;
    const out = extractBusinessClaims({ finalUrl: url, html, kind: "about" });
    const importer = out.claims.find((c) => c.claimType === "company_is_importer");
    expect(importer).toBeDefined();
    expect(importer?.excerpt).toMatch(/leading importer/i);
  });

  it("C: extracts company_is_distributor from explicit distributor language", () => {
    const html = `
      <html><body>
        <p>We are the authorised distributor of premium coffees across the GCC.</p>
      </body></html>
    `;
    const out = extractBusinessClaims({ finalUrl: url, html, kind: "about" });
    const distributor = out.claims.find((c) => c.claimType === "company_is_distributor");
    expect(distributor).toBeDefined();
  });

  it("D: a product catalogue alone does NOT produce importer/distributor claims", () => {
    const html = `
      <html><body>
        <h1>Products</h1>
        <ul>
          <li>Dry Red Chilli</li>
          <li>Turmeric</li>
          <li>Cardamom</li>
        </ul>
        <p>Our catalogue includes over 200 products.</p>
      </body></html>
    `;
    const out = extractBusinessClaims({ finalUrl: url, html, kind: "products" });
    expect(out.claims.find((c) => c.claimType === "company_is_importer")).toBeUndefined();
    expect(out.claims.find((c) => c.claimType === "company_is_distributor")).toBeUndefined();
    // imports_product must not fire either — no "we import X" phrase.
    expect(out.claims.find((c) => c.claimType === "imports_product")).toBeUndefined();
  });

  it("imports_product only fires when 'we import <catalogue product>' co-occurs in the same sentence", () => {
    const html = `
      <html><body>
        <p>We import Guntur Dry Red Chilli directly from India.</p>
      </body></html>
    `;
    const out = extractBusinessClaims({ finalUrl: url, html, kind: "about" });
    const product = out.claims.find((c) => c.claimType === "imports_product");
    expect(product).toBeDefined();
    expect(product?.normalized).toMatchObject({ mdfProductId: "guntur-dry-red-chilli" });
  });

  it("does NOT fire imports_product when import phrase and product are in different sentences", () => {
    const html = `
      <html><body>
        <p>Established in 1998, we import a variety of ingredients.</p>
        <p>Our latest catalogue features Guntur Dry Red Chilli among many spices.</p>
      </body></html>
    `;
    const out = extractBusinessClaims({ finalUrl: url, html, kind: "about" });
    expect(out.claims.find((c) => c.claimType === "imports_product")).toBeUndefined();
  });

  it("F: no qualifying language → no claims (not even description if too short)", () => {
    const html = `
      <html><head><meta name="description" content="Home" /></head>
      <body><h1>Hello</h1><p>Menu.</p></body></html>
    `;
    const out = extractBusinessClaims({ finalUrl: url, html, kind: "homepage" });
    expect(out.claims).toEqual([]);
  });

  it("emits identical sourceRecordRef for the same page + kind so re-runs are idempotent", () => {
    const html = `
      <html><body><p>We are a leading importer of dry chillies and spices.</p></body></html>
    `;
    const first = extractBusinessClaims({ finalUrl: url, html, kind: "about" });
    const second = extractBusinessClaims({ finalUrl: url, html, kind: "about" });
    expect(first.claims.map((c) => c.sourceRecordRef)).toEqual(
      second.claims.map((c) => c.sourceRecordRef),
    );
  });
});
