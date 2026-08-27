#!/usr/bin/env node
/**
 * MDF Outreach — programmatic alpha-crop for the wordmark PNGs.
 *
 * Reads DarkPNG.png and LightPNG.png from src/assets/images/, finds
 * the alpha bounding box for pixels whose alpha exceeds
 * ALPHA_THRESHOLD, adds a safety margin of SAFETY_MARGIN_PCT of the
 * cropped dimensions, and writes trimmed transparent PNGs alongside
 * the sources.
 *
 * Deterministic — every run on the same source yields identical
 * output. Prints a machine-readable JSON summary of measured bounds
 * to stdout for the phase report.
 *
 * Usage:
 *   node scripts/trim-logo.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { PNG } from "pngjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, "..", "src", "assets", "images");

const ALPHA_THRESHOLD = 8; // 0-255 — ignore fully transparent + near-transparent pixels
const SAFETY_MARGIN_PCT = 0.04; // 4% of cropped dimensions on each side

const SOURCES = [
  { input: "DarkPNG.png", output: "DarkPNG.trimmed.png" },
  { input: "LightPNG.png", output: "LightPNG.trimmed.png" },
];

const summaries = [];

for (const { input, output } of SOURCES) {
  const inputPath = join(ASSETS_DIR, input);
  const outputPath = join(ASSETS_DIR, output);
  const buf = readFileSync(inputPath);
  // Sync-decode into RGBA.
  const src = PNG.sync.read(buf);
  const { width: w, height: h, data } = src;

  // Alpha bounding box.
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4 + 3;
      if (data[idx] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0 || maxY < 0) {
    throw new Error(`No opaque pixels found in ${input} — cannot trim.`);
  }

  const cropX = minX;
  const cropY = minY;
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const padLeft = minX;
  const padTop = minY;
  const padRight = w - 1 - maxX;
  const padBottom = h - 1 - maxY;

  // Add safety margin of SAFETY_MARGIN_PCT of the smaller cropped
  // dimension so the margin is proportionally similar top/bottom vs
  // left/right for the wordmark's aspect ratio.
  const safety = Math.max(
    1,
    Math.round(Math.min(cropW, cropH) * SAFETY_MARGIN_PCT),
  );

  const outW = cropW + safety * 2;
  const outH = cropH + safety * 2;
  const dst = new PNG({ width: outW, height: outH });

  // Fill destination with fully transparent RGBA(0,0,0,0).
  dst.data.fill(0);

  // Copy source rect into the destination offset by `safety` on all sides.
  for (let y = 0; y < cropH; y++) {
    const srcRow = (cropY + y) * w + cropX;
    const dstRow = (y + safety) * outW + safety;
    const srcOff = srcRow * 4;
    const dstOff = dstRow * 4;
    dst.data.set(
      data.subarray(srcOff, srcOff + cropW * 4),
      dstOff,
    );
  }

  const outBuf = PNG.sync.write(dst, { colorType: 6 }); // RGBA
  writeFileSync(outputPath, outBuf);

  const summary = {
    source: input,
    canvas: { w, h },
    alphaBoundingBox: { minX, minY, maxX, maxY },
    visibleArtwork: { w: cropW, h: cropH },
    paddingPx: { left: padLeft, top: padTop, right: padRight, bottom: padBottom },
    paddingPct: {
      left: +((padLeft / w) * 100).toFixed(1),
      top: +((padTop / h) * 100).toFixed(1),
      right: +((padRight / w) * 100).toFixed(1),
      bottom: +((padBottom / h) * 100).toFixed(1),
    },
    safetyMarginPx: safety,
    safetyMarginPct: +((safety / Math.min(cropW, cropH)) * 100).toFixed(2),
    trimmedCanvas: { w: outW, h: outH },
    output: basename(outputPath),
  };
  summaries.push(summary);
}

console.log(JSON.stringify(summaries, null, 2));
