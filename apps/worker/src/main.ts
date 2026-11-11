// AppShelf worker entry point: job runner + expiry loop, graceful SIGTERM.
import { createDb } from "@appshelf/db";
import { sql } from "drizzle-orm";
import { loadConfig } from "./config.js";
import { startExpiryLoop } from "./expiry.js";
import { JobRunner } from "./job-runner.js";
import { consoleLogger as log, errorMessage } from "./log.js";
import { onJobFailed, siteHandlers } from "./site-handlers.js";
import { interruptibleSleep } from "./sleep.js";
import { stripeCanceller } from "./stripe-canceller.js";
import { shellWpScripts } from "./wp-scripts.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const handle = createDb(config.databaseUrl, { max: config.concurrency + 2 });
  const { db } = handle;
  const sleeper = interruptibleSleep();
  let shuttingDown = false;
  let stopServices: () => Promise<void> = async () => {};

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutting down: waiting for running jobs", { signal });
    sleeper.wake();
    stopServices()
      .then(() => handle.close())
      .then(() => {
        log.info("worker stopped");
        process.exit(0);
      })
      .catch((error: unknown) => {
        log.error("shutdown failed", { error: errorMessage(error) });
        process.exit(1);
      });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // The web container applies migrations; wait until the jobs table exists.
  let waitLogged = false;
  while (!shuttingDown) {
    let reason = "jobs table does not exist yet";
    try {
      const [row] = await db.execute<{ ready: boolean }>(sql`select to_regclass('public.jobs') is not null as ready`);
      if (row?.ready) break;
    } catch (error) {
      reason = errorMessage(error);
    }
    if (!waitLogged) log.info("waiting for the database and its migrations", { reason });
    waitLogged = true;
    await sleeper.sleep(config.pollIntervalMs);
  }
  if (shuttingDown) return;

  const scripts = shellWpScripts({
    dir: config.scriptsDir,
    timeoutMs: config.scriptTimeoutMs,
    onStderr: (script, stderr) => log.info("script log", { script, stderr: stderr.trim().slice(-2_000) }),
  });
  const handlerDeps = { db, scripts, log };
  const runner = new JobRunner({
    db,
    handlers: siteHandlers,
    onFailed: (job) => onJobFailed(job, handlerDeps),
    handlerDeps,
    log,
    pollIntervalMs: config.pollIntervalMs,
    backoffBaseMs: config.backoffBaseMs,
    lockTimeoutMs: config.lockTimeoutMs,
    concurrency: config.concurrency,
  });
  const expiry = startExpiryLoop({
    db,
    canceller: stripeCanceller(config.stripeSecretKey),
    log,
    intervalMs: config.expiryIntervalMs,
  });
  runner.start();
  stopServices = async () => {
    await Promise.all([runner.stop(), expiry.stop()]);
  };
  log.info("worker started", {
    concurrency: config.concurrency,
    pollIntervalMs: config.pollIntervalMs,
    expiryIntervalMs: config.expiryIntervalMs,
  });
}

main().catch((error: unknown) => {
  log.error("worker failed to start", { error: errorMessage(error) });
  process.exit(1);
});
