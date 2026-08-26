# Buyer Finder architecture

Buyer Finder is an **isolated, additive** module. It does not replace Buyers, Campaigns, Templates, or email sending.

This document records the approved architecture. **Phase 1 implements UI + mock data only.** No database, providers, or Buyer writes exist yet.

## Purpose

Find potential importer / distributor companies, enrich contacts, score them, and put them in a **review queue**. A discovered company is **not** an MDF Buyer until a human explicitly approves it.

Intended flow (later phases):

Target country + product → find companies → enrich → find decision-makers → verify contact → score → review → **approve** → existing Buyers workflow.

## Isolation

Buyer Finder must not write to:

- `buyers` (except later, via a single `approveCandidateAction` that uses the existing Buyer repository)
- campaigns, campaign recipients, templates, email assets, Gmail, workspace settings

`/buyer-finder` lives under the protected `(app)` layout. It is not a public route. Middleware and `PUBLIC_ROUTES` are not changed.

## Data model (TypeScript now; database later)

**One candidate = one company.** Do not duplicate a company because it matches more than one product.

**Contacts** are a list on the candidate. One contact may be marked primary. Multiple titles (Procurement, Import, Managing Director, Owner, …) are expected.

**Product matches** are a list on the candidate. `productKey` uses the existing MDF `ProductKey` vocabulary (`guntur-chilli`, `banganapalli-mango`, `pomegranate`, `indian-apple`).

**LinkedIn:** store URLs only. Render as `Open LinkedIn ↗`. Automated LinkedIn scraping, browser automation, and LinkedIn APIs are prohibited.

## Status (later phases)

Two axes:

- `discoveryStatus`: `new` | `enriching` | `ready` | `archived`
- `reviewStatus`: `pending` | `approved` | `rejected` | `needs_another_contact`

Approval (later) is allowed only when `discoveryStatus === "ready"` **and** `reviewStatus === "pending"`, with a primary contact and at least one product match.

## Phase 1

- Navigation entry + `/buyer-finder` UI
- Search and review queue against **local mock data**
- Candidate detail
- Approve disabled; Reject is a UI toast only
- No server actions, APIs, env vars, or providers

## Phase 2 (persistence foundation — not wired to UI)

Additive migration `0010_buyer_finder_foundation.sql` defines:

- `buyer_candidates` (one company)
- `buyer_candidate_contacts` (people; composite FK on `(candidate_id, workspace_id)`)
- `buyer_candidate_product_matches` (MDF `ProductKey` per company)

RLS uses existing `mdf.__apply_workspace_rls()`. Repositories are workspace-pinned. **The Phase 1 UI still reads mock data.** No approve action. No writes to `buyers`.

## Phase 3 (deterministic scoring + duplicate detection)

Pure TypeScript in `src/lib/buyerFinder/scoring.ts` and `src/lib/buyerFinder/dedupe.ts`. No persistence, no UI wiring, no providers.

**Scoring** (`scoreBuyerCandidate`) is deterministic and explainable. Same input always yields the same `BuyerScoreResult`:

- `companyFit` (max 45) — strongest or targeted product relevance (not a sum of matches), importer/distributor flags, buyer type, country match, industry
- `contactQuality` (max 40) — best single contact (multiple people do not stack), role tier, email presence/status/confidence, LinkedIn URL, primary-contact flag
- `completeness` (max 15) — website, domain, city, evidence, extra product matches, source
- `reasons[]` — each awarded signal with code, label, points, category
- total is clamped 0–100 and equals the three category totals

Role ranking is phrase-based (case-insensitive): procurement/purchasing/import/sourcing titles are strongest; Managing Director / GM are useful; Owner / Founder / Director remain useful. Invalid email awards zero email-quality points and does **not** zero the company score.

Scores are returned only. They are not written to Supabase in this phase.

**Duplicates** (`findBuyerDuplicates`, `findCandidateDuplicates`) return findings only. Nothing is merged, linked, approved, or deleted.

Confidence:

- `exact` — same normalized business email (any contact or `generalEmail`, trim + lowercase)
- `high` — same corporate domain, or same normalized company name **and** country
- `possible` — same normalized company name but different/missing country
- `none` — no signal

Corporate-domain matching uses `normalizeDomain` (URL variants such as `https://www.example.com/` collapse to `example.com`). **Public mailbox domains** (`gmail.com`, `outlook.com`, `yahoo.com`, `hotmail.com`, `icloud.com`, `proton.me`, and similar) are excluded via `isPublicEmailDomain`. Two different Gmail addresses are not a company duplicate; the same Gmail address is still an exact person-level email match.

Company-name comparison lowercases, strips punctuation, treats `&` as `and`, and drops trailing legal suffixes (`ltd`, `limited`, `co`, `company`, …). No Levenshtein, no AI.

Existing `Buyer[]` may be passed in. Deduping must not call `repos.buyers.list()`.

## Phase 4 (mock providers + server-only ingestion)

Machinery only. **Not wired to the UI.** No server actions, API routes, or Supabase execution.

**Providers** (`src/lib/buyerFinder/providers/`):

- `CompanyDiscoveryProvider.discover(query)` — country, existing MDF `productKey`, optional buyer types / industry / limit
- `ContactEnrichmentProvider.findContacts({ company, roles })` — returns people; scoring still chooses the primary
- Mock implementations are static `.example` data (Thailand + UAE, multiple product keys). No network, no `Math.random()`, no env keys
- Email verification provider was **not** added; mock contacts already carry deterministic `emailStatus`

**Ingestion** (`discoverAndIngestCandidates` in `ingestion.ts`, `import "server-only"`):

Query → mock discovery → validate/normalize → mock contact enrichment → candidate-to-candidate dedupe → product match → Phase 3 `scoreBuyerCandidate()` → injected Buyer Finder repositories only (`candidates`, `contacts`, `productMatches`).

Does **not** call `serverRepositories()`, create Supabase, or touch Buyers/Campaigns/Gmail. Optional `existingBuyers` array is analysis-only.

**Idempotency:** exact/high duplicate (domain, email, or name+country) skips a new company row and may additively fill missing city/website, extra contacts, or a **new** product key. Same chilli search twice → same companies, not doubles. Chilli then mango on Siam Spice → one company, two product matches.

**Possible** duplicates are reported, never auto-merged.

**Batch result:** `discovered`, `created`, `enrichedExisting`, `skippedExactDuplicates`, `possibleDuplicates`, `contactsAdded`, `productMatchesAdded`, `failures[]`. One bad company or contact-enrichment error does not abort the rest. Invalid `ProductKey` fails before discovery.

Phase 1 UI still reads `src/lib/buyerFinder/mock/candidates.ts`.

## Later phases (not started)

Phase 5 `approveCandidateAction()` calling existing `repos.buyers.create()`. Real providers after review. Never LinkedIn scrape.
