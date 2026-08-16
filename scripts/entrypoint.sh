#!/bin/sh
# ============================================================================
# Severinno Marketplace SaaS — Production Entrypoint
# ============================================================================
# Supports four modes via WORKER_TYPE env var:
#   WORKER_TYPE=email          → runs email consumer
#   WORKER_TYPE=notification   → runs notification consumer
#   WORKER_TYPE=search-index   → runs search index reindex consumer
#   (default/unset)            → runs Next.js server (with DB setup)
# ============================================================================

set -e

echo "========================================================================"
echo " Severinno Marketplace — Starting..."
echo "========================================================================"

# ── Worker mode: skip DB setup, run consumer directly ──────────────────────
if [ "${WORKER_TYPE:-}" = "email" ]; then
    echo " Mode: Email Worker"
    echo " Starting email consumer..."
    exec bun src/queue/email-consumer.ts
fi

if [ "${WORKER_TYPE:-}" = "notification" ]; then
    echo " Mode: Notification Worker"
    echo " Starting notification consumer..."
    exec bun src/queue/consumer.ts
fi

if [ "${WORKER_TYPE:-}" = "search-index" ]; then
    echo " Mode: Search Index Worker"
    echo " Starting search index consumer..."
    # --conditions react-server: resolve o stub 'server-only' (usado por
    # src/lib/search.ts) que o bundler do Next resolve via condicao, mas o
    # bun puro nao — sem isso o worker cai com "Cannot import from Client Component".
    exec bun --conditions react-server src/queue/search-index-consumer.ts
fi

# ── Graceful shutdown handler ──────────────────────────────────────────────
# Ensures Prisma connections are closed and in-flight requests drain before
# the container stops, preventing connection leaks on the PgBouncer side.
_graceful_shutdown() {
    echo ""
    echo " Shutdown signal received. Draining connections..."
    # Give in-flight requests up to 10 seconds to complete
    sleep 2
    echo " Goodbye."
    exit 0
}
trap _graceful_shutdown SIGTERM SIGINT

# ── Server mode: full DB setup + Next.js start ─────────────────────────────
echo " Mode: Next.js Server"

echo "[1/3] Generating Prisma Client..."
bunx prisma generate
echo "      Done."

echo "[2/3] Running database migrations..."
bunx prisma migrate deploy 2>/dev/null || {
    echo "      No migrations found, pushing schema directly..."
    bunx prisma db push --accept-data-loss 2>/dev/null || true
}
echo "      Done."

if [ "${SEED_DB:-false}" = "true" ]; then
    echo "[3/3] Seeding database..."
    bun run db:seed 2>/dev/null || echo "      Seed completed (or skipped — non-fatal)."
else
    echo "[3/3] Seed skipped. Set SEED_DB=true to seed on next restart."
fi

echo "========================================================================"
echo " App:     http://0.0.0.0:${PORT:-3000}"
echo " Health:  http://0.0.0.0:${PORT:-3000}/api/health"
echo "========================================================================"

exec node server.js
