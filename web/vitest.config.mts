import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
      // `server-only` throws outside a React Server Components bundle.
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
