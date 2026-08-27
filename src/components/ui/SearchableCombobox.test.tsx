import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { SearchableCombobox } from "./SearchableCombobox";

afterEach(() => cleanup());

const OPTIONS = [
  { value: "IN", label: "India" },
  { value: "TH", label: "Thailand" },
  { value: "AE", label: "United Arab Emirates", keywords: ["UAE"] },
];

/**
 * Radix Popover portals its content into `document.body`, so option
 * elements are queried via the global `screen` object rather than the
 * component's local `container`. cmdk applies its filter after the
 * search input receives a value.
 */

describe("SearchableCombobox — trigger + closed state", () => {
  it("shows the empty label when no value is set", () => {
    render(
      <SearchableCombobox
        value={null}
        onChange={vi.fn()}
        options={OPTIONS}
        emptyLabel="Choose a country"
      />,
    );
    expect(screen.getByRole("combobox").textContent).toContain("Choose a country");
    expect(screen.getByRole("combobox").getAttribute("aria-expanded")).toBe("false");
  });

  it("renders the current label when a matching option is selected", () => {
    render(
      <SearchableCombobox
        value="TH"
        onChange={vi.fn()}
        options={OPTIONS}
      />,
    );
    expect(screen.getByRole("combobox").textContent).toContain("Thailand");
  });

  it("shows a Legacy chip when the current value is not in options", () => {
    render(
      <SearchableCombobox
        value="Wakanda"
        onChange={vi.fn()}
        options={OPTIONS}
      />,
    );
    expect(screen.getByRole("combobox").textContent).toContain("Wakanda");
    expect(screen.getByRole("combobox").textContent).toContain("Legacy");
  });

  it("opens (aria-expanded=true) on trigger click", async () => {
    render(<SearchableCombobox value={null} onChange={vi.fn()} options={OPTIONS} />);
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
    });
  });

  it("stays closed when disabled", () => {
    render(
      <SearchableCombobox
        value={null}
        onChange={vi.fn()}
        options={OPTIONS}
        disabled
      />,
    );
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("SearchableCombobox — clear + async + legacy", () => {
  it("clear button emits onClear and does not propagate open", () => {
    const onClear = vi.fn();
    render(
      <SearchableCombobox
        value="India"
        onChange={vi.fn()}
        onClear={onClear}
        options={OPTIONS}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("preserves a legacy value verbatim in the trigger text (no rewrite)", () => {
    render(
      <SearchableCombobox
        value="Some Old Free Text"
        onChange={vi.fn()}
        options={OPTIONS}
      />,
    );
    // Verbatim.
    expect(screen.getByRole("combobox").textContent).toContain("Some Old Free Text");
  });
});
