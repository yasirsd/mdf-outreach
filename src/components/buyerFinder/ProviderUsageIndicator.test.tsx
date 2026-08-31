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
    expect(screen.getByText(/People · Free/)).toBeTruthy();
  });

  it("labels remaining credits as personal reveal, not free discovery", () => {
    render(<ProviderUsageIndicator usage={MOCK_HUNTER_USAGE} state="ok" />);
    expect(screen.getByText(/Personal reveal · 50 credits/)).toBeTruthy();
    expect(screen.getByText(/People · Free/)).toBeTruthy();
  });

  it("shows Not configured and no Discovery · Disabled when Hunter has no key", () => {
    render(<ProviderUsageIndicator usage={null} state="not_configured" />);
    expect(screen.getByText("Not configured")).toBeTruthy();
    expect(screen.queryByText(/Discovery · Disabled/)).toBeNull();
    expect(screen.queryByText(/People · Free/)).toBeNull();
    expect(screen.queryByText(/credits/i)).toBeNull();
  });

  it("shows 'Discovery · Free' + 'Usage unavailable' when the usage endpoint fails", () => {
    render(<ProviderUsageIndicator usage={null} state="unavailable" />);
    expect(screen.getByText(/People · Free/)).toBeTruthy();
    expect(screen.getByText(/Usage unavailable/)).toBeTruthy();
  });

  it("modal separates free discovery from contact/email credits", () => {
    render(<ProviderUsageIndicator usage={MOCK_HUNTER_USAGE} state="ok" />);
    fireEvent.click(screen.getByRole("button", { name: /Hunter · People · Free/i }));
    expect(screen.getAllByText(/Company discovery/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Decision-maker discovery/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Email\/contact reveal/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/no credits consumed/i)).toBeTruthy();
    expect(screen.getAllByText(/Contact \/ email credits/i).length).toBeGreaterThanOrEqual(1);
  });

  it("shows personal reveal copy when the dedicated reveal gate is ready", () => {
    render(<ProviderUsageIndicator usage={MOCK_HUNTER_USAGE} state="ok" hunterReveal="ready" />);
    fireEvent.click(screen.getByRole("button", { name: /Hunter · People · Free/i }));
    expect(screen.getAllByText(/Personal contact reveal/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Up to 1 Hunter Search credit per person/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Locked. Reveal is not available on this server.")).toBeNull();
  });

  it("zero contact credits does NOT change the 'Free' discovery label", () => {
    render(<ProviderUsageIndicator usage={MOCK_HUNTER_USAGE_ZERO} state="ok" />);
    expect(screen.getByText(/People · Free/)).toBeTruthy();
    // Contact bucket may render as 0 credits, but that's fine — Discovery is unaffected.
  });
});
