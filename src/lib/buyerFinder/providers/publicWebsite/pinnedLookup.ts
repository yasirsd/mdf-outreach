/**
 * DNS lookup that returns only pre-validated addresses.
 * Never consults the system resolver. Used to pin HTTP/TLS connections
 * so a later rebinding response cannot change the destination.
 */

import { isIP } from "node:net";
import type { LookupAddress, LookupOptions } from "node:dns";

export type PinnedLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

export function pinnedLookup(
  addresses: readonly string[],
  _hostname: string,
  options: LookupOptions,
  callback: PinnedLookupCallback,
): void {
  const usable = addresses.filter((addr) => isIP(addr) === 4 || isIP(addr) === 6);
  if (usable.length === 0) {
    const err = Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    callback(err, "", 0);
    return;
  }
  if (options.all) {
    callback(
      null,
      usable.map((address) => ({
        address,
        family: isIP(address) as 4 | 6,
      })),
    );
    return;
  }
  // Node http.request without `all` uses the first validated public address.
  // Selection is not rotated. Mixed public+private hostnames are already rejected.
  const first = usable[0]!;
  callback(null, first, isIP(first));
}
