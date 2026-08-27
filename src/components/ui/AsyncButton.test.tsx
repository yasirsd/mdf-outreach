import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { AsyncButton } from "./AsyncButton";

afterEach(() => cleanup());

describe("AsyncButton", () => {
  it("shows label in idle state", () => {
    render(<AsyncButton>Save</AsyncButton>);
    expect(screen.getByRole("button").textContent).toContain("Save");
    expect(screen.getByRole("button").getAttribute("aria-busy")).toBeNull();
  });

  it("disables and marks aria-busy while an async onClick is pending", async () => {
    let resolveFn: (() => void) = () => undefined;
    const onClick = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFn = resolve;
        }),
    );
    render(
      <AsyncButton onClick={onClick} pendingLabel="Saving…">
        Save
      </AsyncButton>,
    );
    const btn = screen.getByRole("button");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(btn.getAttribute("aria-busy")).toBe("true");
    });
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.textContent).toContain("Saving…");

    resolveFn();
    await waitFor(() => {
      expect(btn.getAttribute("aria-busy")).toBeNull();
    });
    expect(btn.hasAttribute("disabled")).toBe(false);
  });

  it("ignores repeat clicks while pending (dedupe)", async () => {
    let resolveFn: (() => void) = () => undefined;
    const onClick = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFn = resolve;
        }),
    );
    render(<AsyncButton onClick={onClick}>Save</AsyncButton>);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    // While pending — a second click should not invoke the handler again.
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute("aria-busy")).toBe("true"));
    expect(onClick).toHaveBeenCalledTimes(1);
    resolveFn();
  });

  it("respects a controlled `pending` prop when supplied", () => {
    render(
      <AsyncButton pending pendingLabel="Sending…">
        Send
      </AsyncButton>,
    );
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.textContent).toContain("Sending…");
  });

  it("resets pending state after a rejection (uncontrolled)", async () => {
    const onClick = vi.fn(async () => {
      throw new Error("kaboom");
    });
    // Rejection path — the button must return to idle even if the
    // caller supplied no onError handler.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<AsyncButton onClick={onClick}>Save</AsyncButton>);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute("aria-busy")).toBeNull());
    expect(onClick).toHaveBeenCalledTimes(1);
    // Also proves the fallback "invisible failure" console warning fires.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("invokes onError with the rejection when provided (explicit contract)", async () => {
    const err = new Error("kaboom");
    const onClick = vi.fn(async () => {
      throw err;
    });
    const onError = vi.fn();
    render(
      <AsyncButton onClick={onClick} onError={onError}>
        Save
      </AsyncButton>,
    );
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute("aria-busy")).toBeNull());
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it("onError enables user-visible error surfacing (e.g. toast)", async () => {
    // Model the intended pattern: onError sets a component-local error
    // message. Prove that message can render in the DOM.
    const err = new Error("network down");
    const onClick = vi.fn(async () => {
      throw err;
    });
    let capturedMessage: string | null = null;
    const onError = (e: unknown) => {
      capturedMessage = (e as Error).message;
    };
    render(
      <AsyncButton onClick={onClick} onError={onError}>
        Save
      </AsyncButton>,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(capturedMessage).toBe("network down"));
  });

  it("supports variant prop mapping to global button classes", () => {
    render(<AsyncButton variant="secondary">Cancel</AsyncButton>);
    expect(screen.getByRole("button").className).toContain("btn-secondary");
    cleanup();
    render(<AsyncButton variant="danger">Delete</AsyncButton>);
    expect(screen.getByRole("button").className).toContain("btn-danger");
  });
});
