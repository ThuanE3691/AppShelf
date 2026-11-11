import type { TemplateInfo } from "@/lib/config";

/** A small browser-window mock-up that hints at each template's layout. */
export function TemplatePreview({ template }: { template: TemplateInfo }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-rose-300" />
        <span className="h-2 w-2 rounded-full bg-amber-300" />
        <span className="h-2 w-2 rounded-full bg-emerald-300" />
        <span className="ml-2 truncate font-mono text-[10px] text-slate-400">/{template.id}-demo/</span>
      </div>
      <div className={`bg-gradient-to-br ${template.tone} p-4 text-white`}>
        <div className="h-2 w-16 rounded bg-white/70" />
        <div className="mt-4 h-4 w-3/4 rounded bg-white/90" />
        <div className="mt-2 h-2 w-1/2 rounded bg-white/60" />
        <div className="mt-4 h-5 w-20 rounded-md bg-white/90" />
      </div>
      <div className="grid grid-cols-3 gap-2 p-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1.5 rounded-md bg-slate-50 p-2">
            <div className="h-6 rounded bg-slate-200" />
            <div className="h-1.5 w-3/4 rounded bg-slate-200" />
            <div className="h-1.5 w-1/2 rounded bg-slate-200" />
          </div>
        ))}
      </div>
    </div>
  );
}
