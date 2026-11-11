import { recreateDatabase, testDatabaseUrl } from "@appshelf/db/testing";
import postgres from "postgres";

/** Creates the disposable test database when missing, then gives it a fresh schema. */
export default async function setup() {
  const url = new URL(testDatabaseUrl());
  const name = decodeURIComponent(url.pathname.slice(1));
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    const [exists] = await client`select 1 from pg_database where datname = ${name}`;
    if (!exists) await client.unsafe(`create database "${name.replaceAll('"', '""')}"`);
  } finally {
    await client.end({ timeout: 5 });
  }
  await recreateDatabase(url.toString());
}
