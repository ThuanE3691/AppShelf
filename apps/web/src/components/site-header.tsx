import Link from "next/link";
import { signOutAction } from "@/app/actions/auth";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "./logo";

export async function SiteHeader() {
  const user = await getCurrentUser();
  return (
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
          <Logo />
          <span>AppShelf</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 text-sm sm:gap-2">
          <Link href="/#templates" className="hidden rounded-md px-3 py-2 text-slate-600 hover:text-slate-900 sm:block">
            Templates
          </Link>
          <Link href="/#pricing" className="hidden rounded-md px-3 py-2 text-slate-600 hover:text-slate-900 sm:block">
            Pricing
          </Link>
          {user ? (
            <>
              <Link href="/dashboard" className="rounded-md px-3 py-2 font-medium text-slate-700 hover:text-slate-900">
                Dashboard
              </Link>
              <form action={signOutAction}>
                <button type="submit" className="rounded-md px-3 py-2 text-slate-500 hover:text-slate-900">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="rounded-md px-3 py-2 font-medium text-slate-700 hover:text-slate-900">
                Sign in
              </Link>
              <Link href="/signup?next=/sites/new" className="btn btn-primary">
                Get a site
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
