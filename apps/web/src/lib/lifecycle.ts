// Lifecycle rules 1-3 from docs/contracts.md. Every function here is idempotent:
// the webhook, the checkout success page and the dashboard may all apply the
// same Stripe object, in any order and more than once.
import {
  BILLABLE_SUBSCRIPTION_STATUSES,
  enqueueJob,
  getDb,
  licenses,
  sites,
  stripeEvents,
  subscriptions,
  type Database,
  type Executor,
  type Subscription,
} from "@appshelf/db";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { isTemplate, siteUrl, SITE_LIFETIME_MS } from "./config";
import { getStripe } from "./stripe";

/** Metadata AppShelf puts on Checkout sessions and their subscriptions. */
export type CheckoutMetadata =
  | { kind: "new"; userId: string; productId: string; template: string; slug: string; title: string }
  | { kind: "renew"; userId: string; productId: string; licenseId: string; siteId: string };

const ENDED_STATUSES = new Set(["canceled", "unpaid"]);
const UNTOUCHABLE_SITE_STATUSES = new Set(["deleting", "deleted"]);

export type EventOutcome = "processed" | "ignored" | "duplicate";

/** Applies one verified webhook event exactly once (stripe_events is the guard). */
export async function processStripeEvent(event: Stripe.Event, db: Database = getDb()): Promise<EventOutcome> {
  let renewedLicenseId: string | null = null;
  const outcome = await db.transaction(async (tx): Promise<EventOutcome> => {
    const inserted = await tx
      .insert(stripeEvents)
      .values({ id: event.id, type: event.type })
      .onConflictDoNothing()
      .returning({ id: stripeEvents.id });
    if (inserted.length === 0) return "duplicate";

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        renewedLicenseId = await applyCheckoutSession(tx, event.data.object);
        return "processed";
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await applySubscription(tx, event.data.object);
        return "processed";
      default:
        return "ignored";
    }
  });
  if (renewedLicenseId) await cancelReplacedSubscriptions(renewedLicenseId, db);
  return outcome;
}

/** Success-page fallback: read the session from Stripe and apply rule 1 or 3. */
export async function syncCheckoutSession(sessionId: string, db: Database = getDb()) {
  const session = await getStripe().checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
  const renewedLicenseId = await db.transaction((tx) => applyCheckoutSession(tx, session));
  if (renewedLicenseId) await cancelReplacedSubscriptions(renewedLicenseId, db);
  return session;
}

type BillableRow = { id: string; stripeSubscriptionId: string };

const isBillable = () => inArray(subscriptions.status, [...BILLABLE_SUBSCRIPTION_STATUSES]);

/** Cancels each subscription in Stripe (test key only) and applies the result; returns the failures. */
async function cancelInStripe(rows: BillableRow[], db: Database): Promise<unknown[]> {
  const stripe = getStripe();
  const errors: unknown[] = [];
  for (const row of rows) {
    try {
      let subscription = await stripe.subscriptions.retrieve(row.stripeSubscriptionId);
      if (subscription.status !== "canceled" && subscription.status !== "incomplete_expired") {
        subscription = await stripe.subscriptions.cancel(row.stripeSubscriptionId);
      }
      const ended = subscription;
      await db.transaction((tx) => applySubscription(tx, ended));
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

/**
 * Dashboard "Cancel plan": cancels every subscription that can still bill this
 * license (the current one and any a renewal replaced) and applies rule 2 now.
 */
export async function cancelLicenseSubscriptions(licenseId: string, db: Database = getDb()): Promise<void> {
  const [license] = await db.select().from(licenses).where(eq(licenses.id, licenseId)).limit(1);
  if (!license) throw new Error(`Unknown license ${licenseId}`);
  const linked = license.subscriptionId
    ? or(eq(subscriptions.licenseId, licenseId), eq(subscriptions.id, license.subscriptionId))
    : eq(subscriptions.licenseId, licenseId);
  const rows = await db
    .select({ id: subscriptions.id, stripeSubscriptionId: subscriptions.stripeSubscriptionId })
    .from(subscriptions)
    .where(and(linked, isBillable()));
  const errors = await cancelInStripe(rows, db);
  if (errors.length > 0) {
    throw new AggregateError(errors, `Could not cancel ${errors.length} subscription(s) of license ${licenseId}`);
  }
}

/**
 * After a renewal: cancels the subscriptions the license used before that can
 * still bill (for example a second paid Renew tab). Failures are only logged:
 * the worker's expiry pass retries them.
 */
export async function cancelReplacedSubscriptions(licenseId: string, db: Database = getDb()): Promise<void> {
  const [license] = await db.select().from(licenses).where(eq(licenses.id, licenseId)).limit(1);
  if (!license?.subscriptionId) return;
  const rows = await db
    .select({ id: subscriptions.id, stripeSubscriptionId: subscriptions.stripeSubscriptionId })
    .from(subscriptions)
    .where(and(eq(subscriptions.licenseId, licenseId), ne(subscriptions.id, license.subscriptionId), isBillable()));
  for (const error of await cancelInStripe(rows, db)) {
    console.error(`could not cancel a replaced subscription of license ${licenseId}; the worker retries`, error);
  }
}

function readMetadata(metadata: Stripe.Metadata | null | undefined): CheckoutMetadata | null {
  const m = metadata ?? {};
  if (!m.userId || !m.productId) return null;
  if (m.kind === "renew" && m.licenseId && m.siteId) {
    return { kind: "renew", userId: m.userId, productId: m.productId, licenseId: m.licenseId, siteId: m.siteId };
  }
  if (m.kind === "new" && m.template && m.slug && m.title) {
    return { kind: "new", userId: m.userId, productId: m.productId, template: m.template, slug: m.slug, title: m.title };
  }
  return null;
}

const toDate = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000) : null);
const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null);

function periodEnd(subscription: Stripe.Subscription): Date | null {
  // Since API version 2025-03-31 the period lives on the subscription items.
  const fromItems = subscription.items?.data?.[0]?.current_period_end;
  const legacy = (subscription as unknown as { current_period_end?: number }).current_period_end;
  return toDate(fromItems ?? legacy);
}

/** Serialises work on one Stripe subscription across concurrent requests. */
async function lockSubscription(tx: Executor, stripeSubscriptionId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${stripeSubscriptionId}))`);
}

async function upsertSubscription(
  tx: Executor,
  values: {
    stripeSubscriptionId: string;
    userId: string;
    productId: string;
    stripeCustomerId: string | null;
    status?: string;
    currentPeriodEnd?: Date | null;
    canceledAt?: Date | null;
  },
): Promise<Subscription> {
  // Fields Stripe sent us win; fields it did not send keep what we have.
  const update: Partial<typeof subscriptions.$inferInsert> = { updatedAt: new Date() };
  if (values.stripeCustomerId) update.stripeCustomerId = values.stripeCustomerId;
  if (values.status) update.status = values.status;
  if (values.currentPeriodEnd !== undefined) update.currentPeriodEnd = values.currentPeriodEnd;
  if (values.canceledAt !== undefined) update.canceledAt = values.canceledAt;

  const [row] = await tx
    .insert(subscriptions)
    .values({ ...values, status: values.status ?? "active" })
    .onConflictDoUpdate({ target: subscriptions.stripeSubscriptionId, set: update })
    .returning();
  if (!row) throw new Error("Subscription upsert returned no row");
  return row;
}

/**
 * Rule 1 (new site) and rule 3 (renew) for a completed Checkout session.
 * Returns the license id when a renewal links it to this subscription, so the
 * caller can cancel the subscriptions it replaced once the transaction commits.
 */
export async function applyCheckoutSession(tx: Executor, session: Stripe.Checkout.Session): Promise<string | null> {
  if (session.mode !== "subscription") return null;
  if (session.status !== "complete") return null;
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") return null;

  const stripeSubscriptionId = idOf(session.subscription);
  const meta = readMetadata(session.metadata);
  if (!stripeSubscriptionId || !meta) return null;

  await lockSubscription(tx, stripeSubscriptionId);

  const expanded = typeof session.subscription === "object" ? session.subscription : null;
  const subscription = await upsertSubscription(tx, {
    stripeSubscriptionId,
    userId: meta.userId,
    productId: meta.productId,
    stripeCustomerId: idOf(session.customer),
    ...(expanded
      ? { status: expanded.status, currentPeriodEnd: periodEnd(expanded), canceledAt: toDate(expanded.canceled_at) }
      : {}),
  });

  if (meta.kind === "renew") {
    return applyRenewal(tx, subscription, meta);
  }

  const [existing] = await tx
    .select({ id: licenses.id })
    .from(licenses)
    .where(eq(licenses.subscriptionId, subscription.id))
    .limit(1);
  if (existing) return null; // Already applied by the other path.

  if (!isTemplate(meta.template)) throw new Error(`Unknown template in checkout metadata: ${meta.template}`);

  const now = new Date();
  const [license] = await tx
    .insert(licenses)
    .values({
      userId: meta.userId,
      productId: meta.productId,
      subscriptionId: subscription.id,
      status: "active",
      activatedAt: now,
    })
    .returning();
  if (!license) throw new Error("License insert returned no row");
  await tx.update(subscriptions).set({ licenseId: license.id }).where(eq(subscriptions.id, subscription.id));

  const site = await insertSiteWithFreeSlug(tx, {
    userId: meta.userId,
    licenseId: license.id,
    template: meta.template,
    title: meta.title,
    slug: meta.slug,
    expiresAt: new Date(now.getTime() + SITE_LIFETIME_MS),
  });
  await enqueueJob("site.provision", { siteId: site.id }, { db: tx });
  return null;
}

/** The slug was free at checkout time; if someone took it since, add a short suffix. */
async function insertSiteWithFreeSlug(
  tx: Executor,
  values: Omit<typeof sites.$inferInsert, "url" | "status">,
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? values.slug : `${values.slug.slice(0, 25)}-${randomSuffix()}`;
    const [site] = await tx
      .insert(sites)
      .values({ ...values, slug, url: siteUrl(slug), status: "pending" })
      .onConflictDoNothing({ target: sites.slug })
      .returning();
    if (site) return site;
  }
  throw new Error(`Could not find a free slug for ${values.slug}`);
}

const randomSuffix = () => Math.random().toString(36).slice(2, 6);

async function applyRenewal(
  tx: Executor,
  subscription: Subscription,
  meta: Extract<CheckoutMetadata, { kind: "renew" }>,
): Promise<string | null> {
  const [license] = await tx
    .select()
    .from(licenses)
    .where(and(eq(licenses.id, meta.licenseId), eq(licenses.userId, meta.userId)))
    .limit(1);
  if (!license) throw new Error(`Renewal for unknown license ${meta.licenseId}`);
  if (license.subscriptionId === subscription.id && license.status === "active") return license.id;
  // Linked once already: a replayed session (success page reload, late duplicate)
  // must not take the license back from a newer renewal or revive an ended plan.
  if (subscription.licenseId === license.id) return null;

  await tx
    .update(licenses)
    .set({ subscriptionId: subscription.id, status: "active", activatedAt: new Date(), deactivatedAt: null })
    .where(eq(licenses.id, license.id));
  await tx.update(subscriptions).set({ licenseId: license.id }).where(eq(subscriptions.id, subscription.id));

  const [site] = await tx
    .select({ id: sites.id, status: sites.status })
    .from(sites)
    .where(and(eq(sites.id, meta.siteId), eq(sites.licenseId, license.id)))
    .limit(1);
  if (site && !UNTOUCHABLE_SITE_STATUSES.has(site.status)) {
    await enqueueJob("site.unarchive", { siteId: site.id }, { db: tx });
  }
  return license.id;
}

/** Mirrors a Stripe subscription and applies rule 2 when it has ended. */
export async function applySubscription(tx: Executor, stripeSub: Stripe.Subscription): Promise<void> {
  await lockSubscription(tx, stripeSub.id);

  const meta = readMetadata(stripeSub.metadata);
  const mirrored = {
    stripeCustomerId: idOf(stripeSub.customer),
    status: stripeSub.status,
    currentPeriodEnd: periodEnd(stripeSub),
    canceledAt: toDate(stripeSub.canceled_at),
  };

  let subscription: Subscription | undefined;
  if (meta) {
    subscription = await upsertSubscription(tx, {
      stripeSubscriptionId: stripeSub.id,
      userId: meta.userId,
      productId: meta.productId,
      ...mirrored,
    });
  } else {
    const update: Partial<typeof subscriptions.$inferInsert> = {
      status: mirrored.status,
      currentPeriodEnd: mirrored.currentPeriodEnd,
      canceledAt: mirrored.canceledAt,
    };
    if (mirrored.stripeCustomerId) update.stripeCustomerId = mirrored.stripeCustomerId;
    [subscription] = await tx
      .update(subscriptions)
      .set(update)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSub.id))
      .returning();
  }
  if (!subscription || !ENDED_STATUSES.has(stripeSub.status)) return;

  // Only the license currently linked to this subscription is affected, so a
  // late event for a replaced (renewed) subscription changes nothing.
  const deactivated = await tx
    .update(licenses)
    .set({ status: "inactive", deactivatedAt: new Date() })
    .where(and(eq(licenses.subscriptionId, subscription.id), eq(licenses.status, "active")))
    .returning({ id: licenses.id });

  for (const license of deactivated) {
    const [site] = await tx
      .select({ id: sites.id, status: sites.status })
      .from(sites)
      .where(eq(sites.licenseId, license.id))
      .limit(1);
    if (site && !UNTOUCHABLE_SITE_STATUSES.has(site.status)) {
      await enqueueJob("site.archive", { siteId: site.id }, { db: tx });
    }
  }
}
