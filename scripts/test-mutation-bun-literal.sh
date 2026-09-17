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
#   1. Cria repo fixture temporário (mirror + script do setup + Dockerfile + .actrc + docs)
#   2. CONTROLE: fake.yml com ${{ vars.BUN_VERSION }} → guard deve PASS (exit 0)
#   3. MUTAÇÃO: reescreve fake.yml com a versão 1.3.14 literal no argumento
#   4. Guard contra o fixture MUTADO (captura exit)
#   5. Verificar que o guard FALHOU com a asserção esperada (mutation detected)
#   6. M3: a varredura dos SCRIPTS (invariante 15) — dupla (controle + cópia do
#      guard sem a chamada) e cirúrgica (a metade dos workflows segue mordendo)
#   7. M4: os EXEMPLOS DE VERSÃO na PROSA (invariante 17) — mesma dupla: o
#      README do fixture com um exemplo DESATUALIZADO reprova, e a cópia do
#      guard sem a chamada da prosa passa (a metade que mede a doc é load-bearing)
#   8. Cleanup (trap EXIT — rm -rf do temp)
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

# ── Invariante 17: a PROSA do fixture ────────────────────────────────────
# A varredura dos exemplos de versão em prosa precisa de duas coisas que o
# resto do fixture não tinha: (a) os docs CANÔNICOS (README + GUARDS.md, o piso
# de cobertura) e (b) um checkout GIT de verdade — a lista de fontes é
# `git ls-files '*.md'`, e sem git a varredura é `unjudgeable` (exit 2), nunca
# "nada a julgar". Os exemplos aqui são DERIVADOS do espelho: um literal neste
# script envelheceria e o mutation test passaria a injetar outra versão.
mkdir -p "$TMP_DIR/docs"
cat > "$TMP_DIR/README.md" <<MD
# Fixture

O setup passa a versão como ARGUMENTO: gh variable set BUN_VERSION $FIXTURE_VERSION
MD
cat > "$TMP_DIR/docs/GUARDS.md" <<MD
# Guards do fixture

Este guard é rodado com --expected $FIXTURE_VERSION (o atalho histórico da versão).
MD
git -C "$TMP_DIR" init -q
git -C "$TMP_DIR" add -A

pass "Fixture criado (mirror + script do setup + Dockerfile + .actrc + docs de prosa)"

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
# STEP 7 — M4: os EXEMPLOS DE VERSÃO na PROSA (invariante 17) mordem?
# ═════════════════════════════════════════════════════════════════════════
#
# A classe que sobrava depois das invariantes 15/16: o literal saiu do código,
# mas a DOC continua ensinando o comando com a versão antiga — e nada fica
# vermelho, porque doc não executa. Aqui a prova é a mesma dupla do M3: o fixture
# com UM exemplo desatualizado reprova nomeando o doc, e a CÓPIA do guard sem a
# chamada da varredura de prosa passa (é ela que reprova).

info "STEP 7: M4 — os exemplos de versão em PROSA são load-bearing?"

# Fixture de volta ao estado LIMPO (o defeito do M3 era outro): chamada correta
# no workflow e o script auxiliar sem literal.
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
cat > "$TMP_DIR/scripts/com-literal.sh" <<'SH'
set -eu
SH

set +e
M4_CTRL_OUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
M4_CTRL_EXIT=$?
set -e
if [ "$M4_CTRL_EXIT" -ne 0 ]; then
  fail "CONTROLE M4: o fixture LIMPO não passa (exit $M4_CTRL_EXIT) — a prosa do"
  fail "fixture já nasce divergente, e a mutação não seria atribuível:"
  echo "$M4_CTRL_OUT" | tail -8
  exit 1
fi
pass "Controle M4 OK — a prosa do fixture (exemplos = valor do espelho) passa"

# ── A mutação: o README passa a citar uma versão que não é a vigente ──────
# O valor injetado NÃO é um literal do Bun do repositório (é um valor falso do
# fixture): se este script cravasse a versão real, ele envelheceria no bump.
STALE_VERSION="0.0.0"
cat > "$TMP_DIR/README.md" <<MD
# Fixture

O setup passa a versão como ARGUMENTO: gh variable set BUN_VERSION $STALE_VERSION
MD

git -C "$TMP_DIR" add -A 2>/dev/null || true

set +e
M4_OUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
M4_EXIT=$?
set -e

if [ "$M4_EXIT" -eq 0 ]; then
  fail "M4 NÃO DETECTADA: o guard passou com um exemplo de versão DESATUALIZADO no"
  fail "README do fixture (exit 0) — a invariante 17 não está julgando a prosa."
  exit 1
fi
if ! grep -q "README.md" <<<"$M4_OUT" || ! grep -q "exemplo de versão desatualizado" <<<"$M4_OUT"; then
  fail "o guard reprovou (exit $M4_EXIT) mas SEM nomear o README como exemplo"
  fail "desatualizado — a falha é de outro invariante do fixture. Veja o output:"
  echo "$M4_OUT" | tail -8
  exit 1
fi
pass "M4 DETECTADA: o exemplo desatualizado no README reprova o guard (exit $M4_EXIT)"

# ── A cópia sem a chamada da invariante 17 (o fixture segue mutado) ───────
sed 's|violations.push(\.\.\.prosa.violations)|void 0 // M4: invariante 17 removida|' \
  "$GUARD" > "$MUT_GUARD"
if cmp -s "$GUARD" "$MUT_GUARD"; then
  fail "A mutação M4 NÃO se aplicou (a chamada da prosa mudou de forma?) — renomeie o alvo do sed."
  exit 1
fi
set +e
M4_SURG_OUT="$(cd "$TMP_DIR" && node "$MUT_GUARD" 2>&1)"
M4_SURG_EXIT=$?
set -e
rm -f "$MUT_GUARD"
if [ "$M4_SURG_EXIT" -ne 0 ]; then
  fail "A mutação M4 NÃO cegou o guard (exit $M4_SURG_EXIT) — o veredito não mudou"
  fail "com a chamada removida: a varredura da prosa não é a que reprova."
  echo "$M4_SURG_OUT" | tail -8
  exit 1
fi
pass "M4 CIRÚRGICA: sem a chamada, o mesmo exemplo desatualizado passa (exit 0)"

# ── E o guard REAL segue reprovando o workflow literal (cirúrgica, inversa) ─
sed 's|violations.push(\.\.\.prosa.violations)|void 0 // M4|' "$GUARD" > "$MUT_GUARD"
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
M4_SURG2_OUT="$(cd "$TMP_DIR" && node "$MUT_GUARD" 2>&1)"
M4_SURG2_EXIT=$?
set -e
rm -f "$MUT_GUARD"
if [ "$M4_SURG2_EXIT" -eq 0 ]; then
  fail "A mutação da invariante 17 também cegou a metade do WORKFLOW — não é cirúrgica."
  exit 1
fi
pass "Mutação CIRÚRGICA — o literal do workflow segue reprovado na cópia mutada"
if [ -f "$MUT_GUARD" ]; then
  fail "resíduo: a cópia mutada do guard ficou em disco."
  exit 1
fi

# ═════════════════════════════════════════════════════════════════════════
# STEP 7 — M5: a CADEIA DE BUILD (invariante 18) é load-bearing?
# ═════════════════════════════════════════════════════════════════════════
#
# O caso que originou a regra: um serviço de compose BUILD AVA o Dockerfile
# SEM passar o arg e herdava o default do arquivo — um valor escrito em lugar
# NENHUM da cadeia de deploy, e que nenhuma das varreduras 13/15/16 tinha o que
# julgar (não havia valor no build site para julgar).
#
# Quatro metades, todas no fixture:
#   M5a o default do ARG volta (`ARG BUN_VERSION=<v>`);
#   M5b o build site NÃO passa o arg (o defeito original);
#   M5c o `packageManager` diz OUTRA versão;
#   M5d o default volta EMBUTIDO na referência (`\${BUN_VERSION:-<v>}`).
# A cópia do guard com as QUATRO linhas neutralizadas passa com as quatro em
# disco (cada metade responde pelo próprio veredito), e o recorte `--staged`
# (o pre-commit) pega o M5b — é no COMMIT que o build site nasce.

info "STEP 7: M5 — a cadeia de build (invariante 18) é load-bearing?"

# O fixture chega aqui com os defeitos do M4 em disco (o literal do workflow e
# o exemplo desatualizado no README). O controle do M5 mede a CADEIA DE BUILD:
# com os defeitos das outras metades em disco, uma reprovação seria delas —
# então o fixture volta à forma válida antes de qualquer asserção do STEP.
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
cat > "$TMP_DIR/README.md" <<MD
# Fixture

O setup passa a versão como ARGUMENTO: gh variable set BUN_VERSION $FIXTURE_VERSION
MD
cat > "$TMP_DIR/docs/GUARDS.md" <<MD
# Guards do fixture

Este guard é rodado com --expected $FIXTURE_VERSION (o atalho histórico da versão).
MD

# A versão divergente é DERIVADA (patch+1): um literal aqui envelheceria junto
# com o espelho — o defeito do fixture é dizer OUTRA versão, não uma.
VERSION_DIVERGENTE="$(echo "$FIXTURE_VERSION" | awk -F. '{print $1"."$2"."$3+1}')"

mkdir -p "$TMP_DIR/deploy"
# Heredoc SEM quotes (o valor do espelho expande) com `\$` no `${...}`: o
# fixture precisa do TEXTO da derivação, não do valor que o bash resolveria.
cat > "$TMP_DIR/docker-compose.yml" <<YML
services:
  web:
    build:
      context: .
      dockerfile: Dockerfile.worker
      args:
        BUN_VERSION: \${BUN_VERSION:-$FIXTURE_VERSION}
YML
printf '{ "name": "fixture", "packageManager": "bun@%s" }\n' "$FIXTURE_VERSION" \
  > "$TMP_DIR/package.json"

set +e
M5_CTRL_OUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
M5_CTRL_EXIT=$?
set -e
if [ "$M5_CTRL_EXIT" -ne 0 ]; then
  fail "CONTROLE M5 FALHOU: o fixture com o build site DERIVADO reprova (exit $M5_CTRL_EXIT)."
  echo "$M5_CTRL_OUT" | tail -10
  fail "O fixture do M5 não é válido — a mutação mediria outra coisa."
  exit 1
fi
pass "Controle M5 OK — compose com o arg derivado + toolchain alinhado passam (exit 0)"

# ── As quatro metades juntas (um defeito por metade, todos no fixture) ───
cat > "$TMP_DIR/Dockerfile.worker" <<EOF
ARG BUN_VERSION=$FIXTURE_VERSION
FROM oven/bun:\${BUN_VERSION:-$FIXTURE_VERSION}
EOF
cat > "$TMP_DIR/docker-compose.yml" <<'YML'
services:
  web:
    build:
      context: .
      dockerfile: Dockerfile.worker
YML
printf '{ "name": "fixture", "packageManager": "bun@%s" }\n' "$VERSION_DIVERGENTE" \
  > "$TMP_DIR/package.json"

set +e
M5_OUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
M5_EXIT=$?
set -e

if [ "$M5_EXIT" -eq 0 ]; then
  fail "GUARD CEGO: as quatro metades da cadeia de build passaram (exit 0)."
  fail "(o default do ARG, o build site sem o arg, o toolchain divergente e o"
  fail "default embutido na referência não estão sendo julgados.)"
  exit 1
fi
for M5_ESPERADO in "ARG BUN_VERSION=$FIXTURE_VERSION' é um DEFAULT" \
  "'web' builda 'Dockerfile.worker'" \
  "SEM passar o arg" \
  "embute o DEFAULT" \
  "packageManager"; do
  if ! grep -Fq "$M5_ESPERADO" <<<"$M5_OUT"; then
    fail "o guard reprovou (exit $M5_EXIT) mas SEM a asserção esperada:"
    fail "  esperava: $M5_ESPERADO"
    echo "$M5_OUT" | tail -10
    exit 1
  fi
done
pass "M5 DETECTADA: as quatro metades reprovam com as quatro mensagens (exit $M5_EXIT)"

# ── O recorte `--staged` (o pre-commit) pega o build site NOVO ───────────
# É no COMMIT que um build site nasce: o recorte lê o BLOCO do ÍNDICE (o
# `args:` e o `dockerfile:` são linhas diferentes) e NOMEIA o serviço. O que
# ele DECLARA cobrir são os blocos que o diff TOCA — uma REMOÇÃO do arg não é
# pega aqui (o bloco não ganha linha nenhuma; quem a pega é a varredura global,
# que roda no PR). É por isso que o defeito do fixture é um serviço NOVO.
if [ ! -d "$TMP_DIR/.git" ]; then
  fail "o fixture do M5 perdeu o .git (o recorte --staged precisa do índice)."
  exit 1
fi
cat > "$TMP_DIR/Dockerfile.worker" <<'EOF'
ARG BUN_VERSION
FROM oven/bun:${BUN_VERSION}
EOF
printf '{ "name": "fixture", "packageManager": "bun@%s" }\n' "$FIXTURE_VERSION" \
  > "$TMP_DIR/package.json"
cat > "$TMP_DIR/docker-compose.yml" <<YML
services:
  web:
    build:
      context: .
      dockerfile: Dockerfile.worker
      args:
        BUN_VERSION: \${BUN_VERSION:-$FIXTURE_VERSION}
YML
git -C "$TMP_DIR" add -A
git -C "$TMP_DIR" -c user.email=fixture@local -c user.name=fixture \
  commit --no-verify -qm "fixture válido (build site derivado)"
# O defeito NOVO (o que um commit introduz): um serviço a mais sem o arg.
cat > "$TMP_DIR/docker-compose.yml" <<YML
services:
  web:
    build:
      context: .
      dockerfile: Dockerfile.worker
      args:
        BUN_VERSION: \${BUN_VERSION:-$FIXTURE_VERSION}
  worker-novo:
    build:
      context: .
      dockerfile: Dockerfile.worker
YML
git -C "$TMP_DIR" add docker-compose.yml
set +e
M5_STAGED_OUT="$(cd "$TMP_DIR" && node "$GUARD" --staged 2>&1)"
M5_STAGED_EXIT=$?
set -e
if [ "$M5_STAGED_EXIT" -eq 0 ]; then
  fail "o recorte --staged passou com o build site sem o arg (exit 0) — o defeito"
  fail "só apareceria no PR, não no commit."
  exit 1
fi
if ! grep -Fq "'worker-novo' builda 'Dockerfile.worker'" <<<"$M5_STAGED_OUT"; then
  fail "o --staged reprovou (exit $M5_STAGED_EXIT) mas sem nomear o serviço novo:"
  echo "$M5_STAGED_OUT" | tail -8
  exit 1
fi
pass "M5 --staged: o commit do build site NOVO sem o arg é RECUSADO, nomeando 'worker-novo'"

# ── A cópia do guard com as quatro linhas neutralizadas ─────────────────
MUT_GUARD="$SCRIPT_DIR/scripts/.tmp-mutation-guard.mjs"
sed \
  -e 's|if (!deriva \|\| embutido) {|if (false) { // M5a: default do ARG cegado|' \
  -e 's|return { kind: m\[1\] === "-" ? "default" : "operador próprio", value: m\[2\] }|return null // M5d: default embutido cegado|' \
  -e 's|violations.push(\.\.\.checkComposeBuildArgs(rel, content, dockerfilesComArg))|void 0 // M5b: build site cegado|' \
  -e 's|violations.push(\.\.\.checkPackageManagerVersion(cwd))|void 0 // M5c: toolchain cegado|' \
  "$GUARD" > "$MUT_GUARD"
if cmp -s "$GUARD" "$MUT_GUARD"; then
  fail "A mutação M5 NÃO se aplicou (uma das quatro linhas mudou de forma?) —"
  fail "reveja os alvos do sed."
  exit 1
fi
for M5_SUB in "void 0 // M5b" "void 0 // M5c" "if (false) { // M5a" "return null // M5d"; do
  if ! grep -Fq "$M5_SUB" "$MUT_GUARD"; then
    fail "a cópia mutada não contém '$M5_SUB' — a metade correspondente NÃO foi cegada."
    rm -f "$MUT_GUARD"
    exit 1
  fi
done

set +e
M5_SURG_OUT="$(cd "$TMP_DIR" && node "$MUT_GUARD" 2>&1)"
M5_SURG_EXIT=$?
set -e
rm -f "$MUT_GUARD"

if [ "$M5_SURG_EXIT" -ne 0 ]; then
  fail "A mutação M5 NÃO cegou o guard (exit $M5_SURG_EXIT) — o veredito não mudou"
  fail "com as quatro linhas removidas: alguma das metades é decorativa."
  echo "$M5_SURG_OUT" | tail -10
  exit 1
fi
pass "M5 CIRÚRGICA: sem as quatro linhas, as quatro metades passam (exit 0)"

# ── E o guard REAL segue reprovando o workflow literal (cirúrgica, inversa) ─
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
M5_INV_OUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
M5_INV_EXIT=$?
set -e
if [ "$M5_INV_EXIT" -eq 0 ]; then
  fail "o guard REAL passou com o literal de workflow em disco — a metade dos"
  fail "workflows parou de morder."
  exit 1
fi
pass "Mutação CIRÚRGICA — o literal do workflow segue reprovado no guard REAL"
if [ -f "$MUT_GUARD" ]; then
  fail "resíduo: a cópia mutada do guard ficou em disco."
  exit 1
fi

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard do Bun pega regressões de drift"
exit 0
