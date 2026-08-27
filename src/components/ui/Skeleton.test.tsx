import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import {
  Skeleton,
  SkeletonRow,
  SkeletonTable,
  SkeletonText,
} from "./Skeleton";

afterEach(() => cleanup());

describe("Skeleton primitives", () => {
  it("Skeleton renders a presentational element hidden from AT", () => {
    const { container } = render(<Skeleton height={20} width="50%" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute("role")).toBe("presentation");
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.className).toContain("mdf-skeleton");
    expect(el.style.height).toBe("20px");
  });

  it("SkeletonText renders one Skeleton per line", () => {
    const { container } = render(<SkeletonText lines={4} />);
    expect(container.querySelectorAll(".mdf-skeleton")).toHaveLength(4);
  });

  it("SkeletonRow uses N grid columns", () => {
    const { container } = render(<SkeletonRow columns={5} />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.style.gridTemplateColumns).toContain("repeat(5");
  });

  it("SkeletonTable renders header + N rows × M columns", () => {
    const { container } = render(<SkeletonTable rows={7} columns={3} />);
    // Header row (3 columns) + 7 data rows × 3 columns = 3 + 21 = 24
    expect(container.querySelectorAll(".mdf-skeleton").length).toBe(3 + 7 * 3);
  });
});
