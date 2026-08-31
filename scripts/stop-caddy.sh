#!/bin/bash
# ---------------------------------------------------------------------------
# stop-caddy.sh — Para o Caddy reverse proxy
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/.caddy.pid"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo -e "${YELLOW}⏹️  Parando Caddy (PID $PID)...${NC}"
    kill "$PID"
    sleep 1
    # Force kill if still running
    if kill -0 "$PID" 2>/dev/null; then
      kill -9 "$PID"
    fi
    echo -e "${GREEN}✅ Caddy parado${NC}"
  else
    echo -e "${YELLOW}⚠️  Caddy não estava rodando${NC}"
  fi
  rm -f "$PID_FILE"
else
  echo -e "${YELLOW}⚠️  Nenhum PID file encontrado${NC}"
fi
