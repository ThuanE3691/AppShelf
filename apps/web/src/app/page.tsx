import Link from "next/link";
import { TemplatePreview } from "@/components/template-preview";
import { getCurrentUser } from "@/lib/auth";
import { showcaseUrl, TEMPLATES } from "@/lib/config";
import { formatPrice, getWordPressProduct } from "@/lib/products";

export const dynamic = "force-dynamic";

const STEPS = [
  { title: "Pick a template", body: "Restaurant, agency or services. Each one is a real WordPress theme you can preview first." },
  { title: "Pay with a test card", body: "Stripe Checkout in test mode. Use 4242 4242 4242 4242, any future date and any CVC." },
  { title: "Get your site", body: "A worker provisions your site on a WordPress Multisite network and shows the admin login." },
];

export default async function HomePage() {
  const [user, product] = await Promise.all([getCurrentUser(), getWordPressProduct()]);
  const ctaHref = user ? "/sites/new" : "/signup?next=/sites/new";
  const price = product ? formatPrice(product) : null;

  return (
    <>
      <section className="relative overflow-hidden border-b border-slate-200 bg-white">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-40 h-80 bg-gradient-to-b from-brand-100/70 to-transparent blur-2xl"
        />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center lg:py-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
              First product on the shelf: hosted WordPress
            </p>
            <h1 className="mt-5 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              A live WordPress site,
              <br />
              <span className="text-brand-600">about a minute after checkout.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-600">
              AppShelf sells licensed apps. Choose a template, name your site and pay with a Stripe test card. Your
              licence switches on, the site is provisioned, and cancelling or renewing archives or restores it.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href={ctaHref} className="btn btn-primary px-5 py-3 text-base">
                Get a site{price ? ` — ${price}/month` : ""}
              </Link>
              <Link href="#templates" className="btn btn-secondary px-5 py-3 text-base">
                See the templates
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {TEMPLATES.map((t, i) => (
              <div key={t.id} className={i === 0 ? "col-span-2 sm:col-span-1 sm:row-span-2 sm:self-center" : ""}>
                <TemplatePreview template={t} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="templates" className="mx-auto max-w-6xl scroll-mt-8 px-4 py-16 sm:px-6">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight">Three templates, all live</h2>
          <p className="mt-3 text-slate-600">
            Every template has a public showcase site on the WordPress network. Open one to see exactly what you will
            get.
          </p>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {TEMPLATES.map((t) => (
            <article key={t.id} className="card flex flex-col p-5">
              <TemplatePreview template={t} />
              <h3 className="mt-5 text-lg font-semibold">{t.name}</h3>
              <p className="text-sm font-medium text-slate-500">{t.tagline}</p>
              <p className="mt-3 text-sm text-slate-600">{t.description}</p>
              <ul className="mt-4 space-y-1.5 text-sm text-slate-700">
                {t.highlights.map((h) => (
                  <li key={h} className="flex items-center gap-2">
                    <span aria-hidden className="text-emerald-600">✓</span>
                    {h}
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex flex-wrap gap-2 pt-1">
                <a
                  href={showcaseUrl(t.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary"
                  aria-label={`Open the ${t.name} showcase site in a new tab`}
                >
                  Live demo ↗
                </a>
                <Link
                  href={
                    user
                      ? `/sites/new?template=${t.id}`
                      : `/signup?next=${encodeURIComponent(`/sites/new?template=${t.id}`)}`
                  }
                  className="btn btn-primary"
                >
                  Use {t.name}
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-3xl font-bold tracking-tight">How it works</h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="rounded-2xl bg-slate-50 p-6">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-4 font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl scroll-mt-8 px-4 py-16 sm:px-6">
        <div className="card mx-auto max-w-lg p-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-600">{product?.name ?? "WordPress Site"}</h2>
          <p className="mt-3 flex items-baseline gap-1">
            <span className="text-5xl font-bold tracking-tight">{price ?? "—"}</span>
            <span className="text-slate-500">/ month</span>
          </p>
          <p className="mt-3 text-slate-600">
            {product?.description ||
              "One WordPress site on the AppShelf network, built from the template you pick."}
          </p>
          <ul className="mt-6 space-y-2 text-sm text-slate-700">
            {[
              "Your own site at wp.…/your-name/",
              "WordPress admin login on your dashboard",
              "Cancel any time: the site is archived, renew to restore it",
              "Demo rule: every site deletes itself after 48 hours",
            ].map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden className="text-emerald-600">✓</span>
                {line}
              </li>
            ))}
          </ul>
          {product ? (
            <Link href={ctaHref} className="btn btn-primary mt-8 w-full py-3 text-base">
              Get a site
            </Link>
          ) : (
            <p className="mt-8 rounded-lg bg-slate-100 p-3 text-center text-sm text-slate-600">
              The plan is being set up. Please check back in a minute.
            </p>
          )}
          <p className="mt-3 text-center text-xs text-slate-500">Stripe test mode: no real card is charged.</p>
        </div>
      </section>
    </>
  );
}
