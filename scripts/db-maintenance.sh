#!/usr/bin/env bash
# =============================================================================
# scripts/db-maintenance.sh — Manutenção Preventiva Semanal do PostgreSQL
# =============================================================================
# Executa:
#   1. VACUUM (ANALYZE) — Limpeza de dead tuples (bloat) e atualização das
#      estatísticas do query planner (pg_statistic) para otimização de queries.
#   2. REINDEX DATABASE CONCURRENTLY — Reconstrução e desfragmentação de
#      índices B-tree e espaciais GiST (PostGIS) sem bloqueio de leitura/escrita.
#   3. Coleta de métricas (tamanho do banco, dead tuples eliminadas, tempo).
#   4. Notificação multi-canal (Telegram e Discord) com resumo da operação.
#
# Usage:
#   ./scripts/db-maintenance.sh                    # Executa em todos os bancos
#   ./scripts/db-maintenance.sh --dry-run          # Apenas exibe bloat e estatísticas
#   ./scripts/db-maintenance.sh --vacuum-only      # Executa apenas VACUUM ANALYZE
#   ./scripts/db-maintenance.sh --database <nome>  # Executa apenas em um banco
#   ./scripts/db-maintenance.sh --quiet            # Notifica apenas em caso de falha
#
# Exit codes:
#   0 — sucesso na manutenção preventiva de todos os bancos
#   1 — erro na execução ou falha de conexão com PostgreSQL
#
# Cron recomendado (Semanal — Domingo às 04:00):
#   0 4 * * 0 /home/deploy/severinno/scripts/db-maintenance.sh >> /var/log/severinno-db-maintenance.log 2>&1
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DRY_RUN=false
VACUUM_ONLY=false
SPECIFIC_DB=""
QUIET=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --vacuum-only)
      VACUUM_ONLY=true
      shift
      ;;
    --database)
      SPECIFIC_DB="$2"
      shift 2
      ;;
    --quiet)
      QUIET=true
      shift
      ;;
    *)
      echo "Opção inválida: $1" >&2
      echo "Uso: $0 [--dry-run] [--vacuum-only] [--database <nome>] [--quiet]" >&2
      exit 2
      ;;
  esac
done

# ── Logging ──────────────────────────────────────────────────────────────────
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/db-maintenance.log"
mkdir -p "$LOG_DIR"

log() {
  local ts
  ts="$(date +'%Y-%m-%d %H:%M:%S')"
  echo "[$ts] $*" | tee -a "$LOG_FILE"
}

# ── Carrega configurações de alertas ─────────────────────────────────────────
if [ -f "$PROJECT_DIR/.env.alertas" ]; then
  # shellcheck disable=SC1090
  source "$PROJECT_DIR/.env.alertas"
elif [ -f "$PROJECT_DIR/deploy/.env.alertas" ]; then
  # shellcheck disable=SC1090
  source "$PROJECT_DIR/deploy/.env.alertas"
elif [ -f "$PROJECT_DIR/.env.production.local" ]; then
  # shellcheck disable=SC1090
  source <(grep -E "^(TELEGRAM_|DISCORD_|APP_URL|DB_|DATABASE_URL)" "$PROJECT_DIR/.env.production.local" 2>/dev/null || true)
elif [ -f "$PROJECT_DIR/.env" ]; then
  # shellcheck disable=SC1090
  source <(grep -E "^(TELEGRAM_|DISCORD_|APP_URL|DB_|DATABASE_URL)" "$PROJECT_DIR/.env" 2>/dev/null || true)
fi

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
DISCORD_WEBHOOK_URL="${DISCORD_WEBHOOK_URL:-}"

# ── Função de Notificação Unificada ──────────────────────────────────────────
send_alert() {
  local title="$1"
  local message="$2"
  local is_critical="${3:-false}"

  # 1. Telegram
  if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    local icon="ℹ️"
    [ "$is_critical" = true ] && icon="🚨"
    local text="<b>$icon $title</b>%0A%0A$message%0A%0A<i>Servidor: $(hostname)</i>"
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_CHAT_ID}" \
      -d "text=${text}" \
      -d "parse_mode=HTML" >/dev/null 2>&1 || true
  fi

  # 2. Discord
  if [ -n "$DISCORD_WEBHOOK_URL" ]; then
    local color=3447003 # Azul
    [ "$is_critical" = true ] && color=15158332 # Vermelho
    local discord_payload
    discord_payload=$(jq -n \
      --arg title "$title" \
      --arg desc "$message" \
      --arg host "$(hostname)" \
      --argjson color "$color" \
      '{
        embeds: [{
          title: $title,
          description: $desc,
          color: $color,
          footer: { text: ("Servidor: " + $host) },
          timestamp: (now | todate)
        }]
      }')
    curl -s -H "Content-Type: application/json" \
      -d "$discord_payload" \
      "$DISCORD_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
}

# ── Detecta container PostgreSQL ─────────────────────────────────────────────
CONTAINER=""
if command -v docker >/dev/null 2>&1; then
  CONTAINER="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -iE 'severinno-postgres|postgis' | head -1 || true)"
fi

DB_USER="${POSTGRES_USER:-severinno}"

run_sql() {
  local target_db="$1"
  local sql="$2"
  if [ -n "$CONTAINER" ]; then
    docker exec "$CONTAINER" psql -U "$DB_USER" -d "$target_db" -t -A -c "$sql"
  elif command -v psql >/dev/null 2>&1; then
    psql -U "$DB_USER" -d "$target_db" -t -A -c "$sql"
  else
    log "❌ Erro: psql e container PostgreSQL não encontrados"
    return 1
  fi
}

run_sql_verbose() {
  local target_db="$1"
  local sql="$2"
  if [ -n "$CONTAINER" ]; then
    docker exec "$CONTAINER" psql -U "$DB_USER" -d "$target_db" -c "$sql"
  elif command -v psql >/dev/null 2>&1; then
    psql -U "$DB_USER" -d "$target_db" -c "$sql"
  else
    log "❌ Erro: psql e container PostgreSQL não encontrados"
    return 1
  fi
}

# ── Validação Inicial ────────────────────────────────────────────────────────
log "================================================================="
log "🚀 Iniciando Manutenção Preventiva do PostgreSQL"
log "================================================================="

if [ -n "$CONTAINER" ]; then
  log "📦 Container PostgreSQL detectado: $CONTAINER"
else
  log "🖥️ Usando psql local"
fi

# Lista de bancos de dados a manter
DATABASES=()
if [ -n "$SPECIFIC_DB" ]; then
  DATABASES=("$SPECIFIC_DB")
else
  # Descobrir bancos do Severinno existentes
  AVAILABLE_DBS="$(run_sql "postgres" "SELECT datname FROM pg_database WHERE datname IN ('severinno', 'evolution', 'glitchtip') ORDER BY datname;")"
  while IFS= read -r db; do
    [ -n "$db" ] && DATABASES+=("$db")
  done <<< "$AVAILABLE_DBS"
fi

if [ "${#DATABASES[@]}" -eq 0 ]; then
  log "❌ Nenhum banco de dados elegível encontrado para manutenção."
  exit 1
fi

log "🎯 Bancos selecionados: ${DATABASES[*]}"

TOTAL_START_TIME=$(date +%s)
SUMMARY_REPORT=""
HAS_ERRORS=false

# ── Execução por Banco de Dados ──────────────────────────────────────────────
for DB in "${DATABASES[@]}"; do
  log "-----------------------------------------------------------------"
  log "🗄️ Processando banco: $DB"
  log "-----------------------------------------------------------------"

  DB_START_TIME=$(date +%s)

  # Métricas antes da manutenção
  SIZE_BEFORE=$(run_sql "$DB" "SELECT pg_size_pretty(pg_database_size('$DB'));")
  DEAD_TUPLES_BEFORE=$(run_sql "$DB" "SELECT COALESCE(SUM(n_dead_tup), 0) FROM pg_stat_user_tables;")
  LIVE_TUPLES_BEFORE=$(run_sql "$DB" "SELECT COALESCE(SUM(n_live_tup), 0) FROM pg_stat_user_tables;")

  log "📊 Estado inicial de '$DB':"
  log "   - Tamanho: $SIZE_BEFORE"
  log "   - Tuplas vivas: $LIVE_TUPLES_BEFORE"
  log "   - Dead tuples (bloat): $DEAD_TUPLES_BEFORE"

  # Top tabelas com dead tuples
  TOP_BLOAT=$(run_sql_verbose "$DB" "
    SELECT relname, n_live_tup, n_dead_tup,
           ROUND(100.0 * n_dead_tup / GREATEST(n_live_tup + n_dead_tup, 1), 1) AS dead_pct,
           pg_size_pretty(pg_total_relation_size(relid)) AS size
    FROM pg_stat_user_tables
    WHERE n_dead_tup > 0
    ORDER BY n_dead_tup DESC
    LIMIT 5;
  " || true)

  if [ -n "$TOP_BLOAT" ] && grep -qv "(0 rows)" <<< "$TOP_BLOAT"; then
    log "📋 Tabelas com dead tuples detectadas:"
    echo "$TOP_BLOAT" | while IFS= read -r line; do log "   $line"; done
  fi

  if [ "$DRY_RUN" = true ]; then
    log "🔎 [DRY-RUN] Simulação concluída para '$DB'. Nenhuma modificação aplicada."
    continue
  fi

  # 1. VACUUM (ANALYZE)
  log "🧹 Executando VACUUM (ANALYZE) em '$DB'..."
  if run_sql "$DB" "VACUUM (ANALYZE);" >/dev/null 2>&1; then
    log "✅ VACUUM (ANALYZE) concluído com sucesso em '$DB'."
  else
    log "⚠️ Falha ao executar VACUUM em '$DB'."
    HAS_ERRORS=true
  fi

  # 2. REINDEX CONCURRENTLY (se não for vacuum-only)
  if [ "$VACUUM_ONLY" = false ]; then
    log "🔄 Executando REINDEX DATABASE CONCURRENTLY '$DB'..."
    if run_sql "$DB" "REINDEX DATABASE CONCURRENTLY \"$DB\";" >/dev/null 2>&1; then
      log "✅ REINDEX CONCURRENTLY concluído com sucesso em '$DB'."
    else
      log "⚠️ Falha ao executar REINDEX em '$DB'."
      HAS_ERRORS=true
    fi
  else
    log "⏭️ REINDEX pulado (--vacuum-only ativo)."
  fi

  # Métricas após manutenção
  DB_END_TIME=$(date +%s)
  DB_DURATION=$((DB_END_TIME - DB_START_TIME))
  SIZE_AFTER=$(run_sql "$DB" "SELECT pg_size_pretty(pg_database_size('$DB'));")
  DEAD_TUPLES_AFTER=$(run_sql "$DB" "SELECT COALESCE(SUM(n_dead_tup), 0) FROM pg_stat_user_tables;")
  RECLAIMED_TUPLES=$((DEAD_TUPLES_BEFORE - DEAD_TUPLES_AFTER))
  [ "$RECLAIMED_TUPLES" -lt 0 ] && RECLAIMED_TUPLES=0

  log "📈 Resultado em '$DB' (duração: ${DB_DURATION}s):"
  log "   - Tamanho antes: $SIZE_BEFORE → depois: $SIZE_AFTER"
  log "   - Dead tuples eliminadas: $RECLAIMED_TUPLES (restantes: $DEAD_TUPLES_AFTER)"

  SUMMARY_REPORT+="$DB: $SIZE_BEFORE -> $SIZE_AFTER (${DB_DURATION}s, -$RECLAIMED_TUPLES dead tuples)%0A"
done

TOTAL_END_TIME=$(date +%s)
TOTAL_DURATION=$((TOTAL_END_TIME - TOTAL_START_TIME))

log "================================================================="
log "🏁 Manutenção Geral Concluída em ${TOTAL_DURATION}s"
log "================================================================="

# ── Alertas e Conclusão ──────────────────────────────────────────────────────
if [ "$DRY_RUN" = false ]; then
  if [ "$HAS_ERRORS" = true ]; then
    send_alert "ALERTA: Manutenção do Banco Concluída com Falhas" \
      "A manutenção preventiva semanal do PostgreSQL finalizou com avisos/erros em ${TOTAL_DURATION}s.%0A%0A$SUMMARY_REPORT" true
  elif [ "$QUIET" = false ]; then
    send_alert "Manutenção do Banco Concluída com Sucesso" \
      "Manutenção semanal do PostgreSQL (VACUUM ANALYZE + REINDEX CONCURRENTLY) finalizada em ${TOTAL_DURATION}s.%0A%0A$SUMMARY_REPORT" false
  fi
fi

exit 0
