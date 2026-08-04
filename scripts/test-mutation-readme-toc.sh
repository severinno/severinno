#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-readme-toc.sh — Mutation tests do guard de TOC do README
# (check-readme-toc.mjs) — DUAS direções de regressão do reverse num script
#
# Prova que o scripts/check-readme-toc.mjs REALMENTE pega as duas formas de o
# reverse (heading fora do índice) quebrar:
#
#   CENÁRIO 1 — parágrafo→heading ANTES do índice (heading NASCE fora do TOC):
#     Um parágrafo de introdução da seção virado `###` (ex.: alguém destaca
#     uma frase com heading) cria um heading novo fora do índice. O guard deve
#     FLAGRAR (exit 1) — o nível-alvo DERIVADO das entradas resolvidas garante
#     que o pai continue sendo a `##` dona e o heading convertido seja
#     detectado como 'heading fora do índice' (o bug que o nearest-heading
#     ingênuo deixava passar silencioso).
#
#   CENÁRIO 2 — bullet REMOVIDO do índice (heading filho fica ÓRFÃO — drift
#     inverso): remover uma entrada do TOC SEM remover o heading correspondente
#     deixa o `### CRLF Guard` órfão — o bullet MORRE e o heading sobrevive, o
#     espelho exato do cenário 1. O guard deve FLAGRAR com o MESMO exit 1 e a
#     MESMA classe de violação reverse ('heading fora do índice').
#
#   CONTROLE (ambos): fixture limpo → guard PASS (exit 0) — prova que a falha
#     vem da MUTAÇÃO, não de um fixture quebrado.
#
# Se o guard PASSAR com QUALQUER mutação (exit 0), ele está CEGO — a checagem
# reverse foi removida/enfraquecida — e o script falha (exit 1), bloqueando o
# CI. Espelho dos demais mutation tests (anchors / bun-literal /
# hooks-symmetry / seed-dev-e2e).
#
# DIFERENÇA vs mutation-seed-dev-e2e: o fixture é criado do zero num mktemp
# (o guard é node-puro, sem docker/prisma). O script não toca NENHUM arquivo
# do repositório real.
#
# Pipeline (por cenário):
#   1. Cria repo fixture temporário (README.md com seção + parágrafo + TOC)
#   2. CONTROLE: fixture limpo → guard deve PASS (exit 0)
#   3. MUTAÇÃO: converte o parágrafo em ### (C1) / remove um bullet (C2)
#   4. Guard contra o fixture MUTADO → deve FALHAR pela asserção reverse
#   5. Cleanup (trap EXIT — rm -rf do temp)
#
# Usage:
#   ./scripts/test-mutation-readme-toc.sh
#
# Exit codes:
#   0 — mutações DETECTADAS pelo guard (falhou pela asserção esperada) ✅
#   1 — guard CEGO (passou com a mutação) OU falha de infra/asserção ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-readme-toc.mjs"

TMP_DIR="$(mktemp -d)"

# ── Mutações (bugs conhecidos) ────────────────────────────────────────────
# Cenário 1: parágrafo de introdução da seção convertido em `###` ANTES do
# índice — o heading novo fica fora do TOC.
# Cenário 2: bullet do índice REMOVIDO deixando o heading filho órfão — a
# direção inversa do mesmo reverse (heading existe, entrada do TOC morreu).
# Fonte da mensagem: main() em scripts/check-readme-toc.mjs:
#   '<file>:<line> [heading fora do índice] '<label>' (nível <level>) na
#   seção '<section>' sem bullet no TOC — adicione '- [<label>](#<slug>)''
#
# ⚠️ Source-coupled: estas strings reproduzem a mensagem EXATA do guard. Se a
# mensagem for reformulada em scripts/check-readme-toc.mjs, o mutation test
# falha com 'não pela asserção esperada' (não é guard cego — é o esperado
# por acoplamento; atualizar as duas juntas).
EXPECTED_FAILURE_S1="[heading fora do índice] 'Camadas de proteção' (nível 3) na seção 'Encoding Guards' sem bullet no TOC"
EXPECTED_FAILURE_S2="[heading fora do índice] 'CRLF Guard' (nível 3) na seção 'Encoding Guards' sem bullet no TOC"

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

# ── Fixtures ──────────────────────────────────────────────────────────────
# C1: seção `##`, um PARÁGRAFO de introdução (a vítima da mutação), o índice
# com 2 bullets que RESOLVEM e os 2 headings reais.
build_fixture_s1() {
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

# C2: índice com 3 bullets + 3 headings — o bloco só é TOC com >= 2 entradas
# (MIN_TOC_ENTRIES=2 em check-readme-toc.mjs); remover 1 bullet deixa 2 (bloco
# ainda detectado) e o heading do bullet removido vira o órfão do reverse.
build_fixture_s2() {
  rm -rf "$TMP_DIR"
  mkdir -p "$TMP_DIR"

  cat > "$TMP_DIR/README.md" <<'EOF'
## Encoding Guards

Este é o parágrafo de introdução da seção.

- [CRLF Guard](#crlf-guard)
- [Auditoria histórica](#auditoria-histórica)
- [Blob CRLF Guard](#blob-crlf-guard)

### CRLF Guard

### Auditoria histórica

### Blob CRLF Guard
EOF
}

# ── Helpers (compartilhados pelos 2 cenários) ─────────────────────────────

# assert_control_pass: roda o guard no fixture ATUAL e valida exit 0.
# $1 = label do cenário (diagnóstico)
assert_control_pass() {
  local label="$1"
  info "Controle ($label) — fixture limpo → guard deve PASS (exit 0)..."
  set +e
  local out exit_code
  out="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
  exit_code=$?
  set -e
  if [ "$exit_code" -ne 0 ]; then
    fail "CONTROLE FALHOU ($label): guard rejeitou o fixture LIMPO (exit $exit_code)."
    echo "$out" | tail -8
    fail "O fixture base não é válido — o mutation test não pode prosseguir."
    exit 1
  fi
  pass "Controle OK ($label) — fixture limpo passa no guard (exit 0)"
}

# assert_mutation_fail: roda o guard no fixture MUTADO e valida que FALHOU
# (exit != 0) PELA asserção reverse esperada (substring no output).
# $1 = mensagem esperada, $2 = label do cenário (diagnóstico)
assert_mutation_fail() {
  local expected="$1" label="$2"
  info "Rodando guard contra o fixture MUTADO ($label)..."
  set +e
  local out exit_code
  out="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
  exit_code=$?
  set -e

  echo "$out" | tail -12

  # Caso 1 — guard CEGO: PASS com a mutação. A checagem reverse (heading fora
  # do índice) ou a derivação do nível-alvo foi removida/enfraquecida. Este é
  # o cenário que o mutation test existe para BLOQUEAR.
  if [ "$exit_code" -eq 0 ]; then
    fail "GUARD CEGO ($label): check-readme-toc passou com a mutação aplicada (exit 0)."
    fail "Verifique se a direção reverse ainda acusa 'heading fora do índice'"
    fail "em scripts/check-readme-toc.mjs."
    exit 1
  fi

  # Caso 2 — falhou, mas NÃO pela asserção esperada (outro invariante quebrou).
  if ! echo "$out" | grep -Fq "$expected"; then
    fail "Guard falhou (exit $exit_code) mas NÃO pela asserção reverse esperada ($label):"
    fail "  esperava:  $expected"
    fail "Falha pode ser outro invariante do fixture — veja o output acima."
    exit 1
  fi

  pass "Mutação DETECTADA ($label): guard falhou com '❌ $expected' (exit $exit_code)"
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TESTS (check-readme-toc deve FALHAR)"
echo "   Cenário 1: parágrafo→heading antes do índice (heading fora do TOC)"
echo "   Cenário 2: bullet removido → heading filho órfão (drift inverso)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# CENÁRIO 1 — parágrafo→heading antes do índice (heading NASCE fora do TOC)
# ═════════════════════════════════════════════════════════════════════════

info "CENÁRIO 1: criando fixture (seção + parágrafo + índice de 2 bullets)..."
build_fixture_s1
pass "Fixture C1 criado (README.md com seção + parágrafo + índice)"

assert_control_pass "Cenário 1"

info "Aplicando mutação C1 (converte o parágrafo em ### antes do índice)..."
# Converte o parágrafo de introdução em heading `### Camadas de proteção`
# ANTES dos bullets — o cenário real: o nearest-heading-ingênuo faria o pai
# do TOC virar esse `###` e o heading convertido escaparia silencioso; o
# nível-alvo DERIVADO mantém o pai na `##` dona e flagra o heading novo.
sed -i 's/^Este é o parágrafo de introdução da seção\.$/### Camadas de proteção/' "$TMP_DIR/README.md"

# Fail-fast: verifica que a mutação realmente aplicou (parágrafo sumiu e o
# heading novo existe ANTES do índice).
if grep -Fq "### Camadas de proteção" "$TMP_DIR/README.md" && ! grep -Fq "Este é o parágrafo" "$TMP_DIR/README.md"; then
  pass "Mutação C1 aplicada: parágrafo → ### Camadas de proteção (antes do índice)"
else
  fail "Mutação C1 não aplicou (sed falhou?)."
  exit 1
fi

assert_mutation_fail "$EXPECTED_FAILURE_S1" "Cenário 1"

# ═════════════════════════════════════════════════════════════════════════
# CENÁRIO 2 — bullet REMOVIDO do índice → heading filho ÓRFÃO (drift inverso)
# ═════════════════════════════════════════════════════════════════════════

info "CENÁRIO 2: criando fixture (índice de 3 bullets + 3 headings)..."
build_fixture_s2
pass "Fixture C2 criado (README.md com seção + índice de 3 bullets)"

assert_control_pass "Cenário 2"

info "Aplicando mutação C2 (remove o bullet '- [CRLF Guard](#crlf-guard)')..."
# Remove APENAS a entrada do índice — o heading `### CRLF Guard` sobrevive e
# fica órfão (espelho do C1: aqui o bullet MORRE, o heading permanece). O
# bloco com 2 bullets restantes ainda é detectado como TOC (MIN_TOC_ENTRIES=2).
#
# ⚠️ Padrão SEM parênteses de propósito: em BRE do GNU sed (ubuntu-latest do
# CI) `\(`/`\)` são delimitadores de GRUPO, não parênteses literais — um
# padrão com `\(#crlf-guard\)` não casaria a linha real (bug de portabilidade
# MSYS vs GNU, pego no review). `/^- \[CRLF Guard\]/d` casa o prefixo do
# bullet sob QUALQUER semântica e não toca o heading (`### CRLF Guard` não
# começa com `- `).
sed -i '/^- \[CRLF Guard\]/d' "$TMP_DIR/README.md"

# Fail-fast: bullet sumiu E o heading órfão continua presente.
if ! grep -Fq -- "- [CRLF Guard](#crlf-guard)" "$TMP_DIR/README.md" && grep -Fq "### CRLF Guard" "$TMP_DIR/README.md"; then
  pass "Mutação C2 aplicada: bullet removido, heading ### CRLF Guard órfão"
else
  fail "Mutação C2 não aplicou (sed falhou?)."
  exit 1
fi

assert_mutation_fail "$EXPECTED_FAILURE_S2" "Cenário 2"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TESTS PASSED — o guard de TOC pega as DUAS direções do reverse:"
pass "  • Cenário 1: parágrafo→heading antes do índice (heading fora do TOC)"
pass "  • Cenário 2: bullet removido → heading filho órfão (drift inverso)"
exit 0
