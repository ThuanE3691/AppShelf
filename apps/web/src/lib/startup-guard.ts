import { assertStripeTestKey } from "./stripe-key";

/** Stops the Node.js server at boot unless a Stripe test-mode key is configured. */
export function enforceStripeTestMode(): void {
  try {
    assertStripeTestKey();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
