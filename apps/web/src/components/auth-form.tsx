"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthFormState } from "@/app/actions/auth";
import { SubmitButton } from "./submit-button";

export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: "signin" | "signup";
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  next: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const isSignup = mode === "signup";
  const otherHref = `${isSignup ? "/login" : "/signup"}?next=${encodeURIComponent(next)}`;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className="field-label">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          className="field-input"
          placeholder="you@example.com"
        />
      </div>
      <div>
        <label htmlFor="password" className="field-label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={isSignup ? "new-password" : "current-password"}
          required
          minLength={isSignup ? 8 : undefined}
          className="field-input"
          aria-describedby={isSignup ? "password-hint" : undefined}
        />
        {isSignup && (
          <p id="password-hint" className="mt-1.5 text-xs text-slate-500">
            At least 8 characters. There is no email verification in this demo.
          </p>
        )}
      </div>
      {state.error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {state.error}
        </p>
      )}
      <SubmitButton pendingLabel={isSignup ? "Creating account…" : "Signing in…"} className="btn btn-primary w-full py-3">
        {isSignup ? "Create account" : "Sign in"}
      </SubmitButton>
      <p className="text-center text-sm text-slate-600">
        {isSignup ? "Already have an account?" : "New to AppShelf?"}{" "}
        <Link href={otherHref} className="font-semibold text-brand-700 hover:underline">
          {isSignup ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
