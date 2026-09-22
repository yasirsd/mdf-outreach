import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  path.resolve(process.cwd(), "supabase/tests/verify_mi1f_full_calibration_cohort.sql"),
  "utf8",
);

function executableSql(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
}

describe("MI1F.5 full calibration-cohort verification artifact", () => {
  it("is structurally read-only", () => {
    const executable = executableSql(SQL);
    const statements = executable.split(";").map((statement) => statement.trim()).filter(Boolean);

    expect(statements.length).toBeGreaterThanOrEqual(5);
    for (const statement of statements) {
      expect(statement).toMatch(/^(select|with)\b/i);
    }
    expect(executable).not.toMatch(
      /\b(insert|update|delete|merge|upsert|create|alter|drop|truncate|grant|revoke|call|do)\b/i,
    );
    expect(executable).not.toMatch(/\brpc\s*\(/i);
  });

  it("enumerates the canonical 18 reporters in cohort order", () => {
    const reporters = [
      "MY", "AE", "SA", "QA", "OM", "KW", "SG", "TH", "VN",
      "LK", "KR", "JP", "GB", "DE", "NL", "US", "CA", "AU",
    ];

    reporters.forEach((reporter, index) => {
      expect(SQL).toContain(`('${reporter}', ${index + 1})`);
    });
  });

  it("covers the persisted source, ledger, observation, publication, and BI boundaries", () => {
    for (const relation of [
      "market_intelligence_sources",
      "market_provider_fetch_ledger",
      "market_trade_observations",
      "market_product_scores",
      "market_product_score_components",
      "buyer_intelligence_sources",
      "buyer_trade_observations",
    ]) {
      expect(SQL).toContain(`public.${relation}`);
    }
  });

  it("exposes every required rolled-up assertion", () => {
    for (const checkId of [
      "market_source_rights",
      "all_18_reporters_present",
      "all_reporters_have_reusable_success",
      "observation_ledger_consistency",
      "controlled_observation_shape",
      "periods_within_2018_2024",
      "no_unexpected_reporters",
      "no_duplicate_observation_identity",
      "canonical_country_codes",
      "no_world_rows",
      "no_090422_contamination",
      "no_market_fit_publication",
      "no_buyer_intelligence_contamination",
    ]) {
      expect(SQL).toContain(`'${checkId}'`);
    }
  });
});
