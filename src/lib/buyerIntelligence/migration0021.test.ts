import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(path.resolve(process.cwd(), "supabase/migrations", name), "utf8");
const SQL = read("0021_buyer_intelligence_write_pipeline.sql");
const ACTIVE = SQL.replace(/--[^\n]*/g, "");
const sha = (value: string) => createHash("sha256").update(value).digest("hex").toUpperCase();

describe("BI2 migration 0021", () => {
  it("guards every applied migration byte-for-byte", () => {
    expect(sha(read("0018_buyer_finder_candidate_conversion.sql"))).toBe("E7DD2418C2BB93FCD6E8C2F90A2E2FF070609019468EB5AA47B1998557043200");
    expect(sha(read("0019_buyer_email_required_conversion.sql"))).toBe("1095537A7E71154EC683B0F457E602C48C85BA627D2657F54B353D66FFA3EB64");
    expect(sha(read("0020_buyer_intelligence_foundation.sql"))).toBe("4B95F56585C14692182EEC77224F6A55873B0BA84BD6C60C42487D76A5D6ED67");
  });

  it("creates only four narrow authenticated SECURITY DEFINER entry points", () => {
    for (const fn of ["refresh_buyer_intelligence", "ingest_buyer_intelligence_source", "ingest_buyer_intelligence_claim", "ingest_buyer_trade_observation"]) {
      expect(SQL).toMatch(new RegExp(`function public\\.${fn}\\([\\s\\S]{0,1200}security definer[\\s\\S]{0,120}search_path\\s*=\\s*public,\\s*mdf,\\s*pg_temp`, "i"));
      expect(SQL).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^;]+\\) to authenticated`, "i"));
      expect(SQL).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^;]+\\) from public,anon`, "i"));
    }
    expect(SQL.match(/create or replace function public\./g)).toHaveLength(4);
  });

  it("derives workspace from session context and exposes no workspace argument", () => {
    expect(SQL.match(/mdf\.current_workspace_id\(\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(SQL).not.toMatch(/function public\.[^(]+\([^)]*p_workspace_id/i);
    expect(SQL).toMatch(/where id=p_source_id and candidate_id=p_candidate_id and workspace_id=v_workspace_id/);
  });

  it("preserves SELECT-only BI1 table grants and denies anon", () => {
    expect(SQL).toMatch(/revoke all on public\.buyer_intelligence_sources,[\s\S]+from anon,authenticated,public/);
    expect(SQL).toMatch(/grant select on public\.buyer_intelligence_sources,[\s\S]+to authenticated/);
    expect(ACTIVE).not.toMatch(/grant\s+(insert|update|delete|all)[^;]*buyer_(intelligence|trade)[^;]*authenticated/i);
  });

  it("uses stable identity locks and explicit existing/conflict outcomes", () => {
    expect(SQL.match(/pg_advisory_xact_lock/g)?.length).toBeGreaterThanOrEqual(4);
    expect(SQL.match(/'outcome','existing'/g)).toHaveLength(3);
    expect(SQL.match(/'outcome','conflict'/g)).toHaveLength(3);
    expect(SQL.match(/'reason','material_mismatch'/g)).toHaveLength(3);
    expect(SQL).not.toMatch(/on conflict[^;]+do update[\s\S]{0,100}buyer_(intelligence_sources|intelligence_claims|trade_observations)/i);
  });

  it("refreshes normalized metrics and four versioned assessments atomically", () => {
    for (const metric of ["last_observed_trade", "trade_observation_count", "shipment_count", "activity_last_12_months", "india_observation_count", "india_shipment_count", "india_observation_share", "last_observed_india_trade", "origin_country_distribution", "supplier_count", "supplier_ranking"]) expect(SQL).toContain(`'${metric}'`);
    expect(SQL).toMatch(/on conflict \(workspace_id,candidate_id,metric_key,calculation_window\) do update/);
    expect(SQL).toMatch(/set superseded_at = p_calculated_at/);
    expect(SQL).not.toMatch(/delete\s+from\s+public\.buyer_intelligence_assessments/i);
    for (const type of ["buyer_legitimacy", "buyer_potential", "contact_access", "outreach_readiness"]) expect(SQL).toContain(`'${type}'`);
    expect(SQL).toMatch(/supporting evidence links required/);
    expect(read("0020_buyer_intelligence_foundation.sql")).toMatch(/create unique index if not exists buyer_intelligence_assessments_one_current_idx[\s\S]{0,180}where superseded_at is null/);
    expect(SQL).toMatch(/pg_advisory_xact_lock\(hashtextextended\(v_workspace_id::text \|\| ':' \|\| p_candidate_id::text/);
  });

  it("mirrors BF5B revealed-personal and public-email conversion readiness", () => {
    const readiness = SQL.slice(SQL.indexOf("select * into v_conversion"), SQL.indexOf("perform mdf.__write_bi_assessment", SQL.indexOf("select * into v_conversion")));
    expect(readiness).toMatch(/buyer_candidate_contacts[\s\S]*?workspace_id=v_workspace_id[\s\S]*?candidate_id=p_candidate_id[\s\S]*?revealed_at is not null[\s\S]*?email_type='personal'[\s\S]*?business_email\s*~\*/);
    expect(readiness).toMatch(/buyer_candidate_public_emails[\s\S]*?workspace_id=v_workspace_id[\s\S]*?candidate_id=p_candidate_id[\s\S]*?email\s*~\*/);
    expect(readiness).not.toMatch(/v_candidate\.general_email/);
    expect(read("0019_buyer_email_required_conversion.sql")).toMatch(/v_contact\.revealed_at is null[\s\S]*?v_contact\.email_type[\s\S]{0,40}<> 'personal'/);
  });

  it("persists support counts that match date and shipment-share formulas", () => {
    expect(SQL).toMatch(/'last_observed_trade','text',null,v_last::text,null,'date',v_dated_verified/);
    expect(SQL).toMatch(/count\(\*\) filter \(where evidence_level=1 and granularity in \('shipment','transaction'\) and trade_date is not null\)/);
    expect(SQL).toMatch(/'india_observation_share','number',[\s\S]{0,160}'ratio',v_known_origin/);
    expect(SQL).toMatch(/v_india_shipments::numeric\/v_known_origin/);
  });

  it("uses provider independence and Candidate-scoped evidence insertion", () => {
    expect(SQL).toMatch(/count\(distinct s\.provider_id\)/);
    expect(SQL).toMatch(/workspace_id, candidate_id, assessment_id, component_key/);
    expect(SQL).toMatch(/p_workspace_id, p_candidate_id, v_id/);
    expect(SQL).toMatch(/source not owned by candidate/);
  });

  it("does not create Buyers, convert Candidates, mutate campaigns, or contact providers", () => {
    expect(ACTIVE).not.toMatch(/insert\s+into\s+public\.(buyers|buyer_finder_candidate_conversions|campaigns|campaign_recipients)/i);
    expect(ACTIVE).not.toMatch(/update\s+public\.(buyers|buyer_candidates|campaigns|campaign_recipients)/i);
    expect(ACTIVE).not.toMatch(/hunter\.io|gmail|linkedin|volza|importyeti|comtrade|net\.http|http_get|http_post|https?:\/\//i);
  });
});
