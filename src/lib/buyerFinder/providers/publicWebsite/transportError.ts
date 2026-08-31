/**
 * Sanitize Node transport failures for development diagnostics.
 *
 * Never copies messages, IPs, DNS answers, certificates, stacks, or headers.
 * Production logging stays silent; this only classifies allowlisted codes.
 */

export type TransportStage = "dns" | "connect" | "tls" | "redirect" | "headers" | "body";

export type SafeErrorCode =
  | "ECONNREFUSED"
  | "ECONNRESET"
  | "ETIMEDOUT"
  | "ENOTFOUND"
  | "EAI_AGAIN"
  | "CERT_ERROR"
  | "TLS_NAME_ERROR"
  | "REDIRECT_TARGET_ERROR"
  | "NETWORK_ERROR";

export interface SanitizedTransportFailure {
  transportStage: TransportStage;
  safeErrorCode: SafeErrorCode;
}

const TLS_NAME_CODES = new Set(["ERR_TLS_CERT_ALTNAME_INVALID"]);

const CERT_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REVOKED",
  "CERT_UNTRUSTED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_OSSL_X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT",
  "ERR_OSSL_X509_V_ERR_CERT_HAS_EXPIRED",
  "ERR_OSSL_X509_V_ERR_HOSTNAME_MISMATCH",
]);

const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NODATA", "EAI_NONAME", "ENODATA"]);

const CONNECT_CODE_MAP: Record<string, SafeErrorCode> = {
  ECONNREFUSED: "ECONNREFUSED",
  ECONNRESET: "ECONNRESET",
  ETIMEDOUT: "ETIMEDOUT",
  ETIME: "ETIMEDOUT",
  ECONNABORTED: "ECONNRESET",
  ENETUNREACH: "NETWORK_ERROR",
  EHOSTUNREACH: "NETWORK_ERROR",
  EHOSTDOWN: "NETWORK_ERROR",
  EPIPE: "ECONNRESET",
};

function nodeCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 && code.length <= 80 ? code : undefined;
}

function nodeSyscall(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const syscall = (err as { syscall?: unknown }).syscall;
  return typeof syscall === "string" ? syscall : undefined;
}

export function classifyTransportError(err: unknown): SanitizedTransportFailure {
  const code = nodeCode(err);
  const syscall = nodeSyscall(err);

  if (code && TLS_NAME_CODES.has(code)) {
    return { transportStage: "tls", safeErrorCode: "TLS_NAME_ERROR" };
  }
  if (code === "ERR_OSSL_X509_V_ERR_HOSTNAME_MISMATCH") {
    return { transportStage: "tls", safeErrorCode: "TLS_NAME_ERROR" };
  }
  if (code && CERT_CODES.has(code)) {
    return { transportStage: "tls", safeErrorCode: "CERT_ERROR" };
  }
  if (code?.startsWith("ERR_TLS_") || code?.startsWith("ERR_SSL_") || code === "EPROTO") {
    return { transportStage: "tls", safeErrorCode: "CERT_ERROR" };
  }

  if (code && DNS_CODES.has(code)) {
    return {
      transportStage: "dns",
      safeErrorCode: code === "EAI_AGAIN" ? "EAI_AGAIN" : "ENOTFOUND",
    };
  }

  if (code && CONNECT_CODE_MAP[code]) {
    return { transportStage: "connect", safeErrorCode: CONNECT_CODE_MAP[code] };
  }

  if (syscall === "connect" || syscall === "getaddrinfo") {
    return {
      transportStage: syscall === "getaddrinfo" ? "dns" : "connect",
      safeErrorCode: syscall === "getaddrinfo" ? "ENOTFOUND" : "NETWORK_ERROR",
    };
  }

  return { transportStage: "connect", safeErrorCode: "NETWORK_ERROR" };
}
