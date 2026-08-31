import { describe, expect, it } from "vitest";
import { pathAllowedByRobots } from "./robotsPolicy";

describe("robotsPolicy", () => {
  it("allows all paths when robots.txt is missing", () => {
    expect(pathAllowedByRobots(undefined, "/contact")).toBe(true);
  });

  it("respects Disallow for User-agent *", () => {
    const robots = "User-agent: *\nDisallow: /contact\nDisallow: /admin";
    expect(pathAllowedByRobots(robots, "/contact")).toBe(false);
    expect(pathAllowedByRobots(robots, "/contact-us")).toBe(false);
    expect(pathAllowedByRobots(robots, "/about")).toBe(true);
  });
});
