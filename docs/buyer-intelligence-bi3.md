# Buyer Intelligence BI3 — Free public company website research

Status: implemented locally against the applied BI0 / BI1 / BI2 stack.
No new migration. No live provider or Supabase call.

BI3 makes the first real Buyer Intelligence ingestion source: the
Candidate company's own public website. It is manually triggered by an
operator on the Candidate detail page — "Research company website ·
Free" — and produces Level-2 `business_evidence` claims through the
existing narrow BI2 write RPCs. It never creates trade observations,
never touches Buyers, and never talks to a paid provider.

## Boundaries

BI3 respects every permanent MDF rule reasserted at BI2:

- Candidate ≠ Buyer. BI3 does not approve, convert, or send anything.
- Email is mandatory for Buyer creation. BI3 changes nothing about
  BF5B eligibility; a Candidate without a usable email stays a
  research record.
- FREE-FIRST. BI3 uses only the Candidate's own public HTML pages.
  No paid API, LinkedIn, Google search, Hunter, or trade-data vendor.
- Missing data remains missing. BI3 records claims only when the
  page text actually supports them; every claim carries a verbatim
  excerpt so an operator can inspect the wording.
- Market-level data ≠ company-specific evidence. Level-2 business
  evidence never counts as verified trade evidence and never affects
  the Trade Intelligence tab.

Applied migrations 0018–0021 remain immutable. BI3 requires no schema
change; the `claim_type` values it emits (`company_is_importer`,
`company_is_distributor`, `imports_product`, `website_business_description`)
are already in migration 0020's CHECK constraint, and the source /
claim shape is enforced by the existing narrow SQL RPCs in 0021.

## Manual workflow

```
Candidate detail
    │
    ▼
"Research company website · Free"   (manual click; per-process lock)
    │
    ▼
Server action: researchCandidateWebsiteAction(candidateId)
    │
    │  requireMdfSession()  · workspace resolved server-side
    │  serverRepositories() · workspace-scoped
    │
    ▼
planWebsiteResearch({ candidate })
    │
    │  Fetches homepage + ranked internal pages via
    │  fetchSafeHtmlPage (BF3A.5 pinned SSRF-safe path)
    │  Bounded time / bytes / redirects / same-domain / robots.txt
    │
    ▼
Per qualifying page: extractBusinessClaims()  (deterministic, source-grounded)
    │
    ▼
buyerIntelligenceWriter.ingestSource(...)  · one row per contributing page
buyerIntelligenceWriter.ingestClaim(...)   · Level-2 business claims
    │
    ▼
BI2 SQL RPC triggers refresh_buyer_intelligence(candidate_id)
    │
    ▼
Buyer Intelligence panel refreshes from persisted assessments
```

## Fetch envelope (reused, unmodified)

Reused from the existing free public-company-contact stack in
`src/lib/buyerFinder/providers/publicWebsite/`:

- `defaultPinnedFetch` — TCP pinned to publicly-validated addresses;
  TLS SNI / Host stay on the original hostname.
- `assertSafeFetchUrl` / `parsePublicHttpUrl` — reject non-http(s),
  loopback, private / link-local / metadata addresses, and
  credential-bearing URLs.
- `fetchSafeHtmlPage` — bounded body (`PUBLIC_WEBSITE_MAX_BODY_BYTES`,
  1 MB), bounded redirects (`PUBLIC_WEBSITE_MAX_REDIRECTS`), timeout
  (`PUBLIC_WEBSITE_TIMEOUT_MS`, 8s per hop), 20-second total budget
  (`PUBLIC_WEBSITE_TOTAL_BUDGET_MS`), HTML/XHTML content-type gate,
  binary sniff, challenge-page detection.
- `pathAllowedByRobots` + `PUBLIC_WEBSITE_USER_AGENT` — honours
  `robots.txt` for internal pages.
- `isSameCompanySite` — only same registrable-domain links are
  followed.

BI3 adds one small orchestrator, `planWebsiteResearch`, which picks
the pages (homepage + up to `BI3_MAX_PAGES = 6` ranked same-site pages)
and returns a sanitized plan. PDF and other non-HTML content types
are out of scope for BI3.

## Page selection rules

Homepage first (candidate `website` or fallback `https://<domain>/`).
Then internal same-domain links classified by URL / anchor text:

| Kind      | Signals                                            |
| --------- | -------------------------------------------------- |
| `about`   | `/about`, `/about-us`, "About us", "Our story"     |
| `company` | `/company`, `/corporate`, "Company", "Corporate"   |
| `products`| `/products`, `/catalogue`, "Product catalogue"     |
| `services`| `/services`, `/what-we-do`, "Services"             |
| `contact` | `/contact`, `/get-in-touch`, "Contact us"          |

Preferred discovery order: about / company → products → services →
contact. Non-matching links are ignored. External links are never
followed. Robots.txt is honoured for the internal pages fetched.

## Evidence classification

Every BI3 claim is Level 2 `business_evidence` — the same class BI2
already uses for company-side directory or self-declared facts. BI3
never produces `verified_trade_evidence` (Level 1). Website copy
about the company cannot verify a shipment, a supplier, or an
India-origin trade record.

Because all BI3 pages share `provider_id = "company_website"`, a
Candidate with many website pages still counts as **one independent
Level-2 provider** under the BI2 legitimacy independence rule. Two
independent providers require a second, distinct provider (a future
BI4 source), not more pages of the same site.

## Supported claim types

BI3 only emits claim types already accepted by migration 0020:

- `website_business_description` — Meta description or the first
  headline + paragraph combined, ≤ 320 chars, deduplicated by
  page identity.
- `company_is_importer` — Fires when a candidate sentence matches an
  explicit importer phrase (`"we are (a|an) importer"`,
  `"we import <phrase>"`, `"leading importer of <phrase>"`,
  `"importers of <phrase>"`, `"importers and distributors of <phrase>"`).
- `company_is_distributor` — Analogous distributor phrases (
  `"we are (a|an) (authorised)? distributor"`, `"we distribute <phrase>"`,
  `"leading distributor of <phrase>"`, `"wholesale distributor of <phrase>"`,
  `"distributors and importers of <phrase>"`).
- `imports_product` — Only fires when a first-person import phrase
  (`"we import"` or `"importers? of"`) AND a canonical MDF product
  mention (`Guntur Dry Red Chilli`, `Banganapalli Mango`, `Indian
  Pomegranate`, `Indian Apples`, or their catalogue short names)
  co-occur in the same visible sentence. Never inferred from a
  product catalogue listing alone.

Confidence is `medium` for description / importer / distributor,
`low` for `imports_product`. Every claim carries a verbatim excerpt
in `raw_value.excerpt` so the Sources tab can display the exact
wording that supported it.

## Explicit non-claims

BI3 does **not** create:

- Any `buyer_trade_observation` (this is the guarantee that keeps
  the Trade Intelligence tab honest).
- `observed_origin_country` / `observed_destination_country`
  (websites do not verify shipment origins).
- `supplier_relationship` / `india_sourcing` (would require actual
  shipment or transaction evidence).
- `imports_product` from mere product catalogue listings.
- Any claim without a verbatim excerpt drawn from the page text.
- A Buyer, campaign recipient, follow-up, or email.

## Ingestion identity

Every BI3 write goes through the BI2 write repository:

**Source**: `provider_id = "company_website"`,
`source_type = "company_web_page"`,
`source_key = "<kind>:<pathname>"`,
`safe_source_ref = "<Kind> · <hostname>"`,
`source_url = <canonical page URL>`,
`access_class = "public"`, `cost_class = "free"`,
`retrieved_at = now()`, `metadata = { pageKind, httpStatus, bytesRead }`.

**Claim**: `source_id + source_record_ref + claim_type` (BI2 identity).
`source_record_ref` is a stable `"page:<sourceKey>:<claimType>"` (or
`"…:<claimType>:<productId>"` for `imports_product`). This means re-
running research on unchanged content resolves as `existing`, and a
materially changed page reports `conflict` — never silently
overwrites historical evidence.

Retrieval timestamps are non-material in BI2's replay contract; the
BI3 orchestrator always uses `new Date().toISOString()` for
`retrieved_at`.

## Changed-content behaviour

For BI3's initial version:

- **Unchanged page / fact** → `existing` from the RPC.
- **New page / fact** → `created`.
- **Materially changed value at the same identity** → `conflict`;
  the pre-existing row is preserved. The action surfaces
  `claimsConflicting > 0` and the Sources tab still shows the
  original. A future correction workflow will add an explicit
  versioned replacement; BI3 never silently mutates.

## Concurrency

A per-process `Set<candidateId>` prevents two simultaneous BI3 runs
against the same Candidate from spending duplicate bandwidth. The
final concurrency floor is the BI2 SQL RPC itself: each ingestion
identity acquires a `pg_advisory_xact_lock`, and refresh is a
Candidate-scoped advisory-locked transaction. Two operators who race
still produce one coherent BI state.

## Resource controls

Per run (all inherited from the BF3A.5 fetch envelope):

- ≤ 6 same-domain pages (homepage + up to 5 ranked internal pages).
- ≤ 1 MB per page body.
- 8s per HTTP hop; 20s total budget.
- ≤ 5 redirects per hop.
- Robots.txt honoured for internal pages.
- HTML/XHTML content-types only; PDF, binaries, media rejected.
- No new global crawler, no background job.

## Outcomes

The server action returns one of:

- `researched` — at least one qualifying business claim created or
  matched existing.
- `no_evidence` — pages fetched, no qualifying wording found.
- `partial` — some pages failed, some succeeded.
- `unreachable` — no homepage was retrievable.
- `invalid_website` — candidate has no website/domain.
- `blocked` — challenge / 401 / 403 / 429.
- `timeout` — total budget exhausted.
- `unsupported_content` — HTML page was never returned (e.g. PDF).
- `conflict` — every recorded claim conflicted with existing evidence.
- `temporarily_unavailable` — transient orchestrator failure.
- `already_running` — a run for this Candidate is already in flight.
- `invalid_input` — bad candidate id, or Candidate is archived / rejected.

The UI shows a truthful outcome line — never a fake percentage.

## Interaction with the rest of the intelligence surface

- **Overview** updates only from persisted BI2 assessments. A
  successful BI3 run should typically move Buyer legitimacy to
  `moderate` (one qualifying Level-2 provider) while Buyer potential
  stays `insufficient_evidence` and Trade Intelligence stays
  "No verified trade intelligence yet." Contact access and
  Outreach readiness are unaffected — BF5B eligibility does not
  change.
- **Sources** now shows the contributing pages with kind, retrieval
  time, and a "View source ↗" link.
- **Trade Intelligence** tab remains "No verified trade intelligence
  yet" until real Level-1 shipment/transaction observations exist.

## Explicit boundary from "Find public company contacts · Free"

BF3A.5's "Find public company contacts · Free" is a separate action
with a separate purpose: it discovers published company email
addresses and writes them to `buyer_candidate_public_emails`. BI3
reuses the same safe fetch infrastructure but does not write emails
and does not silently trigger contact discovery. An operator who
wants both must click both actions; the two responsibilities stay
explicit.

## Future BI4 boundary (not started)

The next intelligence source should be a second **independent
provider** so BI2's legitimacy independence rule can move to
`strong_evidence`. Candidate examples: a lawful directory API
(free tier), an authorised trade-data feed (Volza / ImportYeti /
Comtrade under contract), or a government registry. Each will need
its own SSRF-safe fetcher, its own extraction rules, and its own
`provider_id`. Trade observations should be introduced only when
the source is a real Level-1 shipment or transaction record with
lawful provenance.
