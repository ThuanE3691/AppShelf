import type { Product, SiteTemplate, User } from "@appshelf/db";
import type Stripe from "stripe";
import { appUrl } from "./config";
import type { CheckoutMetadata } from "./lifecycle";
import { getStripe } from "./stripe";

function baseParams(product: Product, metadata: CheckoutMetadata, cancelPath: string): Stripe.Checkout.SessionCreateParams {
  if (!product.stripePriceId) throw new Error("The product has no Stripe price yet. Run the seed script.");
  return {
    mode: "subscription",
    line_items: [{ price: product.stripePriceId, quantity: 1 }],
    client_reference_id: metadata.userId,
    metadata,
    // The subscription carries the same metadata so its own webhooks can be mapped back.
    subscription_data: { metadata },
    success_url: `${appUrl()}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl()}${cancelPath}`,
  };
}

export async function createSiteCheckout(input: {
  user: User;
  product: Product;
  template: SiteTemplate;
  title: string;
  slug: string;
}): Promise<string> {
  const metadata: CheckoutMetadata = {
    kind: "new",
    userId: input.user.id,
    productId: input.product.id,
    template: input.template,
    slug: input.slug,
    title: input.title,
  };
  const session = await getStripe().checkout.sessions.create({
    ...baseParams(input.product, metadata, `/sites/new?template=${input.template}`),
    customer_email: input.user.email,
  });
  if (!session.url) throw new Error("Stripe did not return a Checkout URL");
  return session.url;
}

export async function createRenewCheckout(input: {
  user: User;
  product: Product;
  licenseId: string;
  siteId: string;
  stripeCustomerId: string | null;
}): Promise<string> {
  const metadata: CheckoutMetadata = {
    kind: "renew",
    userId: input.user.id,
    productId: input.product.id,
    licenseId: input.licenseId,
    siteId: input.siteId,
  };
  const session = await getStripe().checkout.sessions.create({
    ...baseParams(input.product, metadata, "/dashboard"),
    ...(input.stripeCustomerId ? { customer: input.stripeCustomerId } : { customer_email: input.user.email }),
  });
  if (!session.url) throw new Error("Stripe did not return a Checkout URL");
  return session.url;
}
