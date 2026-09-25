# Buyer Trade Research — BI4F Phase 2A

Phase 2A is a durable, zero-cost screening engine. It has one provider: the official FDA FSVP participant XLSX. Its result is company/program corroboration only. It never asserts a shipment, product, supplier, country of origin, quantity, value, Guntur connection, or CBP importer-of-record status.

## Execution boundary

- Browser clients may read workspace-scoped batch/job state through RLS and owners may create/cancel through server actions.
- Provider planning, dataset access, attempts, events, leases, accounting, and all mutations use a dedicated server-only Supabase Secret API Key boundary.
- The browser does not pump the queue. `POST /api/internal/trade-research/drain` claims at most two jobs and runs for at most 45 seconds.
- A scheduler must call the drain route with `Authorization: Bearer $TRADE_RESEARCH_DRAIN_SECRET`. No schedule is silently assumed or installed by this phase. An owner may invoke the same route from a same-origin authenticated session for bounded QA.
- Automatic provider cost must remain exactly ₹0 in TypeScript and in five database CHECK constraints. `free_quota` fails closed until a future authoritative quota reservation exists.

## Deployment

1. Run `supabase/tests/preflight_0025_buyer_trade_research_engine.sql` in the production SQL editor. Stop on any `BLOCK` row.
2. Review and apply `supabase/migrations/0025_buyer_trade_research_engine.sql` once.
3. Run `supabase/tests/verify_0025_buyer_trade_research_engine.sql`. Every non-informational row must say `ok`.
4. Confirm server-only environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` (`sb_secret_…`), `APP_BASE_URL`, and a strong `TRADE_RESEARCH_DRAIN_SECRET`. Never put the last two secrets under `NEXT_PUBLIC_`.
5. Configure the available zero-cost scheduler to POST the drain route at a conservative interval. If scheduling is unavailable, leave it unconfigured; queued jobs remain durable and no provider runs automatically.

## First production QA

1. As an owner, choose one U.S. food/import-relevant Buyer Finder candidate that has a persisted product match and explicit state in its address.
2. Select **Research trade activity**. Confirm exactly one batch and one queued job, a single server-derived `fda-fsvp` plan, and `automatic_spend_rupees = 0` everywhere.
3. Invoke one bounded drain from a secure operator shell:

   `curl -X POST "$APP_BASE_URL/api/internal/trade-research/drain" -H "Authorization: Bearer $TRADE_RESEARCH_DRAIN_SECRET"`

4. Confirm the route claims no more than two jobs, the UI resumes from persisted state after refresh, and the job reaches a terminal status.
5. Inspect evidence wording. A strong result must say “Official FSVP importer-program corroboration found.” It must not mention verified shipments, chilli, India, suppliers, quantities, values, Guntur, or importer-of-record status.
6. Run the drain again. Confirm no terminal job is rerun and the shared ready snapshot prevents a second dataset download.
7. Create a second batch for a non-U.S. candidate. Confirm it completes as unsupported/no verified evidence without a provider call or failure.
8. Start a small test batch, request cancellation, drain once, and confirm completed results are preserved while unstarted jobs become cancelled.

The official list is published quarterly and exposes participant name and state. Snapshot freshness is conservatively set to 100 days; conditional `ETag`/`Last-Modified` requests are used after expiry when available.

