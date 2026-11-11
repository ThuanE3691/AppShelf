import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { startSiteCheckoutAction } from "@/app/actions/sites";
import { ArrowLeft } from "@/components/icons";
import { NewSiteForm } from "@/components/new-site-form";
import { getCurrentUser } from "@/lib/auth";
import { isTemplate, wpPublicUrl } from "@/lib/config";
import { formatPrice, getWordPressProduct } from "@/lib/products";

export const metadata: Metadata = { title: "Get a site" };

export default async function NewSitePage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  const { template } = await searchParams;
  const user = await getCurrentUser();
  if (!user) {
    const next = `/sites/new${template ? `?template=${template}` : ""}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  const product = await getWordPressProduct();

  return (
    <div className="page py-(--spacing-section)">
      <Link href="/#templates" className="label inline-flex min-h-11 items-center gap-2 text-ink-700 hover:text-ink-950">
        <ArrowLeft />
        Back to the shelf
      </Link>
      <div className="mt-4 grid gap-10 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <p className="label text-ink-600">Order form · SKU WP-01</p>
          <h1 className="mt-3 text-3xl font-bold">Get a WordPress site</h1>
          <p className="mt-4 text-ink-700">
            Choose a template and an address. After payment your site is provisioned automatically; it usually takes
            under a minute.
          </p>
        </div>
        <div className="tag p-5 sm:p-8 lg:col-span-8">
          {product?.active && product.stripePriceId ? (
            <NewSiteForm
              action={startSiteCheckoutAction}
              initialTemplate={isTemplate(template) ? template : "restaurant"}
              wpBaseUrl={wpPublicUrl()}
              priceLabel={formatPrice(product)}
            />
          ) : (
            <p className="text-ink-700">The WordPress Site plan is being set up. Please check back in a minute.</p>
          )}
        </div>
      </div>
    </div>
  );
}
