import type { Product } from "@appshelf/db";
import Link from "next/link";
import { Barcode } from "@/components/barcode";
import { ArrowDown, ArrowUpRight } from "@/components/icons";
import { TemplatePreview } from "@/components/template-preview";
import { getCurrentUser } from "@/lib/auth";
import { showcaseUrl, TEMPLATES } from "@/lib/config";
import { formatPrice, getWordPressProduct } from "@/lib/products";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    title: "Pick a template",
    body: "Restaurant, agency or services. Each one is a real WordPress theme with a live showcase you can open first.",
  },
  {
    title: "Pay with a test card",
    body: "Stripe Checkout in test mode. Use 4242 4242 4242 4242, any future date and any CVC.",
  },
  {
    title: "Get your site",
    body: "A worker provisions the site on a WordPress Multisite network. Your dashboard shows the address and the admin login.",
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
    <article aria-label="WordPress Site product label" className="tag relative">
      <div className="surface-ink flex items-center justify-between bg-ink-950 px-4 py-2 text-white">
        <span className="label">SKU WP-01</span>
        <span className="label text-signal-500">Bin A · Aisle 01</span>
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
      <dl className="divide-y-2 divide-ink-100 px-4 font-mono text-xs sm:px-5">
        {[
          ["Network", "WordPress Multisite"],
          ["Templates", `${TEMPLATES.length} on the shelf`],
          ["Billing", "Stripe test mode"],
          ["Lifetime", "48 h (demo)"],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2.5">
            <dt className="uppercase tracking-(--tracking-label) text-ink-600">{k}</dt>
            <dd className="text-right font-medium text-ink-950">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t-2 border-ink-950 px-4 pt-3 pb-2 sm:px-5">
        <Barcode value="WP-01-0900" className="h-10 w-full text-ink-950" />
        <p className="label mt-1.5 flex justify-between text-ink-600">
          <span>WP-01-0900</span>
          <span>AppShelf</span>
        </p>
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
            <p className="label inline-flex items-center gap-2 border-2 border-ink-950 px-2 py-1 text-ink-950">
              <span aria-hidden className="h-2 w-2 bg-signal-500 ring-2 ring-ink-950" />
              Aisle 01 · Hosted WordPress
            </p>
            <h1 className="mt-6 text-display font-bold tracking-(--tracking-display)">
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
                Browse the shelf
                <ArrowDown />
              </Link>
            </div>
          </div>
          <div className="bin-grid relative -mx-(--spacing-gutter) border-y-2 border-ink-950 px-(--spacing-gutter) py-10 sm:mx-0 sm:border-2 sm:px-8 lg:col-span-5">
            <span className="label absolute top-2 left-3 bg-white px-1 text-ink-600 sm:left-4">Shelf A</span>
            <div className="mx-auto max-w-sm">
              <ProductTag product={product} price={price} />
            </div>
          </div>
        </div>
      </section>

      <section id="templates" aria-labelledby="templates-title" className="scroll-mt-4 py-(--spacing-section)">
        <div className="page">
          <div className="grid gap-4 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <p className="label text-ink-600">Aisle 01 · Shelf A · 3 bins</p>
              <h2 id="templates-title" className="mt-3 text-3xl font-bold">
                Three templates on the shelf, each one live.
              </h2>
            </div>
            <p className="text-ink-700 lg:col-span-5">
              Every template has a public showcase site on the WordPress network. Open one to see exactly what you
              will get before you pay.
            </p>
          </div>

          <div className="mt-12">
            <ul className="grid border-2 border-ink-950 bg-white md:grid-cols-3">
              {TEMPLATES.map((t, i) => (
                <li
                  key={t.id}
                  className={`flex flex-col ${i > 0 ? "border-t-2 border-ink-950 md:border-t-0 md:border-l-2" : ""}`}
                >
                  <div className="flex items-center justify-between border-b-2 border-ink-950 bg-ink-100 px-4 py-2">
                    <span className="label font-bold text-ink-950">Bin {t.bin}</span>
                    <span className="label text-ink-600">SKU {t.sku}</span>
                  </div>
                  <div className="flex flex-1 flex-col p-4 sm:p-5">
                    <TemplatePreview template={t} />
                    <h3 className="mt-6 text-xl font-bold">{t.name}</h3>
                    <p className="label mt-1 text-ink-600">{t.tagline}</p>
                    <p className="mt-4 text-sm text-ink-700">{t.description}</p>
                    <ol className="mt-5 space-y-1.5 font-mono text-xs text-ink-950">
                      {t.highlights.map((h, n) => (
                        <li key={h} className="flex gap-3">
                          <span className="text-ink-500">{String(n + 1).padStart(2, "0")}</span>
                          {h}
                        </li>
                      ))}
                    </ol>
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
            {/* The shelf rail the bins stand on. */}
            <div aria-hidden className="h-3 bg-ink-950" />
            <div aria-hidden className="flex justify-between px-6">
              <span className="h-5 w-3 bg-ink-950" />
              <span className="h-5 w-3 bg-ink-950" />
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="steps-title" className="border-y-2 border-ink-950 bg-white py-(--spacing-section)">
        <div className="page grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <p className="label text-ink-600">Pick ticket</p>
            <h2 id="steps-title" className="mt-3 text-3xl font-bold">
              How a site gets stocked
            </h2>
          </div>
          <ol className="border-t-2 border-ink-950 lg:col-span-8">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className="grid grid-cols-[4.5rem_1fr] gap-4 border-b-2 border-ink-950 py-6 sm:grid-cols-[7rem_1fr]"
              >
                <span className="font-mono text-3xl font-bold text-ink-950">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="text-lg font-bold">{step.title}</h3>
                  <p className="mt-2 max-w-(--container-prose) text-ink-700">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-4 py-(--spacing-section)">
        <div className="page">
          <div className="tag grid md:grid-cols-[1fr_20rem]">
            <div className="p-6 sm:p-8">
              <p className="label text-ink-600">Spec sheet · SKU WP-01</p>
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
            <div className="flex flex-col justify-between gap-8 border-t-2 border-ink-950 bg-signal-500 p-6 text-ink-950 sm:p-8 md:border-t-0 md:border-l-2">
              <div>
                <p className="label">Price per month</p>
                <p className="mt-3 font-mono text-display leading-none font-bold tracking-tight">{price ?? "—"}</p>
                <p className="mt-3 text-sm font-medium">Stripe test mode: no real card is charged.</p>
              </div>
              {product ? (
                <Link href={ctaHref} className="btn btn-ink w-full">
                  Get a site
                </Link>
              ) : (
                <p className="border-2 border-ink-950 bg-white p-3 text-sm">
                  The plan is being set up. Please check back in a minute.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
