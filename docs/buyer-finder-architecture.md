# Buyer Finder architecture

Buyer Finder is an isolated, additive research and qualification module for MDF Outreach. It discovers potential importer/distributor companies, preserves evidence, helps an operator identify useful contacts, and supports a deliberate Candidate → Buyer conversion. It does not replace Buyers, Campaigns, Templates, or sending.

This document describes the current architecture through BF5B. Future Buyer Intelligence and trade-intelligence work is explicitly marked as planned.

## Core model and boundary

One Buyer Finder Candidate represents one company. Contacts and product matches are child records; a company is not duplicated merely because it matches several MDF products.

Candidates are intelligence records. Buyers are contactable CRM entities. Discovery, enrichment, scoring, or approval alone never creates a Buyer. A Buyer is created only by the explicit conversion action, and every Buyer must have a structurally usable, nonblank email.

Buyer Finder must not write to campaigns, campaign recipients, templates, email assets, Gmail, or workspace settings. It writes to `public.buyers` only through the narrow Candidate-conversion RPC. `BUYER_SEND_ENABLED` is a separate server gate and conversion never sends email.

`/buyer-finder` is protected by the existing `(app)` layout. Repository access is authenticated and workspace-scoped. Browser inputs never carry an authoritative workspace id.

## Current end-to-end flow

1. An operator searches by target country, MDF business product, and optional buyer/contact criteria.
2. Company discovery creates or enriches workspace-scoped Candidate records.
3. Free research collects public company intelligence, public website contact points, and decision-maker directory signals.
4. Deterministic scoring and reveal-priority rules explain which Candidates and contacts deserve attention.
5. Paid personal-contact reveal is optional and dormant unless the server-only reveal gate is explicitly enabled. Provider keys never reach the browser.
6. The operator reviews a Candidate and may approve or reject it. Approval is a review-state transition only; Approve is not Convert.
7. An approved Candidate may be converted only when it has either a persisted revealed personal email or a persisted public company email.
8. The atomic conversion RPC re-loads authoritative records, checks workspace ownership and eligibility, rechecks duplicates, inserts one Buyer and one durable conversion-linkage row, and returns the exact Buyer id.

## Discovery and research

The production Buyer Finder path persists:

- `buyer_candidates` — one row per researched company;
- `buyer_candidate_contacts` — people and decision-maker signals;
- `buyer_candidate_public_emails` — public company emails found on allowed company-site pages;
- `buyer_candidate_product_matches` — persisted MDF business-product matches;
- search runs and free-enrichment jobs — durable progress and retry state;
- contact-reveal events — auditable optional reveal state;
- Candidate conversion linkage — one durable Candidate → Buyer relationship.

Hunter Discover is the company-discovery adapter. Its API key is server-only, constructor-injected, and sent as `X-API-KEY`. Query construction is product-led and avoids generic import/export/logistics tokens that created poor results. Search limits are applied locally where required.

Free public-website research is separate from Hunter usage. It follows URL, same-site, redirect, MIME, size, robots, and SSRF controls before persisting public evidence or company emails.

LinkedIn values are URLs only. The product renders an outbound link; automated LinkedIn scraping, browser automation, and LinkedIn APIs remain prohibited.

## Scoring and prioritization

`scoreBuyerCandidate()` is deterministic and explainable. It returns an overall score, category totals, and awarded reasons without calling a provider or writing data. Company fit, contact quality, and completeness are scored independently; multiple contacts do not stack contact-quality points.

Duplicate analysis is likewise deterministic:

- exact: same normalized email;
- high: same corporate domain, or normalized company name plus country;
- possible: normalized company name with different or missing country;
- none: no recognized signal.

Public mailbox domains are excluded from corporate-domain matching. Findings do not auto-merge or delete records.

Reveal priority is separate from the company score. It ranks promising agri-commercial decision makers for operator attention and does not imply that an email has been revealed or verified.

## Approval and email-required conversion

The Candidate lifecycle has two independent axes:

- `discoveryStatus`: `new` | `enriching` | `ready` | `archived`;
- `reviewStatus`: `pending` | `approved` | `rejected` | `needs_another_contact`.

Approval does not insert into `public.buyers`. Conversion is available only after approval and only with one of these persisted sources:

- `revealed_personal_contact` — a workspace-owned contact with `revealed_at IS NOT NULL`, `email_type = 'personal'`, and a usable email;
- `public_company_email` — a workspace-owned public-email row with a usable email.

`company_only` is historical linkage vocabulary only. It is not offered by the UI, is rejected by the domain and server-action selection logic, and is rejected by the BF5B RPC. An approved Candidate without a usable email displays `NEEDS CONTACT` and remains a research record.

The conversion RPC is `SECURITY DEFINER` with `search_path = public, mdf, pg_temp`. It derives the workspace from `mdf.current_workspace_id()`, never accepts `p_workspace_id`, and scopes Candidate, contact, public-email, product-match, prior-conversion, and duplicate reads to that workspace. Product interest is derived from a persisted product-match row through the approved whitelist; unknown product keys are rejected.

A workspace transaction advisory lock plus the conversion uniqueness constraint serializes competing conversions. Duplicate email/domain/company checks run inside the transaction. Unique-violation recovery returns `already_converted` when the linkage won the race. RPC execution is granted only to `authenticated`; `public` and `anon` are revoked.

## Converted lifecycle

The conversion linkage is durable and selectable by authenticated workspace members but is not directly insertable, updateable, or deletable from the app plane.

After conversion:

- the Candidate remains in Buyer Finder history and in the All queue;
- it appears in the Converted filter;
- the detail page shows a calm Buyer-created state and preserves the research record;
- redundant Approve/Reject controls are hidden;
- Archive remains available and affects only the research record, not the linked Buyer;
- Open Buyer uses `/buyers?buyerId=<uuid>`;
- the Buyers page validates the UUID, resolves it through the workspace-scoped repository, and opens that exact Buyer drawer;
- closing the drawer removes only `buyerId`, preserving Buyer filters.

## Buyer email invariant and migration staging

The existing schema declares `buyers.email NOT NULL` and has a case-insensitive workspace/email unique index. Before BF5B, `NOT NULL` still allowed `''` or whitespace.

Migration `0019_buyer_email_required_conversion.sql` is intentionally unapplied and additive. It:

- adds a `NOT VALID` `btrim(email) <> ''` CHECK to `public.buyers`, which blocks future blank writes without scanning or rewriting historical Buyers;
- adds a `NOT VALID` conversion-linkage source-kind CHECK, which blocks new `company_only` linkage without assuming historical data is clean;
- replaces the existing conversion RPC with the email-required BF5A.1-hardened implementation;
- preserves the existing workspace/email uniqueness index and all linkage permissions.

An operator must run `supabase/tests/preflight_0019_buyer_email_required.sql` before applying 0019. Historical cleanup or later constraint validation requires a separate reviewed operation; migration 0019 does not rewrite data.

## Provider gates and sending isolation

Hunter personal reveal remains optional/dormant and is server-gated by `BUYER_FINDER_HUNTER_REVEAL_ENABLED`. The safe default is false. Search/discovery and free research do not enable it.

Buyer conversion never calls Gmail and never creates campaign recipients. Production outreach remains separately gated by `BUYER_SEND_ENABLED`, whose safe default is false.

## Planned, not implemented

Future Buyer Intelligence and trade-intelligence phases may add richer shipment evidence, market signals, and analytical views. They are not part of BF5B and must not be inferred from the current Candidate fields or UI. Any future provider, data source, or automation must preserve workspace isolation, provenance, cost controls, and the Candidate-versus-Buyer boundary described above.
