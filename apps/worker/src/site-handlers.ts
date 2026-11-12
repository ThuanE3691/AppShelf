// Job handlers for the site lifecycle. Every handler is idempotent: a retry, a
// reclaimed job after a crash or a duplicate job ends in the same state. Each
// one re-reads the site and its license, so a job that became stale (a renewal
// after a cancel, a delete after either) does nothing.
import { licenses, sites, users, type Database, type JobType, type Site } from "@appshelf/db";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Logger } from "./log.js";
import { PermanentJobError, type ClaimedJob } from "./queue.js";
import type { WpScripts } from "./wp-scripts.js";

export interface HandlerDeps {
  db: Database;
  scripts: WpScripts;
  log: Logger;
}

export type JobHandler = (job: ClaimedJob, deps: HandlerDeps) => Promise<void>;

const GONE = ["deleting", "deleted"] as const;
/** States in which provisioning may (still) set the site `active`. */
const PROVISIONABLE = ["pending", "provisioning", "failed"] as const;

async function loadSite(db: Database, job: ClaimedJob): Promise<Site | undefined> {
  const siteId = job.payload?.siteId;
  if (typeof siteId !== "string") throw new PermanentJobError("job payload has no siteId");
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1);
  return site;
}

async function requireSite(db: Database, job: ClaimedJob): Promise<Site> {
  const site = await loadSite(db, job);
  if (!site) throw new PermanentJobError(`site ${job.payload.siteId} does not exist`);
  return site;
}

async function licenseIsActive(db: Database, site: Site): Promise<boolean> {
  const [license] = await db
    .select({ status: licenses.status })
    .from(licenses)
    .where(eq(licenses.id, site.licenseId))
    .limit(1);
  return license?.status === "active";
}

const isGone = (site: Site) => (GONE as readonly string[]).includes(site.status);
/** Not provisioned yet: provisioning will apply the license state when it finishes. */
const awaitsProvisioning = (site: Site) =>
  site.wpBlogId === null && (PROVISIONABLE as readonly string[]).includes(site.status);

/**
 * A cancel that arrived while provisioning was still pending (its archive job
 * skipped the unprovisioned site) takes effect in the provision job itself.
 */
async function archiveIfLicenseInactive({ db, scripts, log }: HandlerDeps, site: Site, blogId: number) {
  if (await licenseIsActive(db, site)) return;
  await scripts.archive(blogId);
  await db
    .update(sites)
    .set({ status: "archived" })
    .where(and(eq(sites.id, site.id), notInArray(sites.status, [...GONE])));
  log.info("site archived after provisioning: license is inactive", { siteId: site.id, blogId });
}

const provision: JobHandler = async (job, deps) => {
  const { db, scripts, log } = deps;
  const site = await requireSite(db, job);
  if (isGone(site)) return log.info("provision skipped: site is being deleted", { siteId: site.id });
  if (site.wpBlogId !== null && (site.status === "active" || site.status === "archived")) {
    log.info("provision skipped: already provisioned", { siteId: site.id, blogId: site.wpBlogId });
    // A retry after the post-create archive failed still has to finish it.
    if (site.status === "active") await archiveIfLicenseInactive(deps, site, site.wpBlogId);
    return;
  }

  const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, site.userId)).limit(1);
  if (!owner) throw new PermanentJobError(`owner of site ${site.id} does not exist`);

  await db
    .update(sites)
    .set({ status: "provisioning" })
    .where(and(eq(sites.id, site.id), inArray(sites.status, [...PROVISIONABLE])));

  // Idempotent per slug: a retry returns the same blog with fresh credentials.
  const created = await scripts.create(site.slug, site.title, site.template, owner.email);

  // Always record the blog (a later delete needs its id); only move to `active`
  // when nothing (like the expiry pass) moved the site on meanwhile.
  await db
    .update(sites)
    .set({
      wpBlogId: created.blogId,
      url: created.url,
      wpAdminUser: created.adminUser,
      wpAdminPassword: created.adminPassword,
      status: sql`case when ${sites.status} in ('pending', 'provisioning', 'failed') then 'active'::site_status else ${sites.status} end`,
      provisionedAt: sql`coalesce(${sites.provisionedAt}, now())`,
    })
    .where(eq(sites.id, site.id));
  log.info("site provisioned", { siteId: site.id, blogId: created.blogId, url: created.url });

  await archiveIfLicenseInactive(deps, site, created.blogId);
};

const archive: JobHandler = async (job, { db, scripts, log }) => {
  const site = await requireSite(db, job);
  if (isGone(site) || site.status === "failed") {
    return log.info("archive skipped", { siteId: site.id, status: site.status });
  }
  if (await licenseIsActive(db, site)) {
    return log.info("archive skipped: license is active again (renewed)", { siteId: site.id });
  }
  if (awaitsProvisioning(site)) {
    return log.info("archive deferred to provisioning: site has no blog yet", { siteId: site.id });
  }
  if (site.wpBlogId === null) throw new PermanentJobError(`site ${site.id} has no blog (status ${site.status})`);

  await scripts.archive(site.wpBlogId);
  await db
    .update(sites)
    .set({ status: "archived" })
    .where(and(eq(sites.id, site.id), notInArray(sites.status, [...GONE])));
  log.info("site archived", { siteId: site.id, blogId: site.wpBlogId });
};

const unarchive: JobHandler = async (job, { db, scripts, log }) => {
  const site = await requireSite(db, job);
  if (isGone(site) || site.status === "failed") {
    return log.info("unarchive skipped", { siteId: site.id, status: site.status });
  }
  if (!(await licenseIsActive(db, site))) {
    return log.info("unarchive skipped: license is inactive", { siteId: site.id });
  }
  if (awaitsProvisioning(site)) {
    return log.info("unarchive deferred to provisioning: site has no blog yet", { siteId: site.id });
  }
  if (site.wpBlogId === null) throw new PermanentJobError(`site ${site.id} has no blog (status ${site.status})`);

  await scripts.unarchive(site.wpBlogId);
  await db
    .update(sites)
    .set({ status: "active" })
    .where(and(eq(sites.id, site.id), notInArray(sites.status, [...GONE])));
  log.info("site unarchived", { siteId: site.id, blogId: site.wpBlogId });
};

const remove: JobHandler = async (job, { db, scripts, log }) => {
  const site = await loadSite(db, job);
  if (!site) return log.info("delete skipped: site row is gone", { siteId: job.payload.siteId });
  if (site.status === "deleted") return log.info("delete skipped: already deleted", { siteId: site.id });

  await db.update(sites).set({ status: "deleting" }).where(eq(sites.id, site.id));
  // site-delete.sh succeeds when the blog is already gone.
  if (site.wpBlogId !== null) await scripts.delete(site.wpBlogId);
  await db
    .update(sites)
    .set({ status: "deleted", deletedAt: sql`coalesce(${sites.deletedAt}, now())` })
    .where(eq(sites.id, site.id));
  log.info("site deleted", { siteId: site.id, blogId: site.wpBlogId });
};

export const siteHandlers: Record<JobType, JobHandler> = {
  "site.provision": provision,
  "site.archive": archive,
  "site.unarchive": unarchive,
  "site.delete": remove,
};

/** Runs once a job has failed for good. A site that could not be provisioned is `failed`. */
export async function onJobFailed(job: ClaimedJob, { db }: Pick<HandlerDeps, "db">): Promise<void> {
  if (job.type !== "site.provision" || typeof job.payload?.siteId !== "string") return;
  await db
    .update(sites)
    .set({ status: "failed" })
    .where(and(eq(sites.id, job.payload.siteId), inArray(sites.status, ["pending", "provisioning"])));
}
