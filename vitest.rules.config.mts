import { defineConfig } from "vitest/config";
import path from "node:path";

// Separate from the main suite: these need a running Firestore emulator, which
// `npm run test:rules` provides. Keeping them out of `npm test` means the fast
// suite never depends on Java being installed.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["firestore/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
