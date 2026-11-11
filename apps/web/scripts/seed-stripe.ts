// Idempotent seed: makes sure the WordPress Site product and its monthly price
// exist in Stripe (test mode only) and upserts the matching `products` row.
// Run with `npm run seed -w @appshelf/web`; the web image runs a bundled copy on start.
import { createDb, products } from "@appshelf/db";
import Stripe from "stripe";
import { assertStripeTestKey } from "../src/lib/stripe-key.ts";

const PRODUCT_SLUG = "wordpress-site";
const LOOKUP_KEY = "appshelf_wp_site_monthly";
const PRICE_CENTS = 900;
const CURRENCY = "usd";
const NAME = "WordPress Site";
const DESCRIPTION =
  "One hosted WordPress site on the AppShelf Multisite network, built from the template you choose.";

async function ensureStripePrice(stripe: Stripe): Promise<Stripe.Price> {
  const existing = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], active: true, limit: 1 });
  const found = existing.data[0];
  if (found) return found;

  const searched = await stripe.products.search({ query: `metadata['appshelf_slug']:'${PRODUCT_SLUG}'`, limit: 1 });
  const product =
    searched.data[0] ??
    (await stripe.products.create({
      name: `AppShelf ${NAME} (demo)`,
      description: DESCRIPTION,
      metadata: { appshelf_slug: PRODUCT_SLUG, appshelf_type: "wordpress_site" },
    }));

  return stripe.prices.create({
    product: product.id,
    unit_amount: PRICE_CENTS,
    currency: CURRENCY,
    recurring: { interval: "month" },
    lookup_key: LOOKUP_KEY,
    transfer_lookup_key: true,
    metadata: { appshelf_slug: PRODUCT_SLUG },
  });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const stripe = new Stripe(assertStripeTestKey());

  const price = await ensureStripePrice(stripe);
  const productId = typeof price.product === "string" ? price.product : price.product.id;
  const values = {
    name: NAME,
    type: "wordpress_site" as const,
    description: DESCRIPTION,
    stripeProductId: productId,
    stripePriceId: price.id,
    priceCents: price.unit_amount ?? PRICE_CENTS,
    currency: price.currency,
    interval: price.recurring?.interval ?? "month",
    active: true,
    metadata: { templates: ["restaurant", "agency", "services"], lookupKey: LOOKUP_KEY },
  };

  const { db, close } = createDb(databaseUrl, { max: 1 });
  try {
    await db
      .insert(products)
      .values({ slug: PRODUCT_SLUG, ...values })
      .onConflictDoUpdate({ target: products.slug, set: { ...values, updatedAt: new Date() } });
  } finally {
    await close();
  }
  console.log(`seed: product ${PRODUCT_SLUG} ready (Stripe ${productId}, price ${price.id})`);
}

main().catch((error: unknown) => {
  console.error("seed: failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
