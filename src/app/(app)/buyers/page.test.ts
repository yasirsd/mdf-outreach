import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * F9 — Buyers page architecture.
 *
 * Post-F9 the page must use server-side pagination via listPaginated
 * and never call the unbounded list() from the loader.
 */

const PAGE = readFileSync(
  path.resolve(process.cwd(), "src/app/(app)/buyers/page.tsx"),
  "utf8",
);
const VIEW = readFileSync(
  path.resolve(process.cwd(), "src/app/(app)/buyers/BuyersView.tsx"),
  "utf8",
);

describe("F9 Buyers page", () => {
  it("uses listPaginated in the loader", () => {
    expect(PAGE).toContain("listPaginated");
  });

  it("does NOT call the unbounded list() from the loader", () => {
    expect(PAGE).not.toMatch(/repos\.buyers\.list\(\)/);
  });

  it("clamps pageSize to the allowed values (25 / 50 / 100)", () => {
    expect(PAGE).toContain("ALLOWED_PAGE_SIZES");
    expect(PAGE).toContain("new Set([25, 50, 100])");
  });

  it("caches URL param 'q' for search and bounds its length", () => {
    expect(PAGE).toContain('asStr("q").slice(0, 128)');
  });

  it("clamps page to >= 1", () => {
    expect(PAGE).toContain("parseInt1");
    expect(PAGE).toContain("if (!Number.isFinite(n) || n < 1) return fallback");
  });

  it("normalizes an out-of-range requested page to pageCount instead of a broken empty state", () => {
    expect(PAGE).toMatch(/page > 1 && paged\.rows\.length === 0 && paged\.pageCount > 0/);
  });

  it("view exposes URL-state pagination — replaces the client-only filter", () => {
    // Post-F9 the view derives filter state from props (server) and
    // pushes changes through router.replace — no client-side full-set
    // filtering.
    expect(VIEW).toContain("useSearchParams");
    expect(VIEW).toContain("router.replace");
    expect(VIEW).toContain("pushFilters");
    // Renders a pagination bar.
    expect(VIEW).toContain("PaginationBar");
  });

  it("changing any filter resets page to 1", () => {
    // Every filter-setter passes page: 1.
    for (const line of VIEW.split("\n")) {
      const m = line.match(/pushFilters\(\{[^}]*(country|status|product):[^}]*\}\)/);
      if (m && !line.includes("page: 1")) {
        // Allow the empty-clear line separately.
        if (!line.includes("clearFilters") && !line.includes("clear")) {
          throw new Error(`Filter setter must reset page to 1: ${line.trim()}`);
        }
      }
    }
    // clearFilters explicitly does it too.
    expect(VIEW).toMatch(/clearFilters[\s\S]{0,120}page:\s*1/);
  });
});
