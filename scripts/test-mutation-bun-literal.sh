#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-bun-literal.sh — Mutation test do guard check-bun-mirror
#
# Prova que o scripts/check-bun-mirror.mjs REALMENTE pega regressões de drift:
# num repo FIXTURE temporário, primeiro confirma que o guard PASS com a
# chamada do setup correta (${{ vars.BUN_VERSION }}), depois MUTA o mesmo
# workflow para passar a versão LITERAL (1.3.14) no argumento e exige que o
# guard FALHE (exit 1) pela asserção certa. Se o guard passar com o literal
# (exit 0), ele está CEGO — uma checagem foi removida ou enfraquecida — e o
# script falha (exit 1), bloqueando o CI.
#
# Mutação aplicada (workflow temporário fake.yml):
#   run: bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}"  →  ... "1.3.14"
# O checkSetupBunRunLine do guard é o que detecta (o ARGUMENTO da chamada com
# versão literal é o call site agora — o input `bun-version:` do composite
# deixou de existir). Tudo o mais (mirror, script do setup, .actrc, Dockerfiles)
# permanece VÁLIDO — a falha é EXATAMENTE a asserção do literal, sem cascata.
#
# DIFERENÇA vs mutation-seed-dev-e2e: aqui o fixture é criado do zero num
# mktemp (o guard é node-puro, sem docker/prisma), e há um passo de CONTROLE
# (fixture limpo passa) — provando que a falha vem da mutação, não de um
# fixture quebrado. O script não toca NENHUM arquivo do repositório real.
#
# Pipeline:
#   1. Cria repo fixture temporário (mirror + script do setup + Dockerfile + .actrc)
#   2. CONTROLE: fake.yml com ${{ vars.BUN_VERSION }} → guard deve PASS (exit 0)
#   3. MUTAÇÃO: reescreve fake.yml com a versão 1.3.14 literal no argumento
#   4. Guard contra o fixture MUTADO (captura exit)
#   5. Verificar que o guard FALHOU com a asserção esperada (mutation detected)
#   6. Cleanup (trap EXIT — rm -rf do temp)
#
# Usage:
#   ./scripts/test-mutation-bun-literal.sh
#
# Exit codes:
#   0 — mutação DETECTADA pelo guard (falhou pela asserção esperada) ✅
#   1 — guard CEGO (passou com literal) OU falha de infra/asserção ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-bun-mirror.mjs"

# A versão do FIXTURE vem do ESPELHO do repositório (.actrc), não de um literal:
# este script ESCREVE a versão em repos temporários e a cita na asserção, então
# um literal aqui envelhece em silêncio (depois do bump o mutation test passaria
# a injetar/esperar uma versão que o repositório não declara). Fail-closed: sem
# a linha no .actrc o script PARA em vez de inventar uma reserva.
FIXTURE_VERSION="$(sed -n 's/^--var BUN_VERSION=//p' "$SCRIPT_DIR/.actrc" 2>/dev/null | head -1 || true)"
if [ -z "$FIXTURE_VERSION" ]; then
  echo "❌ .actrc não declara '--var BUN_VERSION=' — o fixture precisa de uma versão DECLARADA" >&2
  echo "   (um literal de reserva aqui envelheceria e o mutation test testaria outra versão)." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"

# ── Mutação (bug conhecido) ───────────────────────────────────────────────
# A chamada correta usa a fonte única; a mutação é o LITERAL da versão.
# Asserção que o guard DEVE emitir quando detecta a mutação. Fonte:
# checkSetupBunRunLine em scripts/check-bun-mirror.mjs.
EXPECTED_FAILURE="com versão '$FIXTURE_VERSION'"

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
  # Cópia mutada do guard (STEP 6) — nunca o arquivo real, e sem resíduo.
  rm -f "$SCRIPT_DIR/scripts/.tmp-mutation-guard.mjs"
}
trap cleanup EXIT

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-bun-mirror deve FALHAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1 — Cria o repo fixture temporário (VÁLIDO: mirror + action + .actrc)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando repo fixture temporário em $TMP_DIR..."

mkdir -p "$TMP_DIR/.github/workflows" "$TMP_DIR/scripts" "$TMP_DIR/mini-services/realtime"

# Mirror workflow válido (env.BUN_VERSION = ${{ vars.BUN_VERSION }} — fonte única)
cat > "$TMP_DIR/.github/workflows/sync-bun-mirror.yml" <<'EOF'
name: Sync Bun Mirror
env:
  BUN_VERSION: ${{ vars.BUN_VERSION }}
jobs:
  mirror:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
EOF

# Script do setup válido (lê o ARGUMENTO, puxa do mirror OCI, mantém o
# marcador tier-1 e não tem versão literal)
cat > "$TMP_DIR/scripts/setup-bun-ci.sh" <<'EOF'
set -euo pipefail
VERSION="${1:-}"
if command -v bun >/dev/null 2>&1; then
  echo "✅ Usando Bun pré-instalado: ${FOUND} (0s, sem download)"
  exit 0
fi
MIRROR="ghcr.io/${GHCR_OWNER}/bun:${BUN_VERSION}"
docker pull "$MIRROR"
EOF

printf 'FROM scratch\nCOPY bun /bun\n' > "$TMP_DIR/Dockerfile.bun-mirror"

# Invariante 13: TODOS os Dockerfiles da lista DOCKERFILES devem existir e
# usar o padrão ARG (sem literal) — senão o checkDockerfiles falha por motivo
# ALHEIO à mutação (o CONTROLE exigiria exit 0 num fixture incompleto).
cat > "$TMP_DIR/Dockerfile" <<'EOF'
ARG BUN_VERSION
FROM node:22-alpine
RUN npm install -g bun@${BUN_VERSION}
EOF
cat > "$TMP_DIR/Dockerfile.worker" <<'EOF'
ARG BUN_VERSION
FROM oven/bun:${BUN_VERSION}
EOF
cat > "$TMP_DIR/Dockerfile.ubuntu-bun" <<'EOF'
ARG BUN_VERSION
RUN curl -fsSL -o /tmp/bun.zip \
  "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip"
EOF
cat > "$TMP_DIR/mini-services/realtime/Dockerfile" <<'EOF'
ARG BUN_VERSION
FROM oven/bun:${BUN_VERSION}
EOF
printf -- '--var BUN_VERSION=%s\n' "$FIXTURE_VERSION" > "$TMP_DIR/.actrc"

pass "Fixture criado (mirror + script do setup + Dockerfile + .actrc)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 2 — CONTROLE: fake.yml com a fonte única → guard deve PASS (exit 0)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 2: Controle — chamada correta (setup-bun-ci.sh com \${{ vars.BUN_VERSION }})..."

cat > "$TMP_DIR/.github/workflows/fake.yml" <<'EOF'
name: Fake
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Setup Bun
        shell: bash
        run: bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}"
EOF

set +e
CONTROL_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
CONTROL_EXIT=$?
set -e

if [ "$CONTROL_EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: guard rejeitou o fixture LIMPO (exit $CONTROL_EXIT)."
  echo "$CONTROL_OUTPUT" | tail -15
  fail "O fixture base não é válido — o mutation test não pode prosseguir."
  exit 1
fi
pass "Controle OK — fixture limpo passa no guard (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3 — MUTAÇÃO: reescreve fake.yml com a versão 1.3.14 LITERAL no argumento
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação (versão 1.3.14 literal no argumento)..."

# Heredoc SEM quotes: a versão do fixture é DERIVADA (ver o topo) e precisa
# expandir aqui. A mutação é o LITERAL no argumento do setup — o valor vem do
# espelho, a literalidade é o próprio defeito injetado.
cat > "$TMP_DIR/.github/workflows/fake.yml" <<EOF
name: Fake
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Setup Bun
        shell: bash
        run: bash scripts/setup-bun-ci.sh "$FIXTURE_VERSION"
EOF

pass "Mutação aplicada: a chamada do setup passa a versão $FIXTURE_VERSION literal"

# ═════════════════════════════════════════════════════════════════════════
# STEP 4 — Guard contra o fixture MUTADO (deve FALHAR)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 4: Rodando guard contra o fixture MUTADO..."

set +e
GUARD_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
GUARD_EXIT=$?
set -e

echo "$GUARD_OUTPUT" | tail -12

# ═════════════════════════════════════════════════════════════════════════
# STEP 5 — Verificar que o guard DETECTOU a mutação
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Verificando que o guard detectou a mutação..."

# Caso 1 — guard CEGO: PASS com o literal. Uma checagem foi removida/
# enfraquecida (o argumento da chamada ou o scan de literais). Este é o
# cenário que o mutation test existe para BLOQUEAR.
if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "GUARD CEGO: check-bun-mirror passou com a versão literal (exit 0)."
  fail "A mutação (argumento '1.3.14' na chamada do setup) não foi detectada —"
  fail "verifique se uma checagem foi removida/enfraquecida em scripts/check-bun-mirror.mjs"
  fail "(checkSetupBunRunLine / checkLiteralBunLine / checkNoLiteralBunVersion)."
  exit 1
fi

# Caso 2 — falhou, mas NÃO pela asserção esperada (outro invariante quebrou,
# não o literal). Não dá para confirmar que o guard pega ESTA regressão.
if ! grep -Fq "$EXPECTED_FAILURE" <<<"$GUARD_OUTPUT"; then
  fail "Guard falhou (exit $GUARD_EXIT) mas NÃO pela asserção esperada:"
  fail "  esperava:  $EXPECTED_FAILURE"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi

# Caso 3 — ✅ mutação detectada: guard falhou com a mensagem do literal.
pass "Mutação DETECTADA: guard falhou com '❌ $EXPECTED_FAILURE' (exit $GUARD_EXIT)"
pass "O guard check-bun-mirror está sensível a regressões de drift."

# ═════════════════════════════════════════════════════════════════════════
# STEP 6 — M3: a varredura dos SCRIPTS (invariante 15) é load-bearing?
# ═════════════════════════════════════════════════════════════════════════
#
# A classe que a auditoria de espelhos abriu: o literal num SCRIPT não aparece
# em nenhum diff de workflow, e o script CONTINUA FUNCIONANDO com a versão
# antiga (é o defeito que não fica vermelho sozinho). Aqui a prova é dupla:
#
#   - CONTROLE: o fixture (limpo do literal de workflow) + UM script com
#     literal → o guard REPROVA, nomeando o arquivo;
#   - M3: tirando a CHAMADA da invariante numa cópia do guard, o MESMO fixture
#     passa (exit 0) — e o literal de workflow do STEP 3 continua sendo pego na
#     mesma cópia (a mutação é cirúrgica: cega uma metade, não as outras).

info "STEP 6: M3 — a invariante 15 (literal num script) é load-bearing?"

# Devolve o workflow do STEP 3 à forma correta: o fixture do M3 tem de ter UM
# defeito só (o script), senão não dá para atribuir o veredito à metade certa.
cat > "$TMP_DIR/.github/workflows/fake.yml" <<EOF
name: Fake
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Setup Bun
        shell: bash
        run: bash scripts/setup-bun-ci.sh "\${{ vars.BUN_VERSION }}"
EOF
mkdir -p "$TMP_DIR/scripts"
# Heredoc SEM quotes: o literal injetado é o valor DERIVADO do espelho (o
# fixture é o defeito, não a versão). O script-fonte não crava número nenhum.
cat > "$TMP_DIR/scripts/com-literal.sh" <<SH
set -eu
VERSION="\${BUN_VERSION:-$FIXTURE_VERSION}"
SH

set +e
M3_CTRL_OUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
M3_CTRL_EXIT=$?
set -e

if [ "$M3_CTRL_EXIT" -eq 0 ]; then
  fail "CONTROLE M3: o guard passou com um SCRIPT carregando literal (exit 0) —"
  fail "a invariante 15 não está julgando os scripts."
  exit 1
fi
if ! grep -q "scripts/com-literal.sh" <<<"$M3_CTRL_OUT"; then
  fail "o guard reprovou (exit $M3_CTRL_EXIT) mas SEM nomear o script — a violação"
  fail "pode ser outro invariante do fixture. Veja o output:"
  echo "$M3_CTRL_OUT" | tail -8
  exit 1
fi
pass "Controle M3 OK — o guard reprova o literal num script (exit $M3_CTRL_EXIT)"

# ── A mutação: uma CÓPIA do guard sem a chamada da invariante 15 ──────────
# Cópia em `scripts/` (não na temp): os imports relativos do guard
# (`./bun-version.mjs`, `./forge-workflows.mjs`) precisam resolver do lado dele.
MUT_GUARD="$SCRIPT_DIR/scripts/.tmp-mutation-guard.mjs"
sed 's|violations.push(\.\.\.checkScriptLiterals(cwd))|void 0 // M3: invariante 15 removida|' \
  "$GUARD" > "$MUT_GUARD"
if cmp -s "$GUARD" "$MUT_GUARD"; then
  fail "A mutação M3 NÃO se aplicou (a chamada mudou de forma?) — renomeie o alvo do sed."
  exit 1
fi

set +e
M3_OUT="$(cd "$TMP_DIR" && node "$MUT_GUARD" 2>&1)"
M3_EXIT=$?
set -e

rm -f "$MUT_GUARD"

if [ "$M3_EXIT" -ne 0 ]; then
  fail "A mutação M3 NÃO cegou o guard (exit $M3_EXIT) — o veredito não mudou com a"
  fail "chamada removida: a varredura dos scripts não é a que reprova (mecanismo decorativo)."
  echo "$M3_OUT" | tail -8
  exit 1
fi
pass "M3 DETECTADA: sem a chamada, o script com literal passa (exit 0) — varredura load-bearing"

# ── Cirúrgica: a metade dos WORKFLOWS continua mordendo na cópia mutada ──
# (o literal de workflow do STEP 3 volta ao fixture e tem de ser pego mesmo na
# cópia sem a invariante 15).
cat > "$TMP_DIR/scripts/com-literal.sh" <<'SH'
set -eu
SH
sed 's|violations.push(\.\.\.checkScriptLiterals(cwd))|void 0 // M3|' "$GUARD" > "$MUT_GUARD"
cat > "$TMP_DIR/.github/workflows/fake.yml" <<EOF
name: Fake
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Setup Bun
        shell: bash
        run: bash scripts/setup-bun-ci.sh "$FIXTURE_VERSION"
EOF
set +e
M3_SURG_OUT="$(cd "$TMP_DIR" && node "$MUT_GUARD" 2>&1)"
M3_SURG_EXIT=$?
set -e
rm -f "$MUT_GUARD"
if [ "$M3_SURG_EXIT" -eq 0 ]; then
  fail "A mutação da invariante 15 também cegou a metade dos WORKFLOWS — ela não é cirúrgica."
  exit 1
fi
pass "Mutação CIRÚRGICA — o literal de workflow segue reprovado na cópia mutada"
if [ -f "$MUT_GUARD" ]; then
  fail "resíduo: a cópia mutada do guard ficou em disco."
  exit 1
fi
pass "Sem resíduo — o guard real do repositório nunca foi tocado"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard do Bun pega regressões de drift"
exit 0
