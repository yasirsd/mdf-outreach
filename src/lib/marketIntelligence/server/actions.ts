"use server";

import "server-only";
import { syncCurrentMarketProductMappings } from "./mappingSyncMaintenance";

/**
 * Serialize the current TS registry and hand it to the service-role
 * writer. Every failure path returns a sanitized shape — no
 * credentials, no raw provider strings, no service-role client
 * leakage.
 *
 * Order of operations is intentional. See MI1C.1 §3:
 *   1. requireMdfSession() — session must be valid.
 *   2. Role check — must be owner (privileged).
 *   3. Snapshot serialize — never touches the DB.
 *   4. Only NOW obtain the writer + call sync.
 *
 * A denied caller MUST NEVER reach step 4; the writer never gets
 * initialised for them, so a compromised session cannot even trigger
 * a lazy service-role client creation.
 */
export async function syncMarketProductMappingsAction() {
  return syncCurrentMarketProductMappings();
}
