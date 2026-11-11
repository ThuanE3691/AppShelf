import { DEMO_NOTICE } from "@/lib/config";
import { Warning } from "./icons";

export function DemoBanner() {
  return (
    <div role="note" aria-label="Demo notice" className="surface-ink bg-ink-950 text-white">
      <div className="page flex items-start gap-2 py-1.5 sm:items-center sm:py-2">
        <Warning className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-500 sm:mt-0" />
        <p className="text-xs leading-4 font-medium sm:text-sm">{DEMO_NOTICE}</p>
      </div>
      <div aria-hidden className="hazard h-1" />
    </div>
  );
}
