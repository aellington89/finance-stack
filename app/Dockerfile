# Multi-stage build for the Next.js finance application.
# Requires output: "standalone" in next.config.ts.

# --- Stage 1: Install dependencies ---
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Stage 2: Build the application ---
FROM node:24-alpine AS build
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
FROM node:24-alpine AS migrate
WORKDIR /app
RUN apk add --no-cache postgresql-client bash
COPY --from=deps /app/node_modules ./node_modules
COPY package.json drizzle.config.ts tsconfig.json ./
COPY drizzle ./drizzle
COPY scripts ./scripts

# lib/ and tsconfig.json are here for the first-user CLI (Issue #288), not for
# the migration job.
#
# There is no public registration, so the initial account — and every password
# reset — comes from `npm run auth:create-user`. Until #288 neither published
# image could run it: the runner stage below deletes npm (#131), and this stage
# had npm, tsx, node_modules and app/scripts/ but not app/lib/. A bundle install
# therefore came up healthy and could not be logged into without a checkout on
# some other machine, which is precisely what #223 set out to remove. This stage
# is the natural home — it already connects as the superuser and already exists
# to do one-shot administrative work against the database, the same reason it
# hosts /scripts/verify-db-roles.sh:
#
#   docker compose run --rm --entrypoint npm migrate run auth:create-user -- <username>
#
# tsconfig.json is load-bearing rather than incidental. `paths` is declared
# there, and it is the only reason `@/lib/auth/roles`, `@/lib/db`,
# `@/drizzle/schema` and `@/lib/auth/password` resolve under tsx — which reads
# it through get-tsconfig, where `paths` without `baseUrl` implies a baseUrl of
# the tsconfig's own directory, i.e. /app. Delete it as an unused config file
# and the COPY below goes inert: first-user creation breaks on deployment hosts
# while every test in CI stays green.
#
# The copy is whole rather than the three files create-user.ts actually reaches
# (lib/auth/roles.ts, lib/db/index.ts, lib/auth/password.ts). lib/ is ~350 KB
# against a node_modules that is already in this stage, so a narrow copy buys
# nothing measurable and costs a tripwire that fires the first time anyone adds
# an import to one of those modules — on a deployment host, at the one moment
# the operator has no way to work around it. tsx transpiles on demand, so files
# nothing loads are never resolved: lib/db/audited.ts sits next to lib/db/index.ts
# and imports @/auth, and is simply never reached.
COPY lib ./lib

# Roles, seeds and the role-verification script used to be bind-mounted by the
# `migrate` service (Issue #224). They are baked in now so the stack can run from
# a registry image with no source tree on the host. They come from the `repo`
# additional context because they live at the repo root, outside this ./app
# build context.
#
# The destination paths are exactly the paths they were mounted at, so nothing
# that reads them had to change: app/scripts/migrate-and-seed.sh hardcodes
# /roles/… and /seeds/…, and scripts/verify-db-roles.sh defaults ROLES_DIR to
# /roles and is documented as `… --entrypoint bash migrate /scripts/verify-db-roles.sh`.
#
# Note this stage therefore has two script directories, as it did at runtime
# before: /app/scripts from the ./app context (migrate-and-seed.sh,
# preflight-superuser.sh) and /scripts from the repo root (verify-db-roles.sh).
#
# /roles also carries 00-create-databases.sql, which creates the databases
# themselves. That used to be init-db/01-create-databases.sh, run by the postgres
# entrypoint hook on an empty data directory only; Issue #225 made it step 0 of
# migrate-and-seed.sh, which is what removed postgres's own ./init-db mount.
COPY --from=repo init-db/roles /roles
COPY --from=repo init-db/seeds /seeds
COPY --from=repo scripts/verify-db-roles.sh /scripts/verify-db-roles.sh

# Published to GHCR on every vX.Y.Z tag (#226). The source label is what links
# the package back to this repository — without it the package page shows no
# repo, and "Inherit access from repository" has nothing to key off.
LABEL org.opencontainers.image.source="https://github.com/aellington89/finance-stack" \
      org.opencontainers.image.title="finance-migrate" \
      org.opencontainers.image.description="Drizzle migration, database/role creation and seed runner for Finance Stack"

ENTRYPOINT ["bash", "/app/scripts/migrate-and-seed.sh"]

# --- Stage 3: Production runner ---
FROM node:24-alpine AS runner
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
# The `migrate` stage above deliberately keeps npm, and since #288 for two
# reasons rather than one: it runs `npx drizzle-kit`, and it is where the
# first-user CLI (`npm run auth:create-user`) lives. Adding a script runner back
# here for that one administrative command was the rejected alternative — it
# would undo this deletion for the entire runtime to serve a command run once
# per deployment.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg \
           /opt/yarn-*

COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
# CHANGELOG.md is at the repo root (outside the ./app build context).
# Supplied via the `repo` additional_contexts entry in docker-compose.yml — the
# same context the migrate stage above takes its roles and seeds from.
COPY --from=repo --chown=nextjs:nodejs CHANGELOG.md ./CHANGELOG.md

# Published to GHCR on every vX.Y.Z tag (#226). GIT_SHA is re-declared because
# ARGs are per-stage — the one at the top of the `build` stage is not in scope
# here — and this sits at the end of the stage so it invalidates no cached layer.
ARG GIT_SHA=dev
LABEL org.opencontainers.image.source="https://github.com/aellington89/finance-stack" \
      org.opencontainers.image.title="finance-app" \
      org.opencontainers.image.description="Next.js finance management application" \
      org.opencontainers.image.revision="$GIT_SHA"

USER nextjs

EXPOSE 3001

CMD ["node", "server.js"]
