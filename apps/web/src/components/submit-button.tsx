"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingLabel,
  className = "btn btn-primary",
}: {
  children: ReactNode;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? (
        <>
          <span aria-hidden className="h-3 w-3 animate-spin border-2 border-current border-r-transparent" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
