import { getDb, products, type Product } from "@appshelf/db";
import { eq } from "drizzle-orm";
import { PRODUCT_SLUG } from "./config";

/** The WordPress Site product, or null until the seed script has run. */
export async function getWordPressProduct(): Promise<Product | null> {
  const [row] = await getDb().select().from(products).where(eq(products.slug, PRODUCT_SLUG)).limit(1);
  return row ?? null;
}

export function formatPrice(product: Pick<Product, "priceCents" | "currency">): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: product.currency.toUpperCase(),
    minimumFractionDigits: product.priceCents % 100 === 0 ? 0 : 2,
  }).format(product.priceCents / 100);
}
