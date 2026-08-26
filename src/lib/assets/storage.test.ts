import { describe, it, expect } from "vitest";
import {
  ALLOWED_EMAIL_MIME_TYPES,
  MAX_ASSET_BYTES,
  assertPathInWorkspace,
  buildStoragePath,
  isAllowedEmailMime,
} from "./storage";

const WS_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const WS_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("buildStoragePath — workspace-derived path", () => {
  it("produces {workspace}/{theme}/{slot}/{slug}-{suffix}.{ext}", () => {
    const p = buildStoragePath({
      workspaceId: WS_A,
      themeKey: "guntur-chilli",
      slot: "hero",
      originalName: "Guntur Hero Photo.jpg",
      mime: "image/jpeg",
      randomSuffix: "abcd1234",
    });
    expect(p).toBe(`${WS_A}/guntur-chilli/hero/guntur-hero-photo-abcd1234.jpg`);
  });

  it("uses the correct extension per MIME", () => {
    const png = buildStoragePath({
      workspaceId: WS_A,
      themeKey: "banganapalli-mango",
      slot: "orchard",
      originalName: "orchard.PNG",
      mime: "image/png",
      randomSuffix: "1234",
    });
    expect(png.endsWith(".png")).toBe(true);
    const gif = buildStoragePath({
      workspaceId: WS_A,
      themeKey: "pomegranate",
      slot: "hero",
      originalName: "ruby.gif",
      mime: "image/gif",
      randomSuffix: "5678",
    });
    expect(gif.endsWith(".gif")).toBe(true);
  });

  it("rejects path segments that could enable traversal or injection", () => {
    expect(() =>
      buildStoragePath({
        workspaceId: "../etc",
        themeKey: "guntur-chilli",
        slot: "hero",
        originalName: "x.jpg",
        mime: "image/jpeg",
        randomSuffix: "abc",
      }),
    ).toThrow(/Invalid storage path segment/);
    expect(() =>
      buildStoragePath({
        workspaceId: WS_A,
        themeKey: "../mango",
        slot: "hero",
        originalName: "x.jpg",
        mime: "image/jpeg",
        randomSuffix: "abc",
      }),
    ).toThrow(/Invalid storage path segment/);
    expect(() =>
      buildStoragePath({
        workspaceId: WS_A,
        themeKey: "guntur-chilli",
        slot: "hero/../../evil",
        originalName: "x.jpg",
        mime: "image/jpeg",
        randomSuffix: "abc",
      }),
    ).toThrow(/Invalid storage path segment/);
  });

  it("sanitizes the caller-supplied filename to a safe slug", () => {
    const p = buildStoragePath({
      workspaceId: WS_A,
      themeKey: "guntur-chilli",
      slot: "hero",
      originalName: "../../../etc/passwd.jpg",
      mime: "image/jpeg",
      randomSuffix: "9999",
    });
    expect(p).toBe(`${WS_A}/guntur-chilli/hero/etc-passwd-9999.jpg`);
    expect(p.includes("..")).toBe(false);
  });
});

describe("assertPathInWorkspace — cross-workspace prevention", () => {
  it("accepts paths that begin with the caller's workspace id", () => {
    expect(() =>
      assertPathInWorkspace(`${WS_A}/guntur-chilli/hero/x.jpg`, WS_A),
    ).not.toThrow();
  });

  it("rejects paths that target another workspace", () => {
    expect(() =>
      assertPathInWorkspace(`${WS_B}/guntur-chilli/hero/x.jpg`, WS_A),
    ).toThrow(/does not belong to caller/i);
  });

  it("rejects traversal", () => {
    expect(() => assertPathInWorkspace("../../etc/passwd", WS_A)).toThrow();
    expect(() =>
      assertPathInWorkspace(`${WS_A}/guntur-chilli/../../secret`, WS_A),
    ).toThrow();
    expect(() => assertPathInWorkspace(`/absolute/path`, WS_A)).toThrow();
  });
});

describe("isAllowedEmailMime — MIME allowlist", () => {
  it("accepts JPEG, PNG, GIF", () => {
    for (const m of ALLOWED_EMAIL_MIME_TYPES) expect(isAllowedEmailMime(m)).toBe(true);
  });

  it("rejects WebP, AVIF, SVG, and everything else", () => {
    expect(isAllowedEmailMime("image/webp")).toBe(false);
    expect(isAllowedEmailMime("image/avif")).toBe(false);
    expect(isAllowedEmailMime("image/svg+xml")).toBe(false);
    expect(isAllowedEmailMime("application/pdf")).toBe(false);
    expect(isAllowedEmailMime("text/html")).toBe(false);
  });
});

describe("MAX_ASSET_BYTES — size sanity", () => {
  it("is 5 MB", () => {
    expect(MAX_ASSET_BYTES).toBe(5 * 1024 * 1024);
  });
});
