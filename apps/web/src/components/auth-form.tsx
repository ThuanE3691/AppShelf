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
    <form action={formAction} className="space-y-6" noValidate>
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
          aria-invalid={Boolean(state.error)}
          aria-describedby={state.error ? "auth-error" : undefined}
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
          aria-invalid={Boolean(state.error)}
          aria-describedby={[isSignup ? "password-hint" : "", state.error ? "auth-error" : ""].join(" ").trim() || undefined}
        />
        {isSignup && (
          <p id="password-hint" className="mt-2 text-sm text-ink-600">
            At least 8 characters. There is no email verification in this demo.
          </p>
        )}
      </div>
      {state.error && (
        <p id="auth-error" role="alert" className="border-2 border-danger-700 bg-danger-100 px-3 py-2 text-sm font-medium text-danger-700">
          {state.error}
        </p>
      )}
      <SubmitButton pendingLabel={isSignup ? "Creating account…" : "Signing in…"} className="btn btn-primary w-full">
        {isSignup ? "Create account" : "Sign in"}
      </SubmitButton>
      <p className="border-t-2 border-ink-100 pt-5 text-sm text-ink-700">
        {isSignup ? "Already have an account?" : "New to AppShelf?"}{" "}
        <Link href={otherHref} className="text-link">
          {isSignup ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
