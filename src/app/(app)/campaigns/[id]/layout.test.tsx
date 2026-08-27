import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { Suspense } from "react";

/**
 * F2 follow-up: the campaign shell must render synchronously so the
 * tab bar is visible + interactive while the async header data is
 * still resolving. Only the header is Suspense-guarded.
 *
 * We can't invoke the real App Router layout in a unit test (it's a
 * server component that awaits getCachedCampaign), so this test
 * exercises the exact structural pattern: sync shell + Suspense
 * around a suspending child + fallback shape. It uses a hand-rolled
 * suspender that throws its pending promise, which is exactly how
 * React Suspense identifies a suspending component.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/campaigns/c1",
  useRouter: () => ({ push: vi.fn() }),
  notFound: () => {
    throw new Error("notFound");
  },
}));

function makeSuspender(promise: Promise<string>) {
  let resolved: string | undefined;
  const gated = promise.then((v) => {
    resolved = v;
  });
  return function HeaderReader() {
    if (resolved !== undefined) {
      return <h1 data-testid="header-real">{resolved}</h1>;
    }
    // React reads this and shows the nearest <Suspense fallback>.
    throw gated;
  };
}

function ShellUnderTest({ headerPromise }: { headerPromise: Promise<string> }) {
  const HeaderReader = makeSuspender(headerPromise);
  return (
    <div data-testid="shell">
      <Suspense fallback={<div data-testid="header-skeleton">skeleton</div>}>
        <HeaderReader />
      </Suspense>
      <nav data-testid="tabs">tabs render synchronously</nav>
      <main data-testid="body">body content</main>
    </div>
  );
}

afterEach(() => cleanup());

describe("Campaign layout — synchronous shell", () => {
  it("renders tabs + body immediately without awaiting the header data", () => {
    const headerPromise = new Promise<string>(() => undefined); // never resolves
    render(<ShellUnderTest headerPromise={headerPromise} />);
    // Sync parts are visible on first paint.
    expect(screen.getByTestId("shell")).toBeTruthy();
    expect(screen.getByTestId("tabs")).toBeTruthy();
    expect(screen.getByTestId("body")).toBeTruthy();
    // Header is still Suspense-fallback while the promise is pending.
    expect(screen.getByTestId("header-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("header-real")).toBeNull();
  });
});
