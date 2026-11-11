import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { startSiteCheckoutAction } from "@/app/actions/sites";
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
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">
        ← Back to templates
      </Link>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">Get a WordPress site</h1>
      <p className="mt-2 text-slate-600">
        Choose a template and an address. After payment your site is provisioned automatically; it usually takes
        under a minute.
      </p>
      <div className="card mt-8 p-6 sm:p-8">
        {product?.active && product.stripePriceId ? (
          <NewSiteForm
            action={startSiteCheckoutAction}
            initialTemplate={isTemplate(template) ? template : "restaurant"}
            wpBaseUrl={wpPublicUrl()}
            priceLabel={formatPrice(product)}
          />
        ) : (
          <p className="text-slate-600">The WordPress Site plan is being set up. Please check back in a minute.</p>
        )}
      </div>
    </div>
  );
}
