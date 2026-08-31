import { describe, expect, it } from "vitest";
import { personFingerprint } from "./personIdentity";

const CANDIDATE_ID = "00000000-0000-4000-8000-0000000000aa";

describe("personFingerprint", () => {
  it("is deterministic for the same candidate + domain + name + title", () => {
    const a = personFingerprint({
      candidateId: CANDIDATE_ID,
      domain: "www.MahmoodSons.com",
      maskedName: "Amina K.",
      position: "Head of Procurement",
    });
    const b = personFingerprint({
      candidateId: CANDIDATE_ID,
      domain: "mahmoodsons.com",
      maskedName: "  Amina  K.  ",
      position: "Head-of-Procurement",
    });
    expect(a).toBe(b);
    expect(a).toContain(CANDIDATE_ID);
    expect(a).toContain("mahmoodsons.com");
    expect(a).toContain("amina k");
    expect(a).toContain("head of procurement");
  });

  it("differs when the person or candidate differs", () => {
    const base = {
      candidateId: CANDIDATE_ID,
      domain: "mahmoodsons.com",
      maskedName: "Amina K.",
      position: "Head of Procurement",
    };
    expect(personFingerprint({ ...base, maskedName: "Omar S." })).not.toBe(personFingerprint(base));
    expect(personFingerprint({ ...base, position: "Sales Manager" })).not.toBe(personFingerprint(base));
    expect(
      personFingerprint({ ...base, candidateId: "00000000-0000-4000-8000-0000000000ff" }),
    ).not.toBe(personFingerprint(base));
  });

  it("does not include provider_ref / reveal_handle", () => {
    const fp = personFingerprint({
      candidateId: CANDIDATE_ID,
      domain: "mahmoodsons.com",
      maskedName: "Amina K.",
      position: "Head of Procurement",
    });
    expect(fp).not.toMatch(/handle|reveal|provider/i);
  });
});
