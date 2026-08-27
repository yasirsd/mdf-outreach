import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * F9 — the env readiness surface must:
 *   • require auth (server-side)
 *   • return no raw secret value
 *   • not expose any control to change BUYER_SEND_ENABLED
 *
 * These invariants are checked via source inspection because the file
 * is a server action and depends on a live Supabase session.
 */

const ACTION = readFileSync(
  path.resolve(process.cwd(), "src/app/(app)/settings/envReadinessAction.ts"),
  "utf8",
);
const PANEL = readFileSync(
  path.resolve(process.cwd(), "src/app/(app)/settings/ProductionReadinessPanel.tsx"),
  "utf8",
);

describe("F9 env readiness surface", () => {
  it("server action is auth-gated with requireMdfSession", () => {
    expect(ACTION).toContain("requireMdfSession");
    expect(ACTION).toContain("await requireMdfSession()");
  });

  it("server action delegates to describeEnvironment (which never returns raw values)", () => {
    expect(ACTION).toContain("describeEnvironment");
  });

  it("server action does not read process.env directly", () => {
    expect(ACTION).not.toMatch(/process\.env\./);
  });

  it("panel does NOT expose any control to enable Buyer Send", () => {
    // Enabling remains an env-var decision. There must be no button,
    // form action or checkbox that flips BUYER_SEND_ENABLED.
    expect(PANEL).not.toMatch(/BUYER_SEND_ENABLED\s*=/);
    expect(PANEL).not.toMatch(/setBuyerSendEnabled/i);
    expect(PANEL).not.toMatch(/enable buyer send/i);
    // The panel copy explicitly explains that it cannot be enabled here.
    expect(PANEL).toMatch(/cannot be enabled from this panel/i);
  });

  it("panel never renders 'value' fields for the readiness entries — only status + detail", () => {
    // Guardrail: the entry shape returned by the action carries no raw
    // value, but if a future edit accidentally added `entry.value` and
    // rendered it in the panel that would be a leak. Assert nothing of
    // the shape is rendered.
    expect(PANEL).not.toMatch(/entry\.value/);
    expect(PANEL).not.toMatch(/e\.value/);
  });
});
