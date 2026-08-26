import { describe, it, expect } from "vitest";
import { classifyFailure, retryLabel } from "./failureClassification";

describe("classifyFailure", () => {
  it("null / empty / undefined → review-required", () => {
    expect(classifyFailure(null)).toBe("review-required");
    expect(classifyFailure(undefined)).toBe("review-required");
    expect(classifyFailure("")).toBe("review-required");
  });

  it.each([
    "Production Buyer Send is not enabled on this server. Set BUYER_SEND_ENABLED=true after QA.",
    "Do not contact (manual).",
    "Buyer has no valid email on file.",
    "Buyer is not part of this campaign.",
    "Buyer no longer exists in this workspace.",
    "Gmail is not connected. Reconnect Gmail to continue.",
    "Subject is empty.",
    "Recipient email is invalid.",
    "Rendered HTML contains a Base64 image. Only production URLs are allowed.",
    "Unresolved personalization: {{first_name}}.",
    'Required asset "Hero" is not uploaded.',
    "This send was already submitted. Refresh the page and re-review recipients.",
    "Another send for this buyer is already in flight.",
    "Gmail rejected the message. No buyer was contacted.",
  ])("safe-to-retry: %s", (msg) => {
    expect(classifyFailure(msg)).toBe("safe-to-retry");
  });

  it.each([
    "Gmail rejected", // bare — missing safety suffix
    "socket hang up",
    "ECONNRESET",
    "Timeout after 30000ms",
    "Audit conflict — this buyer may have been sent by another operator. (…)",
    "unexpected 500 from gmail",
  ])("review-required: %s", (msg) => {
    expect(classifyFailure(msg)).toBe("review-required");
  });

  it("retryLabel exposes human-readable labels", () => {
    expect(retryLabel("safe-to-retry")).toBe("Safe to retry");
    expect(retryLabel("review-required")).toBe("Review required");
    expect(retryLabel("already-sent")).toBe("Already sent");
  });
});
