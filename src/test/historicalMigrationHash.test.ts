import { describe, expect, it } from "vitest";
import { historicalMigrationSha256 } from "./historicalMigrationHash";

describe("historical migration hash portability", () => {
  it("produces the same complete-content hash for LF and CRLF SQL", () => {
    const lf = "begin;\nselect 1;\ncommit;\n";
    const crlf = lf.replace(/\n/g, "\r\n");

    expect(historicalMigrationSha256(crlf)).toBe(
      historicalMigrationSha256(lf),
    );
  });

  it("changes when the canonical SQL text changes materially", () => {
    const original = "begin;\nselect 1;\ncommit;\n";
    const changed = "begin;\nselect 2;\ncommit;\n";

    expect(historicalMigrationSha256(changed)).not.toBe(
      historicalMigrationSha256(original),
    );
  });
});
