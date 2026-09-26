#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-commit-import-exports.sh — Mutation test do guard da
# CLASSE DA PILHA (scripts/check-commit-import-exports.mjs)
#
# Prova que o guard REALMENTE morde a classe que o `prove-stack-per-commit`
# descobria por MEDIÇÃO: um commit da série importa um nome que a ÁRVORE DELE
# ainda não exporta (o `export` entra num commit ACIMA) — o topo da pilha passa,
# o commit do MEIO não carrega.
#
# A mutação é do MUNDO (o fixture é um repo git de verdade, com a série
# construída commit a commit), não do guard: o veredito é o exit/relatório dele
# sobre uma árvore onde a classe EXISTE. O CONTROLE da M1 roda a MESMA série com
# o export no lugar — o vermelho tem de vir da mutação, nunca de um fixture
# quebrado.
#
# Pipeline:
#   1. M1: o commit do MEIO importa `faltando`, que só o commit de CIMA exporta
#          → guard DEVE FALHAR nomeando o commit, o arquivo, o nome e o alvo
#   2. CONTROLE da M1: a mesma série com o export presente no commit do meio
#          → guard DEVE PASSAR (o vermelho é da mutação)
#   3. M2: `export { origem as publicado } from "./d.mjs"` com d.mjs exportando
#          só `publicado` → guard DEVE FALHAR citando `origem` (a direção do
#          `as` no re-export: quem cobra do alvo é o lado de ORIGEM)
#   4. CONTROLE da M2: o mesmo re-export coerente com o alvo → guard DEVE PASSAR
#   5. M3 (CONTROLE da classe): lista de export de 12 linhas no ALVO (além do
#          limite antigo de 8), `@typedef` do JSDoc como export de tipo e
#          `import type { … }` (que NÃO é default import) → guard DEVE PASSAR
#   6. M4: a violação DECLARADA na baseline é PUBLICADA como dívida, não
#          escondida: o mesmo fixture da M1 com a entrada versionada → PASS
#   7. M5: a entrada da baseline que NÃO reproduz (catraca) → guard DEVE FALHAR
#          nomeando a entrada OBSOLETA (numa árvore sem violação nenhuma)
#   8. Cleanup (trap EXIT — rm -rf do temp)
#
# Usage:
#   ./scripts/test-mutation-commit-import-exports.sh
#
# Exit codes:
#   0 — mutações DETECTADAS pelo guard (falhou/ passou pelas asserções esperadas) ✅
#   1 — guard CEGO (passou com a mutação) OU infra ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'M1|o commit do MEIO da série: o import que só o commit de CIMA satisfaz deixa de reprovar'
  'M2|a DIREÇÃO do as no re-export: o alvo passa a ser cobrado pelo nome PUBLICADO, não pelo de origem'
  'M3|o CONTROLE da classe: lista longa além do limite antigo, @typedef do JSDoc e import type viram falso positivo'
  'M4|a violação DECLARADA na baseline deixa de ser publicada como dívida e volta a reprovar'
  'M5|a entrada OBSOLETA da baseline (a que não reproduz) deixa de reprovar a catraca'
)
GUARD="$SCRIPT_DIR/scripts/check-commit-import-exports.mjs"

TMP_DIR="$(mktemp -d)"

# ── Colors ────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }
header() {
  echo ""
  echo "  ───────────────────────────────────────────────────────────────"
  echo -e "   ▶ $1"
  echo "  ───────────────────────────────────────────────────────────────"
}

# ── Cleanup (trap EXIT — SEMPRE remove o temp, mesmo com falha) ──────────
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# ── Fixture: um repo git de verdade (a série é construída commit a commit) ─

fixture_novo() { # $1 = nome → ecoa o caminho do fixture
  local dir="$TMP_DIR/$1"
  mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" config user.email "mutation@fixture.local"
  git -C "$dir" config user.name "Mutation Fixture"
  git -C "$dir" config commit.gpgsign false
  printf '%s\n' "$dir"
}

commit_fixture() { # $1 = dir, $2 = mensagem → ecoa o sha do commit
  git -C "$1" add -A
  git -C "$1" commit -qm "$2"
  git -C "$1" rev-parse HEAD
}

run_guard() { # $1 = dir do fixture; demais = flags
  local dir="$1"
  shift
  set +e
  OUTPUT="$(node "$GUARD" --repo "$dir" "$@" 2>&1)"
  EXIT=$?
  set -e
}

# ── Asserções reusadas (a mesma frase para o mesmo defeito) ────────────────

morreu_citando() { # $1 = termo obrigatório, $2 = o que a metade prova, $3 = termo proibido (opcional)
  if [ "$EXIT" -eq 0 ]; then
    fail "GUARD CEGO: $2 — passou (exit 0) com a mutação aplicada."
    echo "$OUTPUT" | tail -6
    exit 1
  fi
  if ! grep -Fq "$1" <<<"$OUTPUT"; then
    fail "Guard falhou (exit $EXIT) mas NÃO citou '$1' no relatório — a falha pode ser outro invariante do fixture:"
    echo "$OUTPUT" | tail -8
    exit 1
  fi
  if [ -n "${3:-}" ] && grep -Fq "$3" <<<"$OUTPUT"; then
    fail "Guard falhou citando '$3' (o lado ERRADO): a régua da direção do \`as\` está invertida."
    echo "$OUTPUT" | tail -8
    exit 1
  fi
}

passou_limpo() { # $1 = o que a metade controla
  if [ "$EXIT" -ne 0 ]; then
    fail "CONTROLE FALHOU: $1 — o guard rejeitou uma árvore LIMPA (exit $EXIT)."
    echo "$OUTPUT" | tail -8
    exit 1
  fi
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-commit-import-exports)"
echo "  ═════════════════════════════════════════════════════════════════"

# ═════════════════════════════════════════════════════════════════════════
# M1 — o commit do MEIO: o import que só o commit de CIMA satisfaz
# ═════════════════════════════════════════════════════════════════════════

header "MUTAÇÃO M1: o commit do meio importa 'faltando', que só o commit de cima exporta"
info "STEP 1: construindo a série (base → meio vermelho → cima que conserta)..."

FX_M1="$(fixture_novo m1)"
printf 'fixture\n' > "$FX_M1/README.md"
printf 'export const outro = 1\n' > "$FX_M1/b.mjs"
BASE_M1="$(commit_fixture "$FX_M1" "base: b.mjs sem 'faltando'")"

printf 'import { faltando } from "./b.mjs"\nconsole.log(faltando)\n' > "$FX_M1/a.mjs"
MEIO_M1="$(commit_fixture "$FX_M1" "meio: a.mjs importa faltando (b.mjs ainda nao exporta)")"

printf 'export const outro = 1\nexport const faltando = 2\n' > "$FX_M1/b.mjs"
commit_fixture "$FX_M1" "cima: b.mjs ganha faltando" >/dev/null

info "STEP 2: o guard medindo a série --base $BASE_M1 (o commit do meio DEVE reprovar)..."
run_guard "$FX_M1" --base "$BASE_M1"
echo "$OUTPUT" | tail -4

morreu_citando "faltando" "o import do commit do meio sem export na árvore dele"
if ! grep -Fq "${MEIO_M1:0:8}" <<<"$OUTPUT"; then
  fail "Guard reprovou, mas NÃO nomeou o commit do MEIO (${MEIO_M1:0:8}) — o veredito não diz QUAL commit da série não carrega:"
  echo "$OUTPUT" | tail -8
  exit 1
fi
pass "M1 DETECTADA: o commit do meio (${MEIO_M1:0:8}) reprovou citando 'faltando' e b.mjs (exit $EXIT)"

# ── CONTROLE da M1: a MESMA série com o export no commit do meio ──────────

header "CONTROLE da M1: a mesma série, com o export presente no commit do meio"
FX_M1C="$(fixture_novo m1-controle)"
printf 'fixture\n' > "$FX_M1C/README.md"
printf 'export const outro = 1\n' > "$FX_M1C/b.mjs"
BASE_M1C="$(commit_fixture "$FX_M1C" "base")"

printf 'import { faltando } from "./b.mjs"\nconsole.log(faltando)\n' > "$FX_M1C/a.mjs"
printf 'export const outro = 1\nexport const faltando = 2\n' > "$FX_M1C/b.mjs"
commit_fixture "$FX_M1C" "meio: importa faltando e b.mjs JA exporta" >/dev/null

info "STEP 3: o guard na série de controle (DEVE passar)..."
run_guard "$FX_M1C" --base "$BASE_M1C"
passou_limpo "a série com o export no lugar"
pass "CONTROLE OK: com o export presente a série passa (exit 0) — o vermelho da M1 é da mutação"

# ═════════════════════════════════════════════════════════════════════════
# M2 — a DIREÇÃO do `as` no re-export
# ═════════════════════════════════════════════════════════════════════════

header "MUTAÇÃO M2: 'export { origem as publicado } from \"./d.mjs\"' com d.mjs só publicando 'publicado'"
info "STEP 4: construindo a série (o re-export cobra 'origem' do alvo)..."
FX_M2="$(fixture_novo m2)"
printf 'fixture\n' > "$FX_M2/README.md"
printf 'export const publicado = 1\n' > "$FX_M2/d.mjs"
BASE_M2="$(commit_fixture "$FX_M2" "base: d.mjs publica 'publicado'")"

printf 'export { origem as publicado } from "./d.mjs"\n' > "$FX_M2/c.mjs"
commit_fixture "$FX_M2" "renomeia no re-export um nome que o alvo nao tem" >/dev/null

info "STEP 5: o guard contra o re-export invertido (DEVE falhar citando 'origem')..."
run_guard "$FX_M2" --base "$BASE_M2"
echo "$OUTPUT" | tail -4

morreu_citando "origem" "o re-export que exige do alvo o nome de ORIGEM" '"publicado"'
pass "M2 DETECTADA: o alvo foi cobrado por 'origem' (não pelo nome publicado) — exit $EXIT"

# ── CONTROLE da M2: o re-export coerente ─────────────────────────────────

header "CONTROLE da M2: o mesmo re-export com o nome que o alvo publica"
FX_M2C="$(fixture_novo m2-controle)"
printf 'fixture\n' > "$FX_M2C/README.md"
printf 'export const publicado = 1\n' > "$FX_M2C/d.mjs"
BASE_M2C="$(commit_fixture "$FX_M2C" "base")"
printf 'export { publicado } from "./d.mjs"\n' > "$FX_M2C/c.mjs"
commit_fixture "$FX_M2C" "re-export coerente com o alvo" >/dev/null

info "STEP 6: o guard no re-export coerente (DEVE passar)..."
run_guard "$FX_M2C" --base "$BASE_M2C"
passou_limpo "o re-export coerente com o alvo"
pass "CONTROLE OK: o re-export coerente passa (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# M3 — CONTROLE da classe: lista longa, @typedef e import type
# ═════════════════════════════════════════════════════════════════════════
#
# As três formas que o guard JÁ recusou por engano (todas medidas no repo
# real): a lista de export do alvo passando do limite antigo de 8 linhas, o
# nome de tipo publicado só por `@typedef` do JSDoc, e o `import type { … }`
# (que NÃO é default import). Nenhuma delas pode reprovar.

header "MUTAÇÃO M3 (CONTROLE da classe): lista longa + @typedef + import type não podem reprovar"
info "STEP 7: alvo com lista de export de 12 linhas, tipo por @typedef, import type..."
FX_M3="$(fixture_novo m3)"
printf 'fixture\n' > "$FX_M3/README.md"
cat > "$FX_M3/g.mjs" <<'EOF'
export {
  n01,
  n02,
  n03,
  n04,
  n05,
  n06,
  n07,
  n08,
  n09,
  n10,
  ultimoNome,
}
EOF
cat > "$FX_M3/f.mjs" <<'EOF'
/**
 * @typedef {{ valor: string }} Ultimo
 */
EOF
BASE_M3="$(commit_fixture "$FX_M3" "base: alvo com lista longa e typedef")"

cat > "$FX_M3/e.mjs" <<'EOF'
import type { Ultimo } from "./f.mjs"
import { ultimoNome } from "./g.mjs"
export const usa = (v) => /** @type {Ultimo} */ ({ valor: v, nome: ultimoNome })
EOF
commit_fixture "$FX_M3" "importa o ULTIMO nome da lista longa e um tipo por @typedef" >/dev/null

info "STEP 8: o guard contra o CONTROLE da classe (DEVE passar)..."
run_guard "$FX_M3" --base "$BASE_M3"
if [ "$EXIT" -ne 0 ]; then
  fail "CONTROLE DA CLASSE FALHOU: o guard recusou uma árvore LIMPA (lista >8 linhas, @typedef,"
  fail "import type) — é o falso positivo das três formas medidas, exit $EXIT:"
  echo "$OUTPUT" | tail -8
  exit 1
fi
pass "M3 OK: lista longa, @typedef e import type passam (exit 0) — sem falso positivo"

# ═════════════════════════════════════════════════════════════════════════
# M4 — a violação DECLARADA na baseline é publicada, não escondida
# ═════════════════════════════════════════════════════════════════════════

header "MUTAÇÃO M4: a violação DECLARADA na baseline"
info "STEP 9: a mesma classe da M1, agora com a entrada versionada em ci/..."
FX_M4="$(fixture_novo m4)"
printf 'fixture\n' > "$FX_M4/README.md"
printf 'export const outro = 1\n' > "$FX_M4/b.mjs"
BASE_M4="$(commit_fixture "$FX_M4" "base")"
printf 'import { faltando } from "./b.mjs"\nconsole.log(faltando)\n' > "$FX_M4/a.mjs"
MEIO_M4="$(commit_fixture "$FX_M4" "meio: importa faltando (o alvo nao exporta)")"
mkdir -p "$FX_M4/ci"
cat > "$FX_M4/ci/commit-import-exports-baseline.json" <<EOF
{
  "version": 1,
  "entradas": [
    {
      "commit": "$MEIO_M4",
      "arquivo": "a.mjs",
      "nome": "faltando",
      "alvo": "b.mjs",
      "motivo": "dívida do fixture: o export entra num commit acima"
    }
  ]
}
EOF

info "STEP 10: o guard com a dívida declarada (DEVE passar PUBLICANDO a entrada)..."
run_guard "$FX_M4" --base "$BASE_M4"
passou_limpo "a violação declarada na baseline"
if ! grep -Fq "declarada" <<<"$OUTPUT"; then
  fail "A dívida declarada passou (exit 0) mas o relatório NÃO a publica como 'declarada' —"
  fail "uma violação silenciada é o oposto do que a baseline declara:"
  echo "$OUTPUT" | tail -6
  exit 1
fi
pass "M4 OK: a violação declarada passa PUBLICADA (exit 0) — dívida visível, não escondida"

# ═════════════════════════════════════════════════════════════════════════
# M5 — a catraca: a entrada OBSOLETA (a que não reproduz) reprova
# ═════════════════════════════════════════════════════════════════════════

header "MUTAÇÃO M5: a entrada OBSOLETA da baseline"
info "STEP 11: árvore LIMPA + entrada que não reproduz (catraca)..."
FX_M5="$(fixture_novo m5)"
printf 'fixture\n' > "$FX_M5/README.md"
printf 'export const outro = 1\n' > "$FX_M5/b.mjs"
BASE_M5="$(commit_fixture "$FX_M5" "base")"
printf 'export const limpo = 1\n' > "$FX_M5/a.mjs"
commit_fixture "$FX_M5" "commit limpo" >/dev/null
mkdir -p "$FX_M5/ci"
cat > "$FX_M5/ci/commit-import-exports-baseline.json" <<'EOF'
{
  "version": 1,
  "entradas": [
    {
      "commit": "0000000000000000000000000000000000000000",
      "arquivo": "a.mjs",
      "nome": "fantasma",
      "alvo": "b.mjs",
      "motivo": "entrada envelhecida: nada reproduz"
    }
  ]
}
EOF

info "STEP 12: o guard contra a entrada obsoleta (DEVE falhar nomeando OBSOLETA)..."
run_guard "$FX_M5" --base "$BASE_M5"
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO: a entrada da baseline que NÃO reproduz passou (exit 0) — a catraca"
  fail "deixou de cobrar a dívida que envelheceu (uma baseline que só cresce esconde o conserto)."
  echo "$OUTPUT" | tail -6
  exit 1
fi
if ! grep -Fq "OBSOLETA" <<<"$OUTPUT"; then
  fail "Guard falhou (exit $EXIT) mas NÃO nomeou a entrada OBSOLETA:"
  echo "$OUTPUT" | tail -8
  exit 1
fi
pass "M5 DETECTADA: a entrada que não reproduz reprovou como OBSOLETA (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard pega o import sem export no commit do meio,"
pass "nomeando o commit, o arquivo, o nome e o alvo (exit 1), cobra do alvo o lado"
pass "de ORIGEM do re-export, cobre a catraca nos dois sentidos (declarada passa,"
pass "obsoleta reprova) e não morde as três formas que já foram falso positivo."
exit 0
