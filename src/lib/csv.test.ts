import { describe, it, expect } from "vitest";
import { mapCsvToBuyers, buyersToCsv } from "./csv";

describe("csv mapping", () => {
  it("maps common headers to Buyer fields", () => {
    const rows = [
      {
        first_name: "Somchai",
        last_name: "Prasert",
        company: "Siam Spice",
        email: "somchai@example.com",
        country: "Thailand",
      },
    ];
    const mapping = {
      first_name: "firstName" as const,
      last_name: "lastName" as const,
      company: "company" as const,
      email: "email" as const,
      country: "country" as const,
    };
    const drafts = mapCsvToBuyers(rows, mapping);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].valid).toBe(true);
    expect(drafts[0].buyer.firstName).toBe("Somchai");
    expect(drafts[0].buyer.company).toBe("Siam Spice");
    expect(drafts[0].buyer.email).toBe("somchai@example.com");
  });

  it("flags rows with missing email", () => {
    const drafts = mapCsvToBuyers(
      [{ company: "Foo" }],
      { company: "company" },
    );
    expect(drafts[0].valid).toBe(false);
    expect(drafts[0].errors).toContain("Missing email");
  });

  it("flags rows with invalid email", () => {
    const drafts = mapCsvToBuyers(
      [{ email: "not-an-email" }],
      { email: "email" },
    );
    expect(drafts[0].valid).toBe(false);
    expect(drafts[0].errors).toContain("Invalid email");
  });

  it("round-trips buyers to CSV", () => {
    const now = new Date().toISOString();
    const csv = buyersToCsv([
      {
        id: "b1",
        firstName: "Malee",
        lastName: "Tanaka",
        company: "Golden Basil",
        email: "malee@example.com",
        country: "Thailand",
        status: "ready",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    expect(csv).toContain("first_name");
    expect(csv).toContain("Malee");
    expect(csv).toContain("Thailand");
  });
});
