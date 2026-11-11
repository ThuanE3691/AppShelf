"use client";

import { useActionState } from "react";
import type { SiteActionState } from "@/app/actions/sites";
import { SubmitButton } from "./submit-button";

type Action = (state: SiteActionState, formData: FormData) => Promise<SiteActionState>;

export function CancelPlanButton({ action, siteId, siteTitle }: { action: Action; siteId: string; siteTitle: string }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(`Cancel the plan for "${siteTitle}"? The licence turns inactive and the site is archived right away.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="siteId" value={siteId} />
      <SubmitButton pendingLabel="Cancelling…" className="btn btn-danger">
        Cancel plan
      </SubmitButton>
      {state.error && <p role="alert" className="field-error">{state.error}</p>}
    </form>
  );
}

export function RenewPlanButton({ action, siteId }: { action: Action; siteId: string }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction}>
      <input type="hidden" name="siteId" value={siteId} />
      <SubmitButton pendingLabel="Opening Stripe…" className="btn btn-primary">
        Renew
      </SubmitButton>
      {state.error && <p role="alert" className="field-error">{state.error}</p>}
    </form>
  );
}
