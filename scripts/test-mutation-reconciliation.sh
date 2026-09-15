#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-reconciliation.sh — Mutation test do CICLO DE
# RECONCILIAÇÃO de issues de dívida (closeIfResolved / reconcileDebt):
#
# Usage:
#   ./scripts/test-mutation-reconciliation.sh
#
# Exit codes:
#   0 — mutação DETECTADA: com o fechamento removido, a suíte fica VERMELHA
#       porque o teste de integração (forge-doctor-issue) prova que a issue
#       NÃO foi fechada ✅
#   1 — suíte CEGA (verde com a mutação) / falhou por outro motivo / a mutação
#       não aplicou / infra ❌
#
# POR QUE: o ciclo de reconciliação tem UM fio: `await backend.close()` dentro
# de `reconcileDebt`. Cortar esse fio e a issue fica ABERTA depois do veredito
# voltar a PRONTA — a dívida mente. O teste de integração
# (forge-doctor-issue.test.ts — "veredito PRONTA com a issue ABERTA: comenta
# a prova e FECHA") prova o ciclo completo: abrir → reconciliar → verificar
# fechamento. Sem o fechamento, o assert `gitea.issues[0].state === 'closed'`
# falha.
#
# COMO: remove o `await backend.close()` do `reconcileDebt` em
# issue-publish.mjs, roda o teste de integração que prova o ciclo, e espera
# VERMELHO (o fechamento não aconteceu → o teste detecta). Restaura.
#
# CONTROLE:
#   - backup + trap de restauração (NUNCA deixa o repo sujo)
#   - validação de aplicação (o diff precisa existir)
#   - rodagem do teste específico (não da suíte inteira — rápido e preciso)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="$REPO_ROOT/scripts/issue-publish.mjs"
TEST_FILE="$REPO_ROOT/src/lib/__tests__/forge-doctor-issue.test.ts"

# ── Controle de mutação ─────────────────────────────────────────────────
# O que mutamos: removemos a linha `await backend.close(issue.number)` do
# reconcileDebt — o ÚNICO ponto onde o fechamento acontece.

MUTATION_LINE="    await backend.close(issue.number)"

# ── Backup + trap ───────────────────────────────────────────────────────
BACKUP="${TARGET}.bak"
cp "$TARGET" "$BACKUP"
trap 'mv "$BACKUP" "$TARGET"' EXIT

# ── Aplicar mutação ─────────────────────────────────────────────────────
# Substitui a linha de fechamento por um comentário — mantém a estrutura
# (o loop continua, o comment acontece, mas o close NÃO).
sed -i "s|^${MUTATION_LINE}$|    // [mutation-test] await backend.close(issue.number)|" "$TARGET"

# Validação: a mutação precisa ter sido aplicada
if ! grep -q "mutation-test.*backend.close" "$TARGET"; then
  echo "❌ FALHA: mutação não aplicou — o padrão não foi encontrado em issue-publish.mjs"
  exit 1
fi

echo "✅ Mutação aplicada: backend.close() removido de reconcileDebt"
echo "   Rodando o teste de integração do ciclo de reconciliação..."

# ── Rodar o teste que prova o ciclo ──────────────────────────────────────
# O teste "veredito PRONTA com a issue ABERTA: comenta a prova e FECHA"
# contém:
#   expect(gitea.issues[0].state).toBe("closed")
# Com a mutação, a issue fica "open" → o teste FALHA → mutação detectada.

cd "$REPO_ROOT"
RESULT=0
timeout 120 bunx vitest run \
  --config vitest.config.unit.ts \
  -t "veredito PRONTA com a issue ABERTA" \
  "$TEST_FILE" 2>&1 || RESULT=$?

# ── Verificar resultado ─────────────────────────────────────────────────
if [ "$RESULT" -ne 0 ]; then
  echo "✅ Mutação detectada: o teste de reconciliação FALHOU (como esperado)"
  echo "   O ciclo de fechamento de issues está FUNCIONANDO e PROVADO em CI"
  exit 0
else
  echo "❌ FALHA: o teste passou COM a mutação — o ciclo de reconciliação"
  echo "   não está sendo exercitado! Verifique se o teste realmente"
  echo "   invoca reconcileDebt via CLI."
  exit 1
fi
