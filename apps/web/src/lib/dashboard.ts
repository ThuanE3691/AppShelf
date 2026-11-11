import { getDb, jobs, licenses, sites, subscriptions, type Job, type License, type Site } from "@appshelf/db";
import { desc, eq, inArray, sql } from "drizzle-orm";

export interface DashboardSite {
  site: Site;
  license: License;
  subscription: { stripeSubscriptionId: string; status: string; stripeCustomerId: string | null } | null;
  lastJob: Pick<Job, "type" | "status" | "lastError" | "createdAt"> | null;
}

export async function getDashboardSites(userId: string): Promise<DashboardSite[]> {
  const db = getDb();
  const rows = await db
    .select({
      site: sites,
      license: licenses,
      subscription: {
        stripeSubscriptionId: subscriptions.stripeSubscriptionId,
        status: subscriptions.status,
        stripeCustomerId: subscriptions.stripeCustomerId,
      },
    })
    .from(sites)
    .innerJoin(licenses, eq(licenses.id, sites.licenseId))
    .leftJoin(subscriptions, eq(subscriptions.id, licenses.subscriptionId))
    .where(eq(sites.userId, userId))
    .orderBy(desc(sites.createdAt));

  const siteIds = rows.map((r) => r.site.id);
  const latest = new Map<string, DashboardSite["lastJob"]>();
  if (siteIds.length > 0) {
    const jobRows = await db
      .selectDistinctOn([sql`${jobs.payload}->>'siteId'`], {
        siteId: sql<string>`${jobs.payload}->>'siteId'`,
        type: jobs.type,
        status: jobs.status,
        lastError: jobs.lastError,
        createdAt: jobs.createdAt,
      })
      .from(jobs)
      .where(inArray(sql`${jobs.payload}->>'siteId'`, siteIds))
      .orderBy(sql`${jobs.payload}->>'siteId'`, desc(jobs.createdAt));
    for (const { siteId, ...job } of jobRows) latest.set(siteId, job);
  }

  return rows.map((r) => ({ ...r, lastJob: latest.get(r.site.id) ?? null }));
}

export async function getOwnedSite(userId: string, siteId: string) {
  const [row] = (await getDashboardSites(userId)).filter((r) => r.site.id === siteId);
  return row ?? null;
}

/** Renew is offered while the site still exists and its 48 hours are not over. */
export function canRenew(entry: DashboardSite, now = new Date()): boolean {
  return (
    entry.license.status === "inactive" &&
    !["deleting", "deleted", "failed"].includes(entry.site.status) &&
    entry.site.expiresAt > now
  );
}

export function canCancel(entry: DashboardSite): boolean {
  return entry.license.status === "active" && entry.subscription !== null && entry.subscription.status !== "canceled";
}
