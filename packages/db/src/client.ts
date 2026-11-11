import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;
/** A database handle or an open transaction: both run queries the same way. */
export type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface DbHandle {
  db: Database;
  close: () => Promise<void>;
}

export function createDb(url: string, options: { max?: number } = {}): DbHandle {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}

const globalForDb = globalThis as unknown as { __appshelfDb?: DbHandle };

/** Process-wide client built from DATABASE_URL (reused across hot reloads). */
export function getDb(): Database {
  if (!globalForDb.__appshelfDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__appshelfDb = createDb(url);
  }
  return globalForDb.__appshelfDb.db;
}

export async function closeDb(): Promise<void> {
  const handle = globalForDb.__appshelfDb;
  globalForDb.__appshelfDb = undefined;
  await handle?.close();
}
