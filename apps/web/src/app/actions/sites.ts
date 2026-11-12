"use server";

import { getDb } from "@appshelf/db";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createRenewCheckout, createSiteCheckout } from "@/lib/checkout";
import { isTemplate } from "@/lib/config";
import { canCancel, canRenew, getOwnedSite } from "@/lib/dashboard";
import { cancelLicenseSubscriptions } from "@/lib/lifecycle";
import { getWordPressProduct } from "@/lib/products";
import { checkSlug } from "@/lib/slug";
import { validateTitle } from "@/lib/site-title";

export interface NewSiteFormState {
  error?: string;
  fieldErrors?: Partial<Record<"template" | "title" | "slug", string>>;
  values?: { template?: string; title?: string; slug?: string };
}

async function requireUser(next: string) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

export async function startSiteCheckoutAction(_prev: NewSiteFormState, formData: FormData): Promise<NewSiteFormState> {
  const user = await requireUser("/sites/new");
  const template = String(formData.get("template") ?? "");
  const values = {
    template,
    title: String(formData.get("title") ?? "").trim(),
    slug: String(formData.get("slug") ?? ""),
  };

  const fieldErrors: NewSiteFormState["fieldErrors"] = {};
  if (!isTemplate(template)) fieldErrors.template = "Pick one of the three templates.";
  const title = validateTitle(values.title);
  if (!title.ok) fieldErrors.title = title.error;
  const slug = await checkSlug(getDb(), values.slug);
  if (!slug.ok) fieldErrors.slug = slug.error;
  if (Object.keys(fieldErrors).length > 0 || !isTemplate(template) || !title.ok || !slug.ok) {
    return { fieldErrors, values };
  }

  const product = await getWordPressProduct();
  if (!product?.active || !product.stripePriceId) {
    return { error: "The WordPress Site plan is not available right now. Please try again later.", values };
  }

  let checkoutUrl: string;
  try {
    checkoutUrl = await createSiteCheckout({ user, product, template, title: title.title, slug: slug.slug });
  } catch (error) {
    console.error("create checkout failed", error);
    return { error: "Could not start Stripe Checkout. Please try again.", values };
  }
  redirect(checkoutUrl);
}

export interface SiteActionState {
  error?: string;
}

export async function cancelPlanAction(_prev: SiteActionState, formData: FormData): Promise<SiteActionState> {
  const user = await requireUser("/dashboard");
  const entry = await getOwnedSite(user.id, String(formData.get("siteId") ?? ""));
  if (!entry || !canCancel(entry) || !entry.subscription) return { error: "This plan cannot be cancelled." };

  try {
    await cancelLicenseSubscriptions(entry.license.id);
  } catch (error) {
    console.error("cancel subscription failed", error);
    return { error: "Stripe could not cancel the plan. Please try again." };
  }
  // Fresh dashboard without any stale ?checkout= notice.
  redirect("/dashboard?plan=cancelled");
}

export async function renewPlanAction(_prev: SiteActionState, formData: FormData): Promise<SiteActionState> {
  const user = await requireUser("/dashboard");
  const entry = await getOwnedSite(user.id, String(formData.get("siteId") ?? ""));
  if (!entry || !canRenew(entry)) return { error: "This site can no longer be renewed." };

  const product = await getWordPressProduct();
  if (!product?.active || !product.stripePriceId) return { error: "The plan is not available right now." };

  let checkoutUrl: string;
  try {
    checkoutUrl = await createRenewCheckout({
      user,
      product,
      licenseId: entry.license.id,
      siteId: entry.site.id,
      stripeCustomerId: entry.subscription?.stripeCustomerId ?? null,
    });
  } catch (error) {
    console.error("create renew checkout failed", error);
    return { error: "Could not start Stripe Checkout. Please try again." };
  }
  redirect(checkoutUrl);
}
