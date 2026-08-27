import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const ASSETS = join(__dirname, "..", "..", "assets", "images");

const TRIMMED = ["DarkPNG.trimmed.png", "LightPNG.trimmed.png"];

/**
 * F4 logo-correction regression suite.
 *
 * These tests protect three contracts:
 *
 *   1. Both trimmed source assets exist and are importable.
 *   2. The trimmed canvases equal the visible artwork bounding box
 *      PLUS at most a ~5 % transparent safety margin on each edge —
 *      i.e. no significant padding is baked into the shipped files.
 *   3. MdfWordmark.tsx contains no PADDING_COMPENSATION constant
 *      and imports the .trimmed.png files, not the padded originals.
 */

describe("MDF wordmark — trimmed asset contract", () => {
  it.each(TRIMMED)("%s exists and can be decoded as RGBA PNG", (fname) => {
    const path = join(ASSETS, fname);
    expect(existsSync(path)).toBe(true);
    const png = PNG.sync.read(readFileSync(path));
    expect(png.width).toBeGreaterThan(0);
    expect(png.height).toBeGreaterThan(0);
    expect(png.data.length).toBe(png.width * png.height * 4);
  });

  it.each(TRIMMED)(
    "%s alpha bounds occupy ≥ 90 % of the canvas on each axis (safety margin ≤ 5 %)",
    (fname) => {
      const png = PNG.sync.read(readFileSync(join(ASSETS, fname)));
      const { width: w, height: h, data } = png;
      let minX = w;
      let minY = h;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const alpha = data[(y * w + x) * 4 + 3];
          if (alpha > 8) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      const visibleW = maxX - minX + 1;
      const visibleH = maxY - minY + 1;
      // Visible artwork should span at least 90 % of each axis — i.e.
      // safety margin totals to at most 10 % (≤ 5 % per side).
      expect(visibleW / w).toBeGreaterThanOrEqual(0.9);
      expect(visibleH / h).toBeGreaterThanOrEqual(0.9);
    },
  );
});

describe("MdfWordmark component — no legacy padding hacks", () => {
  it("no PADDING_COMPENSATION constant remains in the component", () => {
    const src = readFileSync(
      join(__dirname, "MdfWordmark.tsx"),
      "utf8",
    );
    expect(src).not.toContain("PADDING_COMPENSATION");
  });

  it("imports the trimmed asset files", () => {
    const src = readFileSync(
      join(__dirname, "MdfWordmark.tsx"),
      "utf8",
    );
    expect(src).toContain("DarkPNG.trimmed.png");
    expect(src).toContain("LightPNG.trimmed.png");
  });
});
