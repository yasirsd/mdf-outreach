# Buyer Intelligence BI1 implementation

Status: complete and live-verified. `0020_buyer_intelligence_foundation.sql` is applied; its six tables have RLS, authenticated SELECT-only access, anon denial, and a verified empty initial state. BI1 performed no provider ingestion.

## Foundation schema

BI1 adds exactly six Candidate-owned, workspace-scoped concepts:

| Table | Responsibility |
| --- | --- |
| `buyer_intelligence_sources` | Safe provenance envelope for one provider/document retrieval; no credentials or raw authorization material. |
| `buyer_intelligence_claims` | Source-linked non-trade facts with separate raw and normalized values. |
| `buyer_trade_observations` | Source-linked shipment, transaction, aggregate, relationship, company-claim, or directory-signal records. Missing fields remain null. |
| `buyer_trade_metrics` | Rebuildable normalized metric rows: one controlled key and exactly one typed value per Candidate/calculation window. |
| `buyer_intelligence_assessments` | Versioned, explainable legitimacy, potential, contact-access, or readiness results. |
| `buyer_intelligence_assessment_evidence` | Component-level links to exactly one claim, observation, or metric. |

All six tables contain `workspace_id` and `candidate_id`. Source/fact relationships use `(id, candidate_id, workspace_id)` foreign keys. Assessment evidence also carries `candidate_id` and uses that triple for the assessment and every evidence target, preventing same-workspace cross-Candidate linkage.

The assessment-evidence candidate key and normalized metric rows are approved integrity/extensibility corrections found during BI1 implementation. They are also recorded in the BI0 architecture document.

## Evidence and data semantics

The controlled evidence mapping is Level 1 `verified_trade_evidence`, Level 2 `business_evidence`, and Level 3 `discovery_signal`. Database checks and TypeScript constants share this vocabulary. Shipment and transaction rows must be Level 1; company claims are Level 2; directory signals are Level 3.

Origin and destination are separate nullable fields. The Candidate’s country is profile context and is never copied into either observation field. Raw product description, normalized category, raw HS code, and optional MDF business-product id remain separate. The optional MDF id is validated against the existing application catalogue. Supplier summaries are calculated from observations rather than maintained as a second source of truth.

Source deduplication uses `(workspace_id, candidate_id, provider_id, source_key)`. Claim identity uses `(source_id, source_record_ref, claim_type)` and observation identity uses `(source_id, source_record_ref)`, so retrieving one source again is idempotent without merging distinct source records or preventing one source record from supporting several claim types.

## Normalized metrics and deterministic calculations

Each metric row stores `metric_key`, `value_type`, one of `numeric_value` / `text_value` / `structured_value`, `unit`, `calculation_window`, optional window bounds, `supporting_observation_count`, optional observation watermark, `calculated_at`, and `calculation_version`.

The BI1 basic calculator derives last observed trade, observation count, shipment count, India observation/shipment counts, India shipment share, last India trade, origin distribution, and supplier ranking. A shipment count includes only Level 1 rows whose granularity is `shipment`. The already-applied metric key `india_observation_share` uses that same shipment basis: verified Level 1 India-origin shipments divided by verified Level 1 shipments with known origin. Transactions remain eligible for `india_observation_count` and last India trade but are excluded from this ratio. India results use actual observation origin `IN`; product relevance, Candidate country, website claims, and directory signals cannot establish India sourcing. Missing shipment origin produces no share rather than a fabricated zero-evidence interpretation.

The conservative legitimacy calculator returns an explanation and evidence ids:

- `verified`: at least one Level 1 shipment/transaction;
- `strong_evidence`: Level 2 evidence from at least two independent sources;
- `moderate_evidence`: Level 2 evidence from one source;
- `weak_signal`: Level 3 evidence only;
- `no_evidence_found`: no eligible evidence.

Contact access is evaluated independently as company-only, public route, named contact, direct contact, or historically credit-enriched contact. `company_only` is intelligence vocabulary only and does not permit Buyer conversion.

## Repositories and pagination

The six provider-neutral read contracts live in the existing repository interface module. Their Supabase implementations are constructed with a server-resolved workspace id; callers provide only entity ids and filters. The Candidate detail loader reads sources, claims, the first trade page, metrics, and assessments. During staged deployment it converts only a recognized missing-BI1-table/schema-cache response to an empty BI view; all other errors remain visible.

Trade history uses database keyset pagination ordered by `trade_date DESC NULLS LAST, id DESC`. The opaque cursor contains only those database ordering keys, never provider pagination state. The default page size is 25 and the hard maximum is 100. Filters cover granularity, evidence type, origin, destination, HS code, normalized product, canonical MDF product, and normalized supplier.

## Read-only UI

Candidate detail contains Overview, Trade Intelligence, and Sources tabs. Overview shows only supported legitimacy, contact access, last trade, verified shipment count, India sourcing, and evidence counts. Trade Intelligence shows summary fields and recent observation data. Sources exposes provider, source type, evidence class/level, retrieval/observation dates, safe reference, and safe HTTP(S) link; internal source keys and metadata are not sent in the view model.

With no BI rows the page says “No verified trade intelligence yet.” It does not turn Buyer Finder discovery evidence into trade proof. The UI has no mutation or provider-call control.

## RLS, grants, and retention

Migration 0020 applies `mdf.__apply_workspace_rls` to every table, revokes all access from `anon`, `authenticated`, and `public`, then grants only `SELECT` to `authenticated`. Normal UI reads need no service role and accept no client-supplied workspace authority.

Candidate/source/evidence foreign keys use `ON DELETE RESTRICT` to make research difficult to destroy accidentally. Deleting an assessment cascades only its derived evidence-link rows. Source/claim/link rows are treated as immutable; observations, metrics, and assessments use the established `updated_at` trigger.

## Historical read-only preflight plan used for 0020

This is retained as historical deployment documentation. Migration 0020 has since been applied and live-verified.

```sql
begin transaction read only;

select version
from supabase_migrations.schema_migrations
where version in ('0018', '0019', '0020')
order by version;

select target.table_name, to_regclass('public.' || target.table_name) as existing_relation
from (values
  ('buyer_intelligence_sources'),
  ('buyer_intelligence_claims'),
  ('buyer_trade_observations'),
  ('buyer_trade_metrics'),
  ('buyer_intelligence_assessments'),
  ('buyer_intelligence_assessment_evidence')
) as target(table_name);

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.buyer_candidates'::regclass
  and contype in ('p', 'u')
order by conname;

select n.nspname as function_schema, p.proname, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'mdf'
  and p.proname in ('__apply_workspace_rls', 'current_workspace_id')
order by p.proname;

select n.nspname as function_schema, p.proname, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'set_updated_at';

rollback;
```

Expected review: 0018 and 0019 are present, 0020 is absent, all six target relations are absent (or an existing relation triggers a stop-and-investigate), `buyer_candidates` supports `(id, workspace_id)`, and the RLS/workspace/updated-at helpers exist with the signatures used by the migration. Do not proceed on any mismatch.

The completed live verification confirmed the six relations, enabled RLS, authenticated SELECT-only privileges, anon denial, zero initial intelligence rows, and unchanged Buyer/conversion counts. BI2 treats 0020 as immutable.

## Future provider boundary

No provider adapter exists in BI1. A later phase may add one reviewed, lawful, server-only, free/public or explicitly authorized adapter. It must return normalized envelopes, preserve retrieval provenance, respect source and observation identity separately, and never fall through automatically to paid providers. Market-level datasets must use a physically separate future model and cannot support Candidate assessments without company-specific evidence.
