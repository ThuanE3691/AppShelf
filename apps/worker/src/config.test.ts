import { describe, expect, it } from "vitest";
import { assertStripeTestKey, databaseUrlFromEnv, loadConfig } from "./config.js";
import { parseCreated } from "./wp-scripts.js";

describe("Stripe key guard", () => {
  it.each([undefined, "", "sk_live_abc", "rk_test_abc", "pk_test_abc"])("refuses %s", (key) => {
    expect(() => assertStripeTestKey(key)).toThrow(/test-mode/);
  });

  it("accepts a test-mode secret key", () => {
    expect(assertStripeTestKey("sk_test_123")).toBe("sk_test_123");
  });

  it("refuses to load a config with a live key", () => {
    expect(() => loadConfig({ DATABASE_URL: "postgres://x/y", STRIPE_SECRET_KEY: "sk_live_1" })).toThrow(/test-mode/);
  });
});

describe("config", () => {
  it("uses the contract defaults", () => {
    const config = loadConfig({ DATABASE_URL: "postgres://x/y", STRIPE_SECRET_KEY: "sk_test_1" });
    expect(config).toMatchObject({
      scriptsDir: "/opt/appshelf/wp",
      pollIntervalMs: 2_000,
      backoffBaseMs: 5_000,
      expiryIntervalMs: 300_000,
    });
    expect(config.scriptTimeoutMs).toBeLessThan(config.lockTimeoutMs);
  });

  it("builds DATABASE_URL from the generated Postgres password", () => {
    expect(databaseUrlFromEnv({ POSTGRES_PASSWORD: "p@ss/w" })).toBe(
      "postgres://appshelf:p%40ss%2Fw@postgres:5432/appshelf",
    );
  });
});

describe("script output", () => {
  it("reads the last JSON line of site-create.sh", () => {
    const out = 'Success: something\n{"blogId":12,"url":"http://wp.x/a/","adminUser":"a-admin","adminPassword":"pw"}\n';
    expect(parseCreated(out)).toEqual({ blogId: 12, url: "http://wp.x/a/", adminUser: "a-admin", adminPassword: "pw" });
  });

  it.each(["", "not json", '{"blogId":0,"url":"u","adminUser":"a","adminPassword":"p"}', '{"blogId":3}'])(
    "rejects %j",
    (out) => {
      expect(() => parseCreated(out)).toThrow();
    },
  );
});
