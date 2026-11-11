import { recreateDatabase, testDatabaseUrl } from "@appshelf/db/testing";

/** Runs once: fresh schema in the disposable test database. */
export default async function setup() {
  await recreateDatabase(testDatabaseUrl());
}
