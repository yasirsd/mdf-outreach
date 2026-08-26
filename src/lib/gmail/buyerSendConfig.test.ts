import { afterEach, describe, it, expect } from "vitest";
import { BUYER_SEND_BATCH_MAX, isBuyerSendEnabled } from "./buyerSendConfig";

const ORIG = process.env.BUYER_SEND_ENABLED;

afterEach(() => {
  if (ORIG === undefined) delete process.env.BUYER_SEND_ENABLED;
  else process.env.BUYER_SEND_ENABLED = ORIG;
});

describe("BUYER_SEND_BATCH_MAX", () => {
  it("is 10 for the first production version", () => {
    expect(BUYER_SEND_BATCH_MAX).toBe(10);
  });
});

describe("isBuyerSendEnabled", () => {
  it("defaults to false when the env var is unset", () => {
    delete process.env.BUYER_SEND_ENABLED;
    expect(isBuyerSendEnabled()).toBe(false);
  });
  it("is false for any string other than 'true' / '1'", () => {
    process.env.BUYER_SEND_ENABLED = "yes";
    expect(isBuyerSendEnabled()).toBe(false);
    process.env.BUYER_SEND_ENABLED = "false";
    expect(isBuyerSendEnabled()).toBe(false);
    process.env.BUYER_SEND_ENABLED = "";
    expect(isBuyerSendEnabled()).toBe(false);
  });
  it("is true for 'true' (case-insensitive) or '1'", () => {
    process.env.BUYER_SEND_ENABLED = "true";
    expect(isBuyerSendEnabled()).toBe(true);
    process.env.BUYER_SEND_ENABLED = "TRUE";
    expect(isBuyerSendEnabled()).toBe(true);
    process.env.BUYER_SEND_ENABLED = "1";
    expect(isBuyerSendEnabled()).toBe(true);
  });
});
