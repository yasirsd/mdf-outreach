import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = readFileSync(join(process.cwd(), "src/app/api/workspace/selection/route.ts"), "utf8");
const MIDDLEWARE = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");

describe("selected workspace API security", () => {
  it("authenticates the user, validates the app session, and delegates membership proof to the RPC helper", () => {
    expect(ROUTE).toContain("supabase.auth.getUser()");
    expect(ROUTE).toContain("checkAppSession(");
    expect(ROUTE).toContain("setCurrentWorkspace(supabase, user.id, workspaceId)");
  });

  it("accepts no caller-provided user identity and validates the workspace UUID", () => {
    expect(ROUTE).not.toMatch(/userId\??\s*:/);
    expect(ROUTE).toContain("isEntityUuid(workspaceId)");
  });

  it("allows the selection endpoint through middleware before selected-workspace enforcement", () => {
    const endpointIndex = MIDDLEWARE.indexOf('pathname === "/api/workspace/selection"');
    const membershipIndex = MIDDLEWARE.indexOf("const membership = await getActiveMembership", endpointIndex);
    expect(endpointIndex).toBeGreaterThan(0);
    expect(membershipIndex).toBeGreaterThan(endpointIndex);
  });
});
