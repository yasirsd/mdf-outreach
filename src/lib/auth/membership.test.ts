import { describe, expect, it } from "vitest";
import { getActiveMembership, setCurrentWorkspace } from "./membership";

function selectedMembershipClient(input: {
  selectedWorkspaceId?: string;
  membership?: { role: string; active: boolean };
  rpcResult?: { data: unknown; error: unknown };
}) {
  const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  return {
    calls,
    client: {
      from(table: string) {
        const filters: Array<[string, unknown]> = [];
        const query = {
          select: () => query,
          eq: (key: string, value: unknown) => {
            filters.push([key, value]);
            return query;
          },
          maybeSingle: async () => {
            calls.push({ table, filters });
            if (table === "workspaces") {
              return { data: input.selectedWorkspaceId ? { id: input.selectedWorkspaceId } : null, error: null };
            }
            return { data: input.membership ?? null, error: null };
          },
        };
        return query;
      },
      rpc: async () => input.rpcResult ?? { data: null, error: null },
    },
  };
}

describe("selected workspace membership", () => {
  it("resolves the selected workspace and verifies the user's active membership", async () => {
    const fake = selectedMembershipClient({
      selectedWorkspaceId: "workspace-b",
      membership: { role: "owner", active: true },
    });
    await expect(getActiveMembership(fake.client as never, "user-u")).resolves.toEqual({
      workspaceId: "workspace-b",
      role: "owner",
    });
    expect(fake.calls[1]).toEqual({
      table: "workspace_members",
      filters: [["user_id", "user-u"], ["workspace_id", "workspace-b"], ["active", true]],
    });
  });

  it("fails closed when selection is missing", async () => {
    const fake = selectedMembershipClient({});
    await expect(getActiveMembership(fake.client as never, "user-u")).resolves.toBeNull();
    expect(fake.calls).toHaveLength(1);
  });

  it("fails closed when the selected membership is inactive or missing", async () => {
    const fake = selectedMembershipClient({ selectedWorkspaceId: "workspace-b" });
    await expect(getActiveMembership(fake.client as never, "user-u")).resolves.toBeNull();
  });

  it("switches only through the authenticated RPC and re-resolves selection", async () => {
    const fake = selectedMembershipClient({
      selectedWorkspaceId: "workspace-b",
      membership: { role: "member", active: true },
      rpcResult: { data: "workspace-b", error: null },
    });
    await expect(setCurrentWorkspace(fake.client as never, "user-u", "workspace-b")).resolves.toEqual({
      workspaceId: "workspace-b",
      role: "member",
    });
  });

  it("does not fall back when the switch RPC rejects an invalid workspace", async () => {
    const error = new Error("WORKSPACE_SELECTION_FORBIDDEN");
    const fake = selectedMembershipClient({ rpcResult: { data: null, error } });
    await expect(setCurrentWorkspace(fake.client as never, "user-u", "workspace-c")).rejects.toBe(error);
    expect(fake.calls).toHaveLength(0);
  });
});
