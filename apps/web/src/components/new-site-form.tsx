"use client";

import { useActionState, useEffect, useState } from "react";
import type { NewSiteFormState } from "@/app/actions/sites";
import { TEMPLATES } from "@/lib/config";
import { slugify, validateSlug } from "@/lib/slug-rules";
import { Check } from "./icons";
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
    <form action={formAction} className="space-y-10">
      <fieldset>
        <legend className="field-label">01 · Template</legend>
        <div className="mt-3 grid gap-0 border-2 border-ink-950 sm:grid-cols-3">
          {TEMPLATES.map((t, i) => (
            <label
              key={t.id}
              className={`group relative flex cursor-pointer flex-col bg-white p-4 transition-colors hover:bg-ink-100 has-[:checked]:bg-signal-500 has-[:focus-visible]:outline-3 has-[:focus-visible]:-outline-offset-6 has-[:focus-visible]:outline-ink-950 ${
                i > 0 ? "border-t-2 border-ink-950 sm:border-t-0 sm:border-l-2" : ""
              }`}
            >
              <input
                type="radio"
                name="template"
                value={t.id}
                checked={template === t.id}
                onChange={() => setTemplate(t.id)}
                className="sr-only"
              />
              <span className="flex items-center justify-between gap-2">
                <span className="label text-ink-700 group-has-[:checked]:text-ink-950">
                  Bin {t.bin} · {t.sku}
                </span>
                <span
                  aria-hidden
                  className="flex h-6 w-6 items-center justify-center border-2 border-ink-950 bg-white text-transparent group-has-[:checked]:bg-ink-950 group-has-[:checked]:text-signal-500"
                >
                  <Check />
                </span>
              </span>
              <span className="mt-6 text-lg font-bold">{t.name}</span>
              <span className="mt-1 text-sm text-ink-700 group-has-[:checked]:text-ink-950">{t.tagline}</span>
            </label>
          ))}
        </div>
        {state.fieldErrors?.template && <p className="field-error">{state.fieldErrors.template}</p>}
      </fieldset>

      <div>
        <label htmlFor="title" className="field-label">
          02 · Site title
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
          aria-describedby={state.fieldErrors?.title ? "title-error" : undefined}
        />
        {state.fieldErrors?.title && (
          <p id="title-error" className="field-error">
            {state.fieldErrors.title}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="slug" className="field-label">
          03 · Site address
        </label>
        <div className="mt-2 flex border-2 border-ink-950 bg-white focus-within:shadow-[4px_4px_0_0_var(--color-signal-500)] has-[[aria-invalid=true]]:border-danger-700">
          <span className="hidden items-center border-r-2 border-ink-950 bg-ink-100 px-3 font-mono text-xs text-ink-700 sm:inline-flex">
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
            className="block min-h-11 w-full min-w-0 px-3 py-2.5 font-mono text-base placeholder:text-ink-400 focus:outline-none focus-visible:outline-3 focus-visible:-outline-offset-4 focus-visible:outline-ink-950"
            placeholder="luna-bistro"
            aria-describedby="slug-prefix slug-status"
            aria-invalid={Boolean(slugError)}
            spellCheck={false}
            autoCapitalize="off"
          />
        </div>
        <p id="slug-prefix" className="mt-2 font-mono text-xs break-all text-ink-600 sm:hidden">
          {wpBaseUrl.replace(/^https?:\/\//, "")}/{effectiveSlug || "your-address"}/
        </p>
        <p
          id="slug-status"
          aria-live="polite"
          className={slugError ? "field-error" : "mt-2 flex items-center gap-1.5 text-sm text-ink-600"}
        >
          {slugError ??
            (availability.state === "checking" ? (
              "Checking…"
            ) : availability.state === "ok" && effectiveSlug ? (
              <>
                <span className="flex h-4 w-4 items-center justify-center bg-ok-700 text-white">
                  <Check className="h-3 w-3" />
                </span>
                <span className="font-medium text-ok-700">Available</span>
              </>
            ) : (
              "Lowercase letters, numbers and hyphens. Filled in from the title."
            ))}
        </p>
      </div>

      {state.error && (
        <p role="alert" className="border-2 border-danger-700 bg-danger-100 px-3 py-2 text-sm font-medium text-danger-700">
          {state.error}
        </p>
      )}

      <div className="flex flex-col gap-4 border-t-2 border-ink-950 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-700">
          <span className="font-mono font-bold text-ink-950">{priceLabel}/month</span>, billed by Stripe in test mode.
          <br />
          Test card <span className="font-mono text-ink-950">4242 4242 4242 4242</span>.
        </p>
        <SubmitButton pendingLabel="Opening Stripe…" className="btn btn-primary">
          Continue to payment
        </SubmitButton>
      </div>
    </form>
  );
}
