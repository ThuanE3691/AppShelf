import { sites, type Executor } from "@appshelf/db";
import { eq } from "drizzle-orm";
import { validateSlug, type SlugCheck } from "./slug-rules";

export * from "./slug-rules";

export async function isSlugTaken(db: Executor, slug: string): Promise<boolean> {
  const rows = await db.select({ id: sites.id }).from(sites).where(eq(sites.slug, slug)).limit(1);
  return rows.length > 0;
}

/** Format check plus uniqueness. */
export async function checkSlug(db: Executor, raw: string): Promise<SlugCheck> {
  const result = validateSlug(raw);
  if (!result.ok) return result;
  if (await isSlugTaken(db, result.slug)) {
    return { ok: false, error: "That address is already taken." };
  }
  return result;
}
