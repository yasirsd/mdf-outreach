import { afterEach, describe, expect, it } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { Field } from "./Field";
import { FormSection } from "./FormSection";
import { Badge } from "./Badge";
import { EmptyState } from "./EmptyState";

afterEach(() => cleanup());

describe("Field", () => {
  it("renders a label + child input + associates hint via aria-describedby", () => {
    render(
      <Field id="x" label="Email" hint="We never share this.">
        <input id="x" />
      </Field>,
    );
    const input = screen.getByRole("textbox");
    // The wrapping <div> carries aria-describedby pointing at the hint node.
    const wrap = input.parentElement as HTMLElement;
    expect(wrap.getAttribute("aria-describedby")).toBe("x-desc");
    expect(document.getElementById("x-desc")?.textContent).toContain("We never");
  });

  it("shows an error message and hides hint when error is present", () => {
    render(
      <Field id="x" label="Email" hint="hint text" error="Invalid email">
        <input id="x" />
      </Field>,
    );
    expect(document.getElementById("x-desc")?.textContent).toContain("Invalid email");
    expect(document.getElementById("x-desc")?.textContent).not.toContain("hint text");
  });

  it("required marker appears when required", () => {
    render(
      <Field id="x" label="Company" required>
        <input id="x" />
      </Field>,
    );
    // The asterisk is aria-hidden but visible.
    expect(screen.getByText(/Company/).parentElement?.textContent).toContain("*");
  });
});

describe("FormSection", () => {
  it("renders the title + description + children", () => {
    render(
      <FormSection title="Identity" description="Who this buyer is.">
        <div data-testid="child">x</div>
      </FormSection>,
    );
    expect(screen.getByText("Identity")).toBeTruthy();
    expect(screen.getByText("Who this buyer is.")).toBeTruthy();
    expect(screen.getByTestId("child")).toBeTruthy();
  });
});

describe("Badge", () => {
  it("renders label text so status is never color-only", () => {
    render(<Badge tone="success">Ready</Badge>);
    expect(screen.getByText("Ready")).toBeTruthy();
  });
  it("accepts an icon slot for extra clarity", () => {
    render(
      <Badge tone="danger" icon={<span data-testid="ico">!</span>}>
        Blocked
      </Badge>,
    );
    expect(screen.getByTestId("ico")).toBeTruthy();
    expect(screen.getByText("Blocked")).toBeTruthy();
  });
});

describe("EmptyState", () => {
  it("shows eyebrow + title + body + actions", () => {
    render(
      <EmptyState
        eyebrow="No campaigns yet"
        title="Get started"
        body="Create your first campaign."
        actions={<button>New</button>}
      />,
    );
    expect(screen.getByText("No campaigns yet")).toBeTruthy();
    expect(screen.getByText("Get started")).toBeTruthy();
    expect(screen.getByText("Create your first campaign.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New" })).toBeTruthy();
  });
});
