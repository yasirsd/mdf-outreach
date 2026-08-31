import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PublicWebsiteCapabilityChip } from "./PublicWebsiteCapabilityChip";

afterEach(() => cleanup());

describe("PublicWebsiteCapabilityChip", () => {
  it("always shows Contacts · Free", () => {
    render(<PublicWebsiteCapabilityChip state="ready" />);
    expect(screen.getByLabelText("Company website contacts · Free")).toBeTruthy();
    expect(screen.queryByText(/Hunter/i)).toBeNull();
    expect(screen.queryByText(/credit/i)).toBeNull();
    expect(screen.queryByText(/Disabled/i)).toBeNull();
  });
});
