# syntax=docker/dockerfile:1
# AppShelf web: Next.js standalone server. Build context is the repository root:
#   docker build -f apps/web/Dockerfile .

FROM node:24-alpine AS build
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm ci --no-audit --no-fund
RUN npm run build -w @appshelf/db && npm run build -w @appshelf/web

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Next.js standalone output: server.js plus only the traced node_modules.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
# Single-file migration runner and its SQL files (it reads ../drizzle next to itself).
COPY --from=build --chown=node:node /repo/packages/db/dist/migrate.bundle.mjs ./db/dist/migrate.bundle.mjs
COPY --from=build --chown=node:node /repo/packages/db/drizzle ./db/drizzle
# Single-file Stripe product/price seed.
COPY --from=build --chown=node:node /repo/apps/web/bundle/seed-stripe.mjs ./seed/seed-stripe.mjs
COPY --chmod=755 apps/web/docker-entrypoint.sh /usr/local/bin/appshelf-web-entrypoint
USER node
EXPOSE 3000
ENTRYPOINT ["appshelf-web-entrypoint"]
CMD ["node", "apps/web/server.js"]
