import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AnnualImportPoint, OriginRankRow } from "@/lib/marketIntelligence/read/overview";
import {
  buildChartSeriesGeometry,
  ImportDemandChart,
  IndiaShareChart,
  OriginCompetitionChart,
} from "./MarketIntelligenceCharts";

afterEach(() => cleanup());

const history: AnnualImportPoint[] = [
  { period: "2022", totalUsd: 10_000_000, totalTonnes: 1_000, indiaValueUsd: 2_000_000, indiaShare: 0.2 },
  { period: "2023", totalUsd: 12_000_000, totalTonnes: 1_100, indiaValueUsd: 3_600_000, indiaShare: 0.3 },
  { period: "2024", totalUsd: 9_000_000, totalTonnes: 900, indiaValueUsd: 3_600_000, indiaShare: 0.4 },
];

describe("MI2B analytical charts", () => {
  it("passes persisted annual import values into the demand chart", () => {
    const { container } = render(<ImportDemandChart history={history} />);
    expect(screen.getByText("Import demand", { selector: "h4" })).toBeTruthy();
    expect(container.querySelector('[data-chart-point="2022"]')?.getAttribute("aria-label"))
      .toContain("$10.0M");
    expect(container.querySelector('[data-chart-point="2024"]')?.getAttribute("aria-label"))
      .toContain("$9.0M");
    expect(screen.getByText("Imports decreased 25.0% in 2024.")).toBeTruthy();
  });

  it("passes persisted India share and India value into accessible chart points", () => {
    const { container } = render(<IndiaShareChart history={history} />);
    const latest = container.querySelector('[data-chart-point="2024"]');
    expect(latest?.getAttribute("aria-label")).toContain("India share 40.0%");
    expect(latest?.getAttribute("aria-label")).toContain("India import value $3.6M");
    expect(screen.getByText("India supplied 40.0% of recorded imports in 2024.")).toBeTruthy();
  });

  it("keeps a missing calendar period as a visual gap", () => {
    const geometry = buildChartSeriesGeometry([
      { period: "2020", value: 10 },
      { period: "2022", value: 12 },
    ]);
    expect(geometry?.segments).toHaveLength(2);
    expect(geometry?.segments.every((segment) => segment.length === 1)).toBe(true);
  });

  it("does not fabricate a trend from one year", () => {
    const { container } = render(<ImportDemandChart history={[history[2]!]} />);
    expect(container.querySelectorAll("[data-series-segment]")).toHaveLength(0);
    expect(screen.getByText("One year of evidence is available; no trend is shown.")).toBeTruthy();
  });

  it("renders an honest unavailable state when the persisted series has no values", () => {
    render(<IndiaShareChart history={[
      { period: "2024", totalUsd: 1, totalTonnes: null, indiaValueUsd: null, indiaShare: null },
    ]} />);
    expect(screen.getByText("Not available")).toBeTruthy();
  });

  it("uses only the latest-period origin rows and limits competition to the top five", () => {
    const origins: OriginRankRow[] = [
      { partnerCountry: "CN", partnerCountryName: "China", valueUsd: 50, share: 0.5 },
      { partnerCountry: "IN", partnerCountryName: "India", valueUsd: 30, share: 0.3 },
      { partnerCountry: "TH", partnerCountryName: "Thailand", valueUsd: 10, share: 0.1 },
      { partnerCountry: "VN", partnerCountryName: "Vietnam", valueUsd: 5, share: 0.05 },
      { partnerCountry: "LK", partnerCountryName: "Sri Lanka", valueUsd: 3, share: 0.03 },
      { partnerCountry: "US", partnerCountryName: "United States", valueUsd: 2, share: 0.02 },
    ];
    render(<OriginCompetitionChart origins={origins} latestPeriod="2024" />);
    expect(screen.getByText("China")).toBeTruthy();
    expect(screen.getAllByText("India").length).toBeGreaterThan(0);
    expect(screen.queryByText("United States")).toBeNull();
  });
});
