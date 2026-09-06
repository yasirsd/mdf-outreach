import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function migration(name: string): string {
  return readFileSync(path.resolve(process.cwd(), "supabase/migrations", name), "utf8");
}

const SQL = migration("0020_buyer_intelligence_foundation.sql");
const ACTIVE_SQL = SQL.replace(/--[^\n]*/g, "");

describe("BI1 migration 0020", () => {
  it("creates exactly the six approved Buyer Intelligence tables and does not apply itself", () => {
    const names = [...SQL.matchAll(/create table if not exists public\.([a-z_]+)/gi)].map(
      (match) => match[1],
    );
    expect(names).toEqual([
      "buyer_intelligence_sources",
      "buyer_intelligence_claims",
      "buyer_trade_observations",
      "buyer_trade_metrics",
      "buyer_intelligence_assessments",
      "buyer_intelligence_assessment_evidence",
    ]);
    expect(SQL).toMatch(/does NOT apply itself/i);
    expect(ACTIVE_SQL).not.toMatch(/^\s*(insert\s+into|update\s+public\.|delete\s+from|truncate)\b/im);
  });

  it("pins every table to workspace and Candidate ownership", () => {
    expect((SQL.match(/workspace_id\s+uuid not null/g) ?? [])).toHaveLength(6);
    expect((SQL.match(/candidate_id\s+uuid not null/g) ?? [])).toHaveLength(6);
    expect((SQL.match(/foreign key \(candidate_id, workspace_id\)/g) ?? [])).toHaveLength(6);
  });

  it("enforces candidate-scoped source and assessment-evidence integrity", () => {
    expect(SQL).toMatch(
      /foreign key \(source_id, candidate_id, workspace_id\)[\s\S]{0,120}buyer_intelligence_sources \(id, candidate_id, workspace_id\)/,
    );
    expect(SQL).toMatch(
      /foreign key \(assessment_id, candidate_id, workspace_id\)[\s\S]{0,140}buyer_intelligence_assessments \(id, candidate_id, workspace_id\)/,
    );
    for (const [column, table] of [
      ["claim_id", "buyer_intelligence_claims"],
      ["observation_id", "buyer_trade_observations"],
      ["metric_id", "buyer_trade_metrics"],
    ]) {
      expect(SQL).toMatch(
        new RegExp(
          `foreign key \\(${column}, candidate_id, workspace_id\\)[\\s\\S]{0,140}${table} \\(id, candidate_id, workspace_id\\)`,
        ),
      );
    }
    expect(SQL).toMatch(/num_nonnulls\(claim_id, observation_id, metric_id\) = 1/);
  });

  it("uses normalized typed metric rows with controlled vocabulary and constraints", () => {
    expect(SQL).toMatch(/metric_key\s+text not null/);
    expect(SQL).toMatch(/value_type\s+text not null/);
    expect(SQL).toMatch(/numeric_value\s+numeric/);
    expect(SQL).toMatch(/text_value\s+text/);
    expect(SQL).toMatch(/structured_value\s+jsonb/);
    expect(SQL).toMatch(/unit\s+text not null/);
    expect(SQL).toMatch(/calculation_window\s+text not null/);
    expect(SQL).toMatch(/supporting_observation_count\s+integer not null/);
    expect(SQL).toMatch(/num_nonnulls\(numeric_value, text_value, structured_value\) = 1/);
    expect(SQL).toMatch(/unique \(workspace_id, candidate_id, metric_key, calculation_window\)/);
    expect(SQL).not.toMatch(/last_observed_trade\s+(date|timestamptz)/i);
  });

  it("preserves missing trade data and separates origin from destination", () => {
    expect(SQL).toMatch(/trade_date\s+date,/);
    expect(SQL).toMatch(/origin_country_code\s+text,/);
    expect(SQL).toMatch(/destination_country_code\s+text,/);
    expect(SQL).toMatch(/supplier_name_raw\s+text,/);
    expect(SQL).toMatch(/hs_code_raw\s+text,/);
    expect(SQL).not.toMatch(/origin_country_code\s+text\s+not null/i);
  });

  it("keeps source identity separate from claim and observation identity", () => {
    expect(SQL).toMatch(
      /unique \(workspace_id, candidate_id, provider_id, source_key\)/,
    );
    expect(SQL).toMatch(/unique \(source_id, source_record_ref, claim_type\)/);
    expect(SQL).toMatch(/unique \(source_id, source_record_ref\)/);
  });

  it("creates only the query-shaped Candidate indexes required by BI1", () => {
    for (const index of [
      "buyer_intelligence_sources_candidate_retrieved_idx",
      "buyer_intelligence_claims_candidate_type_idx",
      "buyer_intelligence_claims_candidate_source_idx",
      "buyer_trade_observations_candidate_date_idx",
      "buyer_trade_observations_candidate_source_idx",
      "buyer_trade_observations_candidate_evidence_idx",
      "buyer_trade_observations_candidate_origin_idx",
      "buyer_trade_observations_candidate_destination_idx",
      "buyer_trade_observations_candidate_hs_idx",
      "buyer_trade_observations_candidate_product_idx",
      "buyer_trade_observations_candidate_mdf_product_idx",
      "buyer_trade_observations_candidate_supplier_idx",
      "buyer_trade_metrics_candidate_key_idx",
      "buyer_intelligence_assessments_candidate_type_idx",
      "buyer_intelligence_assessment_evidence_assessment_idx",
    ]) {
      expect(SQL).toContain(`index if not exists ${index}`);
    }
  });

  it("applies workspace RLS and exposes only SELECT to authenticated", () => {
    const tables = [
      "buyer_intelligence_sources",
      "buyer_intelligence_claims",
      "buyer_trade_observations",
      "buyer_trade_metrics",
      "buyer_intelligence_assessments",
      "buyer_intelligence_assessment_evidence",
    ];
    for (const table of tables) {
      expect(SQL).toContain(`select mdf.__apply_workspace_rls('public.${table}'::regclass);`);
      expect(SQL).toContain(`revoke all on public.${table} from anon, authenticated, public;`);
      expect(SQL).toContain(`grant select on public.${table} to authenticated;`);
      expect(SQL).not.toMatch(
        new RegExp(`grant[^;]*(insert|update|delete)[^;]*public\\.${table}[^;]*authenticated`, "i"),
      );
    }
  });

  it("records retrieval provenance and contains no provider/network operations", () => {
    expect((SQL.match(/retrieved_at\s+timestamptz not null/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(ACTIVE_SQL).not.toMatch(/hunter\.io|gmail|linkedin|https?:\/\//i);
    expect(ACTIVE_SQL).not.toMatch(/net\.http|http_get|http_post/i);
    expect(ACTIVE_SQL).not.toMatch(/\b(insert|update|delete)\s+(into\s+|from\s+)?public\.(buyers|buyer_candidates|campaigns|campaign_recipients)\b/i);
  });

  it("guards the already-applied 0018 and 0019 bytes", () => {
    const sha256 = (text: string) => createHash("sha256").update(text).digest("hex").toUpperCase();
    expect(sha256(migration("0018_buyer_finder_candidate_conversion.sql"))).toBe(
      "E7DD2418C2BB93FCD6E8C2F90A2E2FF070609019468EB5AA47B1998557043200",
    );
    expect(sha256(migration("0019_buyer_email_required_conversion.sql"))).toBe(
      "1095537A7E71154EC683B0F457E602C48C85BA627D2657F54B353D66FFA3EB64",
    );
  });
});
