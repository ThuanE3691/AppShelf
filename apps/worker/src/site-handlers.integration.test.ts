// The real handlers calling the real WordPress scripts against the running
// multisite (no fakes). Runs inside the worker test image, which has wp-cli,
// the scripts and the wp_data volume:
//   pwsh scripts/appshelf.ps1 dc --profile test run --rm --build worker-test
import { enqueueJob, licenses, sites, type Site } from "@appshelf/db";
import { eq } from "drizzle-orm";
import { execFile } from "node:child_process";
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobRunner } from "./job-runner.js";
import { onJobFailed, siteHandlers } from "./site-handlers.js";
import { createSiteFixture, log, openTestDb, resetDb, uniqueSlug, type SiteFixture } from "./test/fixtures.js";
import { scriptEnv, shellWpScripts } from "./wp-scripts.js";

const enabled = process.env.WP_SCRIPTS_INTEGRATION === "1";
const wpOrigin = process.env.WP_INTERNAL_URL ?? "http://wordpress";
const wpHost = process.env.WP_DOMAIN ?? "wp.appshelf.localhost";
const scriptsDir = process.env.WP_SCRIPTS_DIR ?? "/opt/appshelf/wp";

/** wp-cli against the network, the way the site scripts call it (lib.sh). */
function wpCli(...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "sh",
      ["-c", '. "$APPSHELF_WP_DIR/lib.sh" && wp_cli "$@"', "wp-cli", ...args],
      { env: { ...scriptEnv(), APPSHELF_WP_DIR: scriptsDir }, timeout: 60_000 },
      (error, stdout, stderr) => (error ? reject(new Error(`wp ${args.join(" ")}: ${stderr}`)) : resolve(stdout)),
    );
  });
}

/** GET a site path from the WordPress container with the public Host header. */
function fetchSite(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(new URL(path, wpOrigin), { headers: { host: wpHost } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
  });
}

describe.runIf(enabled)("site handlers with the real WordPress scripts", () => {
  const handle = openTestDb();
  const { db } = handle;
  const scripts = shellWpScripts({ dir: scriptsDir, timeoutMs: 90_000 });
  const deps = { db, scripts, log };
  const runner = new JobRunner({
    db,
    handlers: siteHandlers,
    onFailed: (job) => onJobFailed(job, deps),
    handlerDeps: deps,
    log,
    pollIntervalMs: 50,
    backoffBaseMs: 1_000,
    lockTimeoutMs: 600_000,
    concurrency: 1,
  });
  let fixture: SiteFixture;
  const slug = uniqueSlug("wt");

  const site = async (): Promise<Site> => {
    const [row] = await db.select().from(sites).where(eq(sites.id, fixture.site.id));
    if (!row) throw new Error("site row missing");
    return row;
  };
  const setLicense = (status: "active" | "inactive") =>
    db.update(licenses).set({ status }).where(eq(licenses.id, fixture.license.id));
  const run = async (type: Parameters<typeof enqueueJob>[0]) => {
    await enqueueJob(type, { siteId: fixture.site.id }, { db });
    return runner.runOnce();
  };

  beforeAll(async () => {
    await resetDb();
    fixture = await createSiteFixture(db, { site: { slug }, template: "agency" });
  });
  afterAll(async () => {
    // Leave no test blog behind, whatever failed above.
    const row = await site().catch(() => undefined);
    if (row?.wpBlogId) await scripts.delete(row.wpBlogId).catch(() => undefined);
    await handle.close();
  });

  it("provisions the site with the template and stores the blog and credentials", async () => {
    const started = Date.now();
    expect(await run("site.provision")).toBe("done");
    const row = await site();
    expect(row.status).toBe("active");
    expect(row.wpBlogId).toBeGreaterThan(1);
    expect(row.url).toBe(`http://${wpHost}/${slug}/`);
    expect(row.wpAdminUser).toMatch(new RegExp(`^${slug}-[0-9a-f]{8}$`));
    expect(row.wpAdminPassword?.length).toBeGreaterThanOrEqual(12);
    expect(row.provisionedAt).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(30_000);

    const page = await fetchSite(`/${slug}/`);
    expect(page.status).toBe(200);
    expect(page.body).toContain("themes/appshelf-agency/");
  });

  it("is idempotent: a duplicate job is a no-op and a crash before saving reuses the same blog", async () => {
    const before = await site();
    expect(await run("site.provision")).toBe("done");
    expect((await site()).wpBlogId).toBe(before.wpBlogId);

    // Simulate a crash after site-create.sh succeeded but before the row was saved.
    await db.update(sites).set({ status: "provisioning", wpBlogId: null }).where(eq(sites.id, fixture.site.id));
    expect(await run("site.provision")).toBe("done");
    const after = await site();
    expect(after.status).toBe("active");
    expect(after.wpBlogId).toBe(before.wpBlogId);
    expect(after.wpAdminUser).toBe(before.wpAdminUser);
    expect(after.provisionedAt?.getTime()).toBe(before.provisionedAt?.getTime());
  });

  it("gives the per-site admin no network rights and keeps code installs off", async () => {
    const { wpAdminUser } = await site();
    await expect(wpCli("super-admin", "list")).resolves.not.toContain(wpAdminUser!);
    expect((await wpCli("eval", "echo DISALLOW_FILE_MODS && DISALLOW_FILE_EDIT ? 'locked' : 'open';")).trim()).toBe(
      "locked",
    );
  });

  it("archives when the license ended, and repeats safely", async () => {
    await setLicense("inactive");
    expect(await run("site.archive")).toBe("done");
    expect((await site()).status).toBe("archived");
    expect((await fetchSite(`/${slug}/`)).status).toBe(410);

    expect(await run("site.archive")).toBe("done");
    expect((await site()).status).toBe("archived");
  });

  it("skips a stale unarchive while the license is inactive", async () => {
    expect(await run("site.unarchive")).toBe("done");
    expect((await site()).status).toBe("archived");
  });

  it("unarchives after a renewal, and repeats safely", async () => {
    await setLicense("active");
    expect(await run("site.unarchive")).toBe("done");
    expect((await site()).status).toBe("active");
    expect((await fetchSite(`/${slug}/`)).status).toBe(200);

    expect(await run("site.unarchive")).toBe("done");
    expect((await site()).status).toBe("active");
  });

  it("deletes the site, and a retried delete still succeeds", async () => {
    const { wpBlogId } = await site();
    expect(await run("site.delete")).toBe("done");
    const row = await site();
    expect(row.status).toBe("deleted");
    expect(row.deletedAt).not.toBeNull();
    expect((await fetchSite(`/${slug}/`)).status).toBe(404);

    expect(await run("site.delete")).toBe("done");
    // The script itself is idempotent too (a reclaimed job may run it twice).
    await expect(scripts.delete(wpBlogId!)).resolves.toBeUndefined();
    // A late provision job does not bring the site back.
    expect(await run("site.provision")).toBe("done");
    expect((await site()).status).toBe("deleted");
  });
});

describe.runIf(enabled)("site-create.sh never hands out an account it does not own", () => {
  const scripts = shellWpScripts({ dir: scriptsDir, timeoutMs: 90_000 });
  const created: number[] = [];
  afterAll(async () => {
    for (const blogId of created) await scripts.delete(blogId).catch(() => undefined);
  });

  it.each(["appshelf", "appshelf-admin"])("refuses the reserved slug %j", async (slug) => {
    await expect(scripts.create(slug, "Takeover", "agency", "buyer@example.test")).rejects.toThrow(/reserved/);
  });

  it("refuses to reuse a site admin that became a super admin", async () => {
    const slug = uniqueSlug("wsa");
    const site = await scripts.create(slug, "Guard", "agency", "buyer@example.test");
    created.push(site.blogId);
    await wpCli("super-admin", "add", site.adminUser);
    try {
      await expect(scripts.create(slug, "Guard", "agency", "buyer@example.test")).rejects.toThrow(/super admin/);
      // The password was not reset.
      await expect(wpCli("user", "check-password", site.adminUser, site.adminPassword)).resolves.toBeDefined();
    } finally {
      await wpCli("super-admin", "remove", site.adminUser);
    }
  });

  it("refuses to reuse a site admin that belongs to another site", async () => {
    const firstSlug = uniqueSlug("wsb");
    const first = await scripts.create(firstSlug, "First", "agency", "buyer@example.test");
    created.push(first.blogId);
    const slug = uniqueSlug("wsc");
    const second = await scripts.create(slug, "Second", "agency", "buyer@example.test");
    created.push(second.blogId);
    // Make the second site's admin a member of the first site as well.
    await wpCli("user", "set-role", second.adminUser, "editor", `--url=http://${wpHost}/${firstSlug}/`);

    await expect(scripts.create(slug, "Second", "agency", "buyer@example.test")).rejects.toThrow(/another site/);
  });
});
