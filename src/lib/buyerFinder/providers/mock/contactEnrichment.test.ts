import { describe, it, expect } from "vitest";
import { createMockCompanyDiscoveryProvider } from "./companyDiscovery";
import { createMockContactEnrichmentProvider } from "./contactEnrichment";

describe("MockContactEnrichmentProvider", () => {
  const companies = createMockCompanyDiscoveryProvider();
  const contacts = createMockContactEnrichmentProvider();

  it("returns deterministic contacts for the same company", async () => {
    const [siam] = (await companies.discover({ country: "Thailand", productId: "guntur-dry-red-chilli" })).filter(
      (c) => c.providerRecordId === "mock-th-siam-spice",
    );
    const a = await contacts.findContacts({ company: siam! });
    const b = await contacts.findContacts({ company: siam! });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(1);
  });

  it("returns deterministic roles including procurement, import, and managing director", async () => {
    const siam = (await companies.discover({ country: "Thailand", productId: "guntur-dry-red-chilli" })).find(
      (c) => c.providerRecordId === "mock-th-siam-spice",
    );
    const people = await contacts.findContacts({ company: siam! });
    const titles = people.map((p) => p.jobTitle);
    expect(titles).toContain("Procurement Manager");
    expect(titles).toContain("Import Manager");
    expect(titles).toContain("Managing Director");
  });

  it("filters by role priority when matches exist, otherwise returns all", async () => {
    const siam = (await companies.discover({ country: "Thailand", productId: "guntur-dry-red-chilli" })).find(
      (c) => c.providerRecordId === "mock-th-siam-spice",
    );
    const procurementOnly = await contacts.findContacts({
      company: siam!,
      roles: ["procurement"],
    });
    expect(procurementOnly).toHaveLength(1);
    expect(procurementOnly[0]?.jobTitle).toBe("Procurement Manager");
  });

  it("uses only fake emails on .example domains", async () => {
    const hits = await companies.discover({ country: "Thailand", productId: "guntur-dry-red-chilli" });
    for (const company of hits) {
      const people = await contacts.findContacts({ company });
      for (const p of people) {
        expect(p.businessEmail).toMatch(/@[\w.-]+\.example$/);
        expect(p.source).toBe("mock");
      }
    }
  });

  it("contains no random values across repeated enrichment", async () => {
    const gulf = (await companies.discover({ country: "UAE", productId: "guntur-dry-red-chilli" }))[0];
    const runs = await Promise.all(
      Array.from({ length: 5 }, () => contacts.findContacts({ company: gulf! })),
    );
    for (const run of runs) expect(run).toEqual(runs[0]);
  });

  it("fails predictably for a configured company without affecting the factory otherwise", async () => {
    const failing = createMockContactEnrichmentProvider({
      failForProviderRecordId: "mock-th-siam-spice",
    });
    const chilli = await companies.discover({ country: "Thailand", productId: "guntur-dry-red-chilli" });
    const siam = chilli.find((c) => c.providerRecordId === "mock-th-siam-spice")!;
    const other = chilli.find((c) => c.providerRecordId !== "mock-th-siam-spice")!;
    await expect(failing.findContacts({ company: siam })).rejects.toThrow(/Mock contact enrichment failed/);
    await expect(failing.findContacts({ company: other })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "mock" })]),
    );
  });
});
