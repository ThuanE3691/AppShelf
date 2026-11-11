"use client";

import { useActionState, useEffect, useState } from "react";
import type { NewSiteFormState } from "@/app/actions/sites";
import { TEMPLATES } from "@/lib/config";
import { slugify, validateSlug } from "@/lib/slug-rules";
import { SubmitButton } from "./submit-button";

type Availability = { state: "idle" | "checking" } | { state: "ok" } | { state: "error"; message: string };

export function NewSiteForm({
  action,
  initialTemplate,
  wpBaseUrl,
  priceLabel,
}: {
  action: (state: NewSiteFormState, formData: FormData) => Promise<NewSiteFormState>;
  initialTemplate: string;
  wpBaseUrl: string;
  priceLabel: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const [template, setTemplate] = useState(state.values?.template ?? initialTemplate);
  const [title, setTitle] = useState(state.values?.title ?? "");
  const [slug, setSlug] = useState(state.values?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(Boolean(state.values?.slug));
  const [availability, setAvailability] = useState<Availability>({ state: "idle" });

  // Until the visitor edits the address by hand, it follows the title.
  const effectiveSlug = slugEdited ? slug : slugify(title);

  useEffect(() => {
    if (!effectiveSlug) return;
    const format = validateSlug(effectiveSlug);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (!format.ok) {
        setAvailability({ state: "error", message: format.error });
        return;
      }
      setAvailability({ state: "checking" });
      try {
        const res = await fetch(`/api/slug-check?slug=${encodeURIComponent(format.slug)}`, { signal: controller.signal });
        const body = (await res.json()) as { ok: boolean; error?: string };
        setAvailability(body.ok ? { state: "ok" } : { state: "error", message: body.error ?? "Not available." });
      } catch {
        if (!controller.signal.aborted) setAvailability({ state: "idle" });
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [effectiveSlug]);

  const slugError =
    state.fieldErrors?.slug ?? (effectiveSlug && availability.state === "error" ? availability.message : undefined);

  return (
    <form action={formAction} className="space-y-8">
      <fieldset>
        <legend className="field-label">Template</legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {TEMPLATES.map((t) => (
            <label
              key={t.id}
              className="group relative flex cursor-pointer flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition has-[:checked]:border-brand-600 has-[:checked]:ring-2 has-[:checked]:ring-brand-100 hover:border-slate-300"
            >
              <input
                type="radio"
                name="template"
                value={t.id}
                checked={template === t.id}
                onChange={() => setTemplate(t.id)}
                className="sr-only"
              />
              <span className={`h-16 rounded-lg bg-gradient-to-br ${t.tone}`} aria-hidden />
              <span className="mt-3 font-semibold">{t.name}</span>
              <span className="text-xs text-slate-500">{t.tagline}</span>
              <span
                aria-hidden
                className="absolute right-3 top-3 hidden h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-xs text-white group-has-[:checked]:flex"
              >
                ✓
              </span>
            </label>
          ))}
        </div>
        {state.fieldErrors?.template && <p className="field-error">{state.fieldErrors.template}</p>}
      </fieldset>

      <div>
        <label htmlFor="title" className="field-label">
          Site title
        </label>
        <input
          id="title"
          name="title"
          required
          maxLength={60}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="field-input"
          placeholder="Luna Bistro"
          aria-invalid={Boolean(state.fieldErrors?.title)}
        />
        {state.fieldErrors?.title && <p className="field-error">{state.fieldErrors.title}</p>}
      </div>

      <div>
        <label htmlFor="slug" className="field-label">
          Site address
        </label>
        <div className="mt-1.5 flex rounded-lg shadow-sm">
          <span className="inline-flex items-center rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-3 font-mono text-xs text-slate-500">
            {wpBaseUrl.replace(/^https?:\/\//, "")}/
          </span>
          <input
            id="slug"
            name="slug"
            required
            maxLength={30}
            value={effectiveSlug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value.toLowerCase());
            }}
            className="block w-full min-w-0 rounded-r-lg border border-slate-300 px-3 py-2.5 font-mono text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-100 focus:outline-none"
            placeholder="luna-bistro"
            aria-describedby="slug-status"
            aria-invalid={Boolean(slugError)}
            spellCheck={false}
            autoCapitalize="off"
          />
        </div>
        <p id="slug-status" aria-live="polite" className={slugError ? "field-error" : "mt-1.5 text-sm text-slate-500"}>
          {slugError ??
            (availability.state === "checking"
              ? "Checking…"
              : availability.state === "ok" && effectiveSlug
                ? "✓ Available"
                : "Lowercase letters, numbers and hyphens. Filled in from the title.")}
        </p>
      </div>

      {state.error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {state.error}
        </p>
      )}

      <div className="flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-600">
          {priceLabel}/month, billed by Stripe in test mode. Use card <span className="font-mono">4242 4242 4242 4242</span>.
        </p>
        <SubmitButton pendingLabel="Opening Stripe…" className="btn btn-primary px-5 py-3">
          Continue to payment
        </SubmitButton>
      </div>
    </form>
  );
}
