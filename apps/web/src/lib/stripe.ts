import { readFile } from "node:fs/promises";
import Stripe from "stripe";
import { assertStripeTestKey } from "./stripe-key";

const globalForStripe = globalThis as unknown as { __appshelfStripe?: Stripe };

export function getStripe(): Stripe {
  if (!globalForStripe.__appshelfStripe) {
    globalForStripe.__appshelfStripe = new Stripe(assertStripeTestKey(), {
      appInfo: { name: "AppShelf (demo)" },
    });
  }
  return globalForStripe.__appshelfStripe;
}

/**
 * The webhook signing secret. A real STRIPE_WEBHOOK_SECRET wins; otherwise the
 * file written by the stripe-cli container (STRIPE_WEBHOOK_SECRET_FILE) is read
 * on each call, because the CLI may write it after the server started.
 */
export async function getWebhookSecret(): Promise<string | null> {
  const fromEnv = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const file = process.env.STRIPE_WEBHOOK_SECRET_FILE;
  if (!file) return null;
  try {
    const value = (await readFile(file, "utf8")).trim();
    return value || null;
  } catch {
    return null;
  }
}
