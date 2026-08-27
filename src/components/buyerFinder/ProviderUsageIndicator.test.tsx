import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProviderUsageIndicator } from "./ProviderUsageIndicator";
import {
  MOCK_HUNTER_USAGE,
  MOCK_HUNTER_USAGE_NO_RESET,
  MOCK_HUNTER_USAGE_SPLIT,
  MOCK_HUNTER_USAGE_ZERO,
} from "@/lib/buyerFinder/mock/usage";

afterEach(() => cleanup());

describe("ProviderUsageIndicator", () => {
  it("renders remaining credits and a progress bar", () => {
    render(<ProviderUsageIndicator usage={MOCK_HUNTER_USAGE} />);
    expect(screen.getByRole("button", { name: /50 remaining/i })).toBeTruthy();
    expect(screen.getAllByRole("progressbar", { hidden: true }).length).toBeGreaterThanOrEqual(1);
  });

  it("opens a details popup with reset date, free Discover guidance, and credit warnings", () => {
    render(<ProviderUsageIndicator usage={MOCK_HUNTER_USAGE} />);
    fireEvent.click(screen.getByRole("button", { name: /hunter usage/i }));
    expect(screen.getByText("Hunter usage")).toBeTruthy();
    expect(screen.getByText("Resets Oct 15, 2026")).toBeTruthy();
    expect(screen.getByText("Credits")).toBeTruthy();
    expect(screen.getByText("Search credits")).toBeTruthy();
    expect(screen.getByText("Verification credits")).toBeTruthy();
    expect(screen.getAllByText("0 used").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("50 available").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("FREE · 0 credits")).toBeTruthy();
    expect(screen.getByText("Hunter Discover")).toBeTruthy();
    expect(screen.getAllByText("USES CREDITS").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Domain Search/)).toBeTruthy();
    expect(screen.getByText("Email Verifier")).toBeTruthy();
  });

  it("renders split search and verification quotas without a fake unified credits block", () => {
    render(<ProviderUsageIndicator usage={MOCK_HUNTER_USAGE_SPLIT} />);
    fireEvent.click(screen.getByRole("button", { name: /hunter usage/i }));
    expect(screen.getByText("Search credits")).toBeTruthy();
    expect(screen.getByText("Verification credits")).toBeTruthy();
    expect(screen.queryByText(/^Credits$/)).toBeNull();
    expect(screen.getByText("10 used")).toBeTruthy();
    expect(screen.getByText("5 used")).toBeTruthy();
  });

  it("handles a missing reset date", () => {
    render(<ProviderUsageIndicator usage={MOCK_HUNTER_USAGE_NO_RESET} />);
    fireEvent.click(screen.getByRole("button", { name: /hunter usage/i }));
    expect(screen.getByText("Reset date unavailable")).toBeTruthy();
    expect(screen.queryByText(/Resets /)).toBeNull();
  });

  it("handles a zero-credit state", () => {
    render(<ProviderUsageIndicator usage={MOCK_HUNTER_USAGE_ZERO} />);
    expect(screen.getByRole("button", { name: /0 remaining/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /hunter usage/i }));
    expect(screen.getByText("0 used")).toBeTruthy();
    expect(screen.getByText("0 available")).toBeTruthy();
  });

  it("disables refresh instead of faking a Hunter call", () => {
    render(<ProviderUsageIndicator usage={MOCK_HUNTER_USAGE} />);
    fireEvent.click(screen.getByRole("button", { name: /hunter usage/i }));
    const refresh = screen.getByRole("button", { name: /refresh usage/i });
    expect(refresh.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Live usage will be enabled with provider connection/i)).toBeTruthy();
  });
});
