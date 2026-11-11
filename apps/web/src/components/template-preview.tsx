import type { TemplateInfo } from "@/lib/config";

/**
 * A line-drawn layout schematic of each template, like the sketch printed on a
 * spec sheet: it shows the real section structure, not a stock screenshot.
 */
export function TemplatePreview({ template }: { template: TemplateInfo }) {
  return (
    <div className="border-2 border-ink-950 bg-white" aria-hidden>
      <div className="flex items-center justify-between border-b-2 border-ink-950 px-2.5 py-1.5">
        <span className="label truncate text-ink-600">/{template.id}-demo/</span>
        <span className="flex gap-1">
          <span className="h-2 w-2 bg-ink-950" />
          <span className="h-2 w-2 border-2 border-ink-950" />
        </span>
      </div>
      <div className="aspect-[16/10] p-2.5">{SCHEMATICS[template.id]}</div>
    </div>
  );
}

const line = "h-1.5 bg-ink-200";
const block = "bg-ink-100 border-2 border-ink-950";

const SCHEMATICS: Record<TemplateInfo["id"], React.ReactNode> = {
  // Image-led hero, menu with prices, reservation CTA.
  restaurant: (
    <div className="grid h-full grid-rows-[1.3fr_1fr] gap-2">
      <div className={`${block} relative flex items-end p-2`}>
        <div className="space-y-1">
          <div className="h-2 w-20 bg-ink-950" />
          <div className="h-1.5 w-14 bg-ink-400" />
        </div>
        <div className="absolute right-2 bottom-2 h-3 w-10 bg-signal-500 ring-2 ring-ink-950" />
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 self-center">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className={`${line} flex-1`} />
            <div className="h-1.5 w-4 bg-ink-950" />
          </div>
        ))}
      </div>
    </div>
  ),
  // Work-first project grid with a case-study tile.
  agency: (
    <div className="grid h-full grid-cols-3 grid-rows-2 gap-2">
      <div className="col-span-2 row-span-2 flex flex-col justify-end bg-ink-950 p-2">
        <div className="h-2 w-16 bg-white" />
        <div className="mt-1 h-1.5 w-10 bg-signal-500" />
      </div>
      <div className={block} />
      <div className={block} />
    </div>
  ),
  // Service cards, a testimonial and a quote request form.
  services: (
    <div className="grid h-full grid-cols-[1fr_0.8fr] gap-2">
      <div className="grid grid-rows-3 gap-1.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-1.5 border-2 border-ink-950 px-1.5">
            <div className="h-2.5 w-2.5 bg-ink-950" />
            <div className={`${line} flex-1`} />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1.5 border-2 border-ink-950 p-1.5">
        <div className="h-2 border-2 border-ink-300" />
        <div className="h-2 border-2 border-ink-300" />
        <div className="flex-1 border-2 border-ink-300" />
        <div className="h-2.5 bg-signal-500 ring-2 ring-ink-950" />
      </div>
    </div>
  ),
};
