import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Buyer } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  serverRepositories: vi.fn(),
  logActivity: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/repositories/server", () => ({
  serverRepositories: mocks.serverRepositories,
}));
vi.mock("@/lib/activity", () => ({ logActivity: mocks.logActivity }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/utils/supabase/server", () => ({ createClient: vi.fn() }));

import { bulkImportBuyersAction, saveBuyerAction } from "./actions";

function buyer(email: string): Buyer {
  return {
    id: "client-new-id",
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

function installRepos() {
  const buyers = {
    get: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(async (value: Buyer) => value),
    update: vi.fn(),
    findByEmail: vi.fn().mockResolvedValue(undefined),
  };
  mocks.serverRepositories.mockResolvedValue({ repos: { buyers } });
  return buyers;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Buyer server actions enforce usable email", () => {
  it.each(["", "   ", "invalid", "a@b"])("saveBuyerAction rejects %j", async (email) => {
    const buyers = installRepos();
    await expect(saveBuyerAction(buyer(email))).rejects.toThrow(/email is required/i);
    expect(mocks.serverRepositories).toHaveBeenCalledOnce();
    expect(buyers.create).not.toHaveBeenCalled();
    expect(buyers.update).not.toHaveBeenCalled();
  });

  it("saveBuyerAction normalizes a valid address before create", async () => {
    const buyers = installRepos();
    await saveBuyerAction(buyer("  Buyer@Example.COM "));
    expect(buyers.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: "buyer@example.com" }),
    );
  });

  it.each(["", "   ", "invalid", "a@b"])(
    "bulk import rejects %j without lookup or create",
    async (email) => {
      const buyers = installRepos();
      const result = await bulkImportBuyersAction([buyer(email)]);
      expect(result).toMatchObject({ added: 0, updated: 0, skipped: 0 });
      expect(result.errors).toHaveLength(1);
      expect(buyers.findByEmail).not.toHaveBeenCalled();
      expect(buyers.create).not.toHaveBeenCalled();
    },
  );

  it("bulk import normalizes before duplicate lookup and preserves skip handling", async () => {
    const buyers = installRepos();
    buyers.findByEmail.mockResolvedValue(buyer("buyer@example.com"));
    const result = await bulkImportBuyersAction([buyer("  BUYER@Example.COM ")], "skip");
    expect(buyers.findByEmail).toHaveBeenCalledWith("buyer@example.com");
    expect(buyers.create).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });
});
