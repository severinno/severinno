#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-readme-docs-anchor.sh — Mutation test do guard de
# âncoras: âncora quebrada em docs/*.md (cobertura de docs no scan default)
#
# Prova que o scripts/check-readme-anchors.mjs REALMENTE cobre docs/*.md no
# scan DEFAULT (sem target): o guard descobre os docs via discoverDocTargets
# e valida as âncoras internas DELES — não só do README.md. O mutation test
# dos anchors (test-mutation-readme-anchors.sh) roda num temp dir SÓ com
# README.md (docs/ ausente → discoverDocTargets retorna [] → o docs nunca é
# escaneado); este cenário usa um fixture COM docs/ para fechar essa lacuna:
#
#   CENÁRIO — heading renomeado em docs/api.md SEM atualizar o link interno:
#     o docs/api.md tem `- [Seção X](#seção-x)` apontando para `## Seção X`.
#     A mutação renomeia o heading para `## Seção Y` (o link NÃO muda) — o
#     slug `seção-x` deixa de existir no docs → o guard deve FLAGRAR (exit 1)
#     com `docs/api.md:<linha> [forward] [Seção X]: '#seção-x'`.
#
#   CONTROLE — fixture limpo (docs/ presente) → guard PASS (exit 0) E o
#     relatório lista `docs/api.md` (prova que o docs FOI escaneado — sem
#     isso o cenário não provaria cobertura de docs).
#
# Se o guard PASSAR com a mutação (exit 0), ele está CEGO para docs/*.md
# (discoverDocTargets removido/enfraquecido ou o loop de targets quebrado) —
# o script falha (exit 1), bloqueando o CI. Espelho dos demais mutation
# tests: fixture mktemp, node-puro, SEM docker/prisma, não toca NENHUM
# arquivo do repo real.
#
# Usage:
#   ./scripts/test-mutation-readme-docs-anchor.sh
#
# Exit codes:
#   0 — mutação DETECTADA (guard falhou pela asserção esperada) ✅
#   1 — guard CEGO (passou com a mutação) OU falha de infra/asserção ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-readme-anchors.mjs"

TMP_DIR="$(mktemp -d)"

# ── Fonte da mensagem: main() em scripts/check-readme-anchors.mjs:
#   `   - docs/api.md:5 [forward] [Seção X]: '#seção-x'`
# ⚠️ Source-coupled: se a linha de output do guard for reformulada, atualize
# o EXPECTED_FAILURE junto (não é guard cego — é o acoplamento esperado).
EXPECTED_FAILURE="[forward] [Seção X]: '#seção-x'"
EXPECTED_FILE="docs/api.md"

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

# ── Fixture (docs/ PRESENTE — o que o mutation test dos anchors não cobria) ─
build_fixture() {
  rm -rf "$TMP_DIR"
  mkdir -p "$TMP_DIR/docs"

  cat > "$TMP_DIR/README.md" <<'EOF'
# Severinno

## Encoding Guards

- [CRLF Guard](#crlf-guard)

### CRLF Guard
EOF

  cat > "$TMP_DIR/docs/api.md" <<'EOF'
# API

## Seção X

- [Seção X](#seção-x)
EOF
}

# ── Helpers ───────────────────────────────────────────────────────────────

# assert_control_pass: roda o guard (scan default — SEM target) no fixture e
# valida exit 0 E que o docs foi escaneado (nome listado no relatório).
assert_control_pass() {
  info "Controle — fixture limpo (README + docs/api.md) → guard deve PASS (exit 0)..."
  set +e
  local out exit_code
  out="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
  exit_code=$?
  set -e
  if [ "$exit_code" -ne 0 ]; then
    fail "CONTROLE FALHOU: guard rejeitou o fixture LIMPO (exit $exit_code)."
    echo "$out" | tail -8
    fail "O fixture base não é válido — o mutation test não pode prosseguir."
    exit 1
  fi
  if ! echo "$out" | grep -Fq "$EXPECTED_FILE"; then
    fail "CONTROLE FALHOU: o relatório não lista '$EXPECTED_FILE' — o scan default"
    fail "não está descobrindo docs/ (discoverDocTargets quebrado?) — o cenário"
    fail "não provaria cobertura de docs."
    exit 1
  fi
  pass "Controle OK — fixture limpo passa no guard (exit 0) e lista '$EXPECTED_FILE'"
}

# assert_mutation_fail: roda o guard no fixture MUTADO e valida que FALHOU
# (exit 1) PELA asserção esperada apontando o arquivo docs.
assert_mutation_fail() {
  info "Rodando guard contra o fixture MUTADO (heading renomeado em docs/api.md)..."
  set +e
  local out exit_code
  out="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
  exit_code=$?
  set -e

  echo "$out" | tail -12

  # Caso 0 — guard CEGO: PASS com a mutação. O scan de docs/*.md
  # (discoverDocTargets) ou a checagem de âncoras foi removida/enfraquecida.
  if [ "$exit_code" -eq 0 ]; then
    fail "GUARD CEGO: check-readme-anchors passou com âncora quebrada em docs/api.md (exit 0)."
    fail "Verifique se o scan default ainda descobre docs/*.md e valida as âncoras."
    exit 1
  fi

  # Caso 1 — falhou, mas NÃO pela asserção esperada (outro invariante quebrou).
  if ! echo "$out" | grep -Fq "$EXPECTED_FAILURE"; then
    fail "Guard falhou (exit $exit_code) mas NÃO pela asserção esperada:"
    fail "  esperava:  $EXPECTED_FAILURE"
    fail "Falha pode ser outro invariante do fixture — veja o output acima."
    exit 1
  fi

  # Caso 2 — a violação não aponta para o arquivo docs (o guard acusou o
  # README em vez do docs — cobertura de docs não é o que estamos provando).
  if ! echo "$out" | grep -Fq "$EXPECTED_FILE"; then
    fail "Violação não aponta para '$EXPECTED_FILE':"
    fail "  esperava:  linha contendo '$EXPECTED_FILE'"
    fail "A cobertura de docs não está ativa — veja o output acima."
    exit 1
  fi

  pass "Mutação DETECTADA: guard falhou com '❌ $EXPECTED_FAILURE' em '$EXPECTED_FILE' (exit $exit_code)"
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (âncora quebrada em docs/*.md)"
echo "   Cenário: heading renomeado em docs/api.md sem atualizar o link"
echo "   (cobertura de docs no scan default — discoverDocTargets)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# CONTROLE — fixture limpo (docs/ presente) → guard PASS (exit 0) E lista o
# docs no relatório (prova que o scan default descobriu docs/api.md)
# ═════════════════════════════════════════════════════════════════════════

info "Criando fixture (README.md + docs/api.md com link interno)..."
build_fixture
pass "Fixture criado ($TMP_DIR/README.md + $TMP_DIR/docs/api.md)"

assert_control_pass

# ═════════════════════════════════════════════════════════════════════════
# MUTAÇÃO — heading renomeado em docs/api.md SEM atualizar o link interno:
# o slug 'seção-x' deixa de existir no docs → link quebrado NO ARQUIVO DOCS
# ═════════════════════════════════════════════════════════════════════════

info "Aplicando mutação: renomeia '## Seção X' → '## Seção Y' em docs/api.md..."
# Renomeia o heading SEM tocar no link `- [Seção X](#seção-x)` — o slug
# 'seção-x' deixa de existir no docs e o link interno do docs quebra. Padrão
# sem parênteses (portabilidade BRE GNU/MSYS — mesmo truque do toc).
sed -i 's/^## Seção X$/## Seção Y/' "$TMP_DIR/docs/api.md"

# Fail-fast: heading renomeado presente + original sumiu + link intacto.
if grep -Fq "## Seção Y" "$TMP_DIR/docs/api.md" \
  && ! grep -Fq "## Seção X" "$TMP_DIR/docs/api.md" \
  && grep -Fq -- "- [Seção X](#seção-x)" "$TMP_DIR/docs/api.md"; then
  pass "Mutação aplicada: heading renomeado em docs/api.md, link interno intacto"
else
  fail "Mutação não aplicou (sed falhou?)."
  exit 1
fi

assert_mutation_fail

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard de âncoras cobre docs/*.md no scan default:"
pass "  • heading renomeado em docs/api.md → exit 1 com '❌ $EXPECTED_FILE [forward]'"
pass "  • o relatório lista '$EXPECTED_FILE' (discoverDocTargets ativo no fixture)"
exit 0
