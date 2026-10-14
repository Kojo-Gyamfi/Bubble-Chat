import path from "node:path";
import { defineConfig } from "vitest/config";

// Firestore rules tests; need the emulator (`npm run test:rules` starts it).
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "node",
    include: ["tests/rules/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
