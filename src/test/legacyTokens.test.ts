import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * F4 regression guard.
 *
 * The application UI must not reintroduce old light-theme tokens that
 * caused inconsistent white/charcoal surfaces to leak into the dark
 * app. This test scans every TSX / TS file under `src/` EXCLUDING:
 *
 *   - the email renderer, its section files and themes (email
 *     compatibility rules require light surfaces),
 *   - the master template builder (produces email HTML),
 *   - the master template email preview iframe backgrounds,
 *   - tests themselves.
 *
 * If a legitimate exception is added later, either update `ALLOWLIST`
 * or add a `// mdf-legacy-ok` comment on the same line — the guard
 * strips comments before scanning, so tagged lines pass.
 */

const ROOT = join(__dirname, "..");

// Files / directories exempted from the scan.
const EXCLUDE_PATHS = [
  join(ROOT, "lib", "email", "renderer.ts"),
  join(ROOT, "lib", "email", "templates"),
  join(ROOT, "lib", "email", "themes"),
  // Email preview iframe backgrounds legitimately use white for email chrome.
  join(ROOT, "components", "email"),
];

// Legacy tokens that should not appear anywhere in application UI.
const BANNED = [
  "brand-charcoal",
  "brand-canvas",
  "brand-border",
  "brand-muted",
  "brand-ivory",
  "font-serif",
];

// Explicit escape hatch: same-line comment `mdf-legacy-ok` allows a
// line to keep a banned token. Kept for the rare intentional exception
// (email preview shells, etc.).
const ESCAPE_MARKER = "mdf-legacy-ok";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (EXCLUDE_PATHS.some((p) => full.startsWith(p))) continue;
    const s = statSync(full);
    if (s.isDirectory()) {
      walk(full, out);
    } else if (/\.(tsx|ts)$/.test(entry) && !/\.test\.(tsx|ts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("Legacy light-theme token guard", () => {
  it("no non-email UI file uses banned tokens", () => {
    const files = walk(ROOT);
    const offenders: Array<{ file: string; line: number; text: string; token: string }> = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes(ESCAPE_MARKER)) continue;
        for (const token of BANNED) {
          if (line.includes(token)) {
            offenders.push({
              file: file.replace(ROOT, "src"),
              line: i + 1,
              text: line.trim(),
              token,
            });
          }
        }
      }
    }
    if (offenders.length > 0) {
      const msg = offenders
        .slice(0, 20)
        .map((o) => `${o.file}:${o.line}  — uses '${o.token}'\n     ${o.text}`)
        .join("\n");
      expect.fail(
        `Legacy light-theme tokens detected in application UI:\n${msg}\n\nTag intentional exceptions with a same-line '${ESCAPE_MARKER}' comment.`,
      );
    }
    expect(offenders).toEqual([]);
  });
});
