import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/0037_trade_research_supabase_cron.sql"),
  "utf8",
);
const active = sql.replace(/--[^\n]*/g, "");

/**
 * TH07 DEFECT 04 migration 0037 — Supabase pg_cron wake-up for retry-due
 * trade-research jobs. The migration is INFRASTRUCTURE ONLY: enables
 * `pg_cron` + `pg_net`, defines a security-definer scheduler helper the
 * operator calls once from the SQL console with the production URL and
 * the same `TRADE_RESEARCH_DRAIN_SECRET` Vercel env carries. Nothing
 * secret is committed to this file.
 */
describe("TH07 DEFECT 04 migration 0037 — Supabase pg_cron trade-research wake-up contract", () => {
  it("enables pg_cron AND pg_net (both idempotent)", () => {
    expect(active).toMatch(/create\s+extension\s+if\s+not\s+exists\s+pg_cron/i);
    expect(active).toMatch(/create\s+extension\s+if\s+not\s+exists\s+pg_net/i);
  });

  it("defines a scheduler helper that enforces HTTPS and non-empty inputs", () => {
    expect(active).toMatch(/function\s+public\.schedule_trade_research_drain\s*\(\s*p_url\s+text,\s*p_secret\s+text,\s*p_schedule\s+text/);
    expect(active).toMatch(/TRADE_RESEARCH_DRAIN_URL_REQUIRED/);
    expect(active).toMatch(/TRADE_RESEARCH_DRAIN_URL_MUST_BE_HTTPS/);
    expect(active).toMatch(/TRADE_RESEARCH_DRAIN_SECRET_REQUIRED/);
    expect(active).toMatch(/p_url\s*!~\s*'\^https:\/\/'/);
  });

  it("the scheduler is idempotent — removes any previous entry with the same name before scheduling", () => {
    expect(active).toMatch(/cron\.unschedule\([\s\S]*?jobname\s*=\s*'trade_research_drain'/);
    expect(active).toMatch(/cron\.schedule\(\s*'trade_research_drain'/);
  });

  it("the scheduled command POSTs to the drain endpoint with Bearer auth and a bounded timeout", () => {
    expect(active).toMatch(/net\.http_post/);
    expect(active).toMatch(/'Authorization',\s*'Bearer\s*'\s*\|\|\s*%L/);
    expect(active).toMatch(/timeout_milliseconds\s*:=\s*50000/);
    // The command text uses placeholders (%L) rather than hard-coded
    // URL or secret, so the migration itself commits NO secret.
    expect(active).not.toMatch(/'https:\/\/[^']*vercel\.app/);
    expect(active).not.toMatch(/TRADE_RESEARCH_DRAIN_SECRET\s*=/i); // never embed env values
  });

  it("defines an operator-only unschedule helper so the cron can be rotated / removed", () => {
    expect(active).toMatch(/function\s+public\.unschedule_trade_research_drain\s*\(\)/);
    expect(active).toMatch(/cron\.unschedule\([\s\S]*?jobname\s*=\s*'trade_research_drain'/);
  });

  it("defines a secret-free describe helper service_role can call to confirm the schedule exists", () => {
    expect(active).toMatch(/function\s+public\.describe_trade_research_drain_schedule\s*\(\)/);
    // Returns ONLY schedule + active + name — NEVER the command text
    // (which carries the bearer secret).
    expect(active).toMatch(/returns\s+table\s*\(\s*jobname\s+text,\s*schedule\s+text,\s*active\s+boolean\s*\)/);
    expect(active).not.toMatch(/returns\s+table[^)]*command/i);
  });

  it("scheduler + unschedule helpers are SECURITY DEFINER and not callable by public/anon/authenticated/service_role", () => {
    expect(active).toMatch(/function\s+public\.schedule_trade_research_drain[\s\S]*?security\s+definer/);
    expect(active).toMatch(/function\s+public\.unschedule_trade_research_drain[\s\S]*?security\s+definer/);
    expect(active).toMatch(/revoke\s+all\s+on\s+function\s+public\.schedule_trade_research_drain\s*\(\s*text,\s*text,\s*text\s*\)\s+from\s+public,\s*anon,\s*authenticated/);
    expect(active).toMatch(/revoke\s+all\s+on\s+function\s+public\.unschedule_trade_research_drain\(\)\s+from\s+public,\s*anon,\s*authenticated/);
    // Only the describe helper is granted to service_role (safe read-only).
    expect(active).toMatch(/grant\s+execute\s+on\s+function\s+public\.describe_trade_research_drain_schedule\(\)\s+to\s+service_role/);
    // schedule_ and unschedule_ MUST NOT be granted to service_role.
    expect(active).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.schedule_trade_research_drain[\s\S]*?to\s+service_role/);
    expect(active).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.unschedule_trade_research_drain[\s\S]*?to\s+service_role/);
  });

  it("does not touch the trade-research state machine (no state transition, no claim RPC change)", () => {
    expect(active).not.toMatch(/alter\s+function\s+public\.claim_buyer_trade_research_job/i);
    expect(active).not.toMatch(/create\s+or\s+replace\s+function\s+public\.claim_buyer_trade_research_job/i);
    expect(active).not.toMatch(/create\s+or\s+replace\s+function\s+public\.release_buyer_trade_research_job/i);
    expect(active).not.toMatch(/buyer_trade_research_jobs/i);
  });

  it("asks PostgREST to reload the schema cache", () => {
    expect(active).toMatch(/notify\s+pgrst,\s*'reload schema'/);
  });

  it("does not reference the free-enrichment queue — these are separate subsystems", () => {
    expect(active).not.toMatch(/free[-_]enrichment/i);
    expect(active).not.toMatch(/buyer_finder/i);
  });
});
