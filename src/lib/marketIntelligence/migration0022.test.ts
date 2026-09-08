import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * MI1B.2 — historical version immutability.
 *
 * Migration 0022 is (soon to be) an APPLIED immutable historical
 * migration. Its SQL captures a specific point-in-time contract; the
 * test must assert THAT snapshot, not whatever value the current TS
 * domain module happens to export. Once 0022 is applied, a future
 * bump like `mi-select-v2 → mi-select-v3` in TS must NOT require a
 * modification to 0022.
 *
 * The runtime version of the domain constant is verified separately
 * by the module's own tests (`providerSelection.test.ts`). This file
 * verifies the historical schema snapshot only.
 */
const HISTORICAL_MIGRATION_PROVIDER_SELECTION_VERSION = "mi-select-v2";

/**
 * MI1B / MI1B.1 — migration 0022 static guardrails.
 *
 * Read-only: we do not connect to a database from these tests. We
 * assert the migration file's shape so a future edit cannot silently
 * regress the RLS, trust-boundary, invariant, or secret-rejection
 * rules the design relies on.
 */

const HERE = process.cwd();
const M22 = readFileSync(
  path.resolve(HERE, "supabase/migrations/0022_market_intelligence_foundation.sql"),
  "utf8",
);
const PRE = readFileSync(
  path.resolve(HERE, "supabase/tests/preflight_0022_market_intelligence_foundation.sql"),
  "utf8",
);
const VER = readFileSync(
  path.resolve(HERE, "supabase/tests/verify_0022_market_intelligence_foundation.sql"),
  "utf8",
);

const IMMUTABLE_MIGRATIONS = [
  "supabase/migrations/0018_buyer_finder_candidate_conversion.sql",
  "supabase/migrations/0019_buyer_email_required_conversion.sql",
  "supabase/migrations/0020_buyer_intelligence_foundation.sql",
  "supabase/migrations/0021_buyer_intelligence_write_pipeline.sql",
];

const GLOBAL_MUTATION_RPCS: [string, string][] = [
  ["ingest_market_intelligence_source", "jsonb"],
  ["verify_market_intelligence_source", "uuid, jsonb"],
  ["ingest_market_trade_observation", "uuid, jsonb"],
  ["record_market_fetch_result", "jsonb"],
  ["refresh_market_intelligence", "text, text, jsonb"],
];

describe("MI1B migration 0022 — required tables + shape", () => {
  it("creates every required table", () => {
    for (const table of [
      "market_intelligence_sources",
      "product_trade_mappings",
      "market_provider_fetch_ledger",
      "market_trade_observations",
      "market_trade_metrics",
      "market_product_scores",
      "market_product_score_components",
      "market_analysis_events",
    ]) {
      expect(M22).toMatch(new RegExp(`create table if not exists public\\.${table}`));
    }
  });

  it("does not create BACI-specific, tariff, or watchlist tables in MI1B", () => {
    expect(M22).not.toMatch(/create table if not exists public\.market_tariff_observations/i);
    expect(M22).not.toMatch(/create table if not exists public\.market_watchlist/i);
    expect(M22).not.toMatch(/create table if not exists public\.baci/i);
  });

  it("declares 'Does NOT apply itself' preface and is additive-only", () => {
    expect(M22).toMatch(/Does NOT apply itself/i);
    expect(M22).not.toMatch(/drop table/i);
    for (const table of [
      "buyer_candidates",
      "buyers",
      "buyer_finder_candidate_conversions",
      "buyer_intelligence_sources",
      "buyer_intelligence_claims",
      "buyer_trade_observations",
      "buyer_trade_metrics",
      "buyer_intelligence_assessments",
    ]) {
      expect(M22).not.toMatch(new RegExp(`alter table public\\.${table}\\b`, "i"));
      expect(M22).not.toMatch(new RegExp(`insert into public\\.${table}\\b`, "i"));
      expect(M22).not.toMatch(new RegExp(`update public\\.${table}\\b`, "i"));
      expect(M22).not.toMatch(new RegExp(`delete from public\\.${table}\\b`, "i"));
    }
  });

  it("does not seed rows at migration apply time (avoids TS↔SQL drift)", () => {
    const outsideFunctions = M22.replace(/as\s*\$\$[\s\S]*?\$\$;/g, "");
    expect(outsideFunctions).not.toMatch(/insert into public\.market_/i);
    expect(outsideFunctions).not.toMatch(/insert into public\.product_trade_mappings/i);
  });

  it("MI1B.1 — wraps every statement in a single BEGIN/COMMIT transaction", () => {
    // BEGIN must appear before the first CREATE TABLE.
    const beginIdx = M22.indexOf("begin;");
    const firstCreateTable = M22.indexOf("create table");
    const commitIdx = M22.lastIndexOf("commit;");
    const notifyIdx = M22.lastIndexOf("notify pgrst");
    expect(beginIdx).toBeGreaterThan(0);
    expect(beginIdx).toBeLessThan(firstCreateTable);
    expect(notifyIdx).toBeLessThan(commitIdx);
    // No CREATE INDEX CONCURRENTLY (would break the transaction wrap).
    expect(M22).not.toMatch(/create\s+index\s+concurrently/i);
  });

  it("does not enable or touch BUYER_SEND_ENABLED / BUYER_FINDER_HUNTER_REVEAL_ENABLED", () => {
    expect(M22).not.toMatch(/BUYER_SEND_ENABLED/);
    expect(M22).not.toMatch(/BUYER_FINDER_HUNTER_REVEAL_ENABLED/);
    expect(M22).not.toMatch(/api\.hunter\.io/i);
    expect(M22).not.toMatch(/from ["'][^"']*hunter[^"']*["']/i);
    expect(M22).not.toMatch(/@\/lib\/gmail/);
  });
});

describe("MI1B.1 migration 0022 — RLS + policy naming", () => {
  it("enables RLS on every global MI table with SELECT-only to authenticated", () => {
    expect(M22).toMatch(/alter table %s enable row level security/);
    expect(M22).toMatch(/for select to authenticated using \(true\)/);
    expect(M22).toMatch(/revoke all on %s from anon, authenticated, public/);
    expect(M22).toMatch(/grant select on %s to authenticated/);
  });

  it("policy names are built as bare identifiers, never as schema-qualified strings", () => {
    // The loop must NOT format the policy identifier from a
    // qualified table string like 'public.market_...'.
    expect(M22).not.toMatch(/%I_select on %s/);
    // The correct pattern: policy_name := t || '_select';
    // and format('...%I on %s...', policy_name, qualified).
    expect(M22).toMatch(/policy_name\s*text/i);
    expect(M22).toMatch(/policy_name\s*:=\s*t\s*\|\|\s*'_select'/);
    expect(M22).toMatch(/create policy %I on %s/);
    // Table names in the loop are UNQUALIFIED so they can be quoted
    // safely — the qualified form is built separately.
    expect(M22).toMatch(
      /for t in select unnest\(array\[\s*'market_intelligence_sources',/,
    );
  });

  it("uses the standard workspace RLS macro for the operator activity trail", () => {
    expect(M22).toMatch(/mdf\.__apply_workspace_rls\('public\.market_analysis_events'::regclass\)/);
    expect(M22).toMatch(
      /revoke all on public\.market_analysis_events from anon, authenticated, public/,
    );
    expect(M22).toMatch(/grant select on public\.market_analysis_events to authenticated/);
  });

  it("does NOT grant INSERT / UPDATE / DELETE on any global MI table", () => {
    expect(M22).not.toMatch(
      /grant\s+(?:select\s*,\s*)?(insert|update|delete)[\s\S]{0,80}on public\.market_/i,
    );
  });
});

describe("MI1B.1 migration 0022 — trust boundary (service_role writes)", () => {
  it("every global mutation RPC is executable by service_role and denied to public/anon/authenticated", () => {
    for (const [name, args] of GLOBAL_MUTATION_RPCS) {
      const sig = `public\\.${name}\\(${args.replace(/,/g, ", ").replace(/\s+/g, "\\s+")}\\)`;
      expect(M22).toMatch(
        new RegExp(`revoke all on function ${sig}[\\s\\S]{0,120}from public, anon, authenticated`),
      );
      expect(M22).toMatch(
        new RegExp(`grant execute on function ${sig}[\\s\\S]{0,120}to service_role`),
      );
      // The old (unsafe) grant to authenticated must NOT be present for these RPCs.
      expect(M22).not.toMatch(
        new RegExp(`grant execute on function ${sig}[\\s\\S]{0,120}to authenticated`),
      );
    }
  });

  it("does not introduce a new service credential — service_role is the built-in Supabase role", () => {
    // MI1B.1/MI1B.2 must not embed a key or install a role. Naming
    // the env var `SUPABASE_SERVICE_ROLE_KEY` inside a documentation
    // comment (see the MI1B.2 isolation preface) is fine; assigning
    // it to any SQL identifier is not.
    expect(M22).not.toMatch(/(select|insert|update|create|grant|revoke|='\s*)[\s\S]{0,40}SUPABASE_SERVICE_ROLE_KEY/i);
    expect(M22).not.toMatch(/create role\s+service_role/i);
  });

  it("public RPCs no longer require mdf.current_workspace_id() (trust is at grant time)", () => {
    const rpcNames = GLOBAL_MUTATION_RPCS.map(([n]) => n);
    for (const name of rpcNames) {
      const body =
        M22.match(
          new RegExp(`create or replace function public\\.${name}[\\s\\S]*?end;\\s*\\$\\$;`),
        )?.[0] ?? "";
      expect(body).not.toMatch(/mdf\.current_workspace_id\(\)/);
    }
  });
});

describe("MI1B.1 migration 0022 — storage-rights defense in depth", () => {
  it("ingest_market_trade_observation raises when the source is not fully verified", () => {
    const body =
      M22.match(
        /create or replace function public\.ingest_market_trade_observation[\s\S]*?end;\s*\$\$;/,
      )?.[0] ?? "";
    expect(body).toMatch(/service_terms_verified.*false/);
    expect(body).toMatch(/storage_allowed.*false/);
    expect(body).toMatch(/licence_verified_at is null/);
    expect(body).toMatch(/storage rights not verified/i);
  });

  it("verify_market_intelligence_source exists and updates ONLY the five rights fields", () => {
    expect(M22).toContain("create or replace function public.verify_market_intelligence_source");
    const body =
      M22.match(
        /create or replace function public\.verify_market_intelligence_source[\s\S]*?end;\s*\$\$;/,
      )?.[0] ?? "";
    expect(body).toContain("service_terms_verified");
    expect(body).toContain("storage_allowed");
    expect(body).toContain("redistribution_allowed");
    expect(body).toContain("licence_verified_at");
    expect(body).toContain("licence_verification_note");
    // Must not touch identity / provenance columns.
    for (const forbidden of ["provider_id", "dataset_id", "dataset_source", "distribution_service", "source_tier"]) {
      // Body may reference the column in a SELECT/UPDATE clause; we
      // only forbid it appearing in the SET list. Look for
      // "<col>            = " (an assignment).
      const assignmentRegex = new RegExp(`${forbidden}\\s*=`);
      const setListSection = body.match(/update public\.market_intelligence_sources set[\s\S]*?where id/)?.[0] ?? "";
      expect(setListSection).not.toMatch(assignmentRegex);
    }
  });
});

describe("MI1B.1 migration 0022 — global refresh advisory lock", () => {
  it("refresh_market_intelligence lock key is GLOBAL — workspace_id is NOT part of the lock expression", () => {
    const body =
      M22.match(
        /create or replace function public\.refresh_market_intelligence[\s\S]*?end;\s*\$\$;/,
      )?.[0] ?? "";
    // Body still acquires an advisory lock…
    expect(body).toMatch(/pg_advisory_xact_lock/);
    // The lock string uses a stable global prefix.
    expect(body).toMatch(/'mi-refresh:'\s*\|\|\s*p_country_alpha2\s*\|\|\s*':'\s*\|\|\s*p_mdf_product_id/);
    // Isolate the lock expression itself and forbid any workspace reference there.
    const lockExpr =
      body.match(/perform\s+pg_advisory_xact_lock\(([\s\S]*?)\);/)?.[1] ?? "";
    expect(lockExpr).not.toMatch(/workspace/i);
    // No local var referencing workspace anywhere in the RPC body.
    expect(body).not.toMatch(/v_workspace_id\b/);
  });
});

describe("MI1B.1 migration 0022 — invariants (mapping specificity + publication)", () => {
  it("product_trade_mappings mirrors the TS confidence bands via CHECK", () => {
    expect(M22).toMatch(/mapping_kind\s+text\s+not\s+null/);
    expect(M22).toMatch(/mapping_confidence\s+numeric\(4,3\)\s+not\s+null/);
    expect(M22).toMatch(/mapping_kind in \('exact','proxy','composite'\)/);
    expect(M22).toMatch(
      /mapping_kind\s*=\s*'exact'[\s\S]{0,120}mapping_confidence\s*>=\s*0\.85/,
    );
    expect(M22).toMatch(
      /mapping_kind\s*=\s*'proxy'[\s\S]{0,180}mapping_confidence\s*>\s*0\.40[\s\S]{0,80}mapping_confidence\s*<=\s*0\.85/,
    );
    expect(M22).toMatch(
      /mapping_kind\s*=\s*'composite'[\s\S]{0,120}mapping_confidence\s*<=\s*0\.40/,
    );
    expect(M22).toMatch(/eligibility_matches_kind/);
  });

  it("MI1B.1 — scores table mirrors the same banded structural constraints", () => {
    expect(M22).toContain("market_product_scores_kind_matches_bands");
    // Exact requires is_trade_proxy = false; proxy requires true.
    expect(M22).toMatch(/mapping_kind\s*=\s*'exact'[\s\S]{0,200}is_trade_proxy\s*=\s*false/);
    expect(M22).toMatch(/mapping_kind\s*=\s*'proxy'[\s\S]{0,200}is_trade_proxy\s*=\s*true/);
  });

  it("scores table enforces composite/proxy/actionable publication rules", () => {
    expect(M22).toContain("market_product_scores_composite_no_publication");
    expect(M22).toContain("market_product_scores_proxy_not_actionable");
    expect(M22).toContain("market_product_scores_actionable_requires_publication");
    expect(M22).toMatch(
      /mapping_kind\s*<>\s*'composite'\s*or\s*\(published_fit_score is null and recommendation_status\s*=\s*'insufficient_evidence'\)/,
    );
    expect(M22).toMatch(
      /mapping_kind\s*<>\s*'proxy'\s*or\s*\(recommendation_status\s*<>\s*'actionable' and is_trade_proxy\s*=\s*true\)/,
    );
    expect(M22).toMatch(
      /recommendation_status\s*<>\s*'actionable'\s*or\s*\(published_fit_score is not null and mapping_kind\s*=\s*'exact'\)/,
    );
  });

  it("__write_market_score raises for every publication-invariant violation", () => {
    const body = M22.match(/create or replace function mdf\.__write_market_score[\s\S]*?end;\s*\$\$;/)?.[0] ?? "";
    expect(body).toMatch(/composite mapping must not publish a numeric score/);
    expect(body).toMatch(/proxy mapping cannot be actionable and must set is_trade_proxy/);
    expect(body).toMatch(/actionable recommendation requires a published score and exact mapping/);
  });

  it("MI1B.1 — __write_market_score reuses the current row when the material result is unchanged", () => {
    const body = M22.match(/create or replace function mdf\.__write_market_score[\s\S]*?end;\s*\$\$;/)?.[0] ?? "";
    // Full material comparison AND a return before the supersede branch.
    expect(body).toMatch(/return v_current\.id;/);
    expect(body).toMatch(/mapping_kind\s*=\s*p_mapping_kind/);
    expect(body).toMatch(/positive_reasons\s*=\s*coalesce\(p_positive_reasons/);
    expect(body).toMatch(/negative_reasons\s*=\s*coalesce\(p_negative_reasons/);
    expect(body).toMatch(/source_coverage\s*=\s*coalesce\(p_source_coverage/);
    expect(body).toMatch(/jsonb_agg[\s\S]{0,600}order by c\.component_key/);
  });

  it("scores/metrics carry a versioned calculation stamp", () => {
    expect(M22).toContain("market_fit_version");
    expect(M22).toContain("confidence_version");
    expect(M22).toContain("provider_selection_version");
    expect(M22).toContain("calculation_version");
  });

  it("MI1B.2 — historical provider-selection version literal is the snapshot value (not coupled to runtime)", () => {
    // Any literal `'mi-select-vN'` appearing in the migration MUST
    // equal the historical snapshot value — never the current TS
    // domain constant. Runtime version drift is verified in
    // providerSelection.test.ts; this immutable migration file must
    // pin its own literal and never change once applied.
    const literals = M22.match(/'mi-select-v[0-9]+'/g) ?? [];
    for (const literal of literals) {
      expect(literal).toBe(`'${HISTORICAL_MIGRATION_PROVIDER_SELECTION_VERSION}'`);
    }
  });
});

describe("MI1B.1 migration 0022 — metric constraints", () => {
  it("metric_key exactly-one-value constraint uses = 1 (not >= 1)", () => {
    expect(M22).toMatch(
      /market_trade_metrics_one_value_set[\s\S]{0,400}\+\s*\(text_value is not null\)::int\s*\n\s*=\s*1/,
    );
    expect(M22).not.toMatch(
      /market_trade_metrics_one_value_set[\s\S]{0,400}>=\s*1/,
    );
  });

  it("__write_market_metric includes observation_watermark in material equality", () => {
    const body =
      M22.match(/create or replace function mdf\.__write_market_metric[\s\S]*?end;\s*\$\$;/)?.[0] ?? "";
    expect(body).toMatch(
      /coalesce\(v_current\.observation_watermark::text[\s\S]{0,80}coalesce\(p_observation_watermark::text/,
    );
  });
});

describe("MI1B.1 migration 0022 — period/frequency coupling", () => {
  it("observation period regex is coupled to frequency (rejects YYYY-00, YYYY-13, cross-frequency)", () => {
    expect(M22).toContain("market_trade_observations_period_shape_matches_frequency");
    expect(M22).toMatch(/frequency\s*=\s*'annual'\s+and\s+period\s*~\s*'\^\[0-9\]\{4\}\$'/);
    expect(M22).toMatch(
      /frequency\s*=\s*'quarterly'\s+and\s+period\s*~\s*'\^\[0-9\]\{4\}-Q\[1-4\]\$'/,
    );
    expect(M22).toMatch(
      /frequency\s*=\s*'monthly'\s+and\s+period\s*~\s*'\^\[0-9\]\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$'/,
    );
    // Old, permissive regex must not still be present.
    expect(M22).not.toMatch(/period ~ '\^\[0-9\]\{4\}\(-Q\[1-4\]\|-\[0-1\]\[0-9\]\)\?\$'/);
  });
});

describe("MI1B migration 0022 — observation identity + zero/null semantics", () => {
  it("observation identity honours the world/all-partners variant via generated partner_key", () => {
    expect(M22).toContain(
      "partner_key                 text generated always as (coalesce(partner_country, '__WORLD__')) stored",
    );
    expect(M22).toMatch(
      /create unique index if not exists market_trade_observations_identity_uidx[\s\S]{0,300}partner_key/,
    );
  });

  it("stores country codes as ISO alpha-2 UPPERCASE only (never alpha-3)", () => {
    expect(M22).toMatch(/reporter_country\s+text not null/);
    expect(M22).toMatch(/reporter_country ~ '\^\[A-Z\]\{2\}\$'/);
    expect(M22).toMatch(/partner_country is null or partner_country ~ '\^\[A-Z\]\{2\}\$'/);
    expect(M22).not.toMatch(/reporter_alpha3\b/i);
    expect(M22).not.toMatch(/partner_alpha3\b/i);
  });

  it("zero-vs-null: quantity/value are nullable but NOT coerced; nonnegative when present", () => {
    expect(M22).toMatch(/trade_value_usd\s+numeric\([^)]+\)\s*,\s*\n/);
    expect(M22).toMatch(/trade_value_usd is null or trade_value_usd >= 0/);
    expect(M22).toMatch(/quantity is null or quantity >= 0/);
    expect(M22).toMatch(/net_weight_kg is null or net_weight_kg >= 0/);
  });

  it("fetch ledger's outcome vocabulary matches the MI0.1 contract", () => {
    expect(M22).toMatch(/outcome in \(\s*'success','partial','empty','quota_exhausted',\s*'timeout','provider_error','invalid_request','unavailable'\s*\)/);
    expect(M22).toMatch(/fresh_until >= fetched_at/);
    expect(M22).toContain("market_provider_fetch_ledger_fingerprint_idx");
  });

  it("secret-shaped metadata is rejected on every user-facing table AND in the SQL guard", () => {
    // Sources, observations, ledger, score components, and score itself
    // (source_coverage + reason arrays) all carry a secret CHECK.
    const secretChecks =
      M22.match(/no_secrets|safe_metadata::text\)\s*!~\*/g) ?? [];
    expect(secretChecks.length).toBeGreaterThanOrEqual(7);
    expect(M22).toContain("market_product_scores_source_coverage_no_secrets");
    expect(M22).toContain("market_product_score_components_metadata_no_secrets");
    // Central helper mirrors the same regex vocabulary.
    expect(M22).toMatch(
      /api\.\?key\|secret\|token\|cookie\|authorization\|password\|credential\|bearer/i,
    );
  });
});

describe("MI1B migration 0022 — preflight + verification companions", () => {
  it("preflight file exists, is read-only, and checks every MI target", () => {
    expect(PRE).toMatch(/READ-ONLY/i);
    expect(PRE).not.toMatch(/\binsert\s+into\s+public\./i);
    expect(PRE).not.toMatch(/\bupdate\s+public\./i);
    expect(PRE).not.toMatch(/\bdelete\s+from\s+public\./i);
    expect(PRE).not.toMatch(/\bcreate\s+(table|function|policy|index)\b/i);
    expect(PRE).not.toMatch(/\balter\s+table\b/i);
    expect(PRE).not.toMatch(/\bdrop\s+(table|function|policy|index)\b/i);
    expect(PRE).not.toMatch(/\brevoke\b|\bgrant\b/i);
    for (const table of [
      "market_intelligence_sources",
      "product_trade_mappings",
      "market_provider_fetch_ledger",
      "market_trade_observations",
      "market_trade_metrics",
      "market_product_scores",
      "market_product_score_components",
      "market_analysis_events",
    ]) {
      expect(PRE).toContain(table);
    }
    expect(PRE).toContain("buyer_finder_candidate_conversions");
    expect(PRE).toContain("mdf.current_workspace_id()");
    expect(PRE).toContain("mdf.__apply_workspace_rls(regclass)");
  });

  it("verify file is read-only and asserts every post-apply invariant", () => {
    expect(VER).toMatch(/READ-ONLY/i);
    expect(VER).not.toMatch(/\binsert\s+into\s+public\./i);
    expect(VER).not.toMatch(/\bupdate\s+public\./i);
    expect(VER).not.toMatch(/\bdelete\s+from\s+public\./i);
    expect(VER).not.toMatch(/\bcreate\s+(table|function|policy|index)\b/i);
    expect(VER).not.toMatch(/\balter\s+table\b/i);
    expect(VER).not.toMatch(/\bdrop\s+(table|function|policy|index)\b/i);
    expect(VER).not.toMatch(/\brevoke\b|\bgrant\b/i);
    for (const check of [
      "authenticated_select_on_global",
      "authenticated_no_dml_on_global",
      "anon_denied_on_global",
      "authenticated_no_execute_on_mutation_rpcs",
      "service_role_can_execute_mutation_rpcs",
      "mi_rpc_definer",
      "mi_rpc_search_path",
      "mi_table_initial_rowcount",
    ]) {
      expect(VER).toContain(check);
    }
    expect(VER).toMatch(/table has rows — apply must not seed/);
  });
});

describe("MI1B.2 migration 0022 — fail-closed version enforcement", () => {
  it("__write_market_metric raises on a blank calculation_version instead of stamping a default", () => {
    const body =
      M22.match(/create or replace function mdf\.__write_market_metric[\s\S]*?end;\s*\$\$;/)?.[0] ?? "";
    expect(body).toMatch(/nullif\(btrim\(p_calculation_version\), ''\) is null/);
    expect(body).toMatch(/calculation_version is required/);
  });

  it("__write_market_score raises on any blank algorithm/version field", () => {
    const body =
      M22.match(/create or replace function mdf\.__write_market_score[\s\S]*?end;\s*\$\$;/)?.[0] ?? "";
    for (const field of [
      "market_fit_version",
      "confidence_version",
      "provider_selection_version",
    ]) {
      expect(body).toMatch(new RegExp(`nullif\\(btrim\\(p_${field}\\), ''\\) is null`));
      expect(body).toMatch(new RegExp(`${field} is required`));
    }
  });

  it("refresh_market_intelligence stops silently defaulting version fields", () => {
    const body =
      M22.match(
        /create or replace function public\.refresh_market_intelligence[\s\S]*?end;\s*\$\$;/,
      )?.[0] ?? "";
    // No coalesce-with-default for any version literal.
    expect(body).not.toMatch(/coalesce\([^,]+,\s*'mi-select-v[0-9]+'\)/);
    expect(body).not.toMatch(/coalesce\([^,]+,\s*'mi-fit-v[0-9]+'\)/);
    expect(body).not.toMatch(/coalesce\([^,]+,\s*'mi-conf-v[0-9]+'\)/);
    expect(body).not.toMatch(/coalesce\([^,]+,\s*'mi-metrics-v[0-9]+'\)/);
    // calculation_window must also arrive explicitly (no lifetime fallback).
    expect(body).not.toMatch(/coalesce\([^,]+,\s*'lifetime'\)/);
  });

  it("record_market_fetch_result requires an explicit provider_selection_version", () => {
    const body =
      M22.match(
        /create or replace function public\.record_market_fetch_result[\s\S]*?end;\s*\$\$;/,
      )?.[0] ?? "";
    // The input validation branch lists provider_selection_version alongside
    // the other required fields.
    expect(body).toMatch(
      /nullif\(btrim\(p_input->>'provider_selection_version'\), ''\) is null/,
    );
    // The insert uses the value directly (no default fallback).
    expect(body).not.toMatch(/coalesce\([^,]+,\s*'mi-select-v[0-9]+'\)/);
  });
});

describe("MI1B.2 migration 0022 — metric JSON secret protection", () => {
  it("market_trade_metrics.json_value carries a no-secrets CHECK", () => {
    expect(M22).toContain("market_trade_metrics_json_no_secrets");
    // The CHECK spans several lines; give it room and match the
    // regex fragment characteristic of the shared secret vocabulary.
    expect(M22).toMatch(
      /market_trade_metrics_json_no_secrets[\s\S]{0,400}json_value is null[\s\S]{0,200}api\.\?key/,
    );
  });

  it("__write_market_metric calls the central secret guard on the json payload before persisting", () => {
    const body =
      M22.match(/create or replace function mdf\.__write_market_metric[\s\S]*?end;\s*\$\$;/)?.[0] ?? "";
    expect(body).toMatch(/perform mdf\.__market_reject_secrets\(p_json_value\)/);
  });

  it("__write_market_score also passes every caller-supplied JSON through the secret guard", () => {
    const body =
      M22.match(/create or replace function mdf\.__write_market_score[\s\S]*?end;\s*\$\$;/)?.[0] ?? "";
    expect(body).toMatch(/perform mdf\.__market_reject_secrets\(p_positive_reasons\)/);
    expect(body).toMatch(/perform mdf\.__market_reject_secrets\(p_negative_reasons\)/);
    expect(body).toMatch(/perform mdf\.__market_reject_secrets\(p_source_coverage\)/);
    expect(body).toMatch(/perform mdf\.__market_reject_secrets\(p_components\)/);
  });
});

describe("MI1B.2 migration 0022 — server-authoritative refresh + service_role isolation docs", () => {
  it("migration preface documents the browser-vs-server refresh authority contract", () => {
    expect(M22).toMatch(/browser-vs-server refresh authority/i);
    expect(M22).toMatch(/browser[\s\S]{0,80}supplies ONLY[\s\S]{0,40}operator intent/i);
    // Explicitly names the fields the browser must NEVER supply.
    for (const field of [
      "metric rows",
      "diagnostic_fit_score",
      "published_fit_score",
      "data_confidence_score",
      "recommendation_status",
      "score components",
      "provider_selection_version",
      "market_fit_version",
      "confidence_version",
      "calculation_version",
      "source_coverage",
    ]) {
      expect(M22).toContain(field);
    }
  });

  it("migration preface documents the MI1C service_role isolation requirements", () => {
    expect(M22).toMatch(/service_role isolation/i);
    expect(M22).toMatch(/server-only.*module boundary/i);
    expect(M22).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(M22).toMatch(/never be imported by client components/i);
    expect(M22).toMatch(/requireMdfSession\(\)/);
    expect(M22).toMatch(/never become a generic unrestricted repository/i);
  });
});

describe("MI1B migration 0022 — historical migrations untouched", () => {
  it("prior BF5A.1 / BF5B / BI1 / BI2 files still declare their wording", () => {
    const M18 = readFileSync(path.resolve(HERE, IMMUTABLE_MIGRATIONS[0]!), "utf8");
    const M19 = readFileSync(path.resolve(HERE, IMMUTABLE_MIGRATIONS[1]!), "utf8");
    const M20 = readFileSync(path.resolve(HERE, IMMUTABLE_MIGRATIONS[2]!), "utf8");
    const M21 = readFileSync(path.resolve(HERE, IMMUTABLE_MIGRATIONS[3]!), "utf8");
    expect(M18).toMatch(/security definer/);
    expect(M19).toMatch(/security definer/);
    expect(M20).toMatch(/buyer_intelligence_sources/);
    expect(M21).toMatch(/refresh_buyer_intelligence/);
  });
});
