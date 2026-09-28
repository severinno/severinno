#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-no-leaked-imports.sh — Mutation test do guard de
# RESOLUÇÃO DE IMPORTS (check-no-leaked-imports.mjs)
#
# Prova que o scripts/check-no-leaked-imports.mjs REALMENTE detecta a
# regressão que ele existe para bloquear: um import de dep NÃO DECLARADA que
# resolve no node_modules do PROJETO PAI (worktree aninhado) — o bug real do
# `z-ai-web-dev-sdk` (importado em src/app/api/chat/route.ts sem estar no
# package.json; o tsc local resolvia no node_modules do pai e mascarava o
# erro que o CI limpo pegaria como TS2307).
#
#   Cenário A (LEAK do pai):   dep importada SEM declarar e SEM node_modules
#                              local, mas o PAI tem o pacote — o require.resolve
#                              sobe a árvore e resolve no pai = LEAK; o guard
#                              DEVE FALHAR (exit 1) citando a dep.
#   Cenário B (UNDECLARED):    dep importada SEM declarar e SEM resolver em
#                              LUGAR NENHUM — o guard DEVE FALHAR (exit 1)
#                              citando a dep (o tsc do CI limpo falharia TS2307).
#   Cenário C (pending-install): dep DECLARADA mas não instalada — o guard DEVE
#                              PASSAR (exit 0) com aviso de bun install (não é
#                              leak — é install pendente).
#
# E o CONTROLE: o mesmo fixture com a dep declarada E instalada no node_modules
# local passa (exit 0) — provando que a falha vem da MUTAÇÃO, não de um
# fixture quebrado.
#
# DIFERENÇA vs mutation-unused-deps: o fixture é um mini-repo com PAI e FILHO
# (worktree aninhado), reproduzindo exatamente a topologia do leak real. O
# guard roda com --root no filho. O script não toca NENHUM arquivo do repo.
#
# Pipeline:
#   1. Cria parent/ + child/ (worktree aninhado) + child/package.json
#      (dep lodash declarada e instalada localmente) + child/src/index.ts
#   2. CONTROLE: import de dep local instalada → guard exit 0
#   3. MUTAÇÃO A: import de dep que resolve SÓ no node_modules do PAI →
#      guard DEVE FALHAR (exit 1) citando a dep
#   4. MUTAÇÃO B: import de dep inexistente em lugar nenhum → guard DEVE
#      FALHAR (exit 1) citando a dep
#   5. CENÁRIO C: dep declarada mas não instalada → guard DEVE PASSAR (exit 0)
#      com aviso de bun install
#   6. Cleanup (trap EXIT — rm -rf do temp)
#
# Usage:
#   ./scripts/test-mutation-no-leaked-imports.sh
#
# Exit codes:
#   0 — mutações DETECTADAS pelo guard (falhou pelas asserções esperadas) ✅
#   1 — guard CEGO (passou com a mutação) OU infra ❌
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

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'A|import de dep que resolve SÓ no node_modules do PAI (worktree aninhado)'
  'B|import de dep inexistente em lugar nenhum'
  'C|dep DECLARADA com install pendente PASSA (o controle da classe)'
)
GUARD="$SCRIPT_DIR/scripts/check-no-leaked-imports.mjs"

TMP_DIR="$(mktemp -d "$MUT_SCRATCH/mut-XXXXXX")"
PARENT="$TMP_DIR/parent"
CHILD="$PARENT/worktree"   # worktree aninhado no pai (topologia do leak real)
PKG="$CHILD/package.json"
SRC="$CHILD/src/index.ts"

EXPECTED_LEAK="z-ai-web-dev-sdk"
EXPECTED_UNDECLARED="is-odd"

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

# ── build_pkg: (re)escreve o package.json do FILHO (worktree) ────────────
build_pkg() {
  cat > "$PKG" <<'EOF'
{
  "scripts": {},
  "dependencies": {
    "lodash": "^4.17.0"
  }
}
EOF
}

# ── build_src: (re)escreve o src/index.ts do FILHO ───────────────────────
build_src() {
  mkdir -p "$CHILD/src"
  cat > "$SRC" <<'EOF'
import lodash from "lodash"
console.log(lodash)
EOF
}

# ── run_guard: roda o guard no FILHO (--root) ─────────────────────────────
run_guard() {
  set +e
  OUTPUT="$(node "$GUARD" --root "$CHILD" 2>&1)"
  EXIT=$?
  set -e
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-no-leaked-imports deve GATEAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Fixture (PAI + FILHO worktree) + CONTROLE (dep local → exit 0)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando fixture em $TMP_DIR (parent/ + worktree/ aninhado)..."
mkdir -p "$PARENT" "$CHILD"
build_pkg
build_src
# node_modules LOCAL do filho com lodash real (resolve dentro do worktree)
mkdir -p "$CHILD/node_modules/lodash"
cat > "$CHILD/node_modules/lodash/package.json" <<'EOF'
{ "name": "lodash", "main": "index.js", "version": "4.17.21" }
EOF
echo "module.exports = {}" > "$CHILD/node_modules/lodash/index.js"

# node_modules do PAI com o pacote do leak (o bug do z-ai)
mkdir -p "$PARENT/node_modules/$EXPECTED_LEAK"
cat > "$PARENT/node_modules/$EXPECTED_LEAK/package.json" <<EOF
{ "name": "$EXPECTED_LEAK", "main": "index.js", "version": "0.0.18" }
EOF
echo "module.exports = {}" > "$PARENT/node_modules/$EXPECTED_LEAK/index.js"

info "STEP 2: Controle — import de dep local instalada; guard deve PASS (exit 0)..."
run_guard
if [ "$EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: guard rejeitou o fixture LIMPO (exit $EXIT)."
  echo "$OUTPUT" | tail -10
  fail "O fixture base não é válido — o mutation test não pode prosseguir."
  exit 1
fi
pass "Controle OK — fixture limpo passa no guard (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3+4 — MUTAÇÃO A (LEAK: resolve só no node_modules do PAI): deve FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação A — import de dep NÃO declarada que resolve"
info "        SÓ no node_modules do PAI ($EXPECTED_LEAK)..."
cat > "$SRC" <<EOF
import { zai } from "$EXPECTED_LEAK"
console.log(zai)
EOF

info "STEP 4: Rodando guard contra a mutação A (leak do pai)..."
run_guard
echo "$OUTPUT" | tail -8

# Caso 1 — guard CEGO: PASS com a mutação.
if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (leak $EXPECTED_LEAK): check-no-leaked-imports passou com"
  fail "import resolvendo no node_modules do PAI (exit 0). O guard não está"
  fail "verificando a FRONTEIRA de resolução — o bug do z-ai passaria."
  exit 1
fi

# Caso 2 — falhou, mas NÃO citou a dep vazada esperada.
if ! grep -Fq "$EXPECTED_LEAK" <<< "$OUTPUT"; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou a dep vazada esperada:"
  fail "  esperava (dep): $EXPECTED_LEAK"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi
pass "Mutação A DETECTADA: guard falhou citando $EXPECTED_LEAK (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — MUTAÇÃO B (UNDECLARED: não resolve em LUGAR NENHUM): deve FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Aplicando mutação B — import de dep inexistente em lugar"
info "        nenhum ($EXPECTED_UNDECLARED)..."
cat > "$SRC" <<EOF
import isOdd from "$EXPECTED_UNDECLARED"
console.log(isOdd(3))
EOF

info "STEP 6: Rodando guard contra a mutação B (undeclared)..."
run_guard
echo "$OUTPUT" | tail -8

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (undeclared): check-no-leaked-imports passou com import de"
  fail "dep que NÃO resolve em lugar nenhum (exit 0). Dep inexistente não é"
  fail "acusada — o CI limpo falharia TS2307 e o guard não pega."
  exit 1
fi

if ! grep -Fq "$EXPECTED_UNDECLARED" <<< "$OUTPUT"; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou a dep $EXPECTED_UNDECLARED."
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi
pass "Mutação B DETECTADA: guard falhou citando $EXPECTED_UNDECLARED (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 7+8 — CENÁRIO C (pending-install): declarada mas não instalada → PASS
# ═════════════════════════════════════════════════════════════════════════

info "STEP 7: Cenário C — dep DECLARADA no package.json mas SEM node_modules..."
# o src importa lodash (instalada → ok) E chalk (declarada, não instalada →
# pending-install); reescreve o package.json INTEIRO (não append: `cat >>`
# após a chave de fechamento produziria JSON inválido (`}` + `,"chalk"...`),
# o que quebraria o require.resolve do Node (ERR_INVALID_PACKAGE_CONFIG) e o
# JSON.parse do findDeclaringPackageJson — falso "undeclared" em vez de
# pending-install.
cat > "$SRC" <<'EOF'
import lodash from "lodash"
import chalk from "chalk"
console.log(lodash, chalk)
EOF
cat > "$PKG" <<'EOF'
{
  "scripts": {},
  "dependencies": {
    "lodash": "^4.17.0",
    "chalk": "^5.0.0"
  }
}
EOF

info "STEP 8: Rodando guard contra o cenário C (install pendente)..."
run_guard
echo "$OUTPUT" | tail -6

# O guard NÃO deve falhar (não é leak) — mas deve AVISAR o bun install.
if [ "$EXIT" -ne 0 ]; then
  fail "Cenário C FALHOU: guard rejeitou dep DECLARADA com install pendente"
  fail "(exit $EXIT). Dep declarada sem instalar NÃO é leak — o guard deve"
  fail "passar orientando o bun install (falso positivo)."
  echo "$OUTPUT" | tail -10
  exit 1
fi

if ! grep -Fiq "bun install" <<< "$OUTPUT"; then
  fail "Cenário C passou (exit 0) mas NÃO orientou o bun install na mensagem."
  fail "  esperava: menção a 'bun install'"
  echo "$OUTPUT" | tail -6
  exit 1
fi
pass "Cenário C OK: dep declarada + install pendente passa (exit 0) com aviso bun install"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard de imports pega o leak do node_modules"
pass "do pai (exit 1), pega dep inexistente (exit 1) e passa com dep"
pass "declarada + install pendente (exit 0)"
exit 0
