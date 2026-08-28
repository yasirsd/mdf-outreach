import { describe, expect, it } from "vitest";
import { SearchRunActiveExistsError } from "@/lib/repositories/interfaces";
import {
  createMemorySearchRunRepository,
  createMemorySearchRunStore,
} from "./memorySearchRunRepository";

const INPUT = {
  country: "Thailand",
  businessProductId: "guntur-dry-red-chilli",
  desiredBuyerTypes: ["Importer" as const],
  contactPriorities: ["procurement" as const],
};

describe("memory Search Run repository (BF2.2 contract)", () => {
  it("create returns a queued row with free / 0 credits and hunter provider", async () => {
    const repo = createMemorySearchRunRepository("ws-a");
    const run = await repo.create(INPUT);
    expect(run.status).toBe("queued");
    expect(run.stage).toBe("preparing");
    expect(run.provider).toBe("hunter");
    expect(run.costClass).toBe("free");
    expect(run.creditsUsed).toBe(0);
    expect(run.workspaceId).toBe("ws-a");
    expect(run.country).toBe("Thailand");
  });

  it("get returns the created row", async () => {
    const repo = createMemorySearchRunRepository("ws-a");
    const created = await repo.create(INPUT);
    const got = await repo.get(created.id);
    expect(got?.id).toBe(created.id);
    expect(got?.country).toBe("Thailand");
  });

  it("cross-workspace access is impossible through the scoped repository", async () => {
    const store = createMemorySearchRunStore();
    const a = createMemorySearchRunRepository("ws-a", store);
    const b = createMemorySearchRunRepository("ws-b", store);
    const run = await a.create(INPUT);
    expect(await b.get(run.id)).toBeUndefined();
    expect(await b.claimQueued(run.id)).toBeUndefined();
    expect(await b.getLatestActive()).toBeUndefined();
  });

  it("claim queued succeeds once; second claim fails harmlessly", async () => {
    const repo = createMemorySearchRunRepository("ws-a");
    const run = await repo.create(INPUT);
    const first = await repo.claimQueued(run.id);
    expect(first?.status).toBe("running");
    expect(first?.stage).toBe("preparing");
    expect(first?.startedAt).toBeTruthy();
    const second = await repo.claimQueued(run.id);
    expect(second).toBeUndefined();
  });

  it("concurrent claim: exactly one winner", async () => {
    const repo = createMemorySearchRunRepository("ws-a");
    const run = await repo.create(INPUT);
    const [x, y] = await Promise.all([repo.claimQueued(run.id), repo.claimQueued(run.id)]);
    const wins = [x, y].filter(Boolean);
    expect(wins).toHaveLength(1);
  });

  it("terminal run cannot be claimed", async () => {
    const repo = createMemorySearchRunRepository("ws-a");
    const run = await repo.create(INPUT);
    await repo.claimQueued(run.id);
    await repo.update(run.id, { status: "completed", stage: "complete" });
    expect(await repo.claimQueued(run.id)).toBeUndefined();
  });

  it("update counts are persisted; credits stay 0", async () => {
    const repo = createMemorySearchRunRepository("ws-a");
    const run = await repo.create(INPUT);
    const next = await repo.update(run.id, {
      discoveredCount: 10,
      usableCount: 8,
      processedCount: 8,
      createdCount: 5,
    });
    expect(next.discoveredCount).toBe(10);
    expect(next.usableCount).toBe(8);
    expect(next.processedCount).toBe(8);
    expect(next.createdCount).toBe(5);
    expect(next.creditsUsed).toBe(0);
    expect(next.costClass).toBe("free");
  });

  it("stage never regresses", async () => {
    const repo = createMemorySearchRunRepository("ws-a");
    const run = await repo.create(INPUT);
    await repo.update(run.id, { stage: "processing_candidates" });
    const next = await repo.update(run.id, { stage: "discovering" });
    expect(next.stage).toBe("processing_candidates");
  });

  it("latest active returns newest queued/running only", async () => {
    const store = createMemorySearchRunStore();
    let t = 1;
    const repo = createMemorySearchRunRepository("ws-a", store, () => {
      t += 1;
      return `2026-08-28T00:00:0${t}.000Z`;
    });
    const first = await repo.create(INPUT);
    await repo.update(first.id, { status: "completed", stage: "complete" });
    const second = await repo.create(INPUT);
    const active = await repo.getLatestActive();
    expect(active?.id).toBe(second.id);
  });

  it("completed runs are excluded from active lookup", async () => {
    const repo = createMemorySearchRunRepository("ws-a");
    const run = await repo.create(INPUT);
    await repo.update(run.id, { status: "completed", stage: "complete" });
    expect(await repo.getLatestActive()).toBeUndefined();
  });

  it("create throws when an active run already exists (unique guard)", async () => {
    const repo = createMemorySearchRunRepository("ws-a");
    await repo.create(INPUT);
    await expect(repo.create(INPUT)).rejects.toBeInstanceOf(SearchRunActiveExistsError);
  });

  it("workspace id is stamped by the repository, never from input", async () => {
    const repo = createMemorySearchRunRepository("ws-server");
    const run = await repo.create(INPUT);
    expect(run.workspaceId).toBe("ws-server");
    expect(INPUT).not.toHaveProperty("workspaceId");
  });
});
