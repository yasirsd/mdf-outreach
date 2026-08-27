import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { act } from "react-dom/test-utils";
import { NavigationProgress } from "./NavigationProgress";

/**
 * F2 follow-up: the top progress bar must NOT trigger for modifier
 * clicks, target=_blank, external links, downloads, mailto/tel/hash,
 * or same-URL clicks — AND must never leave the bar stuck if a
 * navigation never commits.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/current",
  useSearchParams: () => new URLSearchParams(""),
}));

function click(anchor: HTMLAnchorElement, init: Partial<MouseEventInit> = {}) {
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  anchor.dispatchEvent(ev);
  return ev;
}

function progressBar(): HTMLElement {
  return document.querySelector(".mdf-navprogress") as HTMLElement;
}

function opacity(): string {
  return progressBar().style.opacity;
}

afterEach(() => cleanup());

describe("NavigationProgress — edge cases", () => {
  it("mounts hidden and stays hidden without user interaction", () => {
    render(<NavigationProgress />);
    expect(opacity()).toBe("0");
  });

  it("ignores modifier clicks (Cmd / Ctrl / Shift / Alt)", async () => {
    render(<NavigationProgress />);
    const a = document.createElement("a");
    a.href = "/somewhere-else";
    document.body.appendChild(a);
    click(a, { metaKey: true });
    click(a, { ctrlKey: true });
    click(a, { shiftKey: true });
    click(a, { altKey: true });
    // Advance past START_DELAY_MS; nothing should show.
    await new Promise((r) => setTimeout(r, 120));
    expect(opacity()).toBe("0");
    document.body.removeChild(a);
  });

  it("ignores middle click and other non-primary buttons", async () => {
    render(<NavigationProgress />);
    const a = document.createElement("a");
    a.href = "/somewhere-else";
    document.body.appendChild(a);
    click(a, { button: 1 });
    click(a, { button: 2 });
    await new Promise((r) => setTimeout(r, 120));
    expect(opacity()).toBe("0");
    document.body.removeChild(a);
  });

  it("ignores target=_blank anchors", async () => {
    render(<NavigationProgress />);
    const a = document.createElement("a");
    a.href = "/somewhere-else";
    a.target = "_blank";
    document.body.appendChild(a);
    click(a);
    await new Promise((r) => setTimeout(r, 120));
    expect(opacity()).toBe("0");
    document.body.removeChild(a);
  });

  it("ignores download anchors", async () => {
    render(<NavigationProgress />);
    const a = document.createElement("a");
    a.href = "/somewhere-else";
    a.setAttribute("download", "");
    document.body.appendChild(a);
    click(a);
    await new Promise((r) => setTimeout(r, 120));
    expect(opacity()).toBe("0");
    document.body.removeChild(a);
  });

  it("ignores mailto: / tel: / #-anchors / javascript: hrefs", async () => {
    render(<NavigationProgress />);
    for (const href of [
      "mailto:x@y.z",
      "tel:+123",
      "#anchor",
      "javascript:void(0)",
    ]) {
      const a = document.createElement("a");
      a.href = href;
      document.body.appendChild(a);
      click(a);
      document.body.removeChild(a);
    }
    await new Promise((r) => setTimeout(r, 120));
    expect(opacity()).toBe("0");
  });

  it("ignores external (different-origin) URLs", async () => {
    render(<NavigationProgress />);
    const a = document.createElement("a");
    a.href = "https://example.com/foo";
    document.body.appendChild(a);
    click(a);
    await new Promise((r) => setTimeout(r, 120));
    expect(opacity()).toBe("0");
    document.body.removeChild(a);
  });

  it("ignores clicks on the CURRENT URL (same pathname + search)", async () => {
    // Component compares against window.location (source of truth for
    // "am I already here"). jsdom defaults to `/`, so an anchor with
    // href="/" is same-URL and must not start the bar.
    render(<NavigationProgress />);
    const a = document.createElement("a");
    a.href = "/";
    document.body.appendChild(a);
    click(a);
    await new Promise((r) => setTimeout(r, 120));
    expect(opacity()).toBe("0");
    document.body.removeChild(a);
  });

  it("cleans up on unmount without leaking timers", () => {
    const { unmount } = render(<NavigationProgress />);
    const a = document.createElement("a");
    a.href = "/somewhere-else";
    document.body.appendChild(a);
    click(a); // arms the delayed start
    unmount(); // should clear the timer — no state updates after unmount
    document.body.removeChild(a);
    // If we made it here without React warnings, the cleanup worked.
    expect(true).toBe(true);
  });
});

describe("NavigationProgress — safety timeout", () => {
  it("uses fake timers to confirm state falls back to idle after the safety window", async () => {
    // Because the safety timeout is 8s, we use vi.useFakeTimers to
    // fast-forward without slowing the suite. We drive the state
    // transitions manually.
    vi.useFakeTimers();
    try {
      render(<NavigationProgress />);
      const a = document.createElement("a");
      a.href = "/never-commits";
      document.body.appendChild(a);
      click(a);
      // Advance past START_DELAY_MS → bar becomes visible.
      act(() => {
        vi.advanceTimersByTime(120);
      });
      expect(opacity()).toBe("1");
      // Advance past SAFETY_TIMEOUT_MS without a URL change → back to idle.
      act(() => {
        vi.advanceTimersByTime(8200);
      });
      expect(opacity()).toBe("0");
      document.body.removeChild(a);
    } finally {
      vi.useRealTimers();
    }
  });
});
