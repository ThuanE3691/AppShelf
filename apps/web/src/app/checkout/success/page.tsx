import Link from "next/link";
import { redirect } from "next/navigation";
import { syncCheckoutSession } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

/**
 * Stripe sends the buyer here after paying. The webhook normally applies the
 * checkout first; syncing again is idempotent and covers a missed webhook.
 */
export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id: sessionId } = await searchParams;
  if (!sessionId || !/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) redirect("/dashboard");

  let synced = true;
  let kind: string | undefined;
  try {
    const session = await syncCheckoutSession(sessionId);
    kind = session.metadata?.kind;
  } catch (error) {
    console.error("checkout success sync failed", error);
    synced = false;
  }
  if (synced) redirect(`/dashboard?checkout=${kind === "renew" ? "renewed" : "success"}`);

  return (
    <div className="page py-(--spacing-section)">
      <div className="tag mx-auto max-w-xl">
        <div className="surface-ink flex items-center justify-between bg-ink-950 px-5 py-2.5 text-white">
          <span className="label">Receipt · pending sync</span>
          <span className="label text-signal-500">Stripe test mode</span>
        </div>
        <div className="p-6 sm:p-8">
          <h1 className="text-2xl font-bold">Payment received</h1>
          <p className="mt-3 text-ink-700">
            We could not confirm the order with Stripe just now. It will appear on your dashboard as soon as Stripe
            notifies us.
          </p>
          <Link href="/dashboard" className="btn btn-primary mt-8">
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
