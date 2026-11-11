import path from "node:path";
import { defineConfig } from "vitest/config";

const dbSrc = path.resolve(import.meta.dirname, "../../packages/db/src");

export default defineConfig({
  resolve: {
    alias: [
      // Test against the db package source so no build step is needed.
      { find: /^@appshelf\/db\/testing$/, replacement: `${dbSrc}/testing.ts` },
      { find: /^@appshelf\/db$/, replacement: `${dbSrc}/index.ts` },
    ],
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globalSetup: ["src/test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
