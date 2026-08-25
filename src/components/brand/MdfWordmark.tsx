import Image from "next/image";
import darkArtwork from "@/assets/images/DarkPNG.png";
import lightArtwork from "@/assets/images/LightPNG.png";

/**
 * Full MDF wordmark.
 *
 * `tone` picks the artwork intended for the surrounding surface:
 *   - `light`  → light artwork (white MDF logo) for use on DARK surfaces.
 *   - `dark`   → dark artwork (black MDF logo) for use on LIGHT surfaces.
 *
 * Both variants are shipped inside `src/assets/images` and rendered through
 * next/image so they are optimised, versioned, and never fall back to a
 * broken URL.
 */
export function MdfWordmark({
  tone = "light",
  height = 32,
  className,
}: {
  tone?: "light" | "dark";
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
