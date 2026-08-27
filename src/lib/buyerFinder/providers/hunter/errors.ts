export type HunterDiscoveryErrorCode =
  | "invalid_input"
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "provider_unavailable"
  | "timeout"
  | "invalid_response";

export class HunterDiscoveryError extends Error {
  readonly code: HunterDiscoveryErrorCode;
  readonly status?: number;

  constructor(code: HunterDiscoveryErrorCode, message: string, options?: { status?: number; apiKey?: string }) {
    super(redactSecret(message, options?.apiKey));
    this.name = "HunterDiscoveryError";
    this.code = code;
    this.status = options?.status;
  }
}

/** Strip a secret from any string that might later be logged or thrown. */
export function redactSecret(value: string, secret: string | undefined): string {
  if (!secret || secret.length === 0) return value;
  return value.split(secret).join("[redacted]");
}

export function hunterErrorFromHttpStatus(
  status: number,
  apiKey: string,
  operation = "Hunter Discover",
): HunterDiscoveryError {
  if (status === 400) {
    return new HunterDiscoveryError("invalid_request", `${operation} rejected the request (400).`, {
      status,
      apiKey,
    });
  }
  if (status === 401) {
    return new HunterDiscoveryError("unauthorized", `${operation} authentication failed (401).`, {
      status,
      apiKey,
    });
  }
  if (status === 403) {
    return new HunterDiscoveryError("forbidden", `${operation} forbidden or usage-limited (403).`, {
      status,
      apiKey,
    });
  }
  if (status === 429) {
    return new HunterDiscoveryError("rate_limited", `${operation} rate-limited (429).`, {
      status,
      apiKey,
    });
  }
  if (status >= 500) {
    return new HunterDiscoveryError("provider_unavailable", `${operation} unavailable (${status}).`, {
      status,
      apiKey,
    });
  }
  return new HunterDiscoveryError("provider_unavailable", `${operation} unexpected status (${status}).`, {
    status,
    apiKey,
  });
}
