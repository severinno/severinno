# =============================================================================
# Multi-stage Dockerfile — Severinno Marketplace
# =============================================================================
# Stage 1-2: Bun for dependency install + build (fast, native lockfile)
# Stage 3:   Node.js for the standalone server (Next.js needs Node)
#
# Build:
#   docker build --build-arg BUN_VERSION=1.4.0 -t severinno .
# =============================================================================

# ── Bun version (single source of truth — CI passes via --build-arg) ────────
ARG BUN_VERSION=1.4.0

# ── Base: Bun runtime ────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ── Deps: install dependencies with Bun ──────────────────────────────────────
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ── Builder: generate Prisma client + build Next.js standalone ───────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma needs DATABASE_URL at generate time (only needs schema, not a real DB)
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

# Generate Prisma Client (needed by Next.js at build time)
RUN bun run db:generate

# Build Next.js with standalone output
# BUILD_STANDALONE=true triggers output: "standalone" in next.config.ts
# SKIP_TYPESCRIPT_CHECK: skip tsc in Docker build (CI runs tsc separately)
# DOCKER_BUILD: tells next.config.ts to ignore build-time TS errors
ENV BUILD_STANDALONE=true
ENV SKIP_TYPESCRIPT_CHECK=true
ENV DOCKER_BUILD=true
RUN bun run build

# ── Runner: Node.js standalone server ────────────────────────────────────────
FROM node:22-alpine AS runner
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Public assets (favicon, manifest, icons, etc.)
COPY --from=builder /app/public ./public

# Next.js standalone bundle (includes node_modules + server)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# Static assets (CSS, JS chunks)
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma engine binaries (needed at runtime for query engine)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
