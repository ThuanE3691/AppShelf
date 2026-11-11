import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signUpAction } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth-card";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser, safeNextPath } from "@/lib/auth";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next, "/sites/new");
  if (await getCurrentUser()) redirect(next);
  return (
    <AuthCard
      title="Create your account"
      subtitle="One account holds all your AppShelf licences and sites."
    >
      <AuthForm mode="signup" action={signUpAction} next={next} />
    </AuthCard>
  );
}
