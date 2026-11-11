"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatTimeLeft } from "@/lib/time-left";

/** Re-renders the server page while background jobs are still running. */
export function AutoRefresh({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}

/** Time left until the 48 hour demo expiry; ticks every 30 seconds. */
export function Countdown({ expiresAt, initialText }: { expiresAt: string; initialText: string }) {
  const [text, setText] = useState(initialText);
  useEffect(() => {
    const target = new Date(expiresAt).getTime();
    const tick = () => setText(formatTimeLeft(target - Date.now()));
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return <time dateTime={expiresAt}>{text}</time>;
}

export function SecretValue({ value, label }: { value: string; label: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const action = "label inline-flex min-h-8 items-center border-2 border-ink-950 bg-white px-2 text-ink-950 hover:bg-signal-500";
  return (
    <span className="flex flex-wrap items-center gap-2">
      <code className="bg-ink-950 px-2 py-1 font-mono text-xs text-white">{shown ? value : "••••••••••••"}</code>
      <button type="button" onClick={() => setShown((s) => !s)} className={action} aria-label={`${shown ? "Hide" : "Show"} ${label}`}>
        {shown ? "Hide" : "Show"}
      </button>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className={action}
        aria-label={`Copy ${label}`}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
