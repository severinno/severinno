#!/usr/bin/env bash
# ==============================================================================
# sync-osrm-data.sh — Shell Wrapper Seguro com Lock para Sincronização OSRM
# ==============================================================================
#
# Usage:
#   bash scripts/sync-osrm-data.sh [--check] [--dry-run] [--force] [--restart]
#
# Exit codes:
#   0 — success
#   1 — failure
# ==============================================================================
set -euo pipefail

LOCK_FILE="/tmp/severinno-sync-osrm.lock"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Evita execuções concorrentes via flock
exec 200>"${LOCK_FILE}"
if ! flock -n 200; then
  echo "⚠️ Sincronização OSRM já em execução por outro processo. Abortando." >&2
  exit 0
fi

echo "🗺️ [OSRM] Iniciando validação e sincronização da malha viária..."
cd "${ROOT_DIR}"

if command -v bun >/dev/null 2>&1; then
  BUN_BIN="bun"
elif [ -f "$HOME/.local/bin/bun" ]; then
  BUN_BIN="$HOME/.local/bin/bun"
elif [ -f "$HOME/.bun/bin/bun" ]; then
  BUN_BIN="$HOME/.bun/bin/bun"
else
  BUN_BIN="node"
fi

"${BUN_BIN}" "${SCRIPT_DIR}/sync-osrm-data.ts" "$@"

# Opcional: Reiniciar o contêiner se solicitado
if [[ "${*:-}" =~ "--restart" ]] || [ "${RESTART_CONTAINER:-0}" = "1" ]; then
  if command -v docker >/dev/null 2>&1 && grep -q 'severinno-osrm' <<< "$(docker ps --format '{{.Names}}')"; then
    echo "🔄 [OSRM] Reiniciando contêiner severinno-osrm para recarregar dados..."
    docker restart severinno-osrm
    echo "✅ [OSRM] Contêiner severinno-osrm reiniciado."
  fi
fi

echo "✅ [OSRM] Procedimento concluído com sucesso."
