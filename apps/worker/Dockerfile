# syntax=docker/dockerfile:1
# AppShelf worker: Node 24 job runner plus PHP CLI and wp-cli for the WordPress
# site scripts. Build context is the repository root:
#   docker build -f apps/worker/Dockerfile .

FROM node:24-bookworm-slim AS build
WORKDIR /repo
COPY . .
RUN npm ci --no-audit --no-fund
# One self-contained file (drizzle, postgres and stripe bundled in).
RUN npm run build -w @appshelf/db && npm run build -w @appshelf/worker

FROM wordpress:cli-2.12.0-php8.3 AS wpcli

FROM node:24-bookworm-slim AS runtime
# PHP CLI with what WordPress and wp-cli need to reach MariaDB and render content.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates php-cli php-mysql php-mbstring php-xml php-curl php-zip php-intl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=wpcli /usr/local/bin/wp /usr/local/bin/wp
# Same path as in the wordpress image (docs/contracts.md); the whole folder,
# since the scripts source lib.sh and run site-ops.php.
COPY wordpress/scripts/ /opt/appshelf/wp/
RUN chmod 0755 /opt/appshelf/wp/*.sh && wp --allow-root --version
WORKDIR /app
COPY --from=build /repo/apps/worker/dist/main.mjs ./main.mjs
# Runs as root: the scripts drop to www-data (uid 33, as in the wordpress image)
# for every wp-cli call, so files in wp_data stay owned by Apache.
ENV NODE_ENV=production \
    WP_SCRIPTS_DIR=/opt/appshelf/wp \
    WP_PATH=/var/www/html
STOPSIGNAL SIGTERM
CMD ["node", "main.mjs"]

# Test image: the runtime plus the workspace with dev dependencies, used by the
# `worker-test` compose service to run Vitest against the real scripts.
FROM runtime AS test
WORKDIR /repo
COPY --from=build /repo /repo
ENV NODE_ENV=test \
    WP_SCRIPTS_INTEGRATION=1
CMD ["npm", "test", "-w", "@appshelf/worker"]
