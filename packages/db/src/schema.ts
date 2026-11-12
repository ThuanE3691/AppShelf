import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

const id = () => uuid("id").primaryKey().defaultRandom();
const tz = (name: string) => timestamp(name, { withTimezone: true });

export const productType = pgEnum("product_type", ["wordpress_site", "plugin"]);
export const licenseStatus = pgEnum("license_status", ["active", "inactive"]);
export const siteStatus = pgEnum("site_status", [
  "pending",
  "provisioning",
  "active",
  "archived",
  "deleting",
  "deleted",
  "failed",
]);
export const jobType = pgEnum("job_type", [
  "site.provision",
  "site.archive",
  "site.unarchive",
  "site.delete",
]);
export const jobStatus = pgEnum("job_status", ["queued", "running", "done", "failed"]);

export const SITE_TEMPLATES = ["restaurant", "agency", "services"] as const;
export type SiteTemplate = (typeof SITE_TEMPLATES)[number];

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    ...timestamps,
  },
  (t) => [check("users_email_lowercase", sql`${t.email} = lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: tz("expires_at").notNull(),
    ...timestamps,
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const products = pgTable("products", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  type: productType("type").notNull(),
  description: text("description").notNull().default(""),
  stripeProductId: text("stripe_product_id"),
  stripePriceId: text("stripe_price_id"),
  priceCents: integer("price_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  interval: text("interval").notNull().default("month"),
  active: boolean("active").notNull().default(true),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
    status: text("status").notNull(),
    currentPeriodEnd: tz("current_period_end"),
    canceledAt: tz("canceled_at"),
    /**
     * The license this subscription paid for, set when the license is linked to
     * it and kept after a renewal replaces it, so every subscription that can
     * still bill a license can be found and cancelled.
     */
    licenseId: uuid("license_id").references((): AnyPgColumn => licenses.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("subscriptions_user_id_idx").on(t.userId),
    index("subscriptions_license_id_idx").on(t.licenseId),
  ],
);

/** Stripe subscription statuses that can still charge the customer. */
export const BILLABLE_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
] as const;

export const licenses = pgTable(
  "licenses",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    status: licenseStatus("status").notNull(),
    licenseKey: text("license_key").unique(),
    maxActivations: integer("max_activations"),
    activatedAt: tz("activated_at"),
    deactivatedAt: tz("deactivated_at"),
    ...timestamps,
  },
  (t) => [
    index("licenses_user_id_idx").on(t.userId),
    index("licenses_subscription_id_idx").on(t.subscriptionId),
  ],
);

export const sites = pgTable(
  "sites",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    licenseId: uuid("license_id")
      .notNull()
      .unique()
      .references(() => licenses.id, { onDelete: "cascade" }),
    template: text("template").$type<SiteTemplate>().notNull(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    wpBlogId: integer("wp_blog_id"),
    url: text("url").notNull(),
    wpAdminUser: text("wp_admin_user"),
    wpAdminPassword: text("wp_admin_password"),
    status: siteStatus("status").notNull().default("pending"),
    expiresAt: tz("expires_at").notNull(),
    provisionedAt: tz("provisioned_at"),
    deletedAt: tz("deleted_at"),
    ...timestamps,
  },
  (t) => [
    index("sites_user_id_idx").on(t.userId),
    check(
      "sites_template_check",
      sql`${t.template} in ('restaurant', 'agency', 'services')`,
    ),
  ],
);

export type JobPayload = { siteId: string };

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: jobType("type").notNull(),
    payload: jsonb("payload").$type<JobPayload>().notNull(),
    status: jobStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAfter: tz("run_after").notNull().defaultNow(),
    lockedAt: tz("locked_at"),
    lastError: text("last_error"),
    finishedAt: tz("finished_at"),
    ...timestamps,
  },
  (t) => [index("jobs_status_run_after_idx").on(t.status, t.runAfter)],
);

export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  processedAt: tz("processed_at").notNull().defaultNow(),
  ...timestamps,
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type License = typeof licenses.$inferSelect;
export type Site = typeof sites.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type JobType = (typeof jobType.enumValues)[number];
export type SiteStatus = (typeof siteStatus.enumValues)[number];
