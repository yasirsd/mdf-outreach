import type { IncomingMessage } from "node:http";

export interface PinnedFetchInit {
  method: "GET";
  headers: Record<string, string>;
  redirect: "manual";
  signal: AbortSignal;
  pinnedAddresses: string[];
}

export interface SafeFetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  body: AsyncIterable<Uint8Array | Buffer> | IncomingMessage | null;
}

export type FetchLike = (input: string, init: PinnedFetchInit) => Promise<SafeFetchResponse>;
