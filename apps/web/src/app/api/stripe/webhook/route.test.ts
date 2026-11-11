import { getDb, sites, stripeEvents } from "@appshelf/db";
import { describe, expect, it, vi } from "vitest";
import { cancelLicenseSubscriptions, processStripeEvent } from "@/lib/lifecycle";
import {
  checkoutCompletedEvent,
  deliver,
  seedUserAndProduct,
  snapshot,
  stubStripeSubscriptions,
  subscriptionEvent,
  withCleanDatabase,
} from "@/test/fixtures";

withCleanDatabase();

const HOUR = 3600_000;

async function completeNewSite(slug = "luna-bistro") {
  const { user, product } = await seedUserAndProduct();
  const metadata = { kind: "new", userId: user.id, productId: product.id, template: "restaurant", slug, title: "Luna Bistro" };
  const evt = checkoutCompletedEvent({ subscriptionId: "sub_first", metadata });
  const res = await deliver(evt);
  return { user, product, evt, res, metadata };
}

describe("POST /api/stripe/webhook", () => {
  it("rejects a payload with a bad signature and writes nothing", async () => {
    const { user, product } = await seedUserAndProduct();
    const evt = checkoutCompletedEvent({
      subscriptionId: "sub_forged",
      metadata: { kind: "new", userId: user.id, productId: product.id, template: "agency", slug: "forged", title: "x" },
    });
    const res = await deliver(evt, { secret: "whsec_someone_else" });

    expect(res.status).toBe(400);
    const state = await snapshot();
    expect(state.licenses).toHaveLength(0);
    expect(await getDb().select().from(stripeEvents)).toHaveLength(0);
  });

  it("checkout completed: license active, site pending for 48 h, provision job queued", async () => {
    const { user, res } = await completeNewSite();

    expect(res).toEqual({ status: 200, body: { received: true, outcome: "processed" } });
    const state = await snapshot();
    expect(state.subscriptions).toHaveLength(1);
    expect(state.subscriptions[0]).toMatchObject({ stripeSubscriptionId: "sub_first", status: "active", userId: user.id });

    expect(state.licenses).toHaveLength(1);
    const license = state.licenses[0]!;
    expect(license).toMatchObject({ status: "active", subscriptionId: state.subscriptions[0]!.id });

    expect(state.sites).toHaveLength(1);
    const site = state.sites[0]!;
    expect(site).toMatchObject({
      status: "pending",
      slug: "luna-bistro",
      template: "restaurant",
      title: "Luna Bistro",
      licenseId: license.id,
      url: "http://wp.test.localhost/luna-bistro/",
    });
    const lifetime = site.expiresAt.getTime() - site.createdAt.getTime();
    expect(Math.abs(lifetime - 48 * HOUR)).toBeLessThan(5_000);

    expect(state.jobs.map((j) => ({ type: j.type, status: j.status, payload: j.payload }))).toEqual([
      { type: "site.provision", status: "queued", payload: { siteId: site.id } },
    ]);
  });

  it("ignores a duplicate delivery of the same event", async () => {
    const { evt } = await completeNewSite();
    const again = await deliver(evt);

    expect(again).toEqual({ status: 200, body: { received: true, outcome: "duplicate" } });
    const state = await snapshot();
    expect(state.licenses).toHaveLength(1);
    expect(state.sites).toHaveLength(1);
    expect(state.jobs).toHaveLength(1);
  });

  it("does not provision twice when the success page syncs the same checkout", async () => {
    const { metadata } = await completeNewSite();
    // Same session reaching us again under another event id (the success-page path).
    await processStripeEvent(checkoutCompletedEvent({ subscriptionId: "sub_first", metadata }));

    const state = await snapshot();
    expect(state.licenses).toHaveLength(1);
    expect(state.jobs).toHaveLength(1);
  });

  it("subscription deleted: license inactive, archive job queued once", async () => {
    await completeNewSite();
    const deleted = subscriptionEvent("customer.subscription.deleted", { subscriptionId: "sub_first", status: "canceled" });
    expect((await deliver(deleted)).body.outcome).toBe("processed");
    // A second, distinct event for the same ended subscription changes nothing.
    await deliver(subscriptionEvent("customer.subscription.updated", { subscriptionId: "sub_first", status: "canceled" }));

    const state = await snapshot();
    expect(state.subscriptions[0]).toMatchObject({ status: "canceled" });
    expect(state.subscriptions[0]!.canceledAt).toBeInstanceOf(Date);
    expect(state.licenses[0]).toMatchObject({ status: "inactive" });
    expect(state.licenses[0]!.deactivatedAt).toBeInstanceOf(Date);
    expect(state.jobs.map((j) => j.type)).toEqual(["site.provision", "site.archive"]);
    expect(state.jobs[1]!.payload).toEqual({ siteId: state.sites[0]!.id });
  });

  it("subscription unpaid also ends the licence", async () => {
    await completeNewSite();
    await deliver(subscriptionEvent("customer.subscription.updated", { subscriptionId: "sub_first", status: "unpaid" }));

    const state = await snapshot();
    expect(state.licenses[0]).toMatchObject({ status: "inactive" });
    expect(state.jobs.map((j) => j.type)).toEqual(["site.provision", "site.archive"]);
  });

  it("renew: links the new subscription, license active again, unarchive job queued", async () => {
    const { user, product } = await completeNewSite();
    await deliver(subscriptionEvent("customer.subscription.deleted", { subscriptionId: "sub_first", status: "canceled" }));
    // Pretend the worker archived the site.
    await getDb().update(sites).set({ status: "archived" });
    const before = await snapshot();
    const license = before.licenses[0]!;
    const site = before.sites[0]!;

    const renewMeta = { kind: "renew", userId: user.id, productId: product.id, licenseId: license.id, siteId: site.id };
    const res = await deliver(checkoutCompletedEvent({ subscriptionId: "sub_renewed", metadata: renewMeta }));
    expect(res.body.outcome).toBe("processed");

    const after = await snapshot();
    const renewed = after.subscriptions.find((s) => s.stripeSubscriptionId === "sub_renewed")!;
    expect(after.licenses).toHaveLength(1);
    expect(after.licenses[0]).toMatchObject({ id: license.id, status: "active", subscriptionId: renewed.id, deactivatedAt: null });
    expect(after.sites).toHaveLength(1);
    expect(after.jobs.map((j) => j.type)).toEqual(["site.provision", "site.archive", "site.unarchive"]);
    expect(after.jobs[2]!.payload).toEqual({ siteId: site.id });

    // A late event for the replaced subscription must not deactivate the renewed licence.
    await deliver(subscriptionEvent("customer.subscription.updated", { subscriptionId: "sub_first", status: "canceled" }));
    const final = await snapshot();
    expect(final.licenses[0]).toMatchObject({ status: "active" });
    expect(final.jobs).toHaveLength(3);
  });

  it("two paid renewals: the replaced subscription is cancelled and Cancel plan stops the other", async () => {
    const { user, product } = await completeNewSite();
    await deliver(subscriptionEvent("customer.subscription.deleted", { subscriptionId: "sub_first", status: "canceled" }));
    const { licenses: [license], sites: [site] } = await snapshot();
    const renewMeta = { kind: "renew", userId: user.id, productId: product.id, licenseId: license!.id, siteId: site!.id };
    const stripe = stubStripeSubscriptions({ sub_renew_a: "active", sub_renew_b: "active" });

    // Renew opened in two tabs and paid in both.
    const sessionA = checkoutCompletedEvent({ subscriptionId: "sub_renew_a", metadata: renewMeta });
    await deliver(sessionA);
    expect(stripe.canceled).toEqual([]);
    await deliver(checkoutCompletedEvent({ subscriptionId: "sub_renew_b", metadata: renewMeta }));
    expect(stripe.canceled).toEqual(["sub_renew_a"]);

    let state = await snapshot();
    const byStripeId = (id: string) => state.subscriptions.find((s) => s.stripeSubscriptionId === id)!;
    expect(byStripeId("sub_renew_a")).toMatchObject({ status: "canceled", licenseId: license!.id });
    expect(byStripeId("sub_renew_b")).toMatchObject({ status: "active", licenseId: license!.id });
    expect(state.licenses[0]).toMatchObject({ status: "active", subscriptionId: byStripeId("sub_renew_b").id });

    // A replay of the first session (success page reload) does not take the license back.
    await deliver(checkoutCompletedEvent({ subscriptionId: "sub_renew_a", metadata: renewMeta }));
    state = await snapshot();
    expect(state.licenses[0]).toMatchObject({ status: "active", subscriptionId: byStripeId("sub_renew_b").id });
    expect(stripe.canceled).toEqual(["sub_renew_a"]);

    // Cancel plan leaves nothing billing.
    await cancelLicenseSubscriptions(license!.id);
    expect(stripe.canceled).toEqual(["sub_renew_a", "sub_renew_b"]);
    state = await snapshot();
    expect(state.subscriptions.every((s) => s.status === "canceled")).toBe(true);
    expect(state.licenses[0]).toMatchObject({ status: "inactive" });
    expect(state.jobs.at(-1)).toMatchObject({ type: "site.archive", payload: { siteId: site!.id } });
  });

  it("Cancel plan also stops a replaced subscription the renewal could not cancel", async () => {
    const { user, product } = await completeNewSite();
    const { licenses: [license], sites: [site] } = await snapshot();
    const renewMeta = { kind: "renew", userId: user.id, productId: product.id, licenseId: license!.id, siteId: site!.id };
    // The first subscription still bills (renewed early) and Stripe refuses to cancel it this time.
    const failing = stubStripeSubscriptions({ sub_first: "active", sub_renewed: "active" }, ["sub_first"]);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await deliver(checkoutCompletedEvent({ subscriptionId: "sub_renewed", metadata: renewMeta }))).status).toBe(200);
    expect(failing.canceled).toEqual([]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("could not cancel a replaced subscription"), expect.any(Error));
    vi.restoreAllMocks();

    const stripe = stubStripeSubscriptions({ sub_first: "active", sub_renewed: "active" });
    await cancelLicenseSubscriptions(license!.id);
    expect(stripe.canceled.sort()).toEqual(["sub_first", "sub_renewed"]);
    const state = await snapshot();
    expect(state.subscriptions.every((s) => s.status === "canceled")).toBe(true);
    expect(state.licenses[0]).toMatchObject({ status: "inactive" });
  });

  it("subscription.created before checkout.completed still provisions once", async () => {
    const { user, product } = await seedUserAndProduct();
    const metadata = { kind: "new", userId: user.id, productId: product.id, template: "services", slug: "fix-it", title: "Fix It" };
    await deliver(subscriptionEvent("customer.subscription.created", { subscriptionId: "sub_early", status: "active", metadata }));
    await deliver(checkoutCompletedEvent({ subscriptionId: "sub_early", metadata }));

    const state = await snapshot();
    expect(state.subscriptions).toHaveLength(1);
    expect(state.subscriptions[0]!.currentPeriodEnd).toBeInstanceOf(Date);
    expect(state.licenses).toHaveLength(1);
    expect(state.jobs.map((j) => j.type)).toEqual(["site.provision"]);
  });

  it("adds a suffix when the slug was taken between checkout and payment", async () => {
    const { user, product } = await seedUserAndProduct();
    const meta = (sub: string) => ({ kind: "new", userId: user.id, productId: product.id, template: "agency", slug: "studio", title: sub });
    await deliver(checkoutCompletedEvent({ subscriptionId: "sub_a", metadata: meta("A") }));
    await deliver(checkoutCompletedEvent({ subscriptionId: "sub_b", metadata: meta("B") }));

    const state = await snapshot();
    expect(state.sites.map((s) => s.slug)[0]).toBe("studio");
    expect(state.sites[1]!.slug).toMatch(/^studio-[a-z0-9]{1,4}$/);
    expect(state.jobs).toHaveLength(2);
  });

  it("acknowledges unrelated events without side effects", async () => {
    await seedUserAndProduct();
    const res = await deliver(subscriptionEvent("customer.subscription.updated", { subscriptionId: "sub_unknown", status: "active" }));
    expect(res.body.outcome).toBe("processed");
    const state = await snapshot();
    expect(state.subscriptions).toHaveLength(0);
    expect(state.jobs).toHaveLength(0);
  });
});
