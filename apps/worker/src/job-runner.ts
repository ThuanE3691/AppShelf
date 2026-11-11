// Polls the queue and runs jobs (lifecycle rule 5). `stop()` stops claiming and
// waits for the jobs in flight, which is what SIGTERM triggers.
import type { Database } from "@appshelf/db";
import { errorMessage, type Logger } from "./log.js";
import { claimJob, completeJob, failExpiredLocks, failJob, type ClaimedJob } from "./queue.js";
import type { JobHandler } from "./site-handlers.js";
import { interruptibleSleep, type Sleeper } from "./sleep.js";

export interface JobRunnerOptions {
  db: Database;
  handlers: Record<ClaimedJob["type"], JobHandler>;
  /** Runs after a job failed for good (attempts used up, permanent error or expired lock). */
  onFailed: (job: ClaimedJob) => Promise<void>;
  /** Context passed to every handler. */
  handlerDeps: Parameters<JobHandler>[1];
  log: Logger;
  pollIntervalMs: number;
  backoffBaseMs: number;
  lockTimeoutMs: number;
  concurrency: number;
}

export type RunResult = "idle" | "done" | "retry" | "failed" | "lost";

export class JobRunner {
  private stopping = false;
  private readonly sleeper: Sleeper = interruptibleSleep();
  private loops: Promise<void>[] = [];

  constructor(private readonly options: JobRunnerOptions) {}

  /** Claims and runs at most one job. */
  async runOnce(): Promise<RunResult> {
    const { db, log, lockTimeoutMs } = this.options;

    for (const job of await failExpiredLocks(db, lockTimeoutMs)) {
      log.error("job failed: lock expired with no attempts left", { jobId: job.id, type: job.type });
      await this.options.onFailed(job);
    }

    const job = await claimJob(db, lockTimeoutMs);
    if (!job) return "idle";

    const started = Date.now();
    log.info("job started", { jobId: job.id, type: job.type, siteId: job.payload.siteId, attempt: job.attempts });
    try {
      const handler = this.options.handlers[job.type];
      if (!handler) throw new Error(`no handler for job type ${job.type}`);
      await handler(job, this.options.handlerDeps);
    } catch (error) {
      const outcome = await failJob(db, job, error, this.options.backoffBaseMs);
      const fields = { jobId: job.id, type: job.type, attempt: job.attempts, error: errorMessage(error) };
      if (outcome === "failed") {
        log.error("job failed", fields);
        await this.options.onFailed(job);
      } else if (outcome === "retry") {
        log.warn("job will retry", fields);
      } else {
        log.warn("job lock was lost before it failed", fields);
      }
      return outcome;
    }

    if (!(await completeJob(db, job))) {
      log.warn("job lock was lost before it finished", { jobId: job.id, type: job.type });
      return "lost";
    }
    log.info("job done", { jobId: job.id, type: job.type, ms: Date.now() - started });
    return "done";
  }

  start(): void {
    this.loops = Array.from({ length: this.options.concurrency }, () => this.loop());
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      let result: RunResult = "idle";
      try {
        result = await this.runOnce();
      } catch (error) {
        this.options.log.error("job loop error", { error: errorMessage(error) });
      }
      // Keep draining while there is work; otherwise wait one poll interval.
      if (result === "idle" && !this.stopping) await this.sleeper.sleep(this.options.pollIntervalMs);
    }
  }

  /** Stops claiming new jobs and resolves once every running job has finished. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.sleeper.wake();
    await Promise.all(this.loops);
  }
}
