import { describe, expect, it } from "vitest";
import { classifyTransportError } from "./transportError";

describe("classifyTransportError", () => {
  it("maps connection refusal without copying the message or IP", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED 203.0.113.9:443"), {
      code: "ECONNREFUSED",
      syscall: "connect",
      address: "203.0.113.9",
      port: 443,
    });
    const classified = classifyTransportError(err);
    expect(classified).toEqual({ transportStage: "connect", safeErrorCode: "ECONNREFUSED" });
    expect(JSON.stringify(classified)).not.toMatch(/203\.0\.113\.9|ECONNREFUSED 203/);
  });

  it("maps TLS hostname mismatch to TLS_NAME_ERROR without cert contents", () => {
    const err = Object.assign(new Error("Hostname/IP does not match certificate's altnames: Host: www.company.com. is not in the cert's altnames: DNS:other.com"), {
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
      reason: "Hostname/IP does not match certificate's altnames",
      cert: { subject: { CN: "other.com" }, pem: "-----BEGIN CERTIFICATE-----" },
    });
    const classified = classifyTransportError(err);
    expect(classified).toEqual({ transportStage: "tls", safeErrorCode: "TLS_NAME_ERROR" });
    expect(JSON.stringify(classified)).not.toMatch(/BEGIN CERTIFICATE|altnames|www\.company\.com|other\.com/);
  });

  it("maps expired certificates to CERT_ERROR", () => {
    const classified = classifyTransportError(
      Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" }),
    );
    expect(classified).toEqual({ transportStage: "tls", safeErrorCode: "CERT_ERROR" });
  });

  it("maps DNS resolver failures", () => {
    expect(classifyTransportError(Object.assign(new Error("getaddrinfo ENOTFOUND x"), { code: "ENOTFOUND" }))).toEqual(
      { transportStage: "dns", safeErrorCode: "ENOTFOUND" },
    );
    expect(classifyTransportError(Object.assign(new Error("getaddrinfo EAI_AGAIN x"), { code: "EAI_AGAIN" }))).toEqual(
      { transportStage: "dns", safeErrorCode: "EAI_AGAIN" },
    );
  });

  it("does not pass through unknown codes or stack traces", () => {
    const err = Object.assign(new Error("secret-token stack"), {
      code: "SOME_INTERNAL_CODE",
      stack: "Error: secret-token\n    at defaultPinnedFetch",
    });
    const classified = classifyTransportError(err);
    expect(classified.safeErrorCode).toBe("NETWORK_ERROR");
    expect(JSON.stringify(classified)).not.toMatch(/secret-token|SOME_INTERNAL_CODE|defaultPinnedFetch/);
  });
});
