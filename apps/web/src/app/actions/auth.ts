"use server";

import { getDb, users } from "@appshelf/db";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
  burnPasswordCheck,
  hashPassword,
  normaliseEmail,
  safeNextPath,
  signIn,
  signOut,
  verifyPassword,
} from "@/lib/auth";

export interface AuthFormState {
  error?: string;
  email?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;

function readCredentials(formData: FormData) {
  return {
    email: normaliseEmail(String(formData.get("email") ?? "")),
    password: String(formData.get("password") ?? ""),
    next: safeNextPath(formData.get("next")),
  };
}

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const { email, password, next } = readCredentials(formData);
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return { error: "Enter a valid email address.", email };
  if (password.length < PASSWORD_MIN) return { error: `Use at least ${PASSWORD_MIN} characters for the password.`, email };
  if (password.length > PASSWORD_MAX) return { error: "That password is too long.", email };

  const [user] = await getDb()
    .insert(users)
    .values({ email, passwordHash: await hashPassword(password) })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });
  if (!user) return { error: "An account with this email already exists. Sign in instead.", email };

  await signIn(user.id);
  redirect(next);
}

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const { email, password, next } = readCredentials(formData);
  const [user] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  const valid = user ? await verifyPassword(user.passwordHash, password) : (await burnPasswordCheck(password), false);
  if (!user || !valid) return { error: "Email or password is incorrect.", email };

  await signIn(user.id);
  redirect(next);
}

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect("/");
}
