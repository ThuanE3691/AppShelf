import type { SiteTemplate } from "@appshelf/db";

const trimSlash = (value: string) => value.replace(/\/+$/, "");

/** Public base URL of this web app (Stripe redirects come back here). */
export function appUrl(): string {
  return trimSlash(process.env.APP_URL || "http://app.appshelf.localhost");
}

/** Public base URL of the WordPress network. */
export function wpPublicUrl(): string {
  return trimSlash(process.env.WP_PUBLIC_URL || "http://wp.appshelf.localhost");
}

export function siteUrl(slug: string): string {
  return `${wpPublicUrl()}/${slug}/`;
}

export function showcaseUrl(template: SiteTemplate): string {
  return siteUrl(`${template}-demo`);
}

export const PRODUCT_SLUG = "wordpress-site";
export const SITE_LIFETIME_MS = 48 * 60 * 60 * 1000;

export const DEMO_NOTICE =
  "Personal demo project — test payments only (Stripe test mode). Sites delete themselves after 48 hours.";

export interface TemplateInfo {
  id: SiteTemplate;
  name: string;
  tagline: string;
  description: string;
  highlights: string[];
}

export const TEMPLATES: TemplateInfo[] = [
  {
    id: "restaurant",
    name: "Restaurant",
    tagline: "Menus, opening hours and table bookings",
    description:
      "A warm, image-led site for cafés and restaurants with a menu section, hours and a reservation call to action.",
    highlights: ["Menu with prices", "Opening hours", "Reservation CTA"],
  },
  {
    id: "agency",
    name: "Agency",
    tagline: "Portfolio, case studies and team",
    description:
      "A bold studio site that puts work first: project grid, case studies, team and a contact form.",
    highlights: ["Project grid", "Case studies", "Team section"],
  },
  {
    id: "services",
    name: "Services",
    tagline: "Local business, quotes and reviews",
    description:
      "A clean site for trades and consultants with service cards, testimonials and a quote request form.",
    highlights: ["Service cards", "Testimonials", "Quote request"],
  },
];

export function isTemplate(value: unknown): value is SiteTemplate {
  return typeof value === "string" && TEMPLATES.some((t) => t.id === value);
}
