import { serverRepositories } from "@/lib/repositories/server";
import { BuyersView } from "./BuyersView";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 25;
const ALLOWED_PAGE_SIZES = new Set([25, 50, 100]);

function parseInt1(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

export default async function BuyersPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const { repos } = await serverRepositories();

  const sp = searchParams ?? {};
  const asStr = (k: string) => {
    const v = sp[k];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : "";
  };

  const search = asStr("q").slice(0, 128);
  const status = asStr("status");
  const country = asStr("country");
  const product = asStr("product");

  const requestedPageSize = parseInt1(asStr("pageSize"), DEFAULT_PAGE_SIZE);
  const pageSize = ALLOWED_PAGE_SIZES.has(requestedPageSize)
    ? requestedPageSize
    : DEFAULT_PAGE_SIZE;

  const page = parseInt1(asStr("page"), 1);

  const paged = await repos.buyers.listPaginated({
    page,
    pageSize,
    search: search || undefined,
    status: status || undefined,
    country: country || undefined,
    product: product || undefined,
  });

  // F9 — safe normalization: if the caller requested a page beyond the
  // last valid page (e.g. after a delete or filter tightening), silently
  // clamp to the last page and re-fetch. This prevents an operator being
  // stranded on a broken empty screen when their bookmarked ?page=42 no
  // longer exists.
  let effective = paged;
  if (page > 1 && paged.rows.length === 0 && paged.pageCount > 0) {
    effective = await repos.buyers.listPaginated({
      page: paged.pageCount,
      pageSize,
      search: search || undefined,
      status: status || undefined,
      country: country || undefined,
      product: product || undefined,
    });
  }

  return (
    <BuyersView
      initialRows={effective.rows}
      total={effective.total}
      page={effective.page}
      pageSize={effective.pageSize}
      pageCount={effective.pageCount}
      initialFilters={{ search, status, country, product }}
    />
  );
}
