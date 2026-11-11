// Postgres job queue (docs/contracts.md, lifecycle rule 5).
//
// - Claim: `FOR UPDATE SKIP LOCKED`, oldest due job first. Claiming bumps
//   `attempts`, and that number is the fencing token for finishing the job, so a
//   worker whose lock expired cannot overwrite the result of the one that
//   reclaimed it.
// - Crash safety: a job left in `running` past the lock timeout is claimed
//   again; one that has also used up its attempts is marked `failed`.
// - One job per site at a time, so archive/unarchive/delete of a site never
//   interleave. Claims take a short transaction-level advisory lock so two
//   workers cannot both see "nothing running for this site".
// - Failure: `run_after = now() + 2^attempts * base` until `max_attempts`.
import type { Database, Executor, JobPayload, JobType } from "@appshelf/db";
import { sql } from "drizzle-orm";

export interface ClaimedJob {
  id: string;
  type: JobType;
  payload: JobPayload;
  /** Attempts including this one; also the fencing token. */
  attempts: number;
  maxAttempts: number;
}

/** A failure that retrying cannot fix: the job fails at once. */
export class PermanentJobError extends Error {
  override name = "PermanentJobError";
}

const CLAIM_LOCK_KEY = sql`hashtext('appshelf.jobs.claim')`;
const MAX_ERROR_LENGTH = 2_000;

type JobRow = {
  id: string;
  type: JobType;
  payload: JobPayload;
  attempts: number;
  max_attempts: number;
};

const toClaimed = (row: JobRow): ClaimedJob => ({
  id: row.id,
  type: row.type,
  payload: row.payload,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
});

const lockCutoff = (lockTimeoutMs: number) =>
  sql`now() - make_interval(secs => ${lockTimeoutMs / 1000})`;

/**
 * Marks jobs `failed` that were left `running` past the lock timeout and have no
 * attempts left. Returns them so the caller can run their final-failure hook.
 */
export async function failExpiredLocks(db: Executor, lockTimeoutMs: number): Promise<ClaimedJob[]> {
  const rows = await db.execute<JobRow>(sql`
    update jobs
       set status = 'failed', finished_at = now(), locked_at = null, updated_at = now(),
           last_error = left(concat_ws(E'\n', 'lock expired: the worker stopped while running the job', last_error), ${MAX_ERROR_LENGTH})
     where status = 'running'
       and locked_at < ${lockCutoff(lockTimeoutMs)}
       and attempts >= max_attempts
    returning id, type, payload, attempts, max_attempts`);
  return [...rows].map(toClaimed);
}

/** Claims the next due job (or a stale `running` one), or returns null. */
export async function claimJob(db: Database, lockTimeoutMs: number): Promise<ClaimedJob | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${CLAIM_LOCK_KEY})`);
    const rows = await tx.execute<JobRow>(sql`
      with candidate as (
        select j.id
          from jobs j
         where ((j.status = 'queued' and j.run_after <= now())
             or (j.status = 'running' and j.locked_at < ${lockCutoff(lockTimeoutMs)} and j.attempts < j.max_attempts))
           and not exists (
             select 1 from jobs r
              where r.status = 'running'
                and r.id <> j.id
                and r.payload->>'siteId' = j.payload->>'siteId'
                and r.locked_at >= ${lockCutoff(lockTimeoutMs)})
         order by j.run_after, j.created_at
         limit 1
         for update of j skip locked
      )
      update jobs
         set status = 'running', locked_at = now(), attempts = jobs.attempts + 1, updated_at = now()
        from candidate
       where jobs.id = candidate.id
      returning jobs.id, jobs.type, jobs.payload, jobs.attempts, jobs.max_attempts`);
    const row = rows[0];
    return row ? toClaimed(row) : null;
  });
}

/** Marks the job `done`. Returns false when this worker no longer owns it. */
export async function completeJob(db: Executor, job: ClaimedJob): Promise<boolean> {
  const rows = await db.execute(sql`
    update jobs
       set status = 'done', finished_at = now(), locked_at = null, last_error = null, updated_at = now()
     where id = ${job.id} and status = 'running' and attempts = ${job.attempts}
    returning id`);
  return rows.length > 0;
}

export type FailOutcome = "retry" | "failed" | "lost";

/** Delay before the next attempt: 2^attempts * base (attempts already counts this run). */
export function backoffMs(attempts: number, baseMs: number): number {
  return 2 ** attempts * baseMs;
}

/**
 * Records a failed run: back to `queued` with exponential backoff, or `failed`
 * when attempts are used up or the error is permanent.
 */
export async function failJob(
  db: Executor,
  job: ClaimedJob,
  error: unknown,
  backoffBaseMs: number,
): Promise<FailOutcome> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH);
  const final = error instanceof PermanentJobError || job.attempts >= job.maxAttempts;
  const rows = final
    ? await db.execute(sql`
        update jobs
           set status = 'failed', finished_at = now(), locked_at = null, last_error = ${message}, updated_at = now()
         where id = ${job.id} and status = 'running' and attempts = ${job.attempts}
        returning id`)
    : await db.execute(sql`
        update jobs
           set status = 'queued', locked_at = null, last_error = ${message}, updated_at = now(),
               run_after = now() + make_interval(secs => ${backoffMs(job.attempts, backoffBaseMs) / 1000})
         where id = ${job.id} and status = 'running' and attempts = ${job.attempts}
        returning id`);
  if (rows.length === 0) return "lost";
  return final ? "failed" : "retry";
}
