import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` is a Next.js marker that throws when imported into
      // client bundles. Vitest is neither — stub it out so server-side
      // modules are unit-testable in the node environment.
      "server-only": path.resolve(__dirname, "./src/test/shims/server-only.ts"),
    },
  },
});
