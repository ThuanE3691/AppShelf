import type { ReactNode } from "react";
import { Barcode } from "./barcode";

/** A form printed as a shelf ticket: code strip on top, fields below. */
export function AuthCard({
  code,
  title,
  subtitle,
  children,
}: {
  code: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="page grid gap-10 py-(--spacing-section) lg:grid-cols-[1fr_28rem] lg:items-start">
      <div className="max-w-(--container-prose) lg:pt-6">
        <p className="label text-ink-600">{code}</p>
        <h1 className="mt-4 text-3xl font-bold">{title}</h1>
        <p className="mt-4 text-lg text-ink-700">{subtitle}</p>
      </div>
      <div className="tag">
        <div className="flex items-center justify-between gap-4 border-b-2 border-ink-950 bg-signal-500 px-5 py-2.5">
          <span className="label text-ink-950">{code}</span>
          <Barcode value={code} className="h-5 w-24 text-ink-950" />
        </div>
        <div className="p-5 sm:p-7">{children}</div>
      </div>
    </div>
  );
}
