import { afterEach, describe, expect, it, vi } from "vitest";
import { assertStripeTestKey } from "./stripe-key";

describe("assertStripeTestKey (startup guard)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts a test-mode secret key", () => {
    expect(assertStripeTestKey("sk_test_abc123")).toBe("sk_test_abc123");
  });

  it.each([
    ["live secret key", "sk_live_abc123"],
    ["restricted live key", "rk_live_abc123"],
    ["publishable key", "pk_test_abc123"],
    ["empty string", ""],
  ])("refuses a %s", (_label, key) => {
    expect(() => assertStripeTestKey(key)).toThrow(/sk_test_/);
  });

  it("refuses when STRIPE_SECRET_KEY is missing", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", undefined);
    expect(() => assertStripeTestKey()).toThrow(/sk_test_/);
  });

  it("reads STRIPE_SECRET_KEY by default", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_from_env");
    expect(() => assertStripeTestKey()).toThrow(/Refusing to run/);
  });

  it("is enforced by the Stripe client factory", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_from_env");
    vi.resetModules();
    (globalThis as { __appshelfStripe?: unknown }).__appshelfStripe = undefined;
    const { getStripe } = await import("./stripe");
    expect(() => getStripe()).toThrow(/Refusing to run/);
  });
});
