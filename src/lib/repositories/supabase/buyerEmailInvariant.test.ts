import { describe, expect, it } from "vitest";
import type { Buyer } from "@/lib/types";
import { createSupabaseRepositories } from "./repositories";

function buyer(email: string): Buyer {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    firstName: "A",
    lastName: "Buyer",
    company: "Example Foods",
    email,
    country: "India",
    status: "new",
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  };
}

function noDbClient() {
  return {
    from() {
      throw new Error("DB must not be reached");
    },
  };
}

describe("SupabaseBuyerRepository Buyer email invariant", () => {
  it.each(["", "   ", "invalid", "a@b"])("create rejects %j before Supabase", async (email) => {
    const repos = createSupabaseRepositories(noDbClient() as never, "ws-a");
    await expect(repos.buyers.create(buyer(email))).rejects.toThrow(/email is required/i);
  });

  it("bulkPut rejects any unusable Buyer email before Supabase", async () => {
    const repos = createSupabaseRepositories(noDbClient() as never, "ws-a");
    await expect(
      repos.buyers.bulkPut([buyer("valid@example.com"), buyer(" \t ")]),
    ).rejects.toThrow(/email is required/i);
  });

  it("an explicit email update cannot erase or corrupt a Buyer email", async () => {
    const repos = createSupabaseRepositories(noDbClient() as never, "ws-a");
    await expect(repos.buyers.update(buyer("valid@example.com").id, { email: "x@" }))
      .rejects.toThrow(/email is required/i);
  });

  it("normalizes before insert and preserves database duplicate errors", async () => {
    let inserted: Record<string, unknown> | undefined;
    const duplicate = { code: "23505", message: "duplicate key value" };
    const client = {
      from() {
        return {
          insert(row: Record<string, unknown>) {
            inserted = row;
            return this;
          },
          select() {
            return this;
          },
          async single() {
            return { data: null, error: duplicate };
          },
        };
      },
    };
    const repos = createSupabaseRepositories(client as never, "ws-a");
    await expect(repos.buyers.create(buyer("  DUP@Example.COM "))).rejects.toMatchObject({
      code: "23505",
    });
    expect(inserted?.email).toBe("dup@example.com");
  });
});
