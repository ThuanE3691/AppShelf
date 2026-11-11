// Applies the SQL migrations in ../drizzle. Kept free of relative imports so it
// runs directly with Node type stripping (`npm run db:migrate`) and bundles into
// a single file for the web image.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function runMigrations(url: string, folder = migrationsFolder): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: folder });
  } finally {
    await client.end({ timeout: 5 });
  }
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("db:migrate: DATABASE_URL is not set");
    process.exit(1);
  }
  runMigrations(url)
    .then(() => console.log("db:migrate: migrations applied"))
    .catch((error: unknown) => {
      console.error("db:migrate: failed", error);
      process.exit(1);
    });
}
