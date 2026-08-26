import type { ProductKey } from "@/lib/email/themes/types";

/** Bucket that holds public-read email marketing assets. */
export const EMAIL_ASSET_BUCKET = "email-assets";

/**
 * MIME types we accept for outbound email imagery. JPEG + PNG have the
 * broadest email-client compatibility. GIF is allowed for the rare case
 * of a genuinely necessary decorative animation.
 *
 * WebP / AVIF / SVG are intentionally excluded here — old Outlook and
 * a number of B2B email clients still degrade them poorly, and email
 * imagery must remain readable everywhere.
 */
export const ALLOWED_EMAIL_MIME_TYPES = ["image/jpeg", "image/png", "image/gif"] as const;
export type AllowedEmailMimeType = (typeof ALLOWED_EMAIL_MIME_TYPES)[number];

/**
 * 5 MB per file. Above this we reject rather than silently upload —
 * multi-megabyte hero photography is the leading cause of broken email
 * delivery quotas and clipped renders.
 */
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;

export function isAllowedEmailMime(m: string): m is AllowedEmailMimeType {
  return (ALLOWED_EMAIL_MIME_TYPES as readonly string[]).includes(m);
}

export function extensionFor(mime: AllowedEmailMimeType): string {
  return mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "gif";
}

/**
 * Generate a deterministic-safe storage path for an asset.
 *
 * Layout: `{workspace_id}/{theme_key}/{slot}/{slug}.{ext}`
 *
 * Workspace id and theme key are always resolved server-side from the
 * MDF session — the browser can never inject an arbitrary path segment.
 * The slug is derived from a caller-provided `name` (sanitized) plus a
 * short random suffix so re-uploads never accidentally overwrite each
 * other unless the caller explicitly reuses the same path.
 */
export function buildStoragePath({
  workspaceId,
  themeKey,
  slot,
  originalName,
  mime,
  randomSuffix,
}: {
  workspaceId: string;
  themeKey: ProductKey | string;
  slot: string;
  originalName: string;
  mime: AllowedEmailMimeType;
  /** Injectable so tests can pin the suffix. */
  randomSuffix: string;
}): string {
  const safeWorkspace = requireSegment(workspaceId, "workspace_id");
  const safeTheme = requireSegment(themeKey, "theme_key");
  const safeSlot = requireSegment(slot, "slot");
  const stem = slugify(stripExtension(originalName)) || "asset";
  return `${safeWorkspace}/${safeTheme}/${safeSlot}/${stem}-${randomSuffix}.${extensionFor(mime)}`;
}

/**
 * Reject any segment that could enable path traversal or point at a
 * different workspace. All accepted segments are lowercase alphanumerics
 * plus `-` and `_`.
 */
function requireSegment(v: string, label: string): string {
  if (!v || !/^[a-z0-9][a-z0-9_-]*$/i.test(v)) {
    throw new Error(`Invalid storage path segment: ${label}`);
  }
  return v.toLowerCase();
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Assert that `path` targets exactly the caller's workspace, no traversal. */
export function assertPathInWorkspace(path: string, workspaceId: string): void {
  const expectedPrefix = `${workspaceId.toLowerCase()}/`;
  const normalized = path.replace(/\\/g, "/");
  if (normalized.includes("..") || normalized.startsWith("/")) {
    throw new Error("Invalid storage path");
  }
  if (!normalized.toLowerCase().startsWith(expectedPrefix)) {
    throw new Error("Storage path does not belong to caller's workspace");
  }
}
