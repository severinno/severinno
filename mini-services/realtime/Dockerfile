# ============================================================================
# Severinno Marketplace SaaS — Realtime Mini-Service
# Socket.io server for realtime messaging, booking updates, and tracking.
# ============================================================================

# Versão do Bun — FONTE ÚNICA: vars.BUN_VERSION (build-arg). Sem literal
# (oven/bun:1-slim era tag flutuante) — o guard check-bun-mirror.mjs falha
# se um Dockerfile pinar tag hardcoded.
ARG BUN_VERSION
FROM oven/bun:${BUN_VERSION}-slim AS runner
WORKDIR /app

# Copy package.json and install dependencies
# Copy dependency files and install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY index.ts ./

EXPOSE 3003

CMD ["bun", "index.ts"]
