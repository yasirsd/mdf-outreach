import "fake-indexeddb/auto";

// jsdom lacks ResizeObserver + IntersectionObserver + a few Element APIs
// that Radix / cmdk assume are present. Provide minimal no-op shims so
// component tests run instead of throwing at commit time.

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
}

// Radix uses `Element.hasPointerCapture` for pointer interactions;
// jsdom doesn't implement it.
if (typeof Element !== "undefined" && !Element.prototype.hasPointerCapture) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Element.prototype as any).hasPointerCapture = () => false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Element.prototype as any).setPointerCapture = () => undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Element.prototype as any).releasePointerCapture = () => undefined;
}

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Element.prototype as any).scrollIntoView = () => undefined;
}
