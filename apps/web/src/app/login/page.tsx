import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signInAction } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth-card";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser, safeNextPath } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next);
  if (await getCurrentUser()) redirect(next);
  return (
    <AuthCard title="Sign in" subtitle="Manage your sites, cancel or renew your plan.">
      <AuthForm mode="signin" action={signInAction} next={next} />
    </AuthCard>
  );
}
