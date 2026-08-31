import { describe, expect, it } from "vitest";
import { comparePeopleForPrimary, seniorityRank } from "./personRank";

describe("comparePeopleForPrimary", () => {
  it("prefers stronger role, then decision maker, then seniority, then name, then providerRef", () => {
    const procurement = {
      jobTitle: "Procurement Manager",
      isDecisionMaker: false,
      seniority: "junior",
      fullName: "Zed",
      providerRef: "b",
    };
    const sales = {
      jobTitle: "Sales Manager",
      isDecisionMaker: true,
      seniority: "executive",
      fullName: "Ann",
      providerRef: "a",
    };
    expect(comparePeopleForPrimary(procurement, sales)).toBeLessThan(0);

    const dm = { ...sales, jobTitle: "Sales Manager", isDecisionMaker: true, fullName: "Ann" };
    const notDm = { ...sales, isDecisionMaker: false, fullName: "Bob" };
    expect(comparePeopleForPrimary(dm, notDm)).toBeLessThan(0);

    const exec = { jobTitle: "Sales Manager", isDecisionMaker: false, seniority: "executive", fullName: "Ann", providerRef: "a" };
    const junior = { jobTitle: "Sales Manager", isDecisionMaker: false, seniority: "junior", fullName: "Ann", providerRef: "a" };
    expect(comparePeopleForPrimary(exec, junior)).toBeLessThan(0);

    const ann = { jobTitle: "Buyer", isDecisionMaker: true, seniority: "senior", fullName: "Ann", providerRef: "z" };
    const bob = { jobTitle: "Buyer", isDecisionMaker: true, seniority: "senior", fullName: "Bob", providerRef: "a" };
    expect(comparePeopleForPrimary(ann, bob)).toBeLessThan(0);

    const refA = { jobTitle: "Buyer", isDecisionMaker: true, seniority: "senior", fullName: "Ann", providerRef: "a" };
    const refB = { jobTitle: "Buyer", isDecisionMaker: true, seniority: "senior", fullName: "Ann", providerRef: "b" };
    expect(comparePeopleForPrimary(refA, refB)).toBeLessThan(0);
  });

  it("is deterministic for identical people", () => {
    const person = {
      jobTitle: "Owner",
      isDecisionMaker: true,
      seniority: "executive",
      fullName: "Pat",
      providerRef: "same",
    };
    expect(comparePeopleForPrimary(person, person)).toBe(0);
  });
});

describe("seniorityRank", () => {
  it("orders executive > senior > junior > unknown", () => {
    expect(seniorityRank("executive")).toBeGreaterThan(seniorityRank("senior"));
    expect(seniorityRank("senior")).toBeGreaterThan(seniorityRank("junior"));
    expect(seniorityRank("junior")).toBeGreaterThan(seniorityRank(""));
    expect(seniorityRank(undefined)).toBe(0);
  });
});
