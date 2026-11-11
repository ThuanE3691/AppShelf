import { enqueueJob, jobs, licenses, sites, subscriptions } from "@appshelf/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  cancelExpiredSubscriptions,
  enqueueExpiredDeletes,
  findExpiredSites,
  runExpiryPass,
  type SubscriptionCanceller,
} from "./expiry.js";
import { createSiteFixture, log, openTestDb, resetDb } from "./test/fixtures.js";

const handle = openTestDb();
const { db } = handle;
afterAll(() => handle.close());
beforeEach(() => resetDb());

const past = () => new Date(Date.now() - 60_000);

/** Records calls instead of talking to Stripe; the real canceller is exercised end to end. */
function recordingCanceller(fail = false) {
  const calls: string[] = [];
  const canceller: SubscriptionCanceller = {
    async cancel(id) {
      calls.push(id);
      if (fail) throw new Error("Stripe is down");
      return { status: "canceled", canceledAt: new Date() };
    },
  };
  return { calls, canceller };
}

describe("expiry selector", () => {
  it("selects expired sites that are not deleted and have no open delete job", async () => {
    const expired = await createSiteFixture(db, { site: { status: "active", expiresAt: past() } });
    const archived = await createSiteFixture(db, { site: { status: "archived", expiresAt: past() } });
    await createSiteFixture(db, { site: { status: "active" } }); // not expired
    await createSiteFixture(db, { site: { status: "deleted", expiresAt: past() } });
    const withOpenJob = await createSiteFixture(db, { site: { status: "deleting", expiresAt: past() } });
    await enqueueJob("site.delete", { siteId: withOpenJob.site.id }, { db });
    const withFailedJob = await createSiteFixture(db, { site: { status: "deleting", expiresAt: past() } });
    const failed = await enqueueJob("site.delete", { siteId: withFailedJob.site.id }, { db });
    await db.update(jobs).set({ status: "failed" }).where(eq(jobs.id, failed.id));

    const ids = await findExpiredSites(db);
    expect(ids.sort()).toEqual([expired.site.id, archived.site.id, withFailedJob.site.id].sort());
  });

  it("queues exactly one delete per site, marks it deleting and the license inactive", async () => {
    const { site, license } = await createSiteFixture(db, { site: { status: "active", expiresAt: past() } });

    expect(await enqueueExpiredDeletes(db)).toEqual([site.id]);
    expect(await enqueueExpiredDeletes(db)).toEqual([]);

    const queued = await db.select().from(jobs).where(eq(jobs.type, "site.delete"));
    expect(queued).toHaveLength(1);
    expect(queued[0]?.payload).toEqual({ siteId: site.id });
    const [siteRow] = await db.select().from(sites).where(eq(sites.id, site.id));
    expect(siteRow?.status).toBe("deleting");
    const [licenseRow] = await db.select().from(licenses).where(eq(licenses.id, license.id));
    expect(licenseRow?.status).toBe("inactive");
    expect(licenseRow?.deactivatedAt).not.toBeNull();
  });

  it("stays at one delete job when several workers run the pass at once", async () => {
    for (let round = 0; round < 10; round++) {
      await resetDb();
      const fixtures = await Promise.all(
        Array.from({ length: 5 }, () => createSiteFixture(db, { site: { status: "active", expiresAt: past() } })),
      );
      const results = await Promise.all(Array.from({ length: 4 }, () => enqueueExpiredDeletes(db)));
      expect(results.flat().sort()).toEqual(fixtures.map((f) => f.site.id).sort());
      expect(await db.select().from(jobs)).toHaveLength(5);
    }
  });
});

describe("subscription cancellation", () => {
  it("cancels the still-billing subscription of an expired site once", async () => {
    const expired = await createSiteFixture(db, { site: { status: "active", expiresAt: past() } });
    await createSiteFixture(db, { site: { status: "active" } }); // not expired
    await createSiteFixture(db, { site: { status: "archived", expiresAt: past() }, subscriptionStatus: "canceled" });
    const { calls, canceller } = recordingCanceller();

    const first = await runExpiryPass(db, canceller, log);
    expect(first.deletesQueued).toHaveLength(2);
    expect(calls).toEqual([expired.subscription.stripeSubscriptionId]);
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, expired.subscription.id));
    expect(sub?.status).toBe("canceled");
    expect(sub?.canceledAt).not.toBeNull();

    const second = await runExpiryPass(db, canceller, log);
    expect(second).toEqual({ deletesQueued: [], subscriptionsCanceled: [] });
    expect(calls).toHaveLength(1);
  });

  it("after two renewals cancels the replaced subscription now and the current one at expiry", async () => {
    const fixture = await createSiteFixture(db, { site: { status: "active" }, subscriptionStatus: "canceled" });
    const renewal = (stripeSubscriptionId: string) =>
      db
        .insert(subscriptions)
        .values({
          userId: fixture.site.userId,
          productId: fixture.subscription.productId,
          stripeSubscriptionId,
          status: "active",
          licenseId: fixture.license.id,
        })
        .returning()
        .then((rows) => rows[0]!);
    // Renew paid in two tabs: the license ends up on the second subscription.
    await renewal("sub_renew_first");
    const second = await renewal("sub_renew_second");
    await db.update(licenses).set({ subscriptionId: second.id }).where(eq(licenses.id, fixture.license.id));
    const { calls, canceller } = recordingCanceller();

    await runExpiryPass(db, canceller, log);
    expect(calls).toEqual(["sub_renew_first"]);
    await runExpiryPass(db, canceller, log);
    expect(calls).toEqual(["sub_renew_first"]);

    await db.update(sites).set({ expiresAt: past() }).where(eq(sites.id, fixture.site.id));
    await runExpiryPass(db, canceller, log);
    expect(calls).toEqual(["sub_renew_first", "sub_renew_second"]);
    const billing = await db.select().from(subscriptions).where(eq(subscriptions.status, "active"));
    expect(billing).toEqual([]);
  });

  it("keeps the subscription for the next pass when Stripe fails", async () => {
    const { subscription } = await createSiteFixture(db, { site: { status: "active", expiresAt: past() } });
    const down = recordingCanceller(true);
    expect(await cancelExpiredSubscriptions(db, down.canceller, log)).toEqual([]);
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id));
    expect(sub?.status).toBe("active");

    const up = recordingCanceller();
    expect(await cancelExpiredSubscriptions(db, up.canceller, log)).toEqual([subscription.stripeSubscriptionId]);
  });
});
