// Real rows in the test database plus Stripe-shaped webhook payloads. The
// payloads are signed with stripe.webhooks.generateTestHeaderString, exactly
// like `stripe trigger` deliveries; no Stripe API call is made.
import { closeDb, getDb, jobs, licenses, products, sites, subscriptions, users } from "@appshelf/db";
import { truncateAll, testDatabaseUrl } from "@appshelf/db/testing";
import { asc } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, beforeEach } from "vitest";
import { POST } from "@/app/api/stripe/webhook/route";
import { getStripe } from "@/lib/stripe";

export function withCleanDatabase() {
  beforeEach(async () => truncateAll(testDatabaseUrl()));
  afterAll(async () => closeDb());
}

export async function seedUserAndProduct(email = "buyer@example.com") {
  const db = getDb();
  const [user] = await db.insert(users).values({ email, passwordHash: "not-used" }).returning();
  const [product] = await db
    .insert(products)
    .values({
      slug: "wordpress-site",
      name: "WordPress Site",
      type: "wordpress_site",
      stripeProductId: "prod_test",
      stripePriceId: "price_test",
      priceCents: 900,
    })
    .returning();
  if (!user || !product) throw new Error("seed failed");
  return { user, product };
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`;

function event(type: string, object: unknown, id = nextId("evt_test")): Stripe.Event {
  return {
    id,
    object: "event",
    type,
    api_version: "2026-01-01",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object },
  } as unknown as Stripe.Event;
}

export function checkoutCompletedEvent(input: {
  subscriptionId: string;
  customerId?: string;
  metadata: Record<string, string>;
  eventId?: string;
}): Stripe.Event {
  return event(
    "checkout.session.completed",
    {
      id: nextId("cs_test"),
      object: "checkout.session",
      mode: "subscription",
      status: "complete",
      payment_status: "paid",
      customer: input.customerId ?? "cus_test_1",
      subscription: input.subscriptionId,
      metadata: input.metadata,
    },
    input.eventId,
  );
}

export function subscriptionEvent(
  type: "customer.subscription.created" | "customer.subscription.updated" | "customer.subscription.deleted",
  input: { subscriptionId: string; status: string; metadata?: Record<string, string>; customerId?: string },
): Stripe.Event {
  const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  return event(type, {
    id: input.subscriptionId,
    object: "subscription",
    status: input.status,
    customer: input.customerId ?? "cus_test_1",
    canceled_at: input.status === "canceled" ? Math.floor(Date.now() / 1000) : null,
    metadata: input.metadata ?? {},
    items: { object: "list", data: [{ id: "si_test", current_period_end: periodEnd }] },
  });
}

/** Signs the payload like Stripe does and calls the real route handler. */
export async function deliver(evt: Stripe.Event, options: { secret?: string } = {}) {
  const payload = JSON.stringify(evt);
  const header = getStripe().webhooks.generateTestHeaderString({
    payload,
    secret: options.secret ?? process.env.STRIPE_WEBHOOK_SECRET!,
  });
  const response = await POST(
    new Request("http://app.test.localhost/api/stripe/webhook", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": header, "content-type": "application/json" },
    }),
  );
  return { status: response.status, body: (await response.json()) as { outcome?: string; error?: string } };
}

export async function snapshot() {
  const db = getDb();
  const [allSubscriptions, allLicenses, allSites, allJobs] = await Promise.all([
    db.select().from(subscriptions).orderBy(asc(subscriptions.createdAt)),
    db.select().from(licenses).orderBy(asc(licenses.createdAt)),
    db.select().from(sites).orderBy(asc(sites.createdAt)),
    db.select().from(jobs).orderBy(asc(jobs.createdAt)),
  ]);
  return { subscriptions: allSubscriptions, licenses: allLicenses, sites: allSites, jobs: allJobs };
}
