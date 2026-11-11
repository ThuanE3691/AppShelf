/**
 * AppShelf wordmark as a shelf tag: a punched label with a barcode strip,
 * followed by the name. One SVG with an accessible name.
 */
export function Logo({ className = "h-9 w-auto" }: { className?: string }) {
  return (
    <svg viewBox="0 0 168 36" className={className} role="img" aria-labelledby="appshelf-logo-title">
      <title id="appshelf-logo-title">AppShelf</title>
      {/* Tag body with a clipped corner and a punch hole. */}
      <path d="M2 2h30l8 8v24H2z" className="fill-signal-500 stroke-ink-950" strokeWidth="2.5" strokeLinejoin="miter" />
      <rect x="8" y="7" width="5" height="5" className="fill-paper stroke-ink-950" strokeWidth="2" />
      {/* Barcode strip */}
      <g className="fill-ink-950">
        <rect x="7" y="17" width="2" height="11" />
        <rect x="11" y="17" width="1" height="11" />
        <rect x="14" y="17" width="3" height="11" />
        <rect x="19" y="17" width="1" height="11" />
        <rect x="22" y="17" width="2" height="11" />
        <rect x="26" y="17" width="1" height="11" />
        <rect x="29" y="17" width="3" height="11" />
        <rect x="34" y="17" width="1" height="11" />
      </g>
      <text
        x="50"
        y="26"
        className="fill-ink-950"
        style={{ font: "700 21px var(--font-grotesk), ui-sans-serif, sans-serif", letterSpacing: "-0.04em" }}
      >
        AppShelf
      </text>
    </svg>
  );
}
