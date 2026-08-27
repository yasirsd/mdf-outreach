import Image from "next/image";
import darkArtwork from "@/assets/images/DarkPNG.trimmed.png";
import lightArtwork from "@/assets/images/LightPNG.trimmed.png";

/**
 * MDF wordmark.
 *
 * Uses the PROGRAMMATICALLY TRIMMED master PNGs whose alpha bounds
 * equal the visible artwork plus a ~4 % transparent safety margin.
 * The trim script `scripts/trim-logo.mjs` is deterministic — every
 * run against the same source produces identical output — so the
 * `.trimmed.png` files are checked in as build inputs, not runtime
 * artefacts.
 *
 * `tone`:
 *   - `light` → light artwork (white MDF logo) for use on DARK surfaces
 *   - `dark`  → dark artwork (black MDF logo) for use on LIGHT surfaces
 *
 * `height` is the visible artwork height in px. Because the source
 * canvases equal the visible artwork bounding box (plus 4 % safety
 * margin) the rendered mark now reads at the requested height with
 * normal intrinsic sizing — no CSS transform hacks, no padding
 * compensation constant.
 */

export function MdfWordmark({
  tone = "light",
  height = 32,
  className,
}: {
  tone?: "light" | "dark";
  /** Visible wordmark height in px. */
  height?: number;
  className?: string;
}) {
  const src = tone === "dark" ? darkArtwork : lightArtwork;
  return (
    <Image
      src={src}
      alt="MDF Exports & Imports"
      height={height}
      priority
      className={className}
      style={{ height, width: "auto", display: "block" }}
    />
  );
}
