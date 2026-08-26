/**
 * Translate a Supabase/Postgres error into a user-facing message safe
 * for display in the MDF Outreach UI.
 *
 * The raw error object (including PostgreSQL codes like `42P10`, storage
 * codes like `403`, and long stack traces) is logged server-side by the
 * caller — the caller re-raises the mapped Error with a readable
 * message. The client never sees the raw code.
 */
export function friendlyAssetError(err: unknown): Error {
  const raw = extractRawInfo(err);

  // Log the full detail on the server. Never returned to the client.
  console.warn("[assets.error]", raw);

  const code = raw.code?.toString() ?? "";
  const status = raw.status?.toString() ?? "";
  const message = (raw.message ?? "").toString().toLowerCase();

  // Postgres / PostgREST codes we recognise.
  if (code === "42P10") {
    return new Error(
      "Asset could not be saved due to a database configuration issue. Please contact your MDF administrator.",
    );
  }
  if (code === "23505" || message.includes("duplicate key")) {
    return new Error(
      "An asset for this product and slot already exists. Refresh and try again.",
    );
  }
  if (code === "23503" || message.includes("foreign key")) {
    return new Error("Related record is missing. Refresh and try again.");
  }
  if (code === "42501" || message.includes("permission denied") || status === "403") {
    return new Error(
      "You do not have permission to upload assets to this workspace.",
    );
  }
  if (status === "413" || message.includes("payload too large") || message.includes("too large")) {
    return new Error("File is too large. Please use an image under 5 MB.");
  }
  if (status === "415" || message.includes("mime")) {
    return new Error("Unsupported image type. Use JPEG, PNG, or GIF.");
  }
  if (message.includes("row-level security") || message.includes("rls")) {
    return new Error(
      "Storage permissions rejected the upload. Please contact your MDF administrator.",
    );
  }
  if (message.includes("network") || message.includes("fetch failed")) {
    return new Error("Could not reach the storage server. Please try again shortly.");
  }

  // Fallback: keep the client message intentionally opaque.
  return new Error("Asset could not be saved. Please try again.");
}

function extractRawInfo(err: unknown): {
  code?: unknown;
  status?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  name?: unknown;
} {
  if (!err || typeof err !== "object") return { message: String(err) };
  const e = err as Record<string, unknown>;
  return {
    code: e.code,
    status: e.status,
    message: e.message,
    details: e.details,
    hint: e.hint,
    name: e.name,
  };
}
