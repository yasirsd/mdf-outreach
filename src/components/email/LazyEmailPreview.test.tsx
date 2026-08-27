import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { LazyEmailPreview } from "./LazyEmailPreview";

afterEach(() => cleanup());

describe("LazyEmailPreview", () => {
  it("does not mount an iframe on initial paint", () => {
    // No IntersectionObserver in jsdom → component falls back to
    // immediate mount. Delete the global to simulate not-yet-observed.
    const stash = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    // Provide a stub that never fires — component stays on the placeholder.
    class NoopIO {
      observe() {}
      disconnect() {}
    }
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = NoopIO;
    const { container } = render(<LazyEmailPreview html="<p>x</p>" />);
    // No <iframe> in the DOM before the observer fires.
    expect(container.querySelector("iframe")).toBeNull();
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = stash;
  });

  it("mounts the iframe when `activate` is true (explicit preview)", async () => {
    // Stub IntersectionObserver so the effect never auto-mounts.
    class NoopIO {
      observe() {}
      disconnect() {}
    }
    const stash = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = NoopIO;
    const { container, rerender } = render(
      <LazyEmailPreview html="<p>x</p>" activate={false} />,
    );
    expect(container.querySelector("iframe")).toBeNull();
    await act(async () => {
      rerender(<LazyEmailPreview html="<p>x</p>" activate={true} />);
    });
    expect(container.querySelector("iframe")).toBeTruthy();
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = stash;
  });

  it("gracefully falls back when IntersectionObserver is unavailable", () => {
    const stash = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    const { container } = render(<LazyEmailPreview html="<p>x</p>" />);
    // No observer → mount immediately.
    expect(container.querySelector("iframe")).toBeTruthy();
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = stash;
  });
});
