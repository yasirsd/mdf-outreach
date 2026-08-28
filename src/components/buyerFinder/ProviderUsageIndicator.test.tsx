import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProviderUsageIndicator } from "./ProviderUsageIndicator";
import {
  MOCK_HUNTER_USAGE,
  MOCK_HUNTER_USAGE_ZERO,
} from "@/lib/buyerFinder/mock/usage";

afterEach(() => cleanup());

/**
 * BF2 — Hunter Discover is FREE and must NEVER be represented as
 * gated on the contact/email credits bucket. Contact/email credits
 * are a separate concept surfaced in the details modal.
 */
describe("ProviderUsageIndicator — BF2 semantics", () => {
  it("always renders 'Discovery · Free' regardless of credit state", () => {
    render(<ProviderUsageIndicator usage={MOCK_HUNTER_USAGE} state="ok" />);
    expect(screen.getByText(/Discovery · Free/)).toBeTruthy();
  });

  it("shows contact credits alongside the free-discovery label when ok", () => {
    render(<ProviderUsageIndicator usage={MOCK_HUNTER_USAGE} state="ok" />);
    expect(screen.getByText(/50 credits/)).toBeTruthy();
  });

  it("shows Discovery · Disabled and no credit count when the runtime gate is off", () => {
    render(<ProviderUsageIndicator usage={null} state="disabled" />);
    expect(screen.getByText(/Discovery · Disabled/)).toBeTruthy();
    expect(screen.queryByText(/Discovery · Free/)).toBeNull();
    expect(screen.queryByText(/credits/i)).toBeNull();
  });

  it("shows 'Discovery · Free' + 'Not configured' when the server has no key", () => {
    render(<ProviderUsageIndicator usage={null} state="not_configured" />);
    expect(screen.getByText(/Discovery · Free/)).toBeTruthy();
    expect(screen.getByText(/Not configured/)).toBeTruthy();
  });

  it("shows 'Discovery · Free' + 'Usage unavailable' when the usage endpoint fails", () => {
    render(<ProviderUsageIndicator usage={null} state="unavailable" />);
    expect(screen.getByText(/Discovery · Free/)).toBeTruthy();
    expect(screen.getByText(/Usage unavailable/)).toBeTruthy();
  });

  it("modal separates free discovery from contact/email credits", () => {
    render(<ProviderUsageIndicator usage={MOCK_HUNTER_USAGE} state="ok" />);
    fireEvent.click(screen.getByRole("button", { name: /Hunter · Discovery · Free/i }));
    // Company discovery mentioned at least once, plus the explicit
    // "no credits consumed" body and the "Contact / email credits"
    // section header.
    expect(screen.getAllByText(/Company discovery/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/no credits consumed/i)).toBeTruthy();
    expect(screen.getAllByText(/Contact \/ email credits/i).length).toBeGreaterThanOrEqual(1);
  });

  it("zero contact credits does NOT change the 'Free' discovery label", () => {
    render(<ProviderUsageIndicator usage={MOCK_HUNTER_USAGE_ZERO} state="ok" />);
    expect(screen.getByText(/Discovery · Free/)).toBeTruthy();
    // Contact bucket may render as 0 credits, but that's fine — Discovery is unaffected.
  });
});
