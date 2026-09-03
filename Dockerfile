# syntax=docker/dockerfile:1
# Single multi-stage build → one runtime image that runs BOTH roles:
#   - web    (default)          : node server.js         (Next.js standalone)
#   - worker / cron jobs        : node_modules/.bin/tsx src/worker/...
# The Container Apps for the worker + scheduled jobs override `command`
# (see infra/main.bicep); the web app uses the default CMD.

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ---- deps (full, cached) -------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# ---- build ------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# `next build` collects page data, which loads src/env.ts and validates the
# environment. Real values are injected at runtime by Container Apps; these
# format-valid placeholders only satisfy the schema during the build and never
# reach the runtime image (the `runner` stage starts FROM base, fresh).
ENV APP_URL=https://build.local \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    DIRECT_DATABASE_URL=postgresql://build:build@localhost:5432/build \
    REDIS_URL=redis://localhost:6379 \
    AUTH_SECRET=build-only-placeholder-not-used-at-runtime
RUN npx prisma generate && npm run build

# ---- runtime (web + worker in one image) ----------------------------
FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Next.js standalone server (its own trimmed node_modules + server.js)…
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# …then overlay the FULL node_modules + source so `tsx` can run the worker/crons.
COPY --from=deps  --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --chown=nextjs:nodejs src ./src
COPY --chown=nextjs:nodejs prisma ./prisma
COPY --chown=nextjs:nodejs tsconfig.json package.json ./

USER nextjs
EXPOSE 3000
# Default role: web. Worker/jobs override this in infra/main.bicep.
CMD ["node", "server.js"]
