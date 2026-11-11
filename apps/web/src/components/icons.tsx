// One icon family: 16px grid, 2px square-capped strokes, decorative only.
type IconProps = { className?: string };

const base = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "square" as const,
  strokeLinejoin: "miter" as const,
  "aria-hidden": true,
};

export function ArrowUpRight({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 3h8v8M13 3 3 13" />
    </svg>
  );
}

export function ArrowLeft({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M14 8H3M7 3 2 8l5 5" />
    </svg>
  );
}

export function ArrowDown({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 2v11M3 8l5 5 5-5" />
    </svg>
  );
}

export function Check({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="m2.5 8.5 3.5 3.5 7.5-8" />
    </svg>
  );
}

export function Plus({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 2v12M2 8h12" />
    </svg>
  );
}

export function Warning({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 1.5 15 14.5H1z" />
      <path d="M8 6v4M8 12v.5" />
    </svg>
  );
}
