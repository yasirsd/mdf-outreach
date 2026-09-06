# Buyer Intelligence BI2 implementation

Status: complete in the repository. Migration `0021_buyer_intelligence_write_pipeline.sql` is authored and tested but **not applied**. BI2 used controlled local/test inputs only and made no live Supabase or external-provider calls.

## Write authority

MDF already uses authenticated, narrow `SECURITY DEFINER` RPCs for operations that must be transactional. BI2 follows that pattern rather than adding a service-role secret to the application. The six BI1 tables remain RLS-protected and `SELECT`-only for `authenticated`; `anon` and `public` retain no table access.

0021 exposes exactly four authenticated entry points: source ingestion, claim ingestion, trade-observation ingestion, and complete derived-state refresh. Each has a fixed `search_path`, derives the workspace through `mdf.current_workspace_id()`, validates Candidate/source ownership, and accepts no workspace argument. There is no arbitrary table/payload writer. An internal assessment versioning helper is ungranted.

This is a narrow authenticated application authority, not a browser data-entry feature. No raw-write UI exists. Future provider adapters must remain server-side and call these contracts only after their own lawful-access and normalization checks.

## Ingestion and replay contracts

Source ingestion validates the Candidate, controlled access/cost classes, bounded fields, retrieval/observation timestamps, safe HTTP(S) URL, and object metadata. TypeScript recursively removes secret-shaped metadata keys and sensitive URL parameters. SQL independently rejects secret-shaped metadata, credential-bearing URLs, and sensitive URL parameters. Credentials, cookies, authorization material, signed queries, and provider payload archives are forbidden.

Claims preserve `raw_value` and `normalized_value` independently and validate controlled claim/evidence/confidence vocabulary. Observations preserve every raw/normalized field independently, validate evidence/granularity mapping, country/currency shapes, nonnegative values, period order, and the canonical MDF product whitelist. Candidate country is never an observation fallback.

Identity remains the BI1 rule:

- source: workspace + Candidate + provider + source key;
- claim: source + source record reference + claim type;
- observation: source + source record reference.

An exact replay returns `{ outcome: "existing", id }`. Retrieval time is non-material, so retrieving the same fact later does not duplicate it. If any material value under the identity differs, ingestion returns `{ outcome: "conflict", id, reason: "material_mismatch" }`; existing evidence is not overwritten. A future correction workflow should append an explicitly versioned replacement/correction relationship after human/provider-specific policy is designed, never silently mutate historical evidence.

Advisory transaction locks serialize each ingestion identity. Claim/observation creation invokes refresh inside the same database transaction. Any validation, metric, assessment, or evidence-link failure rolls the complete operation back.

## Deterministic calculations

Only Level 1 `shipment`/`transaction` observations are verified trade. `shipment_count` is narrower: Level 1 `shipment` only. India metrics require the actual `origin_country_code='IN'`. Company claims, directory signals, Candidate country, and market data never contribute.

The `bi2-metrics-v1` lifetime calculation persists normalized typed rows for last observed trade, all observation count, verified shipment count, trailing-365-day verified activity, India observation/shipment count, India share among verified shipments with known origin, last India trade, origin distribution, distinct supplier count, and supplier ranking. The historical key `india_observation_share` is explicitly shipment-based: verified Level 1 India-origin shipments divided by verified Level 1 shipments with known origin; transactions are excluded from this ratio but remain eligible for `india_observation_count` and last India trade. Each metric support count is the number of observations actually participating in its formula—for example, dated verified shipments/transactions for last observed trade and known-origin verified shipments for the India share. Each row also carries unit, calculation window, observation watermark, calculation timestamp, and version. Metric IDs remain stable through the existing four-part upsert key. Metrics are rebuildable projections, never primary evidence.

Legitimacy (`bi2-legitimacy-v1`) remains conservative. Verified requires linked Level 1 trade evidence. Strong requires Level 2 evidence from at least two distinct provider identities—not two rows or source envelopes from one provider. Moderate requires one qualifying provider; weak means Level 3 only; no evidence means nothing qualifying.

Buyer potential (`bi2-potential-v1`) is separate. No verified trade yields `insufficient_evidence`. High requires an authoritative MDF product match plus recent or India-origin verified activity. Medium requires another supported product/HS, recency, or India factor. Otherwise verified but currently unsupported relevance is low. Components and observation links explain every result.

Contact access (`bi2-contact-access-v1`) takes the highest supported state: historical Hunter personal reveal with usable persisted email, other usable direct email, named person, usable public company route, or company only. It never spends credits and never changes conversion eligibility.

Readiness (`bi2-readiness-v1`) mirrors BF5B. Conversion is authoritative even though BF5 archives the retained Candidate research row: a valid unsuppressed linked Buyer is ready for outreach; suppression is suppression. Before conversion, rejected/archived is not eligible and unapproved needs review. An approved Candidate is ready for conversion only with either a Candidate/workspace-scoped usable public-company email or a usable contact email whose persisted row has `revealed_at` and `email_type='personal'`. An ordinary direct-contact email may still produce `direct_contact`, but does not create conversion readiness. Candidate `general_email`, named contacts, and company-only intelligence do not bypass BF5B. Actual sending remains independently disabled.

## Assessment evidence and versioning

Refresh creates explicit component links to supporting claims or observations. Verified/Strong legitimacy cannot be inserted without durable links. Buyer-potential factor components link to their qualifying observations. Contact and readiness depend on existing lifecycle/contact tables outside the BI1 polymorphic evidence targets, so their components intentionally have no fabricated BI links.

The BI1 Candidate-scoped composite foreign keys remain authoritative: assessment, claim, observation, and metric IDs in a link must all share its Candidate and workspace. A Candidate A assessment cannot reference Candidate B evidence.

One Candidate advisory lock serializes parallel refreshes. If classification, summary, components, calculation version, and evidence-link set are unchanged, the current assessment is reused. Otherwise the current row is marked superseded, a new current row and all links are inserted, and old rows/links remain. The BI1 partial unique index independently enforces one current assessment per Candidate/type.

## Read model and projections

Candidate detail now loads current assessment evidence links and prefers persisted metrics and all four persisted assessments. Safe deterministic calculation remains a staged-deployment fallback only. The Overview displays legitimacy, potential, contact access, readiness, and verified trade facts. Trade Intelligence adds persisted origin distribution plus page-derived supplier/product summaries. When a next cursor exists, the UI explicitly says those two projections reflect only the loaded page.

Supplier projection groups observations by normalized/raw supplier name and reports country, first/last observed dates, verified shipment count, and product overlap. Product projection groups by MDF id, then normalized category, HS code, or raw description, retaining all available raw descriptions, normalized categories, MDF matches, HS codes, bounds, and verified shipment count. Neither creates a new truth table.

Zero evidence still displays Buyer legitimacy “No evidence found” and “No verified trade intelligence yet.” Zero metric values are not presented as proof of zero imports.

## Exact read-only preflight for 0021

Do not apply 0021 from the application. Before a separately authorized operator applies it, run this exact read-only preflight against the intended database and stop on any mismatch:

```sql
begin transaction read only;

select version
from supabase_migrations.schema_migrations
where version in ('0018', '0019', '0020', '0021')
order by version;

select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select,
       has_table_privilege('authenticated', c.oid, 'INSERT') as authenticated_insert,
       has_table_privilege('authenticated', c.oid, 'UPDATE') as authenticated_update,
       has_table_privilege('authenticated', c.oid, 'DELETE') as authenticated_delete,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'buyer_intelligence_sources',
    'buyer_intelligence_claims',
    'buyer_trade_observations',
    'buyer_trade_metrics',
    'buyer_intelligence_assessments',
    'buyer_intelligence_assessment_evidence'
  )
order by c.relname;

select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'buyer_candidate_contacts'
      and column_name in ('candidate_id', 'workspace_id', 'business_email', 'revealed_at', 'email_type'))
    or (table_name = 'buyer_candidate_public_emails'
      and column_name in ('candidate_id', 'workspace_id', 'email'))
  )
order by table_name, column_name;

select pg_get_functiondef(
  'public.convert_buyer_finder_candidate(uuid,text,uuid,uuid,uuid)'::regprocedure
) as applied_bf5b_conversion_authority;

select n.nspname as function_schema,
       p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       p.proconfig as function_config,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       exists (
         select 1
         from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
         where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
       ) as public_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'public' and p.proname in (
  'refresh_buyer_intelligence',
  'ingest_buyer_intelligence_source',
  'ingest_buyer_intelligence_claim',
  'ingest_buyer_trade_observation'
)) or (n.nspname = 'mdf' and p.proname = '__write_bi_assessment')
order by n.nspname, p.proname;

select count(*)::bigint as buyers_before from public.buyers;
select count(*)::bigint as conversions_before from public.buyer_finder_candidate_conversions;
select
  count(*) filter (where qualifying_revealed_personal) as qualifying_revealed_personal_candidates,
  count(*) filter (where qualifying_public_email) as qualifying_public_email_candidates,
  count(*) filter (
    where ordinary_contact_email
      and not qualifying_revealed_personal
      and not qualifying_public_email
  ) as ordinary_contact_only_candidates,
  count(*) filter (
    where candidate_general_email
      and not qualifying_revealed_personal
      and not qualifying_public_email
  ) as general_email_only_candidates
from (
  select c.id,
    exists (
      select 1 from public.buyer_candidate_contacts cc
      where cc.workspace_id = c.workspace_id
        and cc.candidate_id = c.id
        and cc.revealed_at is not null
        and cc.email_type = 'personal'
        and cc.business_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    ) as qualifying_revealed_personal,
    exists (
      select 1 from public.buyer_candidate_public_emails pe
      where pe.workspace_id = c.workspace_id
        and pe.candidate_id = c.id
        and pe.email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    ) as qualifying_public_email,
    exists (
      select 1 from public.buyer_candidate_contacts cc
      where cc.workspace_id = c.workspace_id
        and cc.candidate_id = c.id
        and cc.business_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    ) as ordinary_contact_email,
    c.general_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      as candidate_general_email
  from public.buyer_candidates c
  where c.review_status = 'approved'
    and c.discovery_status <> 'archived'
    and not exists (
      select 1 from public.buyer_finder_candidate_conversions cv
      where cv.workspace_id = c.workspace_id and cv.candidate_id = c.id
    )
) readiness_preflight;
select 'buyer_intelligence_sources' as relation, count(*)::bigint from public.buyer_intelligence_sources
union all select 'buyer_intelligence_claims', count(*)::bigint from public.buyer_intelligence_claims
union all select 'buyer_trade_observations', count(*)::bigint from public.buyer_trade_observations
union all select 'buyer_trade_metrics', count(*)::bigint from public.buyer_trade_metrics
union all select 'buyer_intelligence_assessments', count(*)::bigint from public.buyer_intelligence_assessments
union all select 'buyer_intelligence_assessment_evidence', count(*)::bigint from public.buyer_intelligence_assessment_evidence;

rollback;
```

Expected before application: 0018/0019/0020 present and 0021 absent; all six tables have RLS, authenticated SELECT true and INSERT/UPDATE/DELETE false, anon SELECT false; none of the four public BI2 RPCs or internal helper already exists. Confirm the BF5B contact/public-email columns and inspect the applied conversion function for the revealed-personal gates. Record readiness cohorts, Buyer, conversion, and BI row counts for post-application comparison. Ordinary-contact-only and general-email-only cohorts are expected to remain `needs_contact`; they are not migration blockers. Any missing column, unexpected function, or privilege mismatch requires review before application.

## Future provider boundary

BI2 integrates no provider. BI3 may evaluate one lawful free/public or explicitly authorized provider adapter with manual invocation, safe outcomes, rate limits, provenance completeness, and no automatic paid fallback. It should not change the evidence model, accept caller workspace authority, scrape LinkedIn, or conflate market-level data with company evidence.
