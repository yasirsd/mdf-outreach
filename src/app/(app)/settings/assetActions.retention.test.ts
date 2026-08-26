import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AssetRecord } from "@/lib/types";

/**
 * These tests validate two operational invariants of the asset pipeline
 * without hitting Supabase:
 *
 *   (A) Orphan cleanup: if the DB upsert fails after the Storage upload,
 *       the just-uploaded object is deleted before the error propagates.
 *   (B) Production immutability: replacing an asset whose current row is
 *       `production` NEVER physically deletes the previous file. Replacing
 *       a `draft` / `approved` asset DOES delete the previous file.
 *
 * The action module imports server-only helpers (next/headers,
 * @/utils/supabase/server, next/cache) that fail in a plain Node test
 * environment. We stub each of those and inject controllable fakes for
 * the repository and the Storage client, then exercise the real
 * `uploadEmailAssetAction` code path.
 */

const removedPaths: string[] = [];
const uploadedPaths: string[] = [];
let uploadResult: { error: null | { message: string; status?: number; code?: string } } = {
  error: null,
};
let assetsPutError: unknown = null;
let existingAsset: AssetRecord | undefined;
const savedAssets: AssetRecord[] = [];

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: () => undefined,
    getAll: () => [],
    set: () => {},
    delete: () => {},
  }),
}));

vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: async (path: string) => {
          uploadedPaths.push(path);
          return uploadResult;
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/${path}` } }),
        remove: async (paths: string[]) => {
          removedPaths.push(...paths);
          return { data: [], error: null };
        },
      }),
    },
  }),
}));

vi.mock("@/lib/repositories/server", () => ({
  serverRepositories: async () => ({
    session: { membership: { workspaceId: "11111111-1111-1111-1111-111111111111" } },
    repos: {
      assets: {
        findBySlot: async () => existingAsset,
        put: async (a: AssetRecord) => {
          if (assetsPutError) throw assetsPutError;
          savedAssets.push(a);
          return a;
        },
      },
      activity: { add: async () => {} },
    },
  }),
}));

vi.mock("@/lib/activity", () => ({
  logActivity: async () => {},
}));

// Deterministic path suffix so we can assert exact behavior. `randomBytes`
// is only used by the action for the storage-path suffix.
vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return {
    ...actual,
    randomBytes: (_n: number) => Buffer.from("aabbccdd", "hex"),
    randomUUID: () => "22222222-2222-2222-2222-222222222222",
  };
});

// Import AFTER the mocks are declared.
const { uploadEmailAssetAction } = await import("./assetActions");

const WORKSPACE = "11111111-1111-1111-1111-111111111111";

function resetHarness() {
  removedPaths.length = 0;
  uploadedPaths.length = 0;
  uploadResult = { error: null };
  assetsPutError = null;
  existingAsset = undefined;
  savedAssets.length = 0;
}

function buildInput(over: Partial<Parameters<typeof uploadEmailAssetAction>[0]> = {}) {
  return {
    themeKey: "guntur-chilli",
    slot: "hero",
    mimeType: "image/jpeg",
    size: 1024,
    fileName: "hero.jpg",
    base64: Buffer.from("hello").toString("base64"),
    altText: "Guntur hero",
    ...over,
  };
}

describe("uploadEmailAssetAction — orphan cleanup on DB failure", () => {
  beforeEach(resetHarness);

  it("removes the freshly-uploaded object when the DB upsert throws", async () => {
    assetsPutError = { code: "42P10", message: "no unique or exclusion constraint matching the ON CONFLICT" };
    await expect(uploadEmailAssetAction(buildInput())).rejects.toThrow(
      /database configuration issue/i,
    );
    expect(uploadedPaths).toHaveLength(1);
    expect(removedPaths).toEqual(uploadedPaths);
    expect(savedAssets).toHaveLength(0);
  });

  it("does NOT surface the raw Postgres code to the client", async () => {
    assetsPutError = { code: "42P10", message: "no unique or exclusion constraint matching the ON CONFLICT" };
    try {
      await uploadEmailAssetAction(buildInput());
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain("42P10");
      expect(msg).not.toContain("ON CONFLICT");
      expect(msg).not.toContain("unique or exclusion");
    }
  });
});

describe("uploadEmailAssetAction — immutable Production URLs", () => {
  beforeEach(resetHarness);

  it("does NOT delete the previous file when the replaced asset was Production", async () => {
    existingAsset = {
      id: "existing",
      themeKey: "guntur-chilli",
      slot: "hero",
      name: "old.jpg",
      productionUrl: "https://cdn.example/old.jpg",
      storagePath: `${WORKSPACE}/guntur-chilli/hero/old-file.jpg`,
      status: "production",
      altText: "old",
      updatedAt: "2026-08-25T00:00:00Z",
    };
    await uploadEmailAssetAction(buildInput());
    expect(uploadedPaths).toHaveLength(1);
    // Previous production file MUST NOT appear in removedPaths.
    expect(removedPaths).not.toContain(existingAsset.storagePath);
    // The new asset row is saved with status `draft` (not production).
    expect(savedAssets[0]).toMatchObject({
      status: "draft",
      themeKey: "guntur-chilli",
      slot: "hero",
    });
    expect(savedAssets[0].productionUrl).toContain(uploadedPaths[0]);
  });

  it("DOES delete the previous file when the replaced asset was Draft", async () => {
    existingAsset = {
      id: "existing",
      themeKey: "guntur-chilli",
      slot: "hero",
      name: "old.jpg",
      productionUrl: "https://cdn.example/old.jpg",
      storagePath: `${WORKSPACE}/guntur-chilli/hero/old-file.jpg`,
      status: "draft",
      altText: "old",
      updatedAt: "2026-08-25T00:00:00Z",
    };
    await uploadEmailAssetAction(buildInput());
    expect(removedPaths).toContain(existingAsset.storagePath);
  });

  it("DOES delete the previous file when the replaced asset was Approved", async () => {
    existingAsset = {
      id: "existing",
      themeKey: "guntur-chilli",
      slot: "hero",
      name: "old.jpg",
      productionUrl: "https://cdn.example/old.jpg",
      storagePath: `${WORKSPACE}/guntur-chilli/hero/old-file.jpg`,
      status: "approved",
      altText: "old",
      updatedAt: "2026-08-25T00:00:00Z",
    };
    await uploadEmailAssetAction(buildInput());
    expect(removedPaths).toContain(existingAsset.storagePath);
  });

  it("always writes to a NEW, uniquely-named storage path (never overwrites)", async () => {
    existingAsset = {
      id: "existing",
      themeKey: "guntur-chilli",
      slot: "hero",
      name: "old.jpg",
      productionUrl: "https://cdn.example/old.jpg",
      storagePath: `${WORKSPACE}/guntur-chilli/hero/old-file.jpg`,
      status: "production",
      altText: "old",
      updatedAt: "2026-08-25T00:00:00Z",
    };
    await uploadEmailAssetAction(buildInput());
    expect(uploadedPaths[0]).not.toBe(existingAsset.storagePath);
    // Path is under the caller's workspace with an 8-hex random suffix,
    // so re-uploads never accidentally collide.
    expect(uploadedPaths[0]).toMatch(
      new RegExp(`^${WORKSPACE}/guntur-chilli/hero/[a-z0-9-]+-[0-9a-f]{8}\\.jpg$`),
    );
  });
});
