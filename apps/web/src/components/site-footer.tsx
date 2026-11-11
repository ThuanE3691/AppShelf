export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>AppShelf is a personal portfolio project. No real payments are taken and no real email is sent.</p>
        <p>Next.js · Postgres · Stripe test mode · WordPress Multisite</p>
      </div>
    </footer>
  );
}
