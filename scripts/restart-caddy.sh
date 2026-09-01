#!/bin/bash
# ---------------------------------------------------------------------------
# restart-caddy.sh — Reinicia o Caddy reverse proxy
# ---------------------------------------------------------------------------
#
# Usage:
#   bash scripts/restart-caddy.sh [args]
#
# Exit codes:
#   0 — success
#   1 — failure

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

bash "$SCRIPT_DIR/stop-caddy.sh"
sleep 1
bash "$SCRIPT_DIR/start-caddy.sh"
