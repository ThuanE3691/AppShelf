# AppShelf contracts

AppShelf is a **personal demo project**. It sells licensed apps; the first product
type is a hosted WordPress site on one WordPress Multisite network. Payments run
in Stripe **test mode only**. No real customers, no real email.

This file is the contract between the parts of the repo. Change it only together
with every part that depends on the changed section.

## Repository layout and ownership

| Path | Owns |
|---|---|
| `packages/db` | Drizzle schema, SQL migrations, typed client (`@appshelf/db`) |
| `apps/web` | Next.js app: auth, catalogue, checkout, Stripe webhook, dashboard |
| `apps/worker` | Job runner: polls `jobs`, calls the WordPress scripts, 48 h cleanup |
| `wordpress` | WordPress image, multisite install, 3 template themes, site scripts |
| `infra`, `scripts`, `.github` | Compose edge and tunnel, `appshelf` CLI, CI/CD |

npm workspaces (`apps/*`, `packages/*`), Node 24, TypeScript strict.

## Runtime topology (Docker Compose, one machine)

Compose files are merged with `-f` in this order (see `scripts/appshelf.ps1`):
`compose.yaml`, `wordpress/compose.yaml`, `apps/web/compose.yaml`,
`apps/worker/compose.yaml`, `infra/images.compose.yaml` (GHCR image names for
the services built here), and `infra/tunnel.compose.yaml` only when
`.secrets.local` holds `TUNNEL_TOKEN`. The project name is `appshelf`.

`appshelf up` pulls the GHCR images and starts without building;
`appshelf up --build` builds the same services locally. CI publishes
`ghcr.io/thuane3691/appshelf-{web,wordpress,worker}` tagged `latest` and the
commit SHA on every push to `main` (`.github/workflows/ci.yml`,
`infra/docker-bake.hcl`); `APPSHELF_IMAGE_TAG` selects a SHA.

| Service | Image | Internal address | Notes |
|---|---|---|---|
| `postgres` | `postgres:17-alpine` | `postgres:5432` | DB `appshelf` |
| `mariadb` | `mariadb:11` | `mariadb:3306` | DB `wordpress` |
| `wordpress` | `ghcr.io/thuane3691/appshelf-wordpress`, built from `wordpress/` | `wordpress:80` | Multisite, subdirectory |
| `wp-init` | same image as `wordpress` | one-shot | installs network + templates, idempotent |
| `web` | `ghcr.io/thuane3691/appshelf-web`, built from `apps/web/` | `web:3000` | Next.js standalone |
| `stripe-cli` | `stripe/stripe-cli` | none | forwards webhooks; not started once the tunnel and its webhook exist |
| `worker` | `ghcr.io/thuane3691/appshelf-worker`, built from `apps/worker/` | none | Node + wp-cli, mounts `wp_data` |
| `edge` | `caddy:2-alpine` | host `127.0.0.1:80` | local hostnames only |
| `cloudflared` | `cloudflare/cloudflared` (pinned) | none | public hostnames, outbound-only, optional |

Volumes: `pg_data`, `db_data`, `wp_data` (mounted at `/var/www/html` in
`wordpress`, `wp-init` and `worker`).

Hostnames. Local: `app.appshelf.localhost` and `wp.appshelf.localhost`
(served by `edge`). Public, once a domain exists: `app.<CF_ZONE>` and
`wp.<CF_ZONE>` (served by `cloudflared` through the remotely-managed tunnel
`appshelf`, whose ingress is `app.<CF_ZONE>` → `http://web:3000` and
`wp.<CF_ZONE>` → `http://wordpress:80`). Config variables:
`APP_URL` (default `http://app.appshelf.localhost`), `WP_DOMAIN`
(default `wp.appshelf.localhost`), `WP_PUBLIC_URL` (default
`http://wp.appshelf.localhost`) and `WP_SCHEME` (default `http`). WordPress
sites live at `<WP_SCHEME>://<WP_DOMAIN>/<slug>/`. `appshelf tunnel` stores the
public values in `.secrets.local` and the script exports them for Compose
interpolation; `appshelf set-domain` moves an installed network to `WP_DOMAIN`
(backup in `backups/` first).

Secrets. User-supplied secrets are in `.env.local`: `STRIPE_SECRET_KEY`,
`STRIPE_PUBLISHABLE_KEY` (test mode), `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID` and `CF_ZONE` (empty until a domain exists). Generated
secrets are in `.secrets.local`, created by
`scripts/appshelf.ps1` when missing: `POSTGRES_PASSWORD`, `MARIADB_PASSWORD`,
`MARIADB_ROOT_PASSWORD`, `SESSION_SECRET`, `WP_NETWORK_ADMIN_PASSWORD`; plus,
written by `appshelf tunnel`: `TUNNEL_TOKEN`, `STRIPE_WEBHOOK_SECRET` (the
public Stripe test webhook endpoint), `APP_URL`, `WP_DOMAIN`, `WP_PUBLIC_URL`,
`WP_SCHEME`.
Both files are gitignored and loaded by Compose through
`env_file: ["${APPSHELF_SECRETS_DIR:-.}/<file>"]`; from a git worktree set
`APPSHELF_SECRETS_DIR=D:/Works/Upworks/projects/appshelf` so the main
checkout's files are used (never copy them). Never print
their values. Code must refuse a Stripe secret key that does not start with
`sk_test_`.

Memory caps (`mem_limit`): postgres 256m, mariadb 384m, wordpress 512m,
web 512m, worker 384m, edge 64m, cloudflared 64m, stripe-cli 64m. No service
uses `restart: always`; `restart: "no"` everywhere, so nothing starts with
Docker Desktop.

## Database (`packages/db`, Postgres)

All ids are `uuid` with `gen_random_uuid()`. All tables have `created_at` and
`updated_at` (`timestamptz`, default `now()`).

- `users`: `email` (unique, lower-cased), `password_hash` (argon2id or bcrypt).
- `sessions`: `user_id`, `token_hash` (unique), `expires_at`.
- `products`: `slug` (unique), `name`, `type` enum `product_type`
  (`wordpress_site`, `plugin`), `description`, `stripe_product_id`,
  `stripe_price_id`, `price_cents`, `currency`, `interval` (`month`), `active`,
  `metadata` jsonb. The `plugin` value exists now so Release 2 adds rows, not a
  migration.
- `subscriptions`: `user_id`, `product_id`, `stripe_customer_id`,
  `stripe_subscription_id` (unique), `status` (mirror of Stripe status text),
  `current_period_end`, `canceled_at`.
- `licenses`: `user_id`, `product_id`, `subscription_id` (nullable, latest
  subscription), `status` enum `license_status` (`active`, `inactive`),
  `license_key` (nullable, unique; used by the plugin type in Release 2),
  `max_activations` (nullable), `activated_at`, `deactivated_at`.
- `sites`: `user_id`, `license_id` (unique), `template` (`restaurant`,
  `agency`, `services`), `slug` (unique), `title`, `wp_blog_id` (nullable int),
  `url`, `wp_admin_user`, `wp_admin_password` (demo-only throwaway credential,
  shown once on the dashboard), `status` enum `site_status` (`pending`,
  `provisioning`, `active`, `archived`, `deleting`, `deleted`, `failed`),
  `expires_at` (created + 48 h), `provisioned_at`, `deleted_at`.
- `jobs`: `type` enum `job_type` (`site.provision`, `site.archive`,
  `site.unarchive`, `site.delete`), `payload` jsonb `{ "siteId": "<uuid>" }`,
  `status` enum `job_status` (`queued`, `running`, `done`, `failed`),
  `attempts` int default 0, `max_attempts` int default 5, `run_after`
  timestamptz default `now()`, `locked_at`, `last_error`, `finished_at`.
  Index on `(status, run_after)`.
- `stripe_events`: `id` (Stripe event id, primary key), `type`,
  `processed_at`. Webhook idempotency.

Migrations are SQL files generated by drizzle-kit and applied by
`npm run db:migrate -w @appshelf/db`; `web` runs it on start.

## Lifecycle rules

1. Checkout completed (webhook `checkout.session.completed`, or the success
   page reading the session as a fallback, both idempotent): upsert
   subscription, create license `active`, create site `pending` with
   `expires_at = now() + 48h`, enqueue `site.provision`.
2. Subscription ended (`customer.subscription.deleted`, or status
   `canceled`/`unpaid`): license `inactive`, enqueue `site.archive`.
   The dashboard "Cancel plan" cancels the Stripe subscription immediately.
3. Renew: dashboard "Renew" opens a new Checkout session with metadata
   `licenseId` and `siteId`. On completion: link the new subscription, license
   `active`, enqueue `site.unarchive`.
4. Expiry: the worker checks every 5 minutes and on start. A site past
   `expires_at` that is not `deleted` gets `site.delete`; the worker also
   cancels its Stripe subscription if still active and sets the license
   `inactive`.
5. Job runner: `SELECT ... FOR UPDATE SKIP LOCKED`, poll every 2 s, exponential
   backoff `run_after = now() + 2^attempts * 5s`, `failed` after
   `max_attempts`.

## WordPress scripts (owned by `wordpress`, called by `worker`)

Shell scripts in `wordpress/scripts/`, copied into the worker image at
`/opt/appshelf/wp/`. They run wp-cli against `--path=/var/www/html`, read DB
settings from the standard `WORDPRESS_DB_*` env vars, exit non-zero on failure,
and print exactly one JSON line on stdout on success.

| Script | Args | Success stdout |
|---|---|---|
| `site-create.sh` | `<slug> <title> <template> <admin_email>` | `{"blogId":12,"url":"https://wp.x/slug/","adminUser":"...","adminPassword":"..."}` |
| `site-archive.sh` | `<blogId>` | `{"blogId":12,"archived":true}` |
| `site-unarchive.sh` | `<blogId>` | `{"blogId":12,"archived":false}` |
| `site-delete.sh` | `<blogId>` | `{"blogId":12,"deleted":true}` |

`site-create.sh` must be idempotent per slug (if the slug exists, return the
existing site) and finish in under 20 s. Template slugs: `restaurant`,
`agency`, `services`. The three showcase sites live at `/<template>-demo/` and
are created by `wp-init`; they never expire.

## Demo labelling

Every page of the web app and every WordPress site shows a visible banner:
"Personal demo project — test payments only (Stripe test mode). Sites delete
themselves after 48 hours." WordPress sites add it through a network-activated
mu-plugin.
