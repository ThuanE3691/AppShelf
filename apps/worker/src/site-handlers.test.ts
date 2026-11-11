// The real handlers and queue against Postgres, with a scripted stand-in for
// WordPress (the real scripts run in site-handlers.integration.test.ts).
import { enqueueJob, jobs, licenses, sites, type Job, type Site } from "@appshelf/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { JobRunner } from "./job-runner.js";
import { onJobFailed, siteHandlers } from "./site-handlers.js";
import { createSiteFixture, log, openTestDb, resetDb, type SiteFixture } from "./test/fixtures.js";
import type { WpScripts } from "./wp-scripts.js";

const handle = openTestDb();
const { db } = handle;
afterAll(() => handle.close());
beforeEach(() => resetDb());

/** In-memory WordPress: one blog per slug; `down` makes every call fail. */
function fakeWordPress() {
  const state = { down: false, archived: new Map<number, boolean>(), calls: [] as string[] };
  let nextBlogId = 10;
  const blogs = new Map<string, number>();
  const guard = (call: string) => {
    state.calls.push(call);
    if (state.down) throw new Error("WordPress is down");
  };
  const scripts: WpScripts = {
    async create(slug) {
      guard(`create ${slug}`);
      const blogId = blogs.get(slug) ?? nextBlogId++;
      blogs.set(slug, blogId);
      if (!state.archived.has(blogId)) state.archived.set(blogId, false);
      return { blogId, url: `http://wp.test.localhost/${slug}/`, adminUser: `${slug}-0a1b2c3d`, adminPassword: "pw" };
    },
    async archive(blogId) {
      guard(`archive ${blogId}`);
      state.archived.set(blogId, true);
    },
    async unarchive(blogId) {
      guard(`unarchive ${blogId}`);
      state.archived.set(blogId, false);
    },
    async delete(blogId) {
      guard(`delete ${blogId}`);
      state.archived.delete(blogId);
    },
  };
  return { state, scripts };
}

describe("archive and unarchive before the site is provisioned", () => {
  let wp: ReturnType<typeof fakeWordPress>;
  let fixture: SiteFixture;
  let runner: JobRunner;

  beforeEach(async () => {
    wp = fakeWordPress();
    const deps = { db, scripts: wp.scripts, log };
    runner = new JobRunner({
      db,
      handlers: siteHandlers,
      onFailed: (job) => onJobFailed(job, deps),
      handlerDeps: deps,
      log,
      pollIntervalMs: 20,
      backoffBaseMs: 1_000,
      lockTimeoutMs: 60_000,
      concurrency: 1,
    });
    fixture = await createSiteFixture(db);
  });

  const site = async (): Promise<Site> => (await db.select().from(sites).where(eq(sites.id, fixture.site.id)))[0]!;
  const job = async (id: string): Promise<Job> => (await db.select().from(jobs).where(eq(jobs.id, id)))[0]!;
  const makeDue = (id: string) => db.update(jobs).set({ runAfter: sql`now()` }).where(eq(jobs.id, id));
  const cancel = () => db.update(licenses).set({ status: "inactive" }).where(eq(licenses.id, fixture.license.id));
  const renew = () => db.update(licenses).set({ status: "active" }).where(eq(licenses.id, fixture.license.id));

  it("a cancel during a WordPress outage still archives the site once provisioning succeeds", async () => {
    wp.state.down = true;
    const provision = await enqueueJob("site.provision", { siteId: fixture.site.id }, { db });
    expect(await runner.runOnce()).toBe("retry");

    // The buyer cancels while provisioning waits for its next attempt.
    await cancel();
    const archive = await enqueueJob("site.archive", { siteId: fixture.site.id }, { db });
    expect(await runner.runOnce()).toBe("done");
    expect(await job(archive.id)).toMatchObject({ status: "done", attempts: 1 });
    expect((await site()).status).toBe("provisioning");

    wp.state.down = false;
    await makeDue(provision.id);
    expect(await runner.runOnce()).toBe("done");
    const row = await site();
    expect(row.status).toBe("archived");
    expect(wp.state.archived.get(row.wpBlogId!)).toBe(true);
  });

  it("provisioning leaves the site live when the license is active", async () => {
    await enqueueJob("site.provision", { siteId: fixture.site.id }, { db });
    expect(await runner.runOnce()).toBe("done");
    const row = await site();
    expect(row.status).toBe("active");
    expect(wp.state.archived.get(row.wpBlogId!)).toBe(false);
    expect(wp.state.calls.some((c) => c.startsWith("archive"))).toBe(false);
  });

  it("a renewal before provisioning finishes leaves the site live", async () => {
    await cancel();
    await enqueueJob("site.archive", { siteId: fixture.site.id }, { db });
    expect(await runner.runOnce()).toBe("done");
    await renew();
    await enqueueJob("site.unarchive", { siteId: fixture.site.id }, { db });
    expect(await runner.runOnce()).toBe("done");
    expect(wp.state.calls).toEqual([]);

    await enqueueJob("site.provision", { siteId: fixture.site.id }, { db });
    expect(await runner.runOnce()).toBe("done");
    expect((await site()).status).toBe("active");
  });
});
