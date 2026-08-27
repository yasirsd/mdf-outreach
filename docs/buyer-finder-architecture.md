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

## Phase 5A (Hunter Discover company provider)

First **real** company-discovery adapter. **Not wired to the UI, ingestion routes, or Supabase.**

Hunter Discover (`POST https://api.hunter.io/v2/discover`) is used because it supports explicit filters (headquarters country + keywords) and the Discover call is currently free. We do **not** use Hunter’s natural-language `query`, `company_type`, `industry.include`, `limit`/`offset`, Domain Search, Email Finder, or Email Verifier.

**Query construction** (`providers/hunter/query.ts`):

- Country names/aliases resolve to ISO 3166-1 alpha-2 via the existing catalogue helpers (`Thailand` → `TH`, `UAE` → `AE`). Wrapper only; catalogue is not modified.
- Existing MDF `ProductKey` maps to search keywords only (not a second product identity).
- MDF Importer / Distributor / Wholesaler become keywords (`importer`, `distribution`, …). They are **never** sent as Hunter `company_type` (that field means privately held / nonprofit / etc.).
- Free-text `industry` is appended as a keyword. Hunter `industry.include` is not sent (invalid values 400).
- `keywords.match` is `"any"` so we do not require every product keyword AND every buyer-type keyword at once.

**Provider** (`HunterCompanyDiscoveryProvider`): API key injected in the constructor (never `process.env`). Sent as `X-API-KEY` only (not `Authorization`, never `?api_key=`). `fetchImpl` is injectable so Vitest makes **zero** Hunter requests. 15s `AbortController` timeout. HTTP 400/401/403/429/5xx map to typed `HunterDiscoveryError` codes; messages redact the key.

**Mapping:** Hunter `organization` + `domain` → `DiscoveredCompany`. Country is the validated search country. `source: "hunter"`. `isImporter` / `isDistributor` stay **unset** — a keyword hit is not proof the company imports or distributes MDF products. Evidence notes a directory match only.

Local `query.limit` slices the response; Hunter is not sent premium limit/offset.

No contact enrichment. No server actions. No migration changes.

## Phase 5B (one controlled Hunter Discover live test + usage meter)

Developer-only quality check: Thailand + `guntur-chilli` + Importer keywords, `limit` 10 applied locally. Gated by `HUNTER_LIVE_TEST=1` and a session `HUNTER_API_KEY` inside `companyDiscovery.live.test.ts` only. Ordinary `npm test` skips it.

**Live budget:** one `POST /v2/discover` + one `GET /v2/usage` (usage is documented free / 0 credits). No Domain Search, Email Finder, Email Verifier, enrichment, `/account`, `/usage/history`, ingestion, or retries.

**Usage meter (UI):** Buyer Finder header shows a compact Hunter remaining-quota indicator. Click opens the existing `Modal` with plan buckets, reset date, and free Discover vs credit-consuming guidance. The browser still uses **mock** quota data (`src/lib/buyerFinder/mock/usage.ts`). The real `HunterUsageProvider` is server-only, constructor-injected, `X-API-KEY` only. No API key in the browser. Refresh is disabled until the server boundary is wired.

## Phase 5C (Hunter Discover keyword quality)

Generic `"import"` / `"importer"` tokens pulled banks, logistics, and machinery. Query construction now distinguishes **product-led**, **food-trade**, and **hybrid** keyword sets. Standalone rejected tokens: import, importer, export, exporter, logistics, freight. ProductKey remains `guntur-chilli`. MDF buyer types are not Hunter `company_type` and no longer inject generic import keywords. `isImporter` / `isDistributor` stay unset. Mock usage UI now shows unified + search + verification buckets together. Live experiments are gated in `queryExperiments.live.test.ts`. No UI → Hunter wiring.

## Later phases (not started)

Phase 5D+ UI/server wiring and approval. Contact waterfall separate. Never LinkedIn scrape.
