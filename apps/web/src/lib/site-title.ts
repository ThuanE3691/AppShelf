// Site title rules for the new-site form. The title travels to Stripe metadata
// and then to the WordPress scripts as a process argument, where a NUL byte
// makes the call fail; other control characters have no place in a title.
export const TITLE_MAX = 60;

const CONTROL_CHARS = /\p{Cc}/u;

export type TitleCheck = { ok: true; title: string } | { ok: false; error: string };

export function validateTitle(raw: unknown): TitleCheck {
  const title = String(raw ?? "").trim();
  if (!title) return { ok: false, error: "Give your site a title." };
  if (title.length > TITLE_MAX) return { ok: false, error: `Keep the title under ${TITLE_MAX} characters.` };
  if (CONTROL_CHARS.test(title)) {
    return { ok: false, error: "Use plain text: no tabs, line breaks or other control characters." };
  }
  return { ok: true, title };
}
