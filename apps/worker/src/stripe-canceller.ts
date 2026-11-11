import Stripe from "stripe";
import { assertStripeTestKey } from "./config.js";
import type { SubscriptionCanceller } from "./expiry.js";

const toDate = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000) : null);

/** Cancels Stripe subscriptions with a test-mode key only. */
export function stripeCanceller(secretKey: string): SubscriptionCanceller {
  const stripe = new Stripe(assertStripeTestKey(secretKey), { appInfo: { name: "AppShelf worker (demo)" } });
  return {
    async cancel(id) {
      let subscription: Stripe.Subscription;
      try {
        subscription = await stripe.subscriptions.retrieve(id);
      } catch (error) {
        // Gone from Stripe (for example a deleted test customer): nothing can bill.
        if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing") {
          return { status: "canceled", canceledAt: new Date() };
        }
        throw error;
      }
      if (subscription.status !== "canceled" && subscription.status !== "incomplete_expired") {
        subscription = await stripe.subscriptions.cancel(id);
      }
      return { status: subscription.status, canceledAt: toDate(subscription.canceled_at) };
    },
  };
}
