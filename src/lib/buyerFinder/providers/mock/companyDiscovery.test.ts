import { describe, it, expect } from "vitest";
import { createMockCompanyDiscoveryProvider } from "./companyDiscovery";

const chilliTh = {
  country: "Thailand",
  productKey: "guntur-chilli" as const,
};

describe("MockCompanyDiscoveryProvider", () => {
  const provider = createMockCompanyDiscoveryProvider();

  it("returns the same companies for the same query", async () => {
    const a = await provider.discover(chilliTh);
    const b = await provider.discover(chilliTh);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("returns product-specific results", async () => {
    const chilli = await provider.discover(chilliTh);
    const mango = await provider.discover({
      country: "Thailand",
      productKey: "banganapalli-mango",
    });
    expect(chilli.some((c) => c.providerRecordId === "mock-th-siam-spice")).toBe(true);
    expect(mango.some((c) => c.providerRecordId === "mock-th-siam-spice")).toBe(true);
    expect(mango.some((c) => c.providerRecordId === "mock-th-mango-house")).toBe(true);
    expect(chilli.some((c) => c.providerRecordId === "mock-th-mango-house")).toBe(false);
  });

  it("honors limit", async () => {
    const all = await provider.discover(chilliTh);
    const limited = await provider.discover({ ...chilliTh, limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0]).toEqual(all[0]);
  });

  it("honors country filter", async () => {
    const th = await provider.discover(chilliTh);
    const ae = await provider.discover({ country: "UAE", productKey: "guntur-chilli" });
    expect(th.every((c) => c.country === "Thailand")).toBe(true);
    expect(ae.every((c) => c.country === "UAE")).toBe(true);
    expect(ae.some((c) => c.providerRecordId === "mock-ae-gulf-spice")).toBe(true);
    expect(th.some((c) => c.providerRecordId === "mock-ae-gulf-spice")).toBe(false);
  });

  it("honors buyer type filter", async () => {
    const distributors = await provider.discover({
      ...chilliTh,
      buyerTypes: ["Distributor"],
    });
    expect(distributors.every((c) => c.isDistributor || /distributor/i.test(c.buyerType ?? ""))).toBe(
      true,
    );
    expect(distributors.some((c) => c.providerRecordId === "mock-th-chaophraya")).toBe(false);
    expect(distributors.some((c) => c.providerRecordId === "mock-th-bangkok-chilli")).toBe(true);
  });

  it("uses only fake .example domains and mock source", async () => {
    const hits = await provider.discover({ country: "Thailand", productKey: "pomegranate" });
    const uae = await provider.discover({ country: "UAE", productKey: "pomegranate" });
    for (const c of [...hits, ...uae]) {
      expect(c.domain).toMatch(/\.example$/);
      expect(c.source).toBe("mock");
      expect(c.companyName.length).toBeGreaterThan(0);
    }
  });

  it("fails predictably when configured to throw", async () => {
    const failing = createMockCompanyDiscoveryProvider({ fail: true });
    await expect(failing.discover(chilliTh)).rejects.toThrow(/Mock company discovery failed/);
  });
});
