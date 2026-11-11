import { getDb } from "@appshelf/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** Liveness plus a database round trip, for Compose health checks and E2E waits. */
export async function GET(): Promise<Response> {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
