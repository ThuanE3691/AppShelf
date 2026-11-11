export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#4f46e5" />
      <rect x="7" y="8" width="5" height="16" rx="1.5" fill="#fff" />
      <rect x="13.5" y="11" width="5" height="13" rx="1.5" fill="#c7d2fe" />
      <rect x="20" y="8" width="5" height="16" rx="1.5" fill="#fff" transform="rotate(12 22.5 16)" />
    </svg>
  );
}
