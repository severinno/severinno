#!/bin/bash
# check-prisma-migrations.sh
#
# Verifica se o schema Prisma e as migrations estão sincronizados.
# Usado no CI pra garantir que nenhuma migration foi esquecida.
#
# Usage: bash scripts/check-prisma-migrations.sh
#
# Exit codes:
#   0 — tudo sincronizado
#   1 — há migrations pendentes ou schema divergente

set -euo pipefail

echo "🔍 Verificando migrations do Prisma..."

# 1. Verificar se o client está gerado
echo "  → Gerando Prisma client..."
npx prisma generate --no-engine 2>/dev/null || npx prisma generate

# 2. Verificar se há migrations pendentes
echo "  → Verificando migrations pendentes..."
PENDING=$(npx prisma migrate status 2>&1)

if echo "$PENDING" | grep -q "have not yet been applied"; then
  echo "❌ MIGRATIONS PENDENTES DETECTADAS!"
  echo ""
  echo "$PENDING" | grep -A5 "have not yet been applied"
  echo ""
  echo "Rode: npx prisma migrate dev"
  exit 1
fi

# 3. Verificar se o schema está em dia com o client
echo "  → Verificando drift do schema..."
DRIFT=$(npx prisma format --schema=prisma/schema.prisma 2>&1 || true)

if echo "$DRIFT" | grep -qi "error"; then
  echo "❌ ERRO no schema Prisma:"
  echo "$DRIFT"
  exit 1
fi

# 4. Verificar se há diffs não commitados nas migrations
CHANGED_MIGRATIONS=$(git diff --name-only -- 'prisma/migrations/' 2>/dev/null | head -5)
if [ -n "$CHANGED_MIGRATIONS" ]; then
  echo "⚠️  Migrations modificadas não commitadas:"
  echo "$CHANGED_MIGRATIONS"
  echo ""
  echo "Se intencional, faça commit antes de mergear."
fi

echo "✅ Prisma sync OK — schema e migrations atualizados."
