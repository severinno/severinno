#!/usr/bin/env bash
# =============================================================================
# scripts/check-money-decimal.sh — Guard da conversão dinheiro Float → Decimal
# =============================================================================
# Prova, contra um banco real, que a conversão monetária (migration
# 20260930120000_money_decimal) continua de pé a cada mudança de schema:
#
#   1. TYPES       — as 11 colunas monetárias são numeric(10,2)/(12,2)
#                    (qualquer regressão para double precision falha aqui)
#   2. OBJETOS     — os objetos que a migration derruba e recria existem:
#                    mv_provider_stats, trg_refresh_mv_on_booking,
#                    trg_search_reindex_service (a autossuficiência da
#                    migration depende deles; ver header da migration)
#   3. CONTAGENS   — contagem de linhas por tabela monetária; em modo
#                    --ephemeral, valida o delta 0→N do seed de prova
#   4. ROUND-TRIP  — text→numeric→text exato; 0.1+0.2 = 0.30 em numeric
#                    (o float8 equivalente é 0.30000000000000004 — a razão
#                    da conversão); prova do arredondamento de conversão
#                    (9.999999999::float8 → 10.00 em numeric(10,2))
#   5. DML (--ephemeral) — semeia a cadeia completa de FKs e insere uma
#                    linha em CADA tabela monetária, provando escrita exata
#                    centavo a centavo + triggers recriados funcionando
#                    (MV refresh + fila de reindexação)
#
# Transporte (o runner self-hosted não tem psql no host — padrão do job
# prisma-migrations em .github/workflows/infra-guards.yml):
#   PG_CONTAINER=<id>  → docker exec <id> psql (psql de DENTRO do container)
#   senão              → psql $DATABASE_URL no host
#
# Modo --ephemeral (DML de verdade): só roda contra banco de nome
# descartável (severinno_test / *_test / money_check) — intertravamento
# contra rodar com INSERTs no banco de desenvolvimento.
#
# Usage:
#   bash scripts/check-money-decimal.sh                # metadata + round-trip
#   bash scripts/check-money-decimal.sh --ephemeral    # + seed/prova por DML
#
# CI: passo "Money decimal guard" no job prisma-migrations (banco efêmero
# já com `migrate deploy` aplicado) → --ephemeral é seguro lá por padrão.
#
# Exit codes:
#   0 — tudo provado
#   1 — violação encontrada (lista detalhada no output)
#   2 — uso incorreto / pré-requisito ausente
# =============================================================================

set -euo pipefail

EPHEMERAL=false
for arg in "$@"; do
  case "$arg" in
    --ephemeral) EPHEMERAL=true ;;
    *) echo "Uso: $0 [--ephemeral]" >&2; exit 2 ;;
  esac
done

if [ -n "${PG_CONTAINER:-}" ]; then
  : "${PGUSER:?PGUSER é obrigatório com PG_CONTAINER}"
  : "${PGDATABASE:?PGDATABASE é obrigatório com PG_CONTAINER}"
  psqlq() { docker exec "${PG_CONTAINER}" psql -U "${PGUSER}" -d "${PGDATABASE}" -v ON_ERROR_STOP=1 -qtAc "$1"; }
else
  : "${DATABASE_URL:?DATABASE_URL é obrigatório (ou defina PG_CONTAINER)}"
  command -v psql >/dev/null 2>&1 || { echo "❌ psql não encontrado no host e PG_CONTAINER não definido" >&2; exit 2; }
  psqlq() { psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qtAc "$1"; }
fi

VIOLATIONS=()

fail() { VIOLATIONS+=("$1"); echo "❌ $1"; }
ok()   { echo "✅ $1"; }

# =============================================================================
# 1. TYPES — as 11 colunas monetárias
# =============================================================================
echo "── [1/5] Tipos das colunas monetárias ──────────────────────────────"

# table.column=precision,scale esperado (money_decimal: 10,2 ou 12,2)
EXPECTED_TYPES=(
  'Service.basePrice=10,2'
  'QuoteItem.price=10,2'
  'Booking.amount=10,2'
  'Payment.amount=10,2'
  'SettlementPeriod.totalCommission=12,2'
  'SettlementPeriod.totalNet=12,2'
  'SettlementPeriod.totalAmount=12,2'
  'ProviderSettlement.totalAmount=12,2'
  'ProviderSettlement.commission=12,2'
  'ProviderSettlement.netAmount=12,2'
  'WalletTransaction.amount=10,2'
)

for entry in "${EXPECTED_TYPES[@]}"; do
  table="${entry%%.*}"
  rest="${entry#*.}"
  column="${rest%%=*}"
  expected="${rest#*=}"
  actual="$(psqlq "SELECT COALESCE(data_type||','||COALESCE(numeric_precision::text,'?')||','||COALESCE(numeric_scale::text,'?'),'AUSENTE')
                   FROM information_schema.columns
                   WHERE table_name='${table}' AND column_name='${column}'")"
  if [ "${actual}" = "numeric,${expected}" ]; then
    ok "${table}.${column} = numeric(${expected})"
  else
    fail "${table}.${column}: esperado numeric(${expected}), encontrado '${actual}'"
  fi
done

# =============================================================================
# 2. OBJETOS — o que a migration derruba e recria precisa existir
# =============================================================================
echo "── [2/5] Objetos canônicos (MV + triggers que a migration recria) ──"

mv_count="$(psqlq "SELECT count(*) FROM pg_matviews WHERE matviewname='mv_provider_stats'")"
if [ "${mv_count}" = "1" ]; then
  ok "mv_provider_stats presente"
else
  fail "mv_provider_stats ausente (${mv_count}) — triggers de refresh quebrariam os writes"
fi

for trg_tbl in 'trg_refresh_mv_on_booking|Booking' 'trg_search_reindex_service|Service'; do
  trg="${trg_tbl%%|*}"
  tbl="${trg_tbl#*|}"
  n="$(psqlq "SELECT count(*) FROM pg_trigger WHERE tgrelid='\"${tbl}\"'::regclass AND tgname='${trg}' AND NOT tgisinternal")"
  if [ "${n}" = "1" ]; then
    ok "${trg} presente em ${tbl}"
  else
    fail "${trg} ausente em ${tbl} (${n})"
  fi
done

# =============================================================================
# 3. CONTAGENS — linhas por tabela monetária
# =============================================================================
echo "── [3/5] Contagens por tabela monetária ────────────────────────────"

MONEY_TABLES=(Service QuoteItem Booking Payment SettlementPeriod ProviderSettlement WalletTransaction)
declare -A COUNTS_BEFORE=()
for t in "${MONEY_TABLES[@]}"; do
  n="$(psqlq "SELECT count(*) FROM \"${t}\"")"
  COUNTS_BEFORE["${t}"]="${n}"
  echo "   ${t}: ${n} linha(s)"
done

# =============================================================================
# 4. ROUND-TRIP — exatidão do numeric (independe de dados da aplicação)
# =============================================================================
echo "── [4/5] Round-trip numérico ────────────────────────────────────────"

rt="$(psqlq "SELECT v::text FROM (SELECT '12345.67'::numeric(10,2) AS v) s")"
if [ "${rt}" = "12345.67" ]; then ok "text→numeric(10,2)→text preserva 12345.67"; else fail "round-trip 12345.67 → '${rt}'"; fi

sum="$(psqlq "SELECT ((0.1::numeric(10,2) + 0.2::numeric(10,2))::text)")"
if [ "${sum}" = "0.30" ]; then ok "0.1+0.2 = 0.30 exato em numeric"; else fail "0.1+0.2 em numeric → '${sum}' (esperado 0.30)"; fi

fsum="$(psqlq "SELECT (0.1::float8 + 0.2::float8)::text")"
echo "   (testemunha do porquê: o mesmo 0.1+0.2 em float8 = ${fsum} — binário não serve para dinheiro)"

conv="$(psqlq "SELECT ((9.999999999::float8)::numeric(10,2))::text")"
if [ "${conv}" = "10.00" ]; then ok "conversão float→numeric(10,2) arredonda ao centavo (9.999999999 → 10.00)"; else fail "conversão 9.999999999::float8 → '${conv}' (esperado 10.00)"; fi

maxv="$(psqlq "SELECT ('99999999.99'::numeric(10,2))::text")"
if [ "${maxv}" = "99999999.99" ]; then ok "teto do numeric(10,2) preservado (99999999.99)"; else fail "teto 99999999.99 → '${maxv}'"; fi

# =============================================================================
# 5. DML (--ephemeral) — escrita real em TODAS as tabelas monetárias
# =============================================================================
if [ "${EPHEMERAL}" = "true" ]; then
  echo "── [5/5] Prova por DML (modo efêmero) ─────────────────────────────"

  # Intertravamento: só banco de nome descartável
  case "${PGDATABASE:-${DATABASE_URL:-}}" in
    severinno_test|*_test|money_check) : ;;
    *) echo "❌ --ephemeral recusado: banco alvo não parece descartável (${PGDATABASE:-?})." >&2; exit 2 ;;
  esac

  SUF="$$_$(date +%s%N | tail -c 7)"
  SQL="$(cat <<EOSQL
BEGIN;
INSERT INTO "User" (id, email, "passwordHash", name, role, "updatedAt") VALUES
  ('mck_p_${SUF}', 'mck_p_${SUF}@guard.dev', 'x', 'Guard', 'PROVIDER', now()),
  ('mck_c_${SUF}', 'mck_c_${SUF}@guard.dev', 'x', 'Guard', 'CLIENT', now());
INSERT INTO "Category" (id, name, slug, "updatedAt")
  VALUES ('mck_cat_${SUF}', 'Guard', 'guard-${SUF}', now());
INSERT INTO "Service" (id, "providerId", "categoryId", title, description, "basePrice", "updatedAt")
  VALUES ('mck_s_${SUF}', 'mck_p_${SUF}', 'mck_cat_${SUF}', 'Guard', 'Guard', 99.99, now());
INSERT INTO "Booking" (id, "clientId", "providerId", "serviceId", "scheduledAt", address, cep, lat, lng, amount, "updatedAt")
  VALUES ('mck_b_${SUF}', 'mck_c_${SUF}', 'mck_p_${SUF}', 'mck_s_${SUF}', now() + interval '1 day', 'Guard', '00000-000', -23.5, -46.6, 150.00, now());
INSERT INTO "Payment" (id, "bookingId", amount, "updatedAt")
  VALUES ('mck_pay_${SUF}', 'mck_b_${SUF}', 1234.56, now());
INSERT INTO "QuoteRequest" (id, "clientId", "providerId", address, cep, lat, lng, "expiresAt", "updatedAt")
  VALUES ('mck_q_${SUF}', 'mck_c_${SUF}', 'mck_p_${SUF}', 'Guard', '00000-000', -23.5, -46.6, now() + interval '7 days', now());
INSERT INTO "QuoteItem" (id, "requestId", "providerId", "serviceId", description, quantity, price, "updatedAt")
  VALUES ('mck_qi_${SUF}', 'mck_q_${SUF}', 'mck_p_${SUF}', 'mck_s_${SUF}', 'Guard', 2.0, 45.50, now());
INSERT INTO "WalletTransaction" (id, "providerId", amount, "updatedAt")
  VALUES ('mck_w_${SUF}', 'mck_p_${SUF}', 777.77, now());
INSERT INTO "SettlementPeriod" (id, "startDate", "endDate", "totalCommission", "totalNet", "totalAmount", "updatedAt")
  VALUES ('mck_sp_${SUF}', now() - interval '7 days', now(), 10.10, 90.90, 101.00, now());
INSERT INTO "ProviderSettlement" (id, "periodId", "providerId", "totalAmount", commission, "netAmount", "updatedAt")
  VALUES ('mck_ps_${SUF}', 'mck_sp_${SUF}', 'mck_p_${SUF}', 101.00, 10.10, 90.90, now());
COMMIT;
EOSQL
)"
  if [ -n "${PG_CONTAINER:-}" ]; then
    echo "${SQL}" | docker exec -i "${PG_CONTAINER}" psql -U "${PGUSER}" -d "${PGDATABASE}" -v ON_ERROR_STOP=1 -q
  else
    echo "${SQL}" | psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -q
  fi

  # Delta por tabela: cada uma ganhou exatamente 1 linha
  for t in "${MONEY_TABLES[@]}"; do
    n_after="$(psqlq "SELECT count(*) FROM \"${t}\"")"
    delta=$(( n_after - ${COUNTS_BEFORE["${t}"]} ))
    if [ "${delta}" -eq 1 ]; then
      ok "${t}: +1 linha (escrita aceita)"
    else
      fail "${t}: delta de linhas = ${delta} (esperado 1)"
    fi
  done

  # Valores centavo a centavo (leitura do que FOI gravado, não do que foi inserido)
  declare -A EXPECTED_VALUES=(
    ['Service|basePrice|mck_s_']='99.99'
    ['Booking|amount|mck_b_']='150.00'
    ['Payment|amount|mck_pay_']='1234.56'
    ['QuoteItem|price|mck_qi_']='45.50'
    ['WalletTransaction|amount|mck_w_']='777.77'
    ['SettlementPeriod|totalAmount|mck_sp_']='101.00'
    ['ProviderSettlement|netAmount|mck_ps_']='90.90'
  )
  for key in "${!EXPECTED_VALUES[@]}"; do
    tbl="${key%%|*}"; rest="${key#*|}"; col="${rest%%|*}"; prefix="${rest#*|}"
    got="$(psqlq "SELECT \"${col}\"::text FROM \"${tbl}\" WHERE id LIKE '${prefix}%' ORDER BY id DESC LIMIT 1")"
    if [ "${got}" = "${EXPECTED_VALUES[${key}]}" ]; then
      ok "${tbl}.${col} gravado/relido exato: ${got}"
    else
      fail "${tbl}.${col}: gravado '${got}', esperado '${EXPECTED_VALUES[${key}]}'"
    fi
  done

  # Trigger recriado funciona: MV refletiu o booking/service recém-inserido
  mv_rows="$(psqlq "SELECT count(*) FROM mv_provider_stats WHERE provider_id LIKE 'mck_p_%'")"
  if [ "${mv_rows}" -ge 1 ]; then
    ok "mv_provider_stats refletiu o provider novo (trg_refresh_mv_on_* ativo)"
  else
    fail "mv_provider_stats não refletiu o provider novo — trigger de refresh inoperante"
  fi

  # Trigger de reindexação enfileirou o service novo
  q_rows="$(psqlq "SELECT count(*) FROM \"search_reindex_queue\" WHERE \"entityType\"='service' AND \"entityId\" LIKE 'mck_s_%'")"
  if [ "${q_rows}" -ge 1 ]; then
    ok "search_reindex_queue recebeu o service novo (trg_search_reindex_service ativo)"
  else
    fail "search_reindex_queue não recebeu o service novo — trigger de reindexação inoperante"
  fi

  # Limpeza best-effort (ordem reversa de dependência)
  CLEANUP_SQL="$(cat <<EOSQL
BEGIN;
DELETE FROM "ProviderSettlement" WHERE id LIKE 'mck_ps_%';
DELETE FROM "SettlementPeriod"   WHERE id LIKE 'mck_sp_%';
DELETE FROM "WalletTransaction"  WHERE id LIKE 'mck_w_%';
DELETE FROM "QuoteItem"          WHERE id LIKE 'mck_qi_%';
DELETE FROM "QuoteRequest"       WHERE id LIKE 'mck_q_%';
DELETE FROM "Payment"            WHERE id LIKE 'mck_pay_%';
DELETE FROM "Booking"            WHERE id LIKE 'mck_b_%';
DELETE FROM "Service"            WHERE id LIKE 'mck_s_%';
DELETE FROM "Category"           WHERE id LIKE 'mck_cat_%';
DELETE FROM "User"               WHERE id LIKE 'mck_p_%' OR id LIKE 'mck_c_%';
DELETE FROM "search_reindex_queue" WHERE "entityId" LIKE 'mck_s_%' OR "entityId" LIKE 'mck_p_%' OR "entityId" LIKE 'mck_cat_%';
COMMIT;
EOSQL
)"
  if [ -n "${PG_CONTAINER:-}" ]; then
    echo "${CLEANUP_SQL}" | docker exec -i "${PG_CONTAINER}" psql -U "${PGUSER}" -d "${PGDATABASE}" -v ON_ERROR_STOP=1 -q || true
  else
    echo "${CLEANUP_SQL}" | psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -q || true
  fi
  echo "   (linhas de prova removidas)"
fi

# =============================================================================
# Veredito
# =============================================================================
echo "────────────────────────────────────────────────────────────────────"
if [ "${#VIOLATIONS[@]}" -gt 0 ]; then
  echo "❌ money-decimal guard: ${#VIOLATIONS[@]} violação(ões):"
  for v in "${VIOLATIONS[@]}"; do echo "   - ${v}"; done
  exit 1
fi
ok "money-decimal guard: 11 colunas numeric provadas, round-trip exato, objetos canônicos de pé"
