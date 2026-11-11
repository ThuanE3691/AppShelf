// Lifecycle rule 4: sites delete themselves 48 h after creation. The pass runs
// when the worker starts (catch-up after downtime) and every 5 minutes.
// Each step is idempotent and safe to run from several workers at once.
import { enqueueJob, licenses, sites, subscriptions, type Database } from "@appshelf/db";
import { and, eq, sql } from "drizzle-orm";
import { errorMessage, type Logger } from "./log.js";
import { interruptibleSleep } from "./sleep.js";

/** Subscription statuses that can still bill the customer. */
const BILLABLE_STATUSES = ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"];

export interface SubscriptionCanceller {
  /** Cancels now; resolves with the resulting Stripe status (already-canceled is fine). */
  cancel(stripeSubscriptionId: string): Promise<{ status: string; canceledAt: Date | null }>;
}

/**
 * Expired sites that are not deleted and have no open `site.delete` job.
 * A failed delete job is retried by the next pass.
 */
export async function findExpiredSites(db: Database, now: Date = new Date()) {
  const rows = await db.execute<{ id: string }>(sql`
    select s.id
      from sites s
     where s.expires_at <= ${now.toISOString()}::timestamptz
       and s.status <> 'deleted'
       and not exists (
         select 1 from jobs j
          where j.type = 'site.delete'
            and j.status in ('queued', 'running')
            and j.payload->>'siteId' = s.id::text)
     order by s.expires_at`);
  return [...rows].map((r) => r.id);
}

/**
 * Gives each expired site exactly one open `site.delete` job, marks it
 * `deleting` and sets its license `inactive`. Returns the site ids it queued.
 */
export async function enqueueExpiredDeletes(db: Database, now: Date = new Date()): Promise<string[]> {
  const queued: string[] = [];
  for (const siteId of await findExpiredSites(db, now)) {
    const done = await db.transaction(async (tx) => {
      // Lock the site first; another worker may be on it.
      const locked = await tx.execute<{ id: string; license_id: string }>(sql`
        select s.id, s.license_id from sites s
         where s.id = ${siteId} and s.status <> 'deleted'
         for update skip locked`);
      const site = locked[0];
      if (!site) return false;
      // Re-check in a new statement: its snapshot includes a delete job that a
      // worker committed while we waited, which a subquery of the locking
      // statement would not see.
      const open = await tx.execute(sql`
        select 1 from jobs j
         where j.type = 'site.delete'
           and j.status in ('queued', 'running')
           and j.payload->>'siteId' = ${siteId}
         limit 1`);
      if (open.length > 0) return false;

      await enqueueJob("site.delete", { siteId }, { db: tx });
      await tx.update(sites).set({ status: "deleting" }).where(eq(sites.id, siteId));
      await tx
        .update(licenses)
        .set({ status: "inactive", deactivatedAt: new Date() })
        .where(and(eq(licenses.id, site.license_id), eq(licenses.status, "active")));
      return true;
    });
    if (done) queued.push(siteId);
  }
  return queued;
}

/** Stripe subscriptions behind expired sites that can still bill. */
export async function findBillableExpiredSubscriptions(db: Database, now: Date = new Date()) {
  const rows = await db.execute<{ id: string; stripe_subscription_id: string }>(sql`
    select distinct sub.id, sub.stripe_subscription_id
      from sites s
      join licenses l on l.id = s.license_id
      join subscriptions sub on sub.id = l.subscription_id
     where s.expires_at <= ${now.toISOString()}::timestamptz
       and sub.status in (${sql.join(BILLABLE_STATUSES.map((s) => sql`${s}`), sql`, `)})`);
  return [...rows].map((r) => ({ id: r.id, stripeSubscriptionId: r.stripe_subscription_id }));
}

/** Cancels those subscriptions in Stripe and mirrors the result. Failures retry next pass. */
export async function cancelExpiredSubscriptions(
  db: Database,
  canceller: SubscriptionCanceller,
  log: Logger,
  now: Date = new Date(),
): Promise<string[]> {
  const canceled: string[] = [];
  for (const sub of await findBillableExpiredSubscriptions(db, now)) {
    try {
      const result = await canceller.cancel(sub.stripeSubscriptionId);
      await db
        .update(subscriptions)
        .set({ status: result.status, canceledAt: result.canceledAt ?? new Date() })
        .where(eq(subscriptions.id, sub.id));
      canceled.push(sub.stripeSubscriptionId);
      log.info("subscription canceled for expired site", { subscriptionId: sub.id, status: result.status });
    } catch (error) {
      log.error("could not cancel subscription; will retry next pass", {
        subscriptionId: sub.id,
        error: errorMessage(error),
      });
    }
  }
  return canceled;
}

export interface ExpiryPassResult {
  deletesQueued: string[];
  subscriptionsCanceled: string[];
}

export async function runExpiryPass(
  db: Database,
  canceller: SubscriptionCanceller,
  log: Logger,
): Promise<ExpiryPassResult> {
  const deletesQueued = await enqueueExpiredDeletes(db);
  const subscriptionsCanceled = await cancelExpiredSubscriptions(db, canceller, log);
  if (deletesQueued.length || subscriptionsCanceled.length) {
    log.info("expiry pass", { deletesQueued: deletesQueued.length, subscriptionsCanceled: subscriptionsCanceled.length });
  }
  return { deletesQueued, subscriptionsCanceled };
}

/** Runs the pass now and then every `intervalMs` until `stop()`. */
export function startExpiryLoop(options: {
  db: Database;
  canceller: SubscriptionCanceller;
  log: Logger;
  intervalMs: number;
}): { stop: () => Promise<void> } {
  const sleeper = interruptibleSleep();
  let stopping = false;
  const loop = (async () => {
    while (!stopping) {
      try {
        await runExpiryPass(options.db, options.canceller, options.log);
      } catch (error) {
        options.log.error("expiry pass failed", { error: errorMessage(error) });
      }
      if (!stopping) await sleeper.sleep(options.intervalMs);
    }
  })();
  return {
    stop: async () => {
      stopping = true;
      sleeper.wake();
      await loop;
    },
  };
}
