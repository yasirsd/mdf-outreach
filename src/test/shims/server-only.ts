// Vitest shim for Next.js's `server-only` marker. In real builds the
// package throws to prevent client-side imports; under tests we just
// import it as a no-op so server-only modules can be unit-tested.
export {};
