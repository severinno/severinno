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

# Copy source — TODOS os módulos .ts do serviço (glob). Lista explícita
# quebrou 2x quando um módulo novo entrou (redis-telemetry.ts,
# redis-kick-audit.ts, ops-alert.ts, user-plan.ts, session-notification.ts,
# port.ts re-exportado por security.ts) e o container bootou com module not
# found — o glob cobre qualquer módulo futuro automaticamente. O contexto de
# build é ./mini-services/realtime (docker-compose.dev.yml), então o glob
# copia só os módulos do serviço, nunca node_modules (diretório).
COPY *.ts ./

EXPOSE 3003

CMD ["bun", "index.ts"]
