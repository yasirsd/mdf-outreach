-- BF2.2C — operator repair for Buyer Finder candidate provenance.
-- NOT a migration. Do NOT run from CI. Do NOT apply automatically.
--
-- Context: production Buyer Finder tables were empty immediately before the
-- two live Hunter Discover searches. Those runs created 29 candidates, all
-- persisted with source='mock' because ingestion hardcoded that value.
-- Evidence notes already say "Hunter Discover company match".
--
-- Hunter does not persist source_url. The safer predicate is the evidence
-- note written by HunterCompanyDiscoveryProvider — not source='mock' alone.
--
-- Operator: run in a transaction, inspect RETURNING rows, then COMMIT
-- or ROLLBACK. Do not execute until you have reviewed this file.

BEGIN;

-- ---------------------------------------------------------------------------
-- Preconditions — abort unless the live-test snapshot still holds.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  total_n integer;
  mock_n integer;
  hunter_n integer;
  evidence_n integer;
BEGIN
  SELECT count(*) INTO total_n FROM public.buyer_candidates;
  SELECT count(*) INTO mock_n FROM public.buyer_candidates WHERE source = 'mock';
  SELECT count(*) INTO hunter_n FROM public.buyer_candidates WHERE source = 'hunter';
  SELECT count(*) INTO evidence_n
  FROM public.buyer_candidates
  WHERE source = 'mock'
    AND evidence::text ILIKE '%Hunter Discover company match%';

  IF total_n <> 29 THEN
    RAISE EXCEPTION 'Abort: expected 29 candidate rows, found %', total_n;
  END IF;
  IF mock_n <> 29 THEN
    RAISE EXCEPTION 'Abort: expected 29 source=mock rows, found %', mock_n;
  END IF;
  IF hunter_n <> 0 THEN
    RAISE EXCEPTION 'Abort: expected 0 source=hunter rows, found %', hunter_n;
  END IF;
  IF evidence_n <> 29 THEN
    RAISE EXCEPTION
      'Abort: expected 29 mock rows with Hunter Discover evidence, found %',
      evidence_n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Repair candidate provenance.
-- ---------------------------------------------------------------------------
UPDATE public.buyer_candidates
SET source = 'hunter'
WHERE source = 'mock'
  AND evidence::text ILIKE '%Hunter Discover company match%'
RETURNING id, company_name, country, source;

-- Product matches from the same runs copied the Hunter evidence note and
-- were also hardcoded to source='mock'.
UPDATE public.buyer_candidate_product_matches
SET source = 'hunter'
WHERE source = 'mock'
  AND evidence::text ILIKE '%Hunter Discover company match%'
RETURNING id, candidate_id, product_key, source;

-- Inspect the 29 candidate rows (and matching product-match rows) above.
-- Then:
--   COMMIT;    -- keep the repair
--   ROLLBACK;  -- leave production unchanged
--
-- After COMMIT, a rollback would be:
--   UPDATE public.buyer_candidates SET source = 'mock' WHERE source = 'hunter';
--   UPDATE public.buyer_candidate_product_matches SET source = 'mock' WHERE source = 'hunter';
-- That post-commit rollback is only safe while this workspace still contains
-- exclusively those 29 Hunter live-test rows.
