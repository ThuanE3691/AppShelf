import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "./client.js";
import { enqueueJob } from "./jobs.js";
import { jobs } from "./schema.js";
import { recreateDatabase, testDatabaseUrl, truncateAll } from "./testing.js";

const url = testDatabaseUrl();
let handle: DbHandle;

beforeAll(async () => {
  await recreateDatabase(url);
  handle = createDb(url, { max: 2 });
});
afterAll(async () => handle.close());
beforeEach(async () => truncateAll(url));

describe("enqueueJob", () => {
  it("inserts a queued job with contract defaults", async () => {
    const siteId = crypto.randomUUID();
    const job = await enqueueJob("site.provision", { siteId }, { db: handle.db });

    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(0);
    expect(job.maxAttempts).toBe(5);
    expect(job.payload).toEqual({ siteId });
    expect(job.runAfter.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("joins the caller's transaction and rolls back with it", async () => {
    const siteId = crypto.randomUUID();
    await expect(
      handle.db.transaction(async (tx) => {
        await enqueueJob("site.archive", { siteId }, { db: tx });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");

    const rows = await handle.db.select().from(jobs).where(eq(jobs.type, "site.archive"));
    expect(rows).toHaveLength(0);
  });

  it("honours runAfter", async () => {
    const later = new Date(Date.now() + 60_000);
    const job = await enqueueJob(
      "site.delete",
      { siteId: crypto.randomUUID() },
      { db: handle.db, runAfter: later },
    );
    expect(job.runAfter.getTime()).toBe(later.getTime());
  });
});

describe("schema", () => {
  it("has the plugin product type ready for release 2", async () => {
    const rows = await handle.db.execute<{ v: string }>(
      "select unnest(enum_range(null::product_type))::text as v",
    );
    expect(rows.map((r) => r.v)).toEqual(["wordpress_site", "plugin"]);
  });
});
