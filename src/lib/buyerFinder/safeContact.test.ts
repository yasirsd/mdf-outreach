import { describe, expect, it } from "vitest";
import { contactContainsProviderRef, toSafeContact, toSafeContacts } from "./safeContact";
import type { BuyerCandidateContact } from "./types";

function contact(over: Partial<BuyerCandidateContact> = {}): BuyerCandidateContact {
  return {
    id: "00000000-0000-4000-8000-0000000000cc",
    candidateId: "00000000-0000-4000-8000-0000000000aa",
    firstName: "",
    lastName: "",
    fullName: "Amina K.",
    jobTitle: "Head of Procurement",
    businessEmail: "",
    isPrimary: true,
    source: "hunter",
    providerRef: "Qk1hQ2c9PS0tZW5jcnlwdGVkLW9wYXF1ZS1oYW5kbGU",
    department: "finance",
    seniority: "senior",
    isDecisionMaker: true,
    linkedinAvailable: true,
    phoneAvailable: false,
    ...over,
  };
}

describe("toSafeContact", () => {
  it("strips providerRef so the reveal handle cannot cross a client boundary", () => {
    const safe = toSafeContact(contact());
    expect(contactContainsProviderRef(safe)).toBe(false);
    expect(JSON.stringify(safe)).not.toMatch(/providerRef|reveal_handle|Qk1hQ2c9PS0tZW5jcnlwdGVk/i);
    expect(safe.fullName).toBe("Amina K.");
    expect(safe.jobTitle).toBe("Head of Procurement");
    expect(safe.linkedinAvailable).toBe(true);
  });

  it("strips every contact in a list", () => {
    const safe = toSafeContacts([contact(), contact({ id: "00000000-0000-4000-8000-0000000000dd", providerRef: "other-handle" })]);
    expect(safe).toHaveLength(2);
    expect(safe.every((c) => !contactContainsProviderRef(c))).toBe(true);
    expect(JSON.stringify(safe)).not.toMatch(/providerRef|other-handle/i);
  });
});
