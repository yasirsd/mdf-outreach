import { createHash } from "node:crypto";

/**
 * Hash an applied SQL migration as canonical LF text.
 *
 * Git may check text files out as CRLF on Windows while CI reads the same
 * blob as LF. Historical immutability guards care about the complete textual
 * content, not that platform representation, so CRLF is canonicalized to LF
 * before hashing. Lone CR characters remain significant.
 */
export function canonicalizeHistoricalMigrationText(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export function historicalMigrationSha256(text: string): string {
  return createHash("sha256")
    .update(canonicalizeHistoricalMigrationText(text), "utf8")
    .digest("hex")
    .toUpperCase();
}
