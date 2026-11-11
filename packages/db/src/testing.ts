// Test helpers: they run against a real Postgres named by TEST_DATABASE_URL.
import postgres from "postgres";
import { runMigrations } from "./migrate.js";

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Point it at a disposable Postgres, e.g. " +
        "postgres://appshelf:appshelf_test@127.0.0.1:55432/appshelf_test",
    );
  }
  return url;
}

/** Drops every table and re-applies all migrations. Only for disposable test databases. */
export async function recreateDatabase(url: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await client.unsafe(
      "drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;",
    );
  } finally {
    await client.end({ timeout: 5 });
  }
  await runMigrations(url);
}

/** Empties all application tables between tests. */
export async function truncateAll(url: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await client.unsafe(
      "truncate table jobs, stripe_events, sites, licenses, subscriptions, sessions, products, users restart identity cascade",
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}
