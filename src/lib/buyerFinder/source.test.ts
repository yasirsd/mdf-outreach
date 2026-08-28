import { describe, expect, it } from "vitest";
import {
  candidateSourceLabel,
  normalizeCandidateSource,
  preferCandidateSource,
} from "./source";

describe("normalizeCandidateSource", () => {
  it("keeps hunter and mock as-is", () => {
    expect(normalizeCandidateSource("hunter")).toBe("hunter");
    expect(normalizeCandidateSource("mock")).toBe("mock");
  });

  it("does not default missing or unknown values to mock", () => {
    expect(normalizeCandidateSource(undefined)).toBe("other");
    expect(normalizeCandidateSource("")).toBe("other");
    expect(normalizeCandidateSource("not-a-provider")).toBe("other");
  });
});

describe("preferCandidateSource", () => {
  it("lets real Hunter evidence upgrade mock", () => {
    expect(preferCandidateSource("mock", "hunter")).toBe("hunter");
  });

  it("never lets mock overwrite hunter", () => {
    expect(preferCandidateSource("hunter", "mock")).toBe("hunter");
  });

  it("keeps hunter when a repeat Hunter search matches", () => {
    expect(preferCandidateSource("hunter", "hunter")).toBe("hunter");
  });

  it("uses incoming when nothing is stored yet", () => {
    expect(preferCandidateSource(undefined, "hunter")).toBe("hunter");
    expect(preferCandidateSource("", "mock")).toBe("mock");
  });
});

describe("candidateSourceLabel", () => {
  it("uses the Hunter provider descriptor display name", () => {
    expect(candidateSourceLabel("hunter")).toBe("Hunter");
  });

  it("labels mock as Mock, not as a generic fallback", () => {
    expect(candidateSourceLabel("mock")).toBe("Mock");
  });
});
