#!/usr/bin/env bash
# =============================================================================
# scripts/db-setup.sh — Setup completo do banco (banco limpo ou existente)
# =============================================================================
# Cria o schema com `prisma db push` (schema sync — fluxo real do projeto),
# reaplica os SQLs customizados que o Prisma NÃO gerencia (search_vector,
# mv_provider_stats, triggers, PostGIS), marca as migrations como aplicadas,
# roda o seed e o índice de busca.
#
# Por que db push e não migrate deploy:
#   O histórico de migrations do projeto contém um snapshot completo
#   (20260813200000_native_enums_and_postgis_sync) que recria todas as tabelas
#   e é incompatível com as migrations incrementais anteriores — `migrate
#   deploy` num banco limpo falha. O fluxo oficial (scripts/setup.sh, README)
#   sempre usou schema sync via db push + reaplicação dos SQLs customizados.
#
# Usage:
#   bash scripts/db-setup.sh              # completo (db push + custom + seed + index)
#   bash scripts/db-setup.sh --skip-seed  # pula seed (index ainda roda)
#   bash scripts/db-setup.sh --skip-index # pula índice de busca
#
# Exit codes:
#   0 — sucesso
#   1 — falha (db push, custom SQL, seed, index com erro OU drift de schema
#       detectado pelo check-schema-drift no passo final)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

SKIP_SEED=false
SKIP_INDEX=false
for arg in "$@"; do
  case "$arg" in
    --skip-seed) SKIP_SEED=true ;;
    --skip-index) SKIP_INDEX=true ;;
    *) echo "Uso: $0 [--skip-seed] [--skip-index]" >&2; exit 2 ;;
  esac
done

echo "── db:setup — schema sync (db push) ─────────────────────────────"

# 0. Habilita PostGIS ANTES do db push — o schema usa colunas
#    Unsupported("geography(Point, 4326)") e o push falha com
#    'type "geography" does not exist' se a extensão não estiver ativa
#    (banco limpo recém-criado não tem a extensão).
echo "[0/6] Habilitando extensão PostGIS..."
bunx prisma db execute --stdin --schema prisma/schema.prisma <<< "CREATE EXTENSION IF NOT EXISTS postgis;" 2>/dev/null || \
  psql "${DATABASE_URL:-}" -c "CREATE EXTENSION IF NOT EXISTS postgis;" 2>/dev/null || true
echo "      ✅ PostGIS habilitado"

# 1. Schema base via db push (cria tabelas/colunas/enums do schema.prisma)
#    --accept-data-loss: em banco limpo não há dados a perder; em banco
#    existente, é o mesmo fallback usado pelo deploy.yml e pelo setup.sh.
echo "[1/6] prisma db push..."
bunx prisma db push --accept-data-loss 2>&1 | tail -4
echo "      ✅ schema base sincronizado"

# 2. Reaplica os SQLs customizados (idempotentes) que o Prisma não gerencia
#    (campos Unsupported: tsvector, geography, MV, triggers, extensão PostGIS)
CUSTOM_MIGRATIONS=(
  "XX_add_postgis"
  "20260722120000_add_performance_indexes"
  "20260724120000_mv_provider_stats"
  "20260724140000_auto_reindex_triggers"
  "20260726120000_add_user_search_vector"
  "20260726130000_add_denormalized_triggers"
  "20261004120000_user_keyset_rating_index"
  "20261004130000_user_location_visible_gist"
)
echo "[2/6] Reaplicando SQLs customizados (idempotentes)..."
for mig in "${CUSTOM_MIGRATIONS[@]}"; do
  SQL_FILE="prisma/migrations/$mig/migration.sql"
  if [ ! -f "$SQL_FILE" ]; then
    echo "      ⚠️  $mig: migration.sql não encontrado — pulando"
    continue
  fi
  echo "      → $mig"
  bunx prisma db execute --file "$SQL_FILE" --schema prisma/schema.prisma 2>/dev/null || \
    psql "$DATABASE_URL" -f "$SQL_FILE" 2>/dev/null || \
    { echo "      ❌ Falha ao aplicar $mig" >&2; exit 1; }
done
echo "      ✅ SQLs customizados aplicados"

# 3. Marca TODAS as migrations como aplicadas (o db push já criou o schema)
echo "[3/6] Marcando migrations como aplicadas (migrate resolve)..."
find "$PROJECT_DIR/prisma/migrations" -maxdepth 1 -type d ! -name "migrations" | sort | while IFS= read -r mig_dir; do
  mig_name=$(basename "$mig_dir")
  if grep -q "$mig_name" <<< "$(bunx prisma migrate status 2>/dev/null)"; then
    echo "      $mig_name: já aplicada"
  else
    bunx prisma migrate resolve --applied "$mig_name" >/dev/null 2>&1 && \
      echo "      $mig_name: resolvida como aplicada" || true
  fi
done
echo "      ✅ migrations marcadas"

# 4. Seed (dados demo)
if [ "$SKIP_SEED" = true ]; then
  echo "[4/6] Seed pulado (--skip-seed)"
else
  echo "[4/6] Rodando seed..."
  bun run db:seed 2>&1 | tail -3 || { echo "      ❌ Seed falhou" >&2; exit 1; }
  echo "      ✅ seed concluído"
fi

# 5. Índice de busca
if [ "$SKIP_INDEX" = true ]; then
  echo "[5/6] Índice de busca pulado (--skip-index)"
else
  echo "[5/6] Indexando busca..."
  bun run db:search:index 2>&1 | tail -3 || { echo "      ❌ Index falhou" >&2; exit 1; }
  echo "      ✅ índice de busca pronto"
fi

# 6. Prova do schema — o db push NÃO gerencia os objetos customizados e já
#    derrubou índices/triggers no passado; o guard compara o que as migrations
#    da lista CUSTOM_MIGRATIONS prometem com o catálogo real e falha o setup
#    em caso de drift. Transporte: psql no host quando houver; senão o container
#    postgis do compose (padrão PG_CONTAINER do check-money-decimal.sh).
echo "[6/6] Prova do schema (check-schema-drift)..."
DB_USER="$(sed -E 's|^[^:]+://([^:]+):.*|\1|' <<< "${DATABASE_URL:-}" 2>/dev/null || true)"
DB_NAME="$(sed -E 's|.*/([^/?]+)(\?.*)?$|\1|' <<< "${DATABASE_URL:-}" 2>/dev/null || true)"
DB_USER="${DB_USER:-severinno}"
DB_NAME="${DB_NAME:-severinno}"

run_drift_check() {
  if command -v psql >/dev/null 2>&1; then
    bash scripts/check-schema-drift.sh
    return
  fi
  if command -v docker >/dev/null 2>&1; then
    local cid
    cid="$(docker ps -q -f name=severinno-postgis 2>/dev/null | head -1)"
    if [ -n "$cid" ]; then
      PG_CONTAINER="$cid" PGUSER="${PGUSER:-$DB_USER}" PGDATABASE="${PGDATABASE:-$DB_NAME}" \
        bash scripts/check-schema-drift.sh
      return
    fi
  fi
  echo "      ⚠️  sem transporte psql/docker — prova pulada; rode 'bun run check:schema-drift' com acesso ao banco"
  return 2
}

DRIFT_RC=0
run_drift_check || DRIFT_RC=$?
if [ "$DRIFT_RC" -eq 1 ]; then
  echo "      ❌ Drift de schema logo após o setup — algo prometido pelas migrations customizadas não existe no banco" >&2
  exit 1
elif [ "$DRIFT_RC" -gt 1 ]; then
  echo "      ⚠️  prova do schema impossível (rc=$DRIFT_RC) — setup segue, mas rode o guard manualmente" >&2
else
  echo "      ✅ schema provado: todos os objetos customizados existem (0 drift)"
fi

echo ""
echo "✅ db:setup concluído!"
exit 0