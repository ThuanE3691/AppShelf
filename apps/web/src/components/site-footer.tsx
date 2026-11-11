export function SiteFooter() {
  return (
    <footer className="surface-ink border-t-2 border-ink-950 bg-ink-950 text-ink-200">
      <div className="page grid gap-6 py-10 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className="label text-signal-500">AppShelf · personal portfolio project</p>
          <p className="mt-3 max-w-(--container-prose) text-sm">
            No real payments are taken and no real email is sent.
          </p>
        </div>
        <ul aria-label="Built with" className="label flex flex-wrap gap-x-4 gap-y-2 text-ink-300">
          <li>Next.js</li>
          <li>Postgres</li>
          <li>Stripe test mode</li>
          <li>WordPress Multisite</li>
        </ul>
      </div>
    </footer>
  );
}
