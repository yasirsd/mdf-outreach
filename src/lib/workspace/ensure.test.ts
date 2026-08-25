import { describe, it, expect } from "vitest";
import { ensureMasterLibrary } from "./ensure";
import type { EmailTemplate } from "@/lib/types";
import type { SupabaseRepositoryBundle } from "@/lib/repositories/supabase/repositories";

function makeMockRepos(initial: EmailTemplate[] = []): {
  repos: SupabaseRepositoryBundle;
  templates: EmailTemplate[];
  buyerCount: () => number;
  campaignCount: () => number;
  activityCount: () => number;
} {
  const templates: EmailTemplate[] = [...initial];
  let buyerWrites = 0;
  let campaignWrites = 0;
  let activityWrites = 0;

  const bundle = {
    templates: {
      list: async () => [...templates],
      get: async (id: string) => templates.find((t) => t.id === id),
      create: async (t: EmailTemplate) => {
        templates.push(t);
        return t;
      },
      update: async (id: string, patch: Partial<EmailTemplate>) => {
        const idx = templates.findIndex((t) => t.id === id);
        templates[idx] = { ...templates[idx], ...patch };
        return templates[idx];
      },
      delete: async (id: string) => {
        const idx = templates.findIndex((t) => t.id === id);
        if (idx >= 0) templates.splice(idx, 1);
      },
      bulkPut: async () => {},
    },
    buyers: {
      list: async () => [],
      get: async () => undefined,
      create: async () => {
        buyerWrites += 1;
        throw new Error("Test failure: ensureMasterLibrary must not create buyers");
      },
      update: async () => {
        throw new Error("no");
      },
      delete: async () => {},
      bulkPut: async () => {},
      findByEmail: async () => undefined,
    },
    campaigns: {
      list: async () => [],
      get: async () => undefined,
      create: async () => {
        campaignWrites += 1;
        throw new Error("Test failure: ensureMasterLibrary must not create campaigns");
      },
      update: async () => {
        throw new Error("no");
      },
      delete: async () => {},
      bulkPut: async () => {},
    },
    activity: {
      list: async () => [],
      add: async () => {
        activityWrites += 1;
        return { id: "", at: "", kind: "", message: "" };
      },
      clear: async () => {},
      bulkPut: async () => {},
    },
    recipients: {} as never,
    assets: {} as never,
    settings: {} as never,
    workspace: {} as never,
  } as unknown as SupabaseRepositoryBundle;

  return {
    repos: bundle,
    templates,
    buyerCount: () => buyerWrites,
    campaignCount: () => campaignWrites,
    activityCount: () => activityWrites,
  };
}

describe("ensureMasterLibrary", () => {
  it("creates all 8 masters on first run", async () => {
    const { repos, templates } = makeMockRepos();
    const r = await ensureMasterLibrary(repos);
    expect(r.created).toBe(8);
    expect(r.total).toBe(8);
    expect(templates).toHaveLength(8);
  });

  it("is idempotent — a second run creates nothing", async () => {
    const { repos, templates } = makeMockRepos();
    await ensureMasterLibrary(repos);
    const second = await ensureMasterLibrary(repos);
    expect(second.created).toBe(0);
    expect(templates).toHaveLength(8);
  });

  it("does not create duplicates when partial masters exist", async () => {
    const { repos, templates } = makeMockRepos([
      {
        id: "existing-1",
        name: "Guntur Signature",
        sections: [],
        themeKey: "guntur-chilli",
        variant: "signature",
        version: 1,
        status: "approved",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const r = await ensureMasterLibrary(repos);
    expect(r.created).toBe(7); // 8 desired - 1 already there
    expect(templates).toHaveLength(8);
    // The existing template is unchanged
    const existing = templates.find((t) => t.id === "existing-1");
    expect(existing).toBeDefined();
    expect(existing!.name).toBe("Guntur Signature");
  });

  it("never overwrites existing master versions", async () => {
    const { repos, templates } = makeMockRepos([
      {
        id: "existing-1",
        name: "Custom name",
        sections: [{ id: "x", type: "intro", visible: true, data: { body: "Custom" } }],
        themeKey: "guntur-chilli",
        variant: "signature",
        version: 5, // higher than the library
        status: "approved",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    await ensureMasterLibrary(repos);
    const kept = templates.find((t) => t.id === "existing-1");
    expect(kept!.version).toBe(5);
    expect(kept!.name).toBe("Custom name");
    expect(kept!.sections[0].data.body).toBe("Custom");
  });

  it("never creates buyers, campaigns, or activity records", async () => {
    const { repos, buyerCount, campaignCount, activityCount } = makeMockRepos();
    await ensureMasterLibrary(repos);
    expect(buyerCount()).toBe(0);
    expect(campaignCount()).toBe(0);
    expect(activityCount()).toBe(0);
  });
});
