import { getDb } from "@appshelf/db";
import { getCurrentUser } from "@/lib/auth";
import { checkSlug } from "@/lib/slug";

export const dynamic = "force-dynamic";

/** Live availability hint for the "Get a site" form. The server action re-checks on submit. */
export async function GET(request: Request): Promise<Response> {
  if (!(await getCurrentUser())) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const slug = new URL(request.url).searchParams.get("slug") ?? "";
  return Response.json(await checkSlug(getDb(), slug));
}
