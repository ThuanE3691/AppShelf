import { DEMO_NOTICE } from "@/lib/config";

export function DemoBanner() {
  return (
    <div role="note" aria-label="Demo notice" className="bg-amber-100 text-amber-950">
      <p className="mx-auto max-w-6xl px-4 py-2 text-center text-sm font-medium sm:px-6">
        <span aria-hidden className="mr-1.5">⚠</span>
        {DEMO_NOTICE}
      </p>
    </div>
  );
}
