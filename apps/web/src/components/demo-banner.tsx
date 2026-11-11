import { DEMO_NOTICE } from "@/lib/config";
import { Warning } from "./icons";

export function DemoBanner() {
  return (
    <div role="note" aria-label="Demo notice" className="surface-ink bg-ink-950 text-white">
      <div className="page flex items-start gap-3 py-2.5 sm:items-center">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center bg-signal-500 text-ink-950 sm:mt-0">
          <Warning className="h-3.5 w-3.5" />
        </span>
        <p className="text-sm font-medium">{DEMO_NOTICE}</p>
      </div>
      <div aria-hidden className="hazard h-1.5" />
    </div>
  );
}
