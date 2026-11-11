# AppShelf demo: plan

Status: in progress. Contract: `docs/contracts.md`. Tracking: GitHub issue in
ThuanE3691/AppShelf.

## Objective

A demo SaaS (Next.js + Postgres + Stripe test mode) that sells licensed apps.
First product: a hosted WordPress site provisioned on WordPress Multisite from 3
templates, which also serve as the WordPress portfolio. Runs on the owner's own
machine (Docker Desktop) behind Cloudflare Tunnel, switched on for demos.

## Done means (locked 2026-11-11, host adjusted to the owner's machine)

1. A stranger signs up, pays with 4242, and gets a running WordPress site in
   under 2 minutes.
2. Cancelling the plan makes the license inactive and archives the site;
   renewing reopens it.
3. Sites delete themselves after 48 hours (runs while the stack is on; catch-up
   on start).
4. All 3 template links load and score 80+ on Lighthouse mobile (measured while
   the stack is on; portfolio says "live demo on request").
5. `products`, `subscriptions`, `licenses`, `jobs` exist and are ready for a
   `plugin` product type.
6. CI/CD: GitHub Actions lints, tests, builds and publishes images to GHCR;
   `appshelf up` pulls and runs them.
7. README includes an architecture diagram.
8. 2 Upwork portfolio entries are live (drafts prepared; owner reviews and posts
   with help on 2026-11-12).

Out of scope: PayPal, plugin license keys, full admin panel, live payments, real
customers, tax and legal, real email, a container per site.

## Phases

| Phase | Owner | Depends on | Output |
|---|---|---|---|
| 0 Skeleton and contracts | orchestrator | none | repo, `docs/contracts.md`, base compose, `scripts/appshelf.ps1` |
| 1a Web app and DB | session `web` | 0 | `packages/db`, `apps/web`, `apps/web/compose.yaml` |
| 1b WordPress and templates | session `wordpress` | 0 | `wordpress/**` incl. compose, scripts, 3 themes |
| 2a Worker | session `worker` | 1a, 1b | `apps/worker/**` |
| 2b CI/CD, tunnel, README | session `infra` | 1a, 1b | `.github/**`, `infra/tunnel.compose.yaml`, `scripts/**`, `README.md` |
| 3 Integration and E2E | orchestrator | 2a, 2b | Playwright E2E < 2 min, Lighthouse report |
| 4 Isolated review | fresh review session | 3 | findings fixed, re-review clean |
| 5 Portfolio drafts | orchestrator | 3 | `docs/portfolio/*.md` + screenshots |
| 6 Public URL | orchestrator | owner buys domain | tunnel, DNS, public E2E, Stripe webhook endpoint |

## Acceptance checks

- `npm run lint && npm run typecheck && npm test` green locally and in CI.
- `tests/e2e` Playwright: fresh email, signup, Checkout with 4242, site reachable,
  elapsed < 120 s; cancel then site returns archived page; renew then site loads;
  expiry with a shortened `expires_at` deletes the site.
- `npx lighthouse --form-factor=mobile` on the 3 template URLs: performance,
  accessibility, best practices, SEO each reported; performance >= 80.
- `psql \d products subscriptions licenses jobs` shows the tables; `product_type`
  enum contains `plugin`.

## Risks

- Multisite domain is stored in the DB: moving from `wp.appshelf.localhost` to
  the public domain needs `wp search-replace` (script owned by phase 2b).
- Without a domain, Stripe webhooks go through `stripe-cli` forwarding; the
  success page also syncs the Checkout session so provisioning never depends on
  one path.
