#!/bin/bash
# ---------------------------------------------------------------------------
# restart-caddy.sh — Reinicia o Caddy reverse proxy
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

bash "$SCRIPT_DIR/stop-caddy.sh"
sleep 1
bash "$SCRIPT_DIR/start-caddy.sh"
