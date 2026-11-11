import { getDb, type Executor } from "./client.js";
import { jobs, type Job, type JobPayload, type JobType } from "./schema.js";

export interface EnqueueOptions {
  /** Run inside this transaction or database handle; defaults to the DATABASE_URL client. */
  db?: Executor;
  /** Earliest time the job may run; defaults to now. */
  runAfter?: Date;
  maxAttempts?: number;
}

/** Inserts a `queued` job. The worker picks it up with FOR UPDATE SKIP LOCKED. */
export async function enqueueJob(
  type: JobType,
  payload: JobPayload,
  options: EnqueueOptions = {},
): Promise<Job> {
  const db = options.db ?? getDb();
  const [job] = await db
    .insert(jobs)
    .values({
      type,
      payload,
      ...(options.runAfter ? { runAfter: options.runAfter } : {}),
      ...(options.maxAttempts ? { maxAttempts: options.maxAttempts } : {}),
    })
    .returning();
  if (!job) throw new Error(`Failed to enqueue ${type}`);
  return job;
}
