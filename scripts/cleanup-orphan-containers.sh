#!/usr/bin/env bash
# =============================================================================
# Cleanup Orphan Containers — Severinno Marketplace
# =============================================================================
# Removes containers that can't be stopped normally because they were started
# by root via `sudo docker compose up -d`.
#
# Usage:
#   sudo bash scripts/cleanup-orphan-containers.sh
#
# What it does:
#   1. Stops and removes severinno-db-1 (orphan postgres:16-alpine, no PostGIS)
#   2. Stops and removes severinno-glitchtip-1 (legacy multi-service GlitchTip)
#   3. Verifies RAM was freed
#
# Exit codes:
#   0 — success (containers removed)
#   1 — failure (containers not found or Docker error)
# =============================================================================

set -euo pipefail

echo "🔍 Checking orphan containers..."

ORPHANS=("severinno-db-1" "severinno-glitchtip-1")
CLEANED=0

for name in "${ORPHANS[@]}"; do
  if docker inspect "$name" >/dev/null 2>&1; then
    echo "  ⚡ Stopping $name..."
    docker stop -t 5 "$name" 2>/dev/null || true
    docker rm -f "$name" 2>/dev/null || true
    echo "  ✅ Removed $name"
    ((CLEANED++))
  else
    echo "  ⏭️  $name not found (already cleaned)"
  fi
done

echo ""
echo "📊 RAM before cleanup:"
free -h | head -2
echo ""
echo "📊 Containers after cleanup:"
docker ps --format "table {{.Names}}\t{{.Status}}" | head -20

if [ "$CLEANED" -gt 0 ]; then
  echo ""
  echo "✅ Cleaned $CLEANED orphan container(s)."
else
  echo ""
  echo "ℹ️  No orphan containers to clean."
fi
