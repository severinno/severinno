# =============================================================================
# Multi-stage Dockerfile — Severinno Marketplace
# =============================================================================
# Stage 1-2: Bun for dependency install + build (fast, native lockfile)
# Stage 3:   Node.js for the standalone server (Next.js needs Node)
#
# Build (a versão do Bun entra SÓ pelo --build-arg, do mesmo valor declarado
# que o runner, os composes e o CI usam — não há default aqui de propósito):
#   docker build --build-arg BUN_VERSION="$(sed -n 's/^--var BUN_VERSION=//p' .actrc)" -t severinno .
#   docker compose -f docker-compose.yml build     # o compose passa o arg
# =============================================================================

# ── Bun version (single source of truth: SÓ pelo --build-arg) ──────────────
# SEM default, de propósito: um literal aqui é o valor de HOJE que nenhum bump
# alcança, e todo build que não passa o arg o herda em SILÊNCIO — foi assim que
# a versão antiga se espalhou por staging/hostinger/package.json. Sem default,
# o build que não passa o arg falha alto (referência `oven/bun:-alpine`) em vez
# de rodar outro Bun. O guard (invariante 18) reprova a volta do default e o
# build site que não passa o arg.
ARG BUN_VERSION

# ── Base: Bun runtime ────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ── Deps: install dependencies with Bun ──────────────────────────────────────
FROM base AS deps
COPY package.json bun.lock ./
# o postinstall (sync-maplibre-worker) precisa do script no container
COPY scripts ./scripts
RUN bun install --frozen-lockfile

# ── Builder: generate Prisma client + build Next.js standalone ───────────────
# glibc (bookworm-slim), NÃO alpine/musl: em node:22-alpine o worker postcss do
# Turbopack tarpitou (6+ GB RSS, CPU 100% por 20+ min) — bindings nativos do
# Tailwind v4 em musl. ATENÇÃO: o tarpit também foi reproduzido em
# bookworm-slim (3x local, 1x VPS) — `next build` dentro de buildkit segue
# instável nesta stack; as imagens de produção vêm do pipeline host-artifacts
# (build no host, montagem da imagem sobre .next/standalone). Este Dockerfile
# permanece como fonte canônica das camadas de runtime.
FROM node:22-bookworm-slim AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma needs DATABASE_URL at generate time (only needs schema, not a real DB)
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

# Generate Prisma Client (needed by Next.js at build time)
RUN npx prisma generate

# Build Next.js with standalone output
# BUILD_STANDALONE=true triggers output: "standalone" in next.config.ts
# SKIP_TYPESCRIPT_CHECK: skip tsc in Docker build (CI runs tsc separately)
# DOCKER_BUILD: tells next.config.ts to ignore build-time TS errors
ENV BUILD_STANDALONE=true
ENV SKIP_TYPESCRIPT_CHECK=true
ENV DOCKER_BUILD=true
RUN npm run build

# ── Runner: Node.js standalone server ────────────────────────────────────────
# Mesma família glibc do builder: as engines do Prisma geradas em bookworm
# (debian-openssl) não rodam em alpine/musl.
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --gid 1001 nextjs

# openssl CLI: sem ele a detecção de runtime do Prisma falha nas imagens slim
# e o client procura a engine errada (debian-openssl-1.1.x). /data é gravado
# pelo app em runtime (geo-query-log).
RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends openssl && \
    rm -rf /var/lib/apt/lists/*
RUN mkdir -p /data && chown nextjs:nodejs /data

# Public assets (favicon, manifest, icons, etc.)
COPY --from=builder /app/public ./public

# Next.js standalone bundle (includes node_modules + server)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# Static assets (CSS, JS chunks)
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma engine binaries (needed at runtime for query engine)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# Schema + migrations: o job migrate do pipeline roda `prisma migrate deploy`
# DENTRO desta imagem (compose run app) — sem o diretório, o CLI não acha o
# schema e o deploy do banco falha.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# CLI do Prisma global: o job migrate roda `prisma migrate deploy` DENTRO de
# um container --rm desta imagem — sem o CLI assado, o npx baixaria o pacote
# da internet a CADA deploy (e o standalone não traz o binário).
RUN npm install -g prisma@6.19.3

USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
