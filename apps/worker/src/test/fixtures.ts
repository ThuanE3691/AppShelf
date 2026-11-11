// Real rows in the disposable test database (TEST_DATABASE_URL).
import {
  createDb,
  licenses,
  products,
  sites,
  subscriptions,
  users,
  type Database,
  type DbHandle,
  type License,
  type Site,
  type SiteTemplate,
  type Subscription,
} from "@appshelf/db";
import { testDatabaseUrl, truncateAll } from "@appshelf/db/testing";
import { eq } from "drizzle-orm";
import { silentLogger } from "../log.js";

export const log = silentLogger;

export function openTestDb(max = 10): DbHandle & { url: string } {
  const url = testDatabaseUrl();
  return { ...createDb(url, { max }), url };
}

export const resetDb = () => truncateAll(testDatabaseUrl());

const HOUR = 3_600_000;

export interface SiteFixture {
  site: Site;
  license: License;
  subscription: Subscription;
}

export const uniqueSlug = (prefix = "wt") => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

/** A user with an active (or given) license, subscription and site. */
export async function createSiteFixture(
  db: Database,
  overrides: {
    site?: Partial<typeof sites.$inferInsert>;
    licenseStatus?: License["status"];
    subscriptionStatus?: string;
    template?: SiteTemplate;
  } = {},
): Promise<SiteFixture> {
  const tag = crypto.randomUUID().slice(0, 8);
  const [user] = await db
    .insert(users)
    .values({ email: `worker-test-${tag}@example.test`, passwordHash: "x" })
    .returning();
  const [product] = await db
    .insert(products)
    .values({ slug: `wp-site-${tag}`, name: "WordPress site", type: "wordpress_site", priceCents: 900 })
    .returning();
  if (!user || !product) throw new Error("fixture insert failed");
  const [subscription] = await db
    .insert(subscriptions)
    .values({
      userId: user.id,
      productId: product.id,
      stripeCustomerId: `cus_test_${tag}`,
      stripeSubscriptionId: `sub_test_${tag}`,
      status: overrides.subscriptionStatus ?? "active",
    })
    .returning();
  if (!subscription) throw new Error("fixture insert failed");
  const [license] = await db
    .insert(licenses)
    .values({
      userId: user.id,
      productId: product.id,
      subscriptionId: subscription.id,
      status: overrides.licenseStatus ?? "active",
      activatedAt: new Date(),
    })
    .returning();
  if (!license) throw new Error("fixture insert failed");
  await db.update(subscriptions).set({ licenseId: license.id }).where(eq(subscriptions.id, subscription.id));
  subscription.licenseId = license.id;
  const slug = overrides.site?.slug ?? uniqueSlug();
  const [site] = await db
    .insert(sites)
    .values({
      userId: user.id,
      licenseId: license.id,
      template: overrides.template ?? "restaurant",
      slug,
      title: `Worker test ${tag}`,
      url: `http://wp.test.localhost/${slug}/`,
      status: "pending",
      expiresAt: new Date(Date.now() + 48 * HOUR),
      ...overrides.site,
    })
    .returning();
  if (!site) throw new Error("fixture insert failed");
  return { site, license, subscription };
}
