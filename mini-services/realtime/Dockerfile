# ============================================================================
# Severinno Marketplace SaaS — Realtime Mini-Service
# Socket.io server for realtime messaging, booking updates, and tracking.
# ============================================================================

FROM oven/bun:1-slim AS runner
WORKDIR /app

# Copy package.json and install dependencies
# Copy dependency files and install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY index.ts ./

EXPOSE 3003

CMD ["bun", "index.ts"]
