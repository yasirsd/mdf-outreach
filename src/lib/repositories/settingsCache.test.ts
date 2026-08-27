import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * F3 — request-scoped settings dedupe. Same contract as
 * campaignCache: within one React render pass, repeated calls execute
 * the underlying repo.settings.get() at most once.
 */

const getSpy = vi.fn(async () => ({
  id: "singleton",
  company: {
    companyName: "MDF",
    shortName: "",
    tagline: "",
    heritage: "",
    location: "",
    website: "",
    email: "",
  },
  brand: { orange: "", charcoal: "", ivory: "", chilli: "" },
  email: {
    fromName: "",
    replyTo: "",
    websiteUrl: "",
    whatsappUrl: "",
    linkedinUrl: "",
    instagramUrl: "",
    defaultCtaUrl: "",
    defaultSubject: "",
    defaultPreheader: "",
  },
  onboardingComplete: true,
  createdAt: "x",
  updatedAt: "x",
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
      const store = new Map<string, R>();
      return ((...args: A): R => {
        const key = JSON.stringify(args);
        if (store.has(key)) return store.get(key) as R;
        const result = fn(...args);
        store.set(key, result);
        return result;
      }) as (...args: A) => R;
    },
  };
});

vi.mock("./server", () => ({
  serverRepositories: async () => ({
    session: { userId: "u", email: "e", membership: { workspaceId: "w" } },
    repos: { settings: { get: () => getSpy() } },
  }),
}));

const { getCachedSettings, requireCachedSettings } = await import("./settingsCache");

afterEach(() => {
  getSpy.mockClear();
});

describe("settingsCache", () => {
  it("dedupes repeated calls in the same request", async () => {
    await Promise.all([getCachedSettings(), getCachedSettings(), getCachedSettings()]);
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it("requireCachedSettings returns the value or throws when missing", async () => {
    const s = await requireCachedSettings();
    expect(s.company.companyName).toBe("MDF");
  });
});
