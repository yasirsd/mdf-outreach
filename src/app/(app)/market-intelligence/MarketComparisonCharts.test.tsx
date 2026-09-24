import { describe, expect, it } from "vitest";
import { buildComparisonChartGeometry } from "./MarketComparisonCharts";

describe("MI3 comparison chart geometry", () => {
  it("uses one shared scale for all countries", () => {
    const geometry = buildComparisonChartGeometry([
      { key: "US", label: "United States", points: [{ period: "2023", value: 100 }, { period: "2024", value: 200 }] },
      { key: "TH", label: "Thailand", points: [{ period: "2023", value: 50 }, { period: "2024", value: 100 }] },
    ]);
    expect(geometry?.maxValue).toBe(200);
    const us2024 = geometry?.series[0]?.points[1];
    const th2024 = geometry?.series[1]?.points[1];
    expect(us2024!.y).toBeLessThan(th2024!.y);
  });

  it("preserves missing-year gaps instead of joining them", () => {
    const geometry = buildComparisonChartGeometry([
      { key: "US", label: "United States", points: [{ period: "2021", value: 10 }, { period: "2023", value: 30 }] },
    ]);
    expect(geometry?.series[0]?.segments).toHaveLength(2);
    expect(geometry?.series[0]?.segments.every((segment) => segment.length === 1)).toBe(true);
  });

  it("renders one-year evidence as a point-only series", () => {
    const geometry = buildComparisonChartGeometry([
      { key: "MY", label: "Malaysia", points: [{ period: "2024", value: 57 }] },
    ]);
    expect(geometry?.minYear).toBe(2024);
    expect(geometry?.maxYear).toBe(2024);
    expect(geometry?.series[0]?.points).toHaveLength(1);
    expect(geometry?.series[0]?.segments).toHaveLength(1);
  });

  it("returns null for entirely missing values", () => {
    expect(buildComparisonChartGeometry([
      { key: "MY", label: "Malaysia", points: [{ period: "2024", value: null }] },
    ])).toBeNull();
  });

  it("caps chart geometry at four series", () => {
    const geometry = buildComparisonChartGeometry(["US", "TH", "MY", "AE", "JP"].map((key) => ({
      key,
      label: key,
      points: [{ period: "2024", value: 1 }],
    })));
    expect(geometry?.series).toHaveLength(4);
    expect(geometry?.series.map((series) => series.key)).toEqual(["US", "TH", "MY", "AE"]);
  });
});
