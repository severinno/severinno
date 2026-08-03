#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-readme-toc.sh — Mutation test do guard de TOC do README
# (check-readme-toc.mjs)
#
# Prova que o scripts/check-readme-toc.mjs REALMENTE pega o bug real da
# conversão parágrafo→heading ANTES do índice: um parágrafo de introdução da
# seção virado `###` (ex.: alguém destaca uma frase com heading) cria um
# heading novo fora do índice. O TOC guard deve FLAGRAR (exit 1) — o
# nível-alvo DERIVADO das entradas resolvidas garante que o pai continue
# sendo a `##` dona e o heading convertido seja detectado como 'heading fora
# do índice' (o bug que o nearest-heading-ingênuo deixava passar silencioso).
#
#   CONTROLE:  fixture limpo (seção + parágrafo + índice + headings) → guard
#              deve PASS (exit 0) — prova que a falha vem da MUTAÇÃO, não de
#              um fixture quebrado.
#   MUTAÇÃO:   converte o parágrafo em `### Camadas de proteção` ANTES do
#              índice → guard deve FALHAR pela asserção reverse '[heading
#              fora do índice] 'Camadas de proteção' (nível 3) na seção
#              'Encoding Guards''.
#
# Se o guard PASSAR com a mutação (exit 0), ele está CEGO — a checagem
# reverse/derivação de nível foi removida/enfraquecida — e o script falha
# (exit 1), bloqueando o CI. Espelho do test-mutation-readme-anchors.sh para
# o guard de TOC (e do mutation-bun-literal / hooks-symmetry / seed-dev-e2e).
#
# DIFERENÇA vs mutation-seed-dev-e2e: aqui o fixture é criado do zero num
# mktemp (o guard é node-puro, sem docker/prisma). O script não toca NENHUM
# arquivo do repositório real.
#
# Pipeline:
#   1. Cria repo fixture temporário (README.md com seção + parágrafo + TOC)
#   2. CONTROLE: fixture limpo → guard deve PASS (exit 0)
#   3. MUTAÇÃO: converte o parágrafo em ### antes do índice
#   4. Guard contra o fixture MUTADO → deve FALHAR pela asserção reverse
#   5. Cleanup (trap EXIT — rm -rf do temp)
#
# Usage:
#   ./scripts/test-mutation-readme-toc.sh
#
# Exit codes:
#   0 — mutação DETECTADA pelo guard (falhou pela asserção esperada) ✅
#   1 — guard CEGO (passou com a mutação) OU falha de infra/asserção ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-readme-toc.mjs"

TMP_DIR="$(mktemp -d)"

# ── Mutação (bug conhecido) ────────────────────────────────────────────────
# Cenário: parágrafo de introdução da seção convertido em `###` ANTES do
# índice — o heading novo fica fora do TOC. O guard DEVE emitir a violação
# reverse. Fonte: main() em scripts/check-readme-toc.mjs:
#   '<file>:<line> [heading fora do índice] '<label>' (nível <level>) na
#   seção '<section>' sem bullet no TOC — adicione '- [<label>](#<slug>)''
#
# ⚠️ Source-coupled: esta string reproduz a mensagem EXATA do guard. Se a
# mensagem for reformulada em scripts/check-readme-toc.mjs, o mutation test
# falha com 'não pela asserção esperada' (não é guard cego — é o esperado
# por acoplamento; atualizar as duas juntas).
EXPECTED_FAILURE="[heading fora do índice] 'Camadas de proteção' (nível 3) na seção 'Encoding Guards' sem bullet no TOC"

# ── Colors ────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

# ── Cleanup (trap EXIT — SEMPRE remove o temp, mesmo com falha) ──────────
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# ── build_fixture: cria o repo fixture limpo ──────────────────────────────
# README mínimo: seção `##`, um PARÁGRAFO de introdução (a vítima da
# mutação), o índice com 2 bullets que RESOLVEM e os 2 headings reais.
build_fixture() {
  rm -rf "$TMP_DIR"
  mkdir -p "$TMP_DIR"

  cat > "$TMP_DIR/README.md" <<'EOF'
## Encoding Guards

Este é o parágrafo de introdução da seção.

- [CRLF Guard](#crlf-guard)
- [Auditoria histórica](#auditoria-histórica)

### CRLF Guard

### Auditoria histórica
EOF
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-readme-toc deve FALHAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Cria o fixture limpo e valida o CONTROLE (deve PASS)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando repo fixture temporário em $TMP_DIR..."

build_fixture
pass "Fixture criado (README.md com seção + parágrafo + índice)"

info "STEP 2: Controle — fixture limpo → guard deve PASS (exit 0)..."

set +e
CONTROL_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
CONTROL_EXIT=$?
set -e

if [ "$CONTROL_EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: guard rejeitou o fixture LIMPO (exit $CONTROL_EXIT)."
  echo "$CONTROL_OUTPUT" | tail -8
  fail "O fixture base não é válido — o mutation test não pode prosseguir."
  exit 1
fi
pass "Controle OK — fixture limpo passa no guard (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3+4 — MUTAÇÃO: parágrafo→heading antes do índice deve FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação (converte o parágrafo em ### antes do índice)..."

# Converte o parágrafo de introdução em heading `### Camadas de proteção`
# ANTES dos bullets — o cenário real: o nearest-heading-ingênuo faria o pai
# do TOC virar esse `###` e o heading convertido escaparia silencioso; o
# nível-alvo DERIVADO mantém o pai na `##` dona e flagra o heading novo.
sed -i 's/^Este é o parágrafo de introdução da seção\.$/### Camadas de proteção/' "$TMP_DIR/README.md"

# Fail-fast: verifica que a mutação realmente aplicou (parágrafo sumiu e o
# heading novo existe ANTES do índice).
if grep -Fq "### Camadas de proteção" "$TMP_DIR/README.md" && ! grep -Fq "Este é o parágrafo" "$TMP_DIR/README.md"; then
  pass "Mutação aplicada: parágrafo → ### Camadas de proteção (antes do índice)"
else
  fail "Mutação não aplicou (sed falhou?)."
  exit 1
fi

info "STEP 4: Rodando guard contra o fixture MUTADO..."
set +e
GUARD_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
GUARD_EXIT=$?
set -e

echo "$GUARD_OUTPUT" | tail -12

# Caso 1 — guard CEGO: PASS com a mutação. A checagem reverse (heading fora
# do índice) ou a derivação do nível-alvo foi removida/enfraquecida. Este é o
# cenário que o mutation test existe para BLOQUEAR.
if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "GUARD CEGO: check-readme-toc passou com parágrafo convertido em heading"
  fail "antes do índice (exit 0). Verifique se a direção reverse ainda acusa"
  fail "'heading fora do índice' em scripts/check-readme-toc.mjs."
  exit 1
fi

# Caso 2 — falhou, mas NÃO pela asserção esperada (outro invariante quebrou).
if ! echo "$GUARD_OUTPUT" | grep -Fq "$EXPECTED_FAILURE"; then
  fail "Guard falhou (exit $GUARD_EXIT) mas NÃO pela asserção reverse esperada:"
  fail "  esperava:  $EXPECTED_FAILURE"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi

pass "Mutação DETECTADA: guard falhou com '❌ $EXPECTED_FAILURE' (exit $GUARD_EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard de TOC pega a conversão parágrafo→heading"
pass "antes do índice (heading fora do índice não escapa)"
exit 0
