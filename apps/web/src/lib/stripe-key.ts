// No imports on purpose: the seed script loads this file directly with Node.

/**
 * AppShelf is a demo and must never touch live money. Anything other than a
 * Stripe test-mode secret key (sk_test_...) stops the process.
 */
export function assertStripeTestKey(key: string | undefined = process.env.STRIPE_SECRET_KEY): string {
  if (!key || !key.startsWith("sk_test_")) {
    throw new Error(
      "Refusing to run: STRIPE_SECRET_KEY must be a Stripe test-mode secret key (sk_test_...). " +
        "AppShelf is a demo and never takes live payments.",
    );
  }
  return key;
}
