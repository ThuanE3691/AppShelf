#!/bin/sh
# Starts the AppShelf web container: guard, migrations, Stripe seed, server.
set -eu

# Demo safety: never run with anything but a Stripe test-mode secret key.
case "${STRIPE_SECRET_KEY:-}" in
  sk_test_*) ;;
  *)
    echo "Refusing to start: STRIPE_SECRET_KEY must be a Stripe test-mode secret key (sk_test_...)." >&2
    exit 1
    ;;
esac

# DATABASE_URL is built from the generated Postgres password unless given.
if [ -z "${DATABASE_URL:-}" ]; then
  : "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required to build DATABASE_URL}"
  DATABASE_URL="$(node -e '
    const e = process.env;
    const user = encodeURIComponent(e.POSTGRES_USER || "appshelf");
    const pass = encodeURIComponent(e.POSTGRES_PASSWORD);
    const host = e.POSTGRES_HOST || "postgres";
    const port = e.POSTGRES_PORT || "5432";
    const db = e.POSTGRES_DB || "appshelf";
    process.stdout.write(`postgres://${user}:${pass}@${host}:${port}/${db}`);
  ')"
  export DATABASE_URL
fi

node /app/db/dist/migrate.bundle.mjs

# Idempotent. A Stripe outage should not keep the site down; the landing page
# shows "being set up" until a later start succeeds.
node /app/seed/seed-stripe.mjs || echo "seed: Stripe product not ready yet; will retry on next start" >&2

exec "$@"
