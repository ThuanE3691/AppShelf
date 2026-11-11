import Link from "next/link";
import { signOutAction } from "@/app/actions/auth";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "./logo";

const navLink =
  "label min-h-11 items-center px-2 text-ink-700 underline-offset-4 hover:text-ink-950 hover:underline sm:px-3";

export async function SiteHeader() {
  const user = await getCurrentUser();
  return (
    <header className="border-b-2 border-ink-950 bg-white">
      <div className="page flex h-16 items-center justify-between gap-3">
        <Link href="/" className="-ml-1 shrink-0 p-1" aria-label="AppShelf home">
          <Logo className="h-8 w-auto sm:h-9" />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          <Link href="/#templates" className={`${navLink} hidden md:inline-flex`}>
            Templates
          </Link>
          <Link href="/#pricing" className={`${navLink} hidden md:inline-flex`}>
            Pricing
          </Link>
          {user ? (
            <>
              <Link href="/dashboard" className={`${navLink} inline-flex`}>
                Dashboard
              </Link>
              <form action={signOutAction}>
                <button type="submit" className={`${navLink} inline-flex`}>
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className={`${navLink} inline-flex`}>
                Sign in
              </Link>
              <Link href="/signup?next=/sites/new" className="btn btn-primary ml-1 px-3 sm:px-5">
                Get a site
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
