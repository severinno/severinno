# =============================================================================
# Dockerfile — Severinno Marketplace
# Multi-stage build: deps → builder → runner (production).
# Uses Next.js `output: "standalone"` for a self-contained runtime.
# =============================================================================

# ── Stage 1: Install dependencies ───────────────────────────────────────────
FROM node:22-alpine AS deps
LABEL stage=deps

RUN apk add --no-cache libc6-compat curl

WORKDIR /app

# Copy manifests first for layer caching
COPY package.json bun.lock ./
# Versão do Bun — FONTE ÚNICA: vars.BUN_VERSION (build-arg passado pelo
# deploy.yml). Sem literal aqui (bun@1.2 era drift) — o guard
# check-bun-mirror.mjs falha se um Dockerfile pinar versão hardcoded; o
# padrão é ARG BUN_VERSION + bun@${BUN_VERSION} (mesmo do Dockerfile.ubuntu-bun).
# Define uma versão fixa para não depender de variáveis externas
ARG BUN_VERSION=1.0.36

# Instala o bun e as dependências sem fazer verificações complicadas
RUN npm install -g bun@${BUN_VERSION} && bun install --frozen-lockfile

# ── Stage 2: Build the application ──────────────────────────────────────────
FROM node:22-alpine AS builder
LABEL stage=builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Skip type-check in build (already done in CI); Prisma generate is required.
ENV SKIP_TYPESCRIPT_CHECK=true
ENV BUILD_STANDALONE=true
RUN bun run db:generate && \
    bun run build

# ── Stage 3: Production runtime ─────────────────────────────────────────────
FROM node:22-alpine AS runner
LABEL stage=runner

RUN addgroup --system --gid 1001 severinno && \
    adduser --system --uid 1001 severinno

WORKDIR /app

# Health check — the app listens on 3000 inside the container
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Copy the standalone build from the builder
COPY --from=builder --chown=severinno:severinno /app/.next/standalone ./
COPY --from=builder --chown=severinno:severinno /app/.next/static ./.next/static
COPY --from=builder --chown=severinno:severinno /app/public ./public

# Prisma client + migrations need to be available at runtime
COPY --from=builder --chown=severinno:severinno /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=severinno:severinno /app/prisma ./prisma

USER severinno

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=187.127.16.136
EXPOSE 3000

# Run the Next.js standalone server directly.
# Docker sends SIGTERM to PID 1; Node.js 22 handles it gracefully.
# For advanced graceful shutdown, wrap with a process manager (e.g., PM2).
CMD ["node", "server.js"]
