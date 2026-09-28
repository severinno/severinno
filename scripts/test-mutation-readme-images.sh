#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-readme-images.sh — Mutation test do guard de imagens
# do README (check-readme-images.mjs)
#
# Prova que o scripts/check-readme-images.mjs pega as DUAS classes de
# regressão que o guard existe para bloquear:
#
#   Cenário 1 (COUNT-PIN): remove um badge <img> do README do fixture. O
#     guard imprime o count de imagens DERIVADO da extração ao vivo
#     (`${imageCount} imagem(ns)`, espelhando a filosofia do check-e2e-counts:
#     count derivado, nunca literal — e o pin `expect(...).toBe(7)` do teste
#     unitário). Com a remoção, o count DEVE cair de '3' para '2' — se uma
#     regressão HARDCODAR o count (ou o regex de extração parar de ver o
#     <img>), o output continua '3' e o mutation test falha: count-pin
#     quebrado. O guard continua PASSANDO (exit 0 — remover imagem não é
#     imagem quebrada); o que o cenário valida é a DERIVAÇÃO do count.
#
#   Cenário 2 (EXISTÊNCIA): aponta um caminho relativo para arquivo
#     INEXISTENTE (public/logo.svg → public/sumiu.png). O guard DEVE FALHAR
#     (exit 1) com '[relative] 'public/sumiu.png': arquivo não existe'.
#     Se o guard PASSAR (exit 0), a checagem validateRelative foi removida/
#     enfraquecida — GUARD CEGO — e o script falha (exit 1), bloqueando o CI.
#
# DIFERENÇA vs os irmãos (toc/anchors): o guard de imagens valida contra o
# DISCO — o fixture materializa arquivos reais (public/logo.svg) no temp dir
# e referencia via caminho relativo (mesma semântica do GitHub). O script não
# toca NENHUM arquivo do repositório real.
#
# Pipeline:
#   1. Cria repo fixture temporário (README.md com 2 badges <img> + 1 img
#      markdown relativa → public/logo.svg materializado)
#   2. CONTROLE: fixture limpo → guard PASS (exit 0) + count-pin '3 imagem(ns)'
#   3. MUTAÇÃO 1 (count-pin): remove 1 badge <img> → guard PASS + count
#      DERIVADO '2 imagem(ns)' (se hardcoded '3' → falha)
#   4. Re-cria fixture limpo → MUTAÇÃO 2 (existência): reponta o src relativo
#      para public/sumiu.png → guard FALHA com 'arquivo não existe'
#   5. Cleanup (trap EXIT — rm -rf do temp)
#
# Usage:
#   ./scripts/test-mutation-readme-images.sh
#
# Exit codes:
#   0 — mutações DETECTADAS (count derivado + existência) ✅
#   1 — guard CEGO (passou com a mutação 2) OU count-pin quebrado OU falha
#       de infra/asserção ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# O SCRATCH DAS FIXTURES É ESTÁVEL E FORA DO `/tmp`: o `/tmp` é limpo por FORA e a
# rodada LONGA perdia fixture no meio da medição (o motivo inteiro, com as duas
# medições, está no cabeçalho do master). A raiz é a MESMA em toda rodada e NÃO
# fica DENTRO do repositório: uma fixture dentro de um repo muda de semântica —
# `node_modules`, o prettier e o git do projeto passam a alcançá-la (medido).
MUT_SCRATCH="${MUT_SCRATCH:-${XDG_CACHE_HOME:-$HOME/.cache}/severinno-mutacao}"
mkdir -p "$MUT_SCRATCH" 2>/dev/null || {
  echo "❌ o scratch das fixtures não pôde ser criado: $MUT_SCRATCH (infra declarada)" >&2
  exit 2
}
GUARD="$SCRIPT_DIR/scripts/check-readme-images.mjs"

TMP_DIR="$(mktemp -d "$MUT_SCRATCH/mut-XXXXXX")"

# ── Mutações (bugs conhecidos) ────────────────────────────────────────────
# Cenário 1: count-pin — o guard imprime o count DERIVADO da extração
#   (main() em scripts/check-readme-images.mjs):
#     '✅ Todas as imagens resolvem (...; ${imageCount} imagem(ns); ...)'
#   Com a remoção de um badge, o count DEVE cair 3 → 2.
# Cenário 2: asserção que o guard DEVE emitir ao apontar src relativo para
#   arquivo ausente. Fonte: main() em scripts/check-readme-images.mjs:
#     '   - <file>:<line> [<kind>] '<src>': <reason>'
#   onde reason = 'arquivo não existe: <resolved>'.
#
# ⚠️ Source-coupled: estas strings reproduzem a mensagem EXATA do guard. Se a
# mensagem for reformulada em scripts/check-readme-images.mjs, o mutation test
# falha com 'não pela asserção esperada' (não é guard cego — é o esperado por
# acoplamento; atualizar as duas juntas).
EXPECTED_FAILURE_EXISTENCE="'public/sumiu.png': arquivo não existe"

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

# ── build_fixture: (re)cria o repo fixture limpo ─────────────────────────
# Idempotente — usado no CONTROLE e na MUTAÇÃO 2 (que parte de um fixture
# limpo de novo, já que a MUTAÇÃO 1 sujou o README).
# README mínimo: 2 badges <img> (URLs válidas) + 1 imagem markdown relativa
# apontando para public/logo.svg MATERIALIZADO no disco (o guard valida
# caminhos relativos contra o dir do arquivo escaneado).
build_fixture() {
  rm -rf "$TMP_DIR"
  mkdir -p "$TMP_DIR/public"

  cat > "$TMP_DIR/public/logo.svg" <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="5" fill="#ccc"/></svg>
EOF

  cat > "$TMP_DIR/README.md" <<'EOF'
# Fixture

<img src="https://img.shields.io/badge/ci-passing-green" alt="CI">
<img src="https://img.shields.io/badge/coverage-90-brightgreen" alt="Coverage">

![logo](public/logo.svg)
EOF
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-readme-images)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Cria o fixture limpo e valida o CONTROLE (deve PASS)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando repo fixture temporário em $TMP_DIR..."

build_fixture
pass "Fixture criado (2 badges <img> + 1 img markdown → public/logo.svg real)"

info "STEP 2: Controle — fixture limpo → guard deve PASS (exit 0) com count-pin '3 imagem(ns)'..."

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

if ! grep -Fq "3 imagem(ns)" <<< "$CONTROL_OUTPUT"; then
  fail "COUNT-PIN no CONTROLE: guard não reportou '3 imagem(ns)' no fixture limpo:"
  echo "$CONTROL_OUTPUT" | tail -4
  exit 1
fi
pass "Count-pin OK — guard reportou '3 imagem(ns)' (derivado da extração)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3+4 — MUTAÇÃO 1 (count-pin): remover badge <img> deve mudar o count
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação 1 (remove 1 badge <img> — count deve cair para 2)..."

# Remove o badge de coverage — o guard continua PASSANDO (remover imagem não
# é imagem quebrada), mas o count DERIVADO deve cair de 3 para 2. Se o count
# fosse HARDCODADO (ou o regex de <img> quebrasse), o output seguiria '3' e
# o mutation test falha — provando que o count-pin é derivado, não literal.
sed -i '/coverage-90-brightgreen/d' "$TMP_DIR/README.md"

# Fail-fast: verifica que a mutação realmente aplicou (o badge sumiu e os
# outros 2 elementos continuam).
if ! grep -Fq "coverage-90-brightgreen" "$TMP_DIR/README.md" && grep -Fq "ci-passing-green" "$TMP_DIR/README.md" && grep -Fq "public/logo.svg" "$TMP_DIR/README.md"; then
  pass "Mutação 1 aplicada: badge coverage removido (restam 2 imagens)"
else
  fail "Mutação 1 não aplicou (sed falhou?)."
  exit 1
fi

info "STEP 4: Rodando guard contra o fixture MUTADO (count deve ser '2')..."
set +e
GUARD_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
GUARD_EXIT=$?
set -e

echo "$GUARD_OUTPUT" | tail -4

# Caso 1 — guard falhou com a mutação: remover imagem não pode virar
# violação (o guard valida existência, não presença).
if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "Guard FALHOU após remoção de badge (exit $GUARD_EXIT) — remover imagem"
  fail "não é imagem quebrada. Algo quebrou na extração/validação?"
  echo "$GUARD_OUTPUT" | tail -8
  exit 1
fi

# Caso 2 — COUNT-PIN QUEBRADO: o count não acompanhou a remoção (continua
# '3' = hardcoded ou extração cega do <img>). É o cenário que o mutation
# test existe para BLOQUEAR.
if grep -Fq "3 imagem(ns)" <<< "$GUARD_OUTPUT"; then
  fail "COUNT-PIN QUEBRADO: guard reportou '3 imagem(ns)' APÓS a remoção do"
  fail "badge <img> (exit 0). O count é hardcoded ou o regex de <img> deixou"
  fail "de extrair — o count precisa ser DERIVADO da extração ao vivo."
  exit 1
fi

if ! grep -Fq "2 imagem(ns)" <<< "$GUARD_OUTPUT"; then
  fail "COUNT-PIN INESPERADO: guard não reportou '2 imagem(ns)' após a remoção:"
  echo "$GUARD_OUTPUT" | tail -4
  exit 1
fi
pass "Mutação 1 DETECTADA: count derivado caiu '3 imagem(ns)' → '2 imagem(ns)' (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — MUTAÇÃO 2 (existência): src relativo para arquivo INEXISTENTE
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Re-criando fixture limpo e aplicando mutação 2 (src → sumiu.png)..."

build_fixture

# Reponta a imagem markdown para um arquivo que NÃO existe no disco — o
# validateRelative deve acusar 'arquivo não existe' e o guard FALHAR (exit 1).
sed -i 's/public\/logo.svg/public\/sumiu.png/' "$TMP_DIR/README.md"

# Fail-fast: verifica que a mutação realmente aplicou.
if grep -Fq "public/sumiu.png" "$TMP_DIR/README.md" && ! grep -Fq "public/logo.svg" "$TMP_DIR/README.md"; then
  pass "Mutação 2 aplicada: ![logo](public/logo.svg) → public/sumiu.png (inexistente)"
else
  fail "Mutação 2 não aplicou (sed falhou?)."
  exit 1
fi

info "STEP 6: Rodando guard contra o fixture MUTADO (deve FALHAR com 'arquivo não existe')..."
set +e
EXISTENCE_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
EXISTENCE_EXIT=$?
set -e

echo "$EXISTENCE_OUTPUT" | tail -8

# Caso 1 — guard CEGO: PASS com o src inexistente. A checagem de existência
# (validateRelative) foi removida/enfraquecida. BLOQUEIA.
if [ "$EXISTENCE_EXIT" -eq 0 ]; then
  fail "GUARD CEGO (existência): check-readme-images passou com src relativo"
  fail "apontando para arquivo INEXISTENTE (exit 0). Verifique se validateRelative"
  fail "ainda acusa 'arquivo não existe' em scripts/check-readme-images.mjs."
  exit 1
fi

# Caso 2 — falhou, mas NÃO pela asserção esperada (outro invariante quebrou).
if ! grep -Fq "$EXPECTED_FAILURE_EXISTENCE" <<< "$EXISTENCE_OUTPUT"; then
  fail "Guard falhou (exit $EXISTENCE_EXIT) mas NÃO pela asserção de existência esperada:"
  fail "  esperava:  $EXPECTED_FAILURE_EXISTENCE"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi

pass "Mutação 2 DETECTADA: guard falhou com '❌ $EXPECTED_FAILURE_EXISTENCE' (exit $EXISTENCE_EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard de imagens reporta count DERIVADO da extração"
pass "(badge removido → count cai) e pega caminho relativo para arquivo inexistente"
exit 0
