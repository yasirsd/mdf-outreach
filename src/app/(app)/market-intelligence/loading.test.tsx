import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import MarketIntelligenceLoading from "./loading";

afterEach(() => cleanup());

describe("MI2B route loading shell", () => {
  it("matches the summary, ranking, detail and chart layout without fake data", () => {
    const { container } = render(<MarketIntelligenceLoading />);
    const region = screen.getByRole("main", { name: "Loading Market Intelligence" });
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Loading Market Intelligence");
    expect(container.querySelectorAll(".mdf-skeleton").length).toBeGreaterThan(40);
    expect(container.querySelectorAll("[role='dialog']")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/\$\d|2024|United States|Malaysia|66 \/ 100/);
  });

  it("keeps all placeholder shapes hidden from assistive technology", () => {
    const { container } = render(<MarketIntelligenceLoading />);
    for (const skeleton of container.querySelectorAll(".mdf-skeleton")) {
      expect(skeleton.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
