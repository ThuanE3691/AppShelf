import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;
const dbSrc = path.resolve(root, "../../packages/db/src");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: `${path.resolve(root, "src")}/$1` },
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
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      // Real Postgres; Stripe is only used to sign and verify webhook payloads (no API calls).
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      STRIPE_SECRET_KEY: "sk_test_vitest_no_api_calls",
      STRIPE_WEBHOOK_SECRET: "whsec_vitest_signing_secret",
      APP_URL: "http://app.test.localhost",
      WP_PUBLIC_URL: "http://wp.test.localhost",
    },
  },
});
