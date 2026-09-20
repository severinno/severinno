#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-archived-pipeline.sh — Mutation test das CONDIÇÕES do
# retrato arquivado (`scripts/check-archived-pipeline.mjs`)
#
# Usage:
#   ./scripts/test-mutation-archived-pipeline.sh
#
# Exit codes:
#   0 — as SEIS mutações foram DETECTADAS (a classe cega + as classes vizinhas
#       seguindo vermelhas) e os controles passaram ✅
#   1 — régua CEGA (a mutação não foi vista) / mutação não-cirúrgica (cegou
#       outra classe também) / controle falso / infra ❌
#
# POR QUE ESTA SUÍTE EXISTE
#
# O guard prova que cada passo do retrato declara, em `when:`, a MESMA condição
# que a forja aplica à sua contraparte. Uma régua dessas tem SEIS elos, e cada
# elo pode virar promessa em prosa sem ninguém notar: a exigência de declarar, o
# ESTREITAMENTO do `if:` do job, a contraparte por marcador (existência e
# trabalho), o fail-closed da leitura e o desempate do casamento ambíguo.
# Apagar qualquer um deles deixa o guard VERDE sobre um retrato que mente — e o
# verde de um guard que já não mede nada é pior que violação, porque converte
# "não verificado" em "parece verificado".
#
# COMO É MEDIDO (por execução, contra um retrato sintético)
#
#   · FIXTURE `misto`: um retrato com UM passo de cada classe — o são (que segue
#     verde em TODAS as mutações: é o que desmente um verde vindo do fixture) e
#     os quatro defeitos (sem `when`, condição que a forja estreita, marcador
#     para job INEXISTENTE, marcador para o job que faz OUTRO trabalho) mais o
#     casamento AMBÍGUO (o mesmo comando em dois jobs da forja);
#   · FIXTURE `yaml-ruim`: um retrato que não faz parsing — a classe do
#     fail-closed ("não consegui ler" nunca é "nada a julgar");
#   · cada mutação é aplicada NO LUGAR (o injetor recusa alvo ausente/duplicado
#     e o arquivo mutado tem de continuar com sintaxe válida), o veredito é
#     medido, e a árvore é restaurada por checksum no mesmo trap.
#
# CADA mutação é CIRÚRGICA: depois dela, a classe mutada SOME do veredito e as
# OUTRAS classes continuam vermelhas — se a mutação apagar o vermelho inteiro,
# ela não provou nada (o guard poderia estar quebrado por outro motivo).
#
# LIMITES DECLARADOS (o que esta prova NÃO cobre):
#   · o fixture é sintético, de propósito: o RETRATO real tem de continuar sendo
#     provado pelo próprio guard (o controle final mede o repositório real);
#   · a suíte unitária (`check-archived-pipeline.test.ts`) é a segunda testemunha
#     das MESMAS classes, com valores (a ordem dos órfãos, a mensagem com os dois
#     lados, o `--json`, o repo real) — aqui o que se mede é o elo do GUARD;
#   · a mutação roda no IN LUGAR: por isso a suíte vive no master `mutation-guards`
#     (matriz serial) e não num job ao lado.
#
# Pipeline:
#   1. CONTROLE: o guard íntegro sobre o fixture misto (todas as classes
#      presentes) e sobre o repositório real (verde)
#   2. M1..M6: cada mutação ⇒ a classe SOME e as vizinhas SEGUEM vermelhas
#   3. CONTROLE FINAL: restaurado (checksum), as classes voltam
#   4. Cleanup (trap EXIT — restaura o guard e remove o temp, mesmo com falha)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

GUARD="scripts/check-archived-pipeline.mjs"

TMP_DIR="$(mktemp -d)"
BACKUP="$TMP_DIR/guard.backup"
FIXTURE="$TMP_DIR/misto"
RUIM="$TMP_DIR/yaml-ruim"
F_VEREDITO="$TMP_DIR/veredito.txt"
export F_VEREDITO

# ── Colors ────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }
header() { echo -e "\n${CYAN}═══ $1 ═══${NC}"; }

restore() {
  if [ -f "$BACKUP" ]; then
    cp "$BACKUP" "$GUARD"
  fi
  rm -rf "$TMP_DIR"
}
trap restore EXIT

cp "$GUARD" "$BACKUP"
CHECKSUM_ORIGINAL="$(sha256sum "$GUARD" | awk '{print $1}')"

# ── Fixtures ──────────────────────────────────────────────────────────────
#
# O retrato sintético: um passo SÃO (o controle que nunca pode cair) e um de
# cada classe de mentira que o guard converte em vermelho.

mkdir -p "$FIXTURE/.gitea/workflows" "$RUIM/.gitea/workflows"

cat > "$FIXTURE/.woodpecker.yml" <<'YAML'
pipeline:
  sao:
    image: alpine:3.20
    commands:
      - node scripts/check-sao.mjs
    when:
      - event: push
        branch: [main, develop]
      - event: pull_request
        branch: main
  sem-when:
    image: alpine:3.20
    commands:
      - node scripts/check-sem-when.mjs
  estreita:
    image: alpine:3.20
    commands:
      - node scripts/check-estreita.mjs
    when:
      - event: push
        branch: [main, develop]
      - event: pull_request
        branch: main
  espelha-typo:
    image: plugins/docker
    # espelha: .gitea/workflows/ci.yml#nao-existe
    settings:
      repo: alguem/algo
    when:
      - event: push
        branch: [main, develop]
      - event: pull_request
        branch: main
  espelha-outro:
    image: alpine:3.20
    # espelha: .gitea/workflows/ci.yml#lint
    commands:
      - node scripts/check-outro.mjs
    when:
      - event: push
        branch: [main, develop]
      - event: pull_request
        branch: main
  ambiguo:
    image: alpine:3.20
    commands:
      - node scripts/check-ambiguo.mjs
    when:
      - event: push
        branch: [main, develop]
      - event: pull_request
        branch: main
YAML

cat > "$FIXTURE/.gitea/workflows/ci.yml" <<'YAML'
name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
jobs:
  sao:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/check-sao.mjs
  sem-when:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/check-sem-when.mjs
  estreita:
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - run: node scripts/check-estreita.mjs
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: bun run lint
  outro:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/check-outro.mjs
  ambiguo:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/check-ambiguo.mjs
YAML

cat > "$FIXTURE/.gitea/workflows/manual.yml" <<'YAML'
name: Manual
on:
  workflow_dispatch:
jobs:
  ambiguo-tambem:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/check-ambiguo.mjs
YAML

cat > "$RUIM/.woodpecker.yml" <<'YAML'
pipeline:
  sao:
    image: alpine:3.20
    commands:
      - [isso nao fecha
YAML

# ── Helpers ───────────────────────────────────────────────────────────────

# O veredito do guard sobre um fixture: o stderr vai para o arquivo exportado e
# o exit code é devolvido (sem `set -e` derrubar a medição).
veredito() {
  local root="$1"
  set +e
  node "$GUARD" --root "$root" > "$F_VEREDITO" 2>&1
  local rc=$?
  set -e
  return "$rc"
}

# Injeta uma mutação CIRÚRGICA: o alvo tem de existir UMA vez (0 ou 2+ = recusa
# — mutar o arquivo errado não mede nada) e o arquivo mutado tem de continuar
# com sintaxe válida.
mutar() {
  local alvo="$1" novo="$2"
  GUARD_ALVO="$alvo" GUARD_NOVO="$novo" python3 - "$GUARD" <<'PY'
import os, sys, pathlib
p = pathlib.Path(sys.argv[1])
src = p.read_text()
alvo = os.environ["GUARD_ALVO"]
novo = os.environ["GUARD_NOVO"]
n = src.count(alvo)
if n != 1:
    print(f"mutacao nao-cirurgica: {n} ocorrencia(s) de {alvo!r}", file=sys.stderr)
    sys.exit(3)
p.write_text(src.replace(alvo, novo))
PY
  node --check "$GUARD" >/dev/null || { echo "mutacao deixou sintaxe invalida" >&2; return 4; }
}

exige() {
  local cond="$1" msg="$2"
  if [ "$cond" = "1" ]; then pass "$msg"; else fail "$msg"; exit 1; fi
}

exige_contem() { grep -qF "$1" "$F_VEREDITO" && echo 1 || echo 0; }
exige_nao_contem() { grep -qF "$1" "$F_VEREDITO" && echo 0 || echo 1; }

# ── 1. CONTROLE ───────────────────────────────────────────────────────────

header "CONTROLE: o guard íntegro vê TODAS as classes"

if veredito "$FIXTURE"; then
  rc=0
else
  rc=$?
fi
exige "$( [ "$rc" = "1" ] && echo 1 || echo 0 )" "o fixture misto sai exit 1 (violações) — sem isso a medição não tem régua"

for ancora in \
  '`pipeline.sem-when`' \
  'NÃO declara `when:`' \
  '`pipeline.estreita`' \
  'mente sobre QUANDO este passo roda' \
  '`pipeline.espelha-typo`' \
  'aponta para um job que NÃO existe' \
  '`pipeline.espelha-outro`' \
  'não roda nenhum comando deste passo' \
  '`pipeline.ambiguo`' \
  'ambíguo: declare a contraparte com `# espelha:`'; do
  exige "$(exige_contem "$ancora")" "o veredito nomeia: $ancora"
done
exige "$(exige_nao_contem '`pipeline.sao`')" "o passo SÃO não aparece no veredito (é o controle do fixture)"

if veredito "$FIXTURE"; then rc=0; else rc=$?; fi
if veredito "$RUIM"; then rc_ruim=0; else rc_ruim=$?; fi
exige "$( [ "$rc_ruim" = "2" ] && echo 1 || echo 0 )" "um retrato que não faz parsing sai exit 2 (fail-closed)"
exige "$(exige_contem 'YAML INVALIDO')" "e o motivo do 2 é NOMEADO"

if node "$GUARD" > "$F_VEREDITO" 2>&1; then rc_real=0; else rc_real=$?; fi
exige "$( [ "$rc_real" = "0" ] && echo 1 || echo 0 )" "o repositório REAL sai 0 (o retrato declarado bate com a forja)"

# ── 2. AS SEIS MUTAÇÕES ───────────────────────────────────────────────────

# M1 — a EXIGÊNCIA de declarar. Sem ela, o passo sem `when:` passa em silêncio.
header "M1: passo sem \`when:\` deixa de ser exigido (a classe fica CEGA)"
mutar '      } else if (whenEfetivo === undefined) {' '      } else if (false) {'
veredito "$FIXTURE" || true
exige "$(exige_nao_contem 'NÃO declara `when:`')" "CEGO: o passo sem \`when:\` não é mais acusado"
exige "$(exige_contem '`pipeline.estreita`')" "cirúrgico: a condição divergente segue vermelha"
cp "$BACKUP" "$GUARD"

# M2 — o ESTREITAMENTO do `if:` do job. Sem ele, a cláusula base inteira vale e
# o retrato que declara "push a main e develop" passa sobre um job que só roda
# em main.
header "M2: o \`if:\` do job deixa de estreitar (a condição da forja fica LARGA)"
mutar '  const clausulas = []
  for (const c of base) {' '  return { clausulas: base, indecidivel: null }
  // eslint-disable-next-line no-unreachable
  const clausulas = []
  for (const c of base) {'
veredito "$FIXTURE" || true
exige "$(exige_nao_contem '`pipeline.estreita`')" "CEGO: o passo que declara a condição LARGA sobre job estreitado passa"
exige "$(exige_contem '`pipeline.sem-when`')" "cirúrgico: o passo sem \`when:\` segue vermelho"
cp "$BACKUP" "$GUARD"

# M3 — a contraparte por marcador: a EXISTÊNCIA do alvo. Sem ela, o typo no
# caminho vira um passo que nunca é julgado — e o guard diz "verde".
header "M3: o marcador deixa de conferir se o ARQUIVO existe"
mutar '      if (!existsSync(join(root, arquivo))) {' '      if (false) {'
veredito "$FIXTURE" || true
exige "$(exige_nao_contem 'aponta para um arquivo que NÃO existe')" "CEGO: o arquivo tipado não é mais acusado"
exige "$(exige_contem '`pipeline.sem-when`')" "cirúrgico: o passo sem \`when:\` segue vermelho"
cp "$BACKUP" "$GUARD"

# M4 — o marcador contra o TRABALHO do alvo. Sem ele, um marcador que aponta
# para o job que faz outra coisa (e tem a mesma condição) passa como provado.
header "M4: o marcador deixa de conferir se o job roda o MESMO trabalho"
mutar '        if (comum.length === 0) {' '        if (false) {'
veredito "$FIXTURE" || true
exige "$(exige_nao_contem 'não roda nenhum comando deste passo')" "CEGO: o marcador para o job errado passa"
exige "$(exige_contem '`pipeline.sem-when`')" "cirúrgico: o passo sem \`when:\` segue vermelho"
cp "$BACKUP" "$GUARD"

# M5 — o FAIL-CLOSED da leitura. Sem ele, um retrato que não faz parsing sai
# como "nada a julgar" — o verde de não saber.
header "M5: o retrato ilegível deixa de ser NÃO JULGÁVEL (vira verde)"
mutar '  if (!parsed.ok) {
    return { passos: [], violacoes: [], pipelines: [], naoJulgavel: `${rel}: ${parsed.motivo}` }
  }' '  if (!parsed.ok) {
    return { passos: [], violacoes: [], pipelines: [], naoJulgavel: null }
  }'
veredito "$RUIM" || rc_m5=$?
exige "$(exige_nao_contem 'YAML INVALIDO')" "o motivo do 2 não aparece mais (a classe cegou)"
cp "$BACKUP" "$GUARD"
if veredito "$RUIM"; then rc_voltou=0; else rc_voltou=$?; fi
exige "$( [ "$rc_voltou" = "2" ] && echo 1 || echo 0 )" "CONTROLE: restaurado, o mesmo fixture volta a sair 2"

# M6 — o DESEMPATE do casamento ambíguo. Sem ele, o guard escolhe um job
# qualquer e o retrato passa provado por acidente.
header "M6: o casamento ambíguo deixa de exigir o desempate"
mutar '    if (casados.length > 1) {' '    if (false) {'
veredito "$FIXTURE" || true
exige "$(exige_nao_contem 'ambíguo: declare a contraparte com `# espelha:`')" "CEGO: o comando em dois jobs passa sem desempate"
exige "$(exige_contem '`pipeline.sem-when`')" "cirúrgico: o passo sem \`when:\` segue vermelho"
cp "$BACKUP" "$GUARD"

# ── 3. CONTROLE FINAL ─────────────────────────────────────────────────────

header "CONTROLE FINAL: restaurado por checksum, as classes voltam"

CHECKSUM_FINAL="$(sha256sum "$GUARD" | awk '{print $1}')"
if [ "$CHECKSUM_ORIGINAL" = "$CHECKSUM_FINAL" ]; then
  pass "o guard foi restaurado byte a byte"
else
  fail "o guard NÃO é o original depois das mutações"
  exit 1
fi

veredito "$FIXTURE" || true
exige "$(exige_contem 'NÃO declara `when:`')" "a classe M1 volta a acusar"
exige "$(exige_contem '`pipeline.estreita`')" "a classe M2 volta a acusar"
exige "$(exige_contem 'aponta para um job que NÃO existe')" "a classe M3 volta a acusar"
exige "$(exige_contem 'não roda nenhum comando deste passo')" "a classe M4 volta a acusar"
exige "$(exige_contem 'ambíguo: declare a contraparte com `# espelha:`')" "a classe M6 volta a acusar"

echo ""
echo -e "${GREEN}MUTATION TEST PASSED — as 6 mutações foram detectadas${NC} ✅"
echo -e "  · cada classe cegou SOZINHA (cirúrgica) e o passo SÃO seguiu imune"
echo -e "  · o guard foi restaurado byte a byte (checksum conferido)"
