// Queue behaviour against a real Postgres. Handlers here are stand-ins because
// these tests are about the queue itself; the real handlers and scripts are
// covered by site-handlers.integration.test.ts.
import { enqueueJob, jobs, sites, type Job } from "@appshelf/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { JobRunner, type JobRunnerOptions } from "./job-runner.js";
import { backoffMs, claimJob, completeJob, failExpiredLocks, failJob, PermanentJobError } from "./queue.js";
import { onJobFailed, type JobHandler } from "./site-handlers.js";
import { createSiteFixture, log, openTestDb, resetDb } from "./test/fixtures.js";
import type { WpScripts } from "./wp-scripts.js";

const handle = openTestDb(12);
const { db } = handle;
afterAll(() => handle.close());
beforeEach(() => resetDb());

const LOCK_MS = 60_000;
const noScripts = {} as WpScripts;

function runner(handler: JobHandler, overrides: Partial<JobRunnerOptions> = {}) {
  return new JobRunner({
    db,
    handlers: {
      "site.provision": handler,
      "site.archive": handler,
      "site.unarchive": handler,
      "site.delete": handler,
    },
    onFailed: (job) => onJobFailed(job, { db }),
    handlerDeps: { db, scripts: noScripts, log },
    log,
    pollIntervalMs: 20,
    backoffBaseMs: 1_000,
    lockTimeoutMs: LOCK_MS,
    concurrency: 1,
    ...overrides,
  });
}

async function getJob(id: string): Promise<Job> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!job) throw new Error(`job ${id} not found`);
  return job;
}

const makeDue = (id: string) => db.update(jobs).set({ runAfter: sql`now()` }).where(eq(jobs.id, id));

describe("claimJob", () => {
  it("hands every job to exactly one of many concurrent workers", async () => {
    const count = 40;
    for (let i = 0; i < count; i++) {
      await enqueueJob("site.provision", { siteId: crypto.randomUUID() }, { db });
    }

    const claimedBy = new Map<string, number>();
    await Promise.all(
      Array.from({ length: 8 }, async (_, worker) => {
        for (;;) {
          const job = await claimJob(db, LOCK_MS);
          if (!job) return;
          expect(claimedBy.has(job.id)).toBe(false);
          claimedBy.set(job.id, worker);
          await new Promise((r) => setTimeout(r, 5));
          expect(await completeJob(db, job)).toBe(true);
        }
      }),
    );

    expect(claimedBy.size).toBe(count);
    expect(new Set(claimedBy.values()).size).toBeGreaterThan(1);
    const rows = await db.select().from(jobs);
    expect(rows.every((j) => j.status === "done" && j.attempts === 1 && j.finishedAt)).toBe(true);
  });

  it("skips jobs that are not due yet", async () => {
    await enqueueJob("site.delete", { siteId: crypto.randomUUID() }, { db, runAfter: new Date(Date.now() + 60_000) });
    expect(await claimJob(db, LOCK_MS)).toBeNull();
  });

  it("runs one job per site at a time, oldest first", async () => {
    const siteId = crypto.randomUUID();
    const first = await enqueueJob("site.archive", { siteId }, { db });
    const second = await enqueueJob("site.unarchive", { siteId }, { db });
    const other = await enqueueJob("site.provision", { siteId: crypto.randomUUID() }, { db });

    const a = await claimJob(db, LOCK_MS);
    expect(a?.id).toBe(first.id);
    // The second job of the same site waits; another site's job does not.
    const b = await claimJob(db, LOCK_MS);
    expect(b?.id).toBe(other.id);
    expect(await claimJob(db, LOCK_MS)).toBeNull();

    await completeJob(db, a!);
    expect((await claimJob(db, LOCK_MS))?.id).toBe(second.id);
  });

  it("does not let two concurrent workers take two jobs of the same site", async () => {
    const siteId = crypto.randomUUID();
    for (let i = 0; i < 5; i++) await enqueueJob("site.archive", { siteId }, { db });
    const claims = await Promise.all(Array.from({ length: 5 }, () => claimJob(db, LOCK_MS)));
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
});

describe("stale locks", () => {
  it("reclaims a job left running past the lock timeout and fences out the old worker", async () => {
    const queued = await enqueueJob("site.provision", { siteId: crypto.randomUUID() }, { db });
    const crashed = await claimJob(db, LOCK_MS);
    expect(crashed?.attempts).toBe(1);

    // Fresh lock: not reclaimed.
    expect(await claimJob(db, LOCK_MS)).toBeNull();

    await db.update(jobs).set({ lockedAt: sql`now() - interval '2 minutes'` }).where(eq(jobs.id, queued.id));
    const reclaimed = await claimJob(db, LOCK_MS);
    expect(reclaimed?.id).toBe(queued.id);
    expect(reclaimed?.attempts).toBe(2);

    // The first worker comes back late: it no longer owns the job.
    expect(await completeJob(db, crashed!)).toBe(false);
    expect(await failJob(db, crashed!, new Error("late"), 1_000)).toBe("lost");
    expect(await completeJob(db, reclaimed!)).toBe(true);
    expect((await getJob(queued.id)).status).toBe("done");
  });

  it("fails a stale job with no attempts left and marks its site failed", async () => {
    const { site } = await createSiteFixture(db, { site: { status: "provisioning" } });
    const job = await enqueueJob("site.provision", { siteId: site.id }, { db, maxAttempts: 1 });
    await claimJob(db, LOCK_MS);
    await db.update(jobs).set({ lockedAt: sql`now() - interval '2 minutes'` }).where(eq(jobs.id, job.id));

    expect(await runner(async () => {}).runOnce()).toBe("idle");

    const failed = await getJob(job.id);
    expect(failed.status).toBe("failed");
    expect(failed.lastError).toMatch(/lock expired/);
    expect(failed.finishedAt).not.toBeNull();
    const [row] = await db.select().from(sites).where(eq(sites.id, site.id));
    expect(row?.status).toBe("failed");
  });

  it("leaves fresh running jobs alone", async () => {
    await enqueueJob("site.provision", { siteId: crypto.randomUUID() }, { db, maxAttempts: 1 });
    await claimJob(db, LOCK_MS);
    expect(await failExpiredLocks(db, LOCK_MS)).toEqual([]);
  });
});

describe("backoff and failure", () => {
  it("uses run_after = now() + 2^attempts * 5s by default", () => {
    expect(backoffMs(1, 5_000)).toBe(10_000);
    expect(backoffMs(2, 5_000)).toBe(20_000);
    expect(backoffMs(4, 5_000)).toBe(80_000);
  });

  it("retries with exponential backoff, then fails after max_attempts", async () => {
    const { site } = await createSiteFixture(db);
    const job = await enqueueJob("site.provision", { siteId: site.id }, { db, maxAttempts: 3 });
    const failing = runner(async () => {
      throw new Error("wp-cli exploded");
    });

    for (const attempt of [1, 2]) {
      const before = Date.now();
      expect(await failing.runOnce()).toBe("retry");
      const row = await getJob(job.id);
      expect(row.status).toBe("queued");
      expect(row.attempts).toBe(attempt);
      expect(row.lastError).toBe("wp-cli exploded");
      expect(row.lockedAt).toBeNull();
      const delay = row.runAfter.getTime() - before;
      expect(delay).toBeGreaterThan(2 ** attempt * 1_000 - 1_500);
      expect(delay).toBeLessThan(2 ** attempt * 1_000 + 1_500);
      // Not due yet, so nothing to run.
      expect(await failing.runOnce()).toBe("idle");
      await makeDue(job.id);
    }

    expect(await failing.runOnce()).toBe("failed");
    const row = await getJob(job.id);
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(3);
    expect(row.finishedAt).not.toBeNull();
    const [after] = await db.select().from(sites).where(eq(sites.id, site.id));
    expect(after?.status).toBe("failed");
  });

  it("fails at once on a permanent error", async () => {
    const job = await enqueueJob("site.archive", { siteId: crypto.randomUUID() }, { db });
    const result = await runner(async () => {
      throw new PermanentJobError("site does not exist");
    }).runOnce();
    expect(result).toBe("failed");
    expect((await getJob(job.id)).attempts).toBe(1);
  });
});

describe("JobRunner lifecycle", () => {
  it("polls, drains the queue and stops only after the running job finished", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started = 0;
    const seen: string[] = [];
    const worker = runner(async (job) => {
      started++;
      seen.push(job.id);
      if (started === 1) await gate;
    });

    const first = await enqueueJob("site.provision", { siteId: crypto.randomUUID() }, { db });
    worker.start();
    await expect.poll(() => started, { timeout: 5_000 }).toBe(1);

    const stopped = worker.stop();
    let stoppedYet = false;
    void stopped.then(() => (stoppedYet = true));
    // A job enqueued during shutdown is not picked up.
    const late = await enqueueJob("site.provision", { siteId: crypto.randomUUID() }, { db });
    await new Promise((r) => setTimeout(r, 200));
    expect(stoppedYet).toBe(false);

    release();
    await stopped;
    expect((await getJob(first.id)).status).toBe("done");
    expect((await getJob(late.id)).status).toBe("queued");
    expect(seen).toEqual([first.id]);
  });

  it("picks up a job enqueued while idle within one poll interval", async () => {
    const done: string[] = [];
    const worker = runner(async (job) => void done.push(job.id), { concurrency: 2 });
    worker.start();
    try {
      const job = await enqueueJob("site.provision", { siteId: crypto.randomUUID() }, { db });
      await expect.poll(() => done, { timeout: 5_000 }).toEqual([job.id]);
    } finally {
      await worker.stop();
    }
  });
});
