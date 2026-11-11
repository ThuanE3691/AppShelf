// Pure slug rules, shared by the browser form and the server.
export const SLUG_MIN = 3;
export const SLUG_MAX = 30;

/**
 * Paths WordPress Multisite (subdirectory mode) or AppShelf already use. A site
 * with one of these slugs would shadow core routes or the showcase sites.
 */
const RESERVED = new Set([
  "admin",
  "api",
  "blog",
  "comments",
  "embed",
  "feed",
  "files",
  "login",
  "page",
  "register",
  "search",
  "signup",
  "wp",
  "wp-admin",
  "wp-content",
  "wp-includes",
  "wp-json",
  "www",
  "restaurant",
  "agency",
  "services",
  "restaurant-demo",
  "agency-demo",
  "services-demo",
]);

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Turns a site title into a slug candidate ("Café Mõnaco & Co" -> "cafe-monaco-co"). */
export function slugify(input: string): string {
  const base = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base.length > SLUG_MAX) {
    // Cut at the last whole word that fits, not in the middle of one.
    const head = base.slice(0, SLUG_MAX + 1);
    const cut = head.lastIndexOf("-");
    return cut >= SLUG_MIN ? head.slice(0, cut) : base.slice(0, SLUG_MAX);
  }
  if (base.length >= SLUG_MIN) return base;
  return base ? `${base}-site` : "";
}

export type SlugCheck = { ok: true; slug: string } | { ok: false; error: string };

/** Format rules only; availability is checked against the database separately. */
export function validateSlug(raw: string): SlugCheck {
  const slug = raw.trim().toLowerCase();
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) {
    return { ok: false, error: `Use ${SLUG_MIN} to ${SLUG_MAX} characters.` };
  }
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      error: "Use lowercase letters, numbers and single hyphens, starting and ending with a letter or number.",
    };
  }
  if (/^\d+$/.test(slug)) {
    return { ok: false, error: "A slug cannot be only numbers." };
  }
  if (RESERVED.has(slug) || slug.startsWith("wp-")) {
    return { ok: false, error: "That address is reserved. Please choose another." };
  }
  return { ok: true, slug };
}
