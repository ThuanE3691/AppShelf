/**
 * Decorative barcode derived from a code string, so each SKU gets its own
 * stable pattern. Not a scannable symbology; hidden from assistive tech.
 */
export function Barcode({ value, className = "h-10 w-full" }: { value: string; className?: string }) {
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  let seed = 7;
  for (const ch of `*${value}*`) {
    seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
    for (let i = 0; i < 3; i++) {
      const w = 1 + ((seed >> (i * 2)) % 3);
      bars.push({ x, w });
      x += w + 1 + ((seed >> (i + 3)) % 2);
    }
  }
  return (
    <svg viewBox={`0 0 ${x} 20`} preserveAspectRatio="none" className={className} aria-hidden>
      {bars.map((b) => (
        <rect key={b.x} x={b.x} y="0" width={b.w} height="20" fill="currentColor" />
      ))}
    </svg>
  );
}
