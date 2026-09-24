import { describe, expect, it } from "vitest";
import {
  formatPercent,
  formatPercentValue,
  formatRank,
  formatScoreOutOf100,
  formatTonnes,
  formatUsdCompact,
  formatUsdPerKg,
  MI2A_EM_DASH,
} from "./format";

describe("MI2A formatters", () => {
  it("USD compact: 117_349_258 → $117.3M", () => {
    expect(formatUsdCompact(117_349_258)).toBe("$117.3M");
    expect(formatUsdCompact(5_400)).toBe("$5.4K");
    expect(formatUsdCompact(900)).toBe("$900");
    expect(formatUsdCompact(0)).toBe("$0");
    expect(formatUsdCompact(null)).toBe(MI2A_EM_DASH);
    expect(formatUsdCompact(undefined)).toBe(MI2A_EM_DASH);
    expect(formatUsdCompact(Number.NaN)).toBe(MI2A_EM_DASH);
    expect(formatUsdCompact(-1_234_000)).toBe("-$1.2M");
  });

  it("Percent: 0.434085 → 43.4%; 0 → 0.0%; null → —", () => {
    expect(formatPercent(0.434085)).toBe("43.4%");
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(null)).toBe(MI2A_EM_DASH);
  });

  it("Percent value (input already %): 3.4297 → 3.4%", () => {
    expect(formatPercentValue(3.4297)).toBe("3.4%");
    expect(formatPercentValue(null)).toBe(MI2A_EM_DASH);
  });

  it("USD/kg: 2.406999 → $2.41/kg", () => {
    expect(formatUsdPerKg(2.406999)).toBe("$2.41/kg");
    expect(formatUsdPerKg(null)).toBe(MI2A_EM_DASH);
  });

  it("Tonnes: 48753.344 → 48.8K t; 900 → 900 t; null → —", () => {
    expect(formatTonnes(48_753.344)).toBe("48.8K t");
    expect(formatTonnes(900)).toBe("900 t");
    expect(formatTonnes(null)).toBe(MI2A_EM_DASH);
    expect(formatTonnes(2_500_000)).toBe("2.5M t");
  });

  it("Score / rank", () => {
    expect(formatScoreOutOf100(66)).toBe("66 / 100");
    expect(formatScoreOutOf100(null)).toBe(MI2A_EM_DASH);
    expect(formatRank(1)).toBe("#1");
    expect(formatRank(null)).toBe(MI2A_EM_DASH);
  });
});
