import Image from "next/image";
import type { ReactNode } from "react";
import { TEMPLATES } from "@/lib/config";
import { TEMPLATE_SHOTS } from "@/lib/template-shots";

const WHAT_YOU_GET = [
  ["Site", "A WordPress site at wp.…/your-name/"],
  ["Admin", "The WordPress admin login, on your dashboard"],
  ["Control", "Cancel any time; renew to bring the site back"],
  ["Lifetime", "48 hours, then the demo deletes it"],
];

/**
 * Sign-up and sign-in layout. On phones the form comes right after the
 * heading; the context column (what you get, templates, test card) follows.
 */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="page grid gap-x-16 gap-y-10 py-(--spacing-section) lg:grid-cols-[1fr_28rem]">
      <div className="lg:col-start-1 lg:row-start-1">
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="mt-4 max-w-(--container-prose) text-lg text-ink-700">{subtitle}</p>
      </div>

      <div className="tag self-start p-5 sm:p-7 lg:col-start-2 lg:row-span-2 lg:row-start-1">{children}</div>

      <aside aria-label="About the WordPress Site plan" className="space-y-10 lg:col-start-1 lg:row-start-2">
        <dl className="max-w-(--container-prose) border-t-2 border-ink-950">
          {WHAT_YOU_GET.map(([k, v]) => (
            <div key={k} className="grid gap-1 border-b-2 border-ink-100 py-3 sm:grid-cols-[7rem_1fr] sm:gap-4">
              <dt className="label pt-0.5 text-ink-600">{k}</dt>
              <dd className="text-ink-950">{v}</dd>
            </div>
          ))}
        </dl>

        <div>
          <h2 className="text-lg font-bold">Pick one of three templates after you sign in</h2>
          <ul className="mt-4 grid max-w-md grid-cols-3 gap-3">
            {TEMPLATES.map((t) => (
              <li key={t.id}>
                <Image
                  src={TEMPLATE_SHOTS[t.id].mobile}
                  alt={`Mobile view of the ${t.name} showcase site`}
                  sizes="(min-width: 1024px) 140px, 30vw"
                  className="h-auto w-full border-2 border-ink-950"
                />
                <p className="mt-2 text-sm font-bold">{t.name}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="max-w-(--container-prose) border-2 border-ink-950 bg-white p-4">
          <p className="label text-ink-600">Stripe test mode</p>
          <p className="mt-2 text-ink-950">
            Pay with <span className="font-mono font-bold">4242 4242 4242 4242</span>, any future date and any CVC. No
            real card is charged.
          </p>
        </div>
      </aside>
    </div>
  );
}
