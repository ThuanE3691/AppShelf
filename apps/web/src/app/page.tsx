import type { Product } from "@appshelf/db";
import Image from "next/image";
import Link from "next/link";
import { Barcode } from "@/components/barcode";
import { ArrowDown, ArrowUpRight } from "@/components/icons";
import { getCurrentUser } from "@/lib/auth";
import { showcaseUrl, TEMPLATES } from "@/lib/config";
import { formatPrice, getWordPressProduct } from "@/lib/products";
import { TEMPLATE_SHOTS } from "@/lib/template-shots";

export const dynamic = "force-dynamic";

/** What the system really does, in order (lifecycle rules in docs/contracts.md). */
const LIFECYCLE = [
  {
    when: "You pay",
    signal: "checkout.session.completed",
    effect: "Licence turns active and a site.provision job is queued.",
    status: "Queued",
  },
  {
    when: "~1 minute later",
    signal: "site-create.sh",
    effect: "The worker creates your site on the Multisite network from the template and puts the admin login on your dashboard.",
    status: "Live",
  },
  {
    when: "You cancel",
    signal: "customer.subscription.deleted",
    effect: "Stripe ends the plan now, the licence goes inactive and the site is archived, not deleted.",
    status: "Archived",
  },
  {
    when: "You renew",
    signal: "site.unarchive",
    effect: "A new Checkout links a new subscription to the same licence and the site comes back as it was.",
    status: "Live",
  },
  {
    when: "48 hours after purchase",
    signal: "site.delete",
    effect: "Demo rule: the site and its subscription are removed automatically.",
    status: "Deleted",
  },
];

const INCLUDED = [
  ["Site", "Your own address at wp.…/your-name/"],
  ["Admin", "WordPress admin login on your dashboard"],
  ["Cancel", "Any time: the site is archived; renew to restore it"],
  ["Lifetime", "Demo rule: every site deletes itself after 48 hours"],
];

function ProductTag({ product, price }: { product: Product | null; price: string | null }) {
  return (
    <article aria-label="WordPress Site product label" className="border-2 border-ink-950 bg-white shadow-tag">
      <div className="surface-ink flex items-center justify-between gap-4 bg-ink-950 px-4 py-2 text-white">
        <span className="label">SKU WP-01</span>
        <span className="label text-ink-300">Stripe test mode</span>
      </div>
      <div className="grid grid-cols-[1fr_auto] border-b-2 border-ink-950">
        <div className="p-4 sm:p-5">
          <h2 className="text-xl font-bold">{product?.name ?? "WordPress Site"}</h2>
          <p className="mt-2 text-sm text-ink-700">One hosted site on the AppShelf network, built from the template you pick.</p>
        </div>
        <div className="flex min-w-28 flex-col items-center justify-center border-l-2 border-ink-950 bg-signal-500 px-4 py-3 text-ink-950">
          <span className="font-mono text-3xl leading-none font-bold tracking-tight">{price ?? "—"}</span>
          <span className="label mt-2">per month</span>
        </div>
      </div>
      <dl className="divide-y-2 divide-ink-100 px-4 sm:px-5">
        {[
          ["Network", "WordPress Multisite"],
          ["Templates", `${TEMPLATES.length} live showcases`],
          ["Billing", "Monthly, cancel any time"],
          ["Lifetime", "48 h (demo)"],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2.5">
            <dt className="label text-ink-600">{k}</dt>
            <dd className="text-right text-sm font-medium text-ink-950">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t-2 border-ink-950 px-4 pt-3 pb-2 sm:px-5">
        <Barcode value="WP-01" className="h-10 w-full text-ink-950" />
        <p className="label mt-1.5 text-ink-600">WP-01 · AppShelf</p>
      </div>
    </article>
  );
}

export default async function HomePage() {
  const [user, product] = await Promise.all([getCurrentUser(), getWordPressProduct()]);
  const ctaHref = user ? "/sites/new" : "/signup?next=/sites/new";
  const price = product ? formatPrice(product) : null;

  return (
    <>
      <section className="border-b-2 border-ink-950 bg-white">
        <div className="page grid gap-12 py-(--spacing-section) lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-7">
            <h1 className="text-display font-bold tracking-(--tracking-display)">
              A live WordPress site, off the shelf in about a minute.
            </h1>
            <p className="mt-6 max-w-(--container-prose) text-lg text-ink-700">
              AppShelf sells licensed apps. Choose a template, name your site and pay with a Stripe test card. Your
              licence switches on and the site is provisioned; cancelling archives it and renewing brings it back.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-x-8 gap-y-4">
              <Link href={ctaHref} className="btn btn-primary px-6 text-base">
                Get a site{price ? ` — ${price}/month` : ""}
              </Link>
              <Link href="#templates" className="text-link inline-flex items-center gap-2">
                See the three templates
                <ArrowDown />
              </Link>
            </div>
          </div>
          <div className="bin-grid -mx-(--spacing-gutter) border-y-2 border-ink-950 px-(--spacing-gutter) py-10 sm:mx-0 sm:border-2 sm:px-8 lg:col-span-5">
            <div className="mx-auto max-w-sm">
              <ProductTag product={product} price={price} />
            </div>
          </div>
        </div>
      </section>

      <section id="templates" aria-labelledby="templates-title" className="scroll-mt-4 py-(--spacing-section)">
        <div className="page">
          <div className="grid gap-4 lg:grid-cols-12 lg:items-end">
            <h2 id="templates-title" className="text-3xl font-bold lg:col-span-7">
              Three templates on the shelf, each one live.
            </h2>
            <p className="text-ink-700 lg:col-span-5">
              These are screenshots of the real showcase sites on the WordPress network. Open one to click around
              before you pay.
            </p>
          </div>

          <div className="mt-12">
            <ul className="grid border-2 border-ink-950 bg-white md:grid-cols-3">
              {TEMPLATES.map((t, i) => (
                <li
                  key={t.id}
                  className={`flex flex-col ${i > 0 ? "border-t-2 border-ink-950 md:border-t-0 md:border-l-2" : ""}`}
                >
                  <a
                    href={showcaseUrl(t.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="group block border-b-2 border-ink-950 bg-ink-100"
                    aria-label={`Open the ${t.name} live demo in a new tab`}
                  >
                    <Image
                      src={TEMPLATE_SHOTS[t.id].desktop}
                      alt={`Home page of the ${t.name} showcase site`}
                      sizes="(min-width: 1216px) 400px, (min-width: 768px) 33vw, 100vw"
                      className="aspect-[16/10] h-auto w-full object-cover object-top transition-opacity duration-150 group-hover:opacity-90"
                    />
                  </a>
                  <div className="flex flex-1 flex-col p-4 sm:p-6">
                    <h3 className="text-xl font-bold">{t.name}</h3>
                    <p className="mt-1 text-sm font-medium text-ink-600">{t.tagline}</p>
                    <p className="mt-4 text-sm text-ink-700">{t.description}</p>
                    <ul className="mt-5 flex flex-wrap gap-2">
                      {t.highlights.map((h) => (
                        <li key={h} className="label border-2 border-ink-200 px-2 py-0.5 text-ink-700">
                          {h}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-auto flex flex-wrap items-center gap-x-6 gap-y-3 pt-7">
                      <Link
                        href={
                          user
                            ? `/sites/new?template=${t.id}`
                            : `/signup?next=${encodeURIComponent(`/sites/new?template=${t.id}`)}`
                        }
                        className="btn btn-secondary"
                      >
                        Use {t.name}
                      </Link>
                      <a
                        href={showcaseUrl(t.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-link inline-flex items-center gap-1.5 text-sm"
                        aria-label={`Open the ${t.name} live demo in a new tab`}
                      >
                        Live demo
                        <ArrowUpRight />
                      </a>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {/* The shelf rail the templates stand on. */}
            <div aria-hidden className="h-3 bg-ink-950" />
            <div aria-hidden className="flex justify-between px-6">
              <span className="h-5 w-3 bg-ink-950" />
              <span className="h-5 w-3 bg-ink-950" />
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="lifecycle-title" className="border-y-2 border-ink-950 bg-white py-(--spacing-section)">
        <div className="page grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <h2 id="lifecycle-title" className="text-3xl font-bold">
              What happens after you pay
            </h2>
            <p className="mt-4 text-ink-700">
              The life of one site, as the system records it. Each step is a real Stripe event or background job;
              your dashboard shows the latest job for every site.
            </p>
          </div>
          <ol className="relative lg:col-span-7">
            <span aria-hidden className="absolute top-2 bottom-2 left-[0.4375rem] w-0.5 bg-ink-950" />
            {LIFECYCLE.map((row) => (
              <li key={row.signal} className="relative grid gap-x-6 gap-y-2 pb-8 pl-10 last:pb-0 md:grid-cols-[1fr_auto]">
                <span aria-hidden className="absolute top-1.5 left-0 h-4 w-4 border-2 border-ink-950 bg-white" />
                <div>
                  <p className="text-lg font-bold">{row.when}</p>
                  <p className="mt-1 font-mono text-sm break-all text-ink-600">{row.signal}</p>
                  <p className="mt-2 max-w-(--container-prose) text-ink-700">{row.effect}</p>
                </div>
                <p className="md:pt-1">
                  <span className="label inline-flex border-2 border-ink-950 px-2 py-0.5 font-bold">{row.status}</span>
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-4 py-(--spacing-section)">
        <div className="page">
          <div className="tag grid md:grid-cols-[1fr_20rem]">
            <div className="p-6 sm:p-8">
              <p className="label text-ink-600">Plan · SKU WP-01</p>
              <h2 id="pricing-title" className="mt-3 text-3xl font-bold">
                {product?.name ?? "WordPress Site"}
              </h2>
              <p className="mt-3 max-w-(--container-prose) text-ink-700">
                {product?.description || "One WordPress site on the AppShelf network, built from the template you pick."}
              </p>
              <dl className="mt-8 border-t-2 border-ink-950">
                {INCLUDED.map(([k, v]) => (
                  <div key={k} className="grid gap-1 border-b-2 border-ink-100 py-3 sm:grid-cols-[8rem_1fr] sm:gap-4">
                    <dt className="label pt-0.5 text-ink-600">{k}</dt>
                    <dd className="text-ink-950">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="surface-ink flex flex-col justify-between gap-8 border-t-2 border-ink-950 bg-ink-950 p-6 text-white sm:p-8 md:border-t-0 md:border-l-2">
              <div>
                <p className="label text-ink-300">Price per month</p>
                <p className="mt-3 font-mono text-display leading-none font-bold tracking-tight">{price ?? "—"}</p>
                <p className="mt-3 text-sm text-ink-200">Stripe test mode: no real card is charged.</p>
              </div>
              {product ? (
                <Link href={ctaHref} className="btn btn-primary w-full">
                  Get a site
                </Link>
              ) : (
                <p className="border-2 border-white p-3 text-sm">The plan is being set up. Please check back in a minute.</p>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
