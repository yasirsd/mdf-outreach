import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";
import { TradeResearchWriter, type InternalJobRow } from "../repository";
import { drainTradeResearch, processTradeResearchJob, TradeResearchDrainExecutionError } from "./worker";
import { safeTradeResearchErrorCode } from "./diagnostics";

/**
 * BI4F Phase 2A production-failure repair regression suite.
 *
 * Production symptom (2026-09-27):
 *   POST /api/internal/trade-research/drain returned
 *     { outcome: "failed", safe_error_code: "DATABASE_42501",
 *       claimed: 1, requeued: 1, failed: 1, automatic_spend_rupees: 0 }
 * claim_buyer_trade_research_job succeeded, and the outer
 * recoverClaimedJob path succeeded. 42501 was raised strictly
 * between claim and finalize.
 *
 * Root cause: TradeResearchWriter.getCandidate performs a direct
 * SELECT on public.buyer_candidates via the service_role client, but
 * migration 0010 granted that table to `authenticated` only.
 * Migration 0026 is the additive privilege repair.
 */

const REPO_ROOT = process.cwd();

function readMigration(): string {
  return readFileSync(
    path.resolve(REPO_ROOT, "supabase/migrations/0026_trade_research_service_role_buyer_candidates_grant.sql"),
    "utf8",
  );
}

/**
 * Strip `--` line comments so the statement-shape assertions below
 * scan only the executable SQL, not the doc block that explains what
 * we are preserving (and therefore intentionally names things like
 * `automatic_spend_rupees` and paid providers in prose form).
 */
function readMigrationStatements(): string {
  return readMigration()
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const NOW = new Date("2026-09-27T00:00:00Z");

function jobRow(): InternalJobRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    batch_id: "00000000-0000-4000-8000-000000000002",
    workspace_id: "00000000-0000-4000-8000-000000000003",
    candidate_id: "00000000-0000-4000-8000-000000000004",
    product_id: "guntur-dry-red-chilli",
    country_code: "US",
    status: "running",
    stage: "preparing_identity",
    revision: 1,
  };
}

describe("BI4F 2A — safe 42501 classification (no SQL/identifier leakage)", () => {
  it("classifies function permission denials as DATABASE_42501_RPC_EXECUTE", () => {
    const err = { code: "42501", message: "permission denied for function claim_buyer_trade_research_job" };
    expect(safeTradeResearchErrorCode(err)).toBe("DATABASE_42501_RPC_EXECUTE");
  });

  it("classifies table permission denials as DATABASE_42501_TABLE", () => {
    const err = { code: "42501", message: "permission denied for table buyer_candidates" };
    expect(safeTradeResearchErrorCode(err)).toBe("DATABASE_42501_TABLE");
  });

  it("classifies relation permission denials as DATABASE_42501_TABLE (Postgres synonym)", () => {
    const err = { code: "42501", message: "permission denied for relation buyer_candidates" };
    expect(safeTradeResearchErrorCode(err)).toBe("DATABASE_42501_TABLE");
  });

  it("classifies sequence permission denials as DATABASE_42501_SEQUENCE", () => {
    const err = { code: "42501", message: "permission denied for sequence buyer_trade_research_events_id_seq" };
    expect(safeTradeResearchErrorCode(err)).toBe("DATABASE_42501_SEQUENCE");
  });

  it("classifies schema permission denials as DATABASE_42501_SCHEMA", () => {
    const err = { code: "42501", message: "permission denied for schema mdf" };
    expect(safeTradeResearchErrorCode(err)).toBe("DATABASE_42501_SCHEMA");
  });

  it("falls back to DATABASE_42501_OTHER when the object kind cannot be inferred", () => {
    const err = { code: "42501", message: "insufficient privilege" };
    expect(safeTradeResearchErrorCode(err)).toBe("DATABASE_42501_OTHER");
  });

  it("never emits the raw table/function/schema identifier in the classified code", () => {
    // Even when the identifier is present in the DB message, we surface only
    // the object-kind noun, never the actual name of the table or function.
    for (const identifier of ["buyer_candidates", "buyer_trade_research_jobs", "mdf.current_workspace_id"]) {
      const err = { code: "42501", message: `permission denied for table ${identifier}` };
      const code = safeTradeResearchErrorCode(err);
      expect(code).not.toContain(identifier);
      expect(code).toBe("DATABASE_42501_TABLE");
    }
  });
});

describe("BI4F 2A — a 42501 raised AFTER claim is safely requeued (production scenario)", () => {
  it("processTradeResearchJob throws when writer.getCandidate reports 42501", async () => {
    // Advance succeeds, getEligiblePlan succeeds, cache hit path — then
    // getCandidate raises 42501 exactly as in the production stack.
    const permissionDenied = Object.assign(new Error("permission denied for table buyer_candidates"), { code: "42501" });
    const writer = {
      isCancellationRequested: vi.fn(async () => false),
      advance: vi.fn(async (row: InternalJobRow, _worker: string, stage: InternalJobRow["stage"]) => ({ ...row, stage, revision: row.revision + 1 })),
      getEligiblePlan: vi.fn(async () => ({ id: "00000000-0000-4000-8000-000000000005", cost_class: "free", automatic_spend_rupees: 0 })),
      latestAttempt: vi.fn(async () => undefined),
      getFreshSnapshot: vi.fn(async () => ({
        id: "00000000-0000-4000-8000-000000000006",
        provider_id: "fda-fsvp", dataset_id: "fsvp-participant-list", published_period: "Apr 1, 2026 – Jun 30, 2026",
        source_url: "https://www.fda.gov/media/186093/download", material_hash: "h", retrieved_at: NOW.toISOString(),
        expires_at: "2026-12-31T00:00:00Z", row_count: 1, normalized_rows: [{ companyName: "X", stateCode: "CA" }],
      })),
      startAttempt: vi.fn(async () => ({ id: "00000000-0000-4000-8000-000000000007", attempt_number: 1 })),
      appendEvent: vi.fn(async () => undefined),
      finishAttempt: vi.fn(async () => undefined),
      getCandidate: vi.fn(async () => { throw permissionDenied; }),
      finalize: vi.fn(),
      release: vi.fn(),
      heartbeat: vi.fn(),
    } as unknown as TradeResearchWriter;
    await expect(
      processTradeResearchJob(writer, jobRow(), "worker", () => NOW),
    ).rejects.toBe(permissionDenied);
  });

  it("drainTradeResearch classifies the 42501 as DATABASE_42501_TABLE and requeues the claimed job", async () => {
    const permissionDenied = Object.assign(new Error("permission denied for table buyer_candidates"), { code: "42501" });
    let claimed = false;
    const writer = {
      claim: vi.fn(async () => {
        if (claimed) return undefined;
        claimed = true;
        return jobRow();
      }),
      isCancellationRequested: vi.fn(async () => false),
      advance: vi.fn(async (row: InternalJobRow, _worker: string, stage: InternalJobRow["stage"]) => ({ ...row, stage, revision: row.revision + 1 })),
      getEligiblePlan: vi.fn(async () => ({ id: "00000000-0000-4000-8000-000000000005", cost_class: "free", automatic_spend_rupees: 0 })),
      latestAttempt: vi.fn(async () => undefined),
      getFreshSnapshot: vi.fn(async () => ({
        id: "00000000-0000-4000-8000-000000000006",
        provider_id: "fda-fsvp", dataset_id: "fsvp-participant-list", published_period: "Apr 1, 2026 – Jun 30, 2026",
        source_url: "https://www.fda.gov/media/186093/download", material_hash: "h", retrieved_at: NOW.toISOString(),
        expires_at: "2026-12-31T00:00:00Z", row_count: 1, normalized_rows: [{ companyName: "X", stateCode: "CA" }],
      })),
      startAttempt: vi.fn(async () => ({ id: "00000000-0000-4000-8000-000000000007", attempt_number: 1 })),
      appendEvent: vi.fn(async () => undefined),
      finishAttempt: vi.fn(async () => undefined),
      getCandidate: vi.fn(async () => { throw permissionDenied; }),
      recoverClaimedJob: vi.fn(async () => "requeued" as const),
    } as unknown as TradeResearchWriter;

    await expect(
      drainTradeResearch({ writer, workerId: "worker-42501", maxJobs: 1, now: () => NOW }),
    ).rejects.toMatchObject({
      safeErrorCode: "DATABASE_42501_TABLE",
      result: { claimed: 1, processed: 0, requeued: 1, failed: 0, automaticSpendRupees: 0, noWork: false },
    });
    // The recovery path (release under service_role) MUST have been invoked
    // — matching production behavior where recovery succeeded.
    expect((writer as unknown as { recoverClaimedJob: ReturnType<typeof vi.fn> }).recoverClaimedJob).toHaveBeenCalledOnce();
  });
});

describe("BI4F 2A — migration 0026 shape (additive, service_role-only, SELECT-only)", () => {
  it("grants exactly SELECT on public.buyer_candidates to service_role", () => {
    const sql = readMigrationStatements();
    expect(sql).toMatch(/grant\s+select\s+on\s+public\.buyer_candidates\s+to\s+service_role\s*;/i);
  });

  it("does NOT grant INSERT / UPDATE / DELETE on public.buyer_candidates", () => {
    const sql = readMigrationStatements();
    expect(sql).not.toMatch(/grant\s+[^;]*\b(?:insert|update|delete)\b[^;]*on\s+public\.buyer_candidates/i);
  });

  it("does NOT widen anon or authenticated privileges anywhere in the migration", () => {
    const sql = readMigrationStatements();
    expect(sql).not.toMatch(/grant\s+[^;]*\s+to\s+(?:anon|authenticated|public)\b/i);
  });

  it("does NOT disable RLS or modify the RLS policies from migration 0010", () => {
    const sql = readMigrationStatements();
    expect(sql).not.toMatch(/disable\s+row\s+level\s+security/i);
    expect(sql).not.toMatch(/drop\s+policy/i);
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql).not.toMatch(/alter\s+policy/i);
  });

  it("does NOT touch any table other than public.buyer_candidates in a GRANT statement", () => {
    const sql = readMigrationStatements();
    const grantLines = sql.match(/\bgrant\b[\s\S]*?;/gi) ?? [];
    expect(grantLines.length).toBeGreaterThan(0);
    for (const line of grantLines) {
      expect(line).toMatch(/public\.buyer_candidates/i);
    }
  });

  it("does NOT reference any paid provider, BI ingest RPC, or Buyer Intelligence write RPC in executable SQL", () => {
    const sql = readMigrationStatements();
    expect(sql).not.toMatch(/ImportYeti|Panjiva|ImportGenius|Volza|Trademo|VQIP/i);
    expect(sql).not.toMatch(/buyer_trade_observations|ingest_buyer_/i);
  });

  it("includes a preflight verification block that fails loudly if the grant did not take effect", () => {
    const sql = readMigrationStatements();
    expect(sql).toMatch(/information_schema\.role_table_grants/i);
    expect(sql).toMatch(/service_role/);
    expect(sql).toMatch(/buyer_candidates/);
    expect(sql).toMatch(/raise\s+exception/i);
  });

  it("reloads the PostgREST schema so the grant is visible to the runtime immediately", () => {
    const sql = readMigrationStatements();
    expect(sql).toMatch(/notify\s+pgrst\s*,\s*'reload schema'/i);
  });
});
