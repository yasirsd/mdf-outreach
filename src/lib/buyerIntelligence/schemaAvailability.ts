/**
 * BI1 is staged before migration 0020 is manually applied. Candidate detail
 * may therefore encounter a missing-table response during that deployment
 * window. Only that exact schema condition becomes an empty state; all other
 * database errors remain visible to the server error boundary.
 */
export function isBuyerIntelligenceSchemaUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as { code?: unknown; message?: unknown };
  if (row.code === "42P01" || row.code === "PGRST205") return true;
  const message = typeof row.message === "string" ? row.message.toLowerCase() : "";
  return (
    message.includes("buyer_intelligence_sources") &&
    (message.includes("does not exist") || message.includes("schema cache"))
  );
}
