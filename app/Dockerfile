# Multi-stage build for the Next.js finance application.
# Requires output: "standalone" in next.config.ts.

# --- Stage 1: Install dependencies ---
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Stage 2: Build the application ---
FROM node:22-alpine AS build
WORKDIR /app
# Build metadata baked into the bundle at build time (standalone has no package.json
# at runtime). Defaults keep a plain `docker compose up` working with gitSha "dev".
ARG GIT_SHA=dev
ARG BUILD_TIME=
ENV NEXT_PUBLIC_GIT_SHA=$GIT_SHA
ENV NEXT_PUBLIC_BUILD_TIME=$BUILD_TIME
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public && npm run build

# --- Stage 2b: Migration runner ---
# Used by the `migrate` Compose service: drizzle-kit + psql, no Next.js build.
FROM node:22-alpine AS migrate
WORKDIR /app
RUN apk add --no-cache postgresql-client bash
COPY --from=deps /app/node_modules ./node_modules
COPY package.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY scripts ./scripts
ENTRYPOINT ["bash", "/app/scripts/migrate-and-seed.sh"]

# --- Stage 3: Production runner ---
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3001

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Strip the bundled package managers (Issue #131). The standalone server runs
# `node server.js` and never resolves or installs a package at runtime, so npm,
# npx, yarn and corepack are pure attack surface here: they give anyone who gets
# execution in this container a way to fetch and run more code.
#
# They also carry their own vendored dependencies, which the CI Trivy gate reads
# as part of the image — npm alone contributed 1 CRITICAL and 5 HIGH findings
# (tar, sigstore, brace-expansion, picomatch) that no application-level bump
# could ever clear. Deleting them removes the vulnerability rather than
# suppressing the report.
#
# The `migrate` stage above deliberately keeps npm: it runs `npx drizzle-kit`.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg \
           /opt/yarn-*

COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
# CHANGELOG.md is at the repo root (outside the ./app build context).
# Supplied via the `changelog` additional_contexts entry in docker-compose.yml.
COPY --from=changelog --chown=nextjs:nodejs CHANGELOG.md ./CHANGELOG.md

USER nextjs

EXPOSE 3001

CMD ["node", "server.js"]
