#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-generated-format.sh — Mutation test do guard do GERADO
# (`scripts/check-generated-format.mjs`)
#
# Usage:
#   ./scripts/test-mutation-generated-format.sh
#
# Exit codes:
#   0 — as SETE metades foram DETECTADAS: o guard reprova a bancada mutada pela
#       âncora CERTA e, com a metade CEGADA, a MESMA bancada PASSA (a metade é
#       load-bearing, não o fixture) ✅
#   1 — uma metade NÃO sustentou o veredito (o guard seguiu medindo igual com o
#       mecanismo desligado), mutação não-cirúrgica, âncora errada ou
#       restauração do guard falhou ❌
#   2 — infra: não foi possível montar a bancada (git, node ou o prettier do
#       repositório ausentes)
#
# O QUE ISTO PROVA (e por que o guard passar hoje não basta)
#
# O `check-generated-format` existe porque um gerador gravava
# `JSON.stringify(dados, null, 2)` e o arquivo versionado NASCIA reprovando o
# `bun run lint` (o prettier colapsa o que cabe na largura): o hook recusou o
# commit do `bench-guard-timing` e o remédio ficou local àquele arquivo,
# enquanto a mesma armadilha seguia em todo gerador que não tinha aprendido a
# lição. O veredito dele é um CONTRATO contra sete regras — e um contrato que
# passa não prova que as sete estão no lugar:
#
#   M1 — O ARTEFATO (a FORMA). O conteúdo é medido com o MESMO binário do
#        `lint` (`--check`): um gerado que não sai como o prettier o deixa é a
#        promessa quebrada do guard. Mutação: o artefato da bancada volta à
#        forma do `JSON.stringify` (válido e fora da forma do prettier).
#   M2 — O CAMINHO DE ESCRITA. Quem gera artefato versionado tem de passar pelo
#        formatador — é a metade ESTRUTURAL, a única que pega o gerador NOVO
#        antes de alguém regenerar o arquivo. Mutação: o gerador da bancada volta
#        a gravar CRU (`writeFileSync` + `JSON.stringify`), com a escrita
#        DECLARADA na tabela (para a única regra em jogo ser a do formatador).
#   M3 — A SAÍDA VERSIONADA. Artefato gerado que não entra no commit não é
#        medido por ninguém. Mutação: o artefato sai do índice do git (segue no
#        disco), como um `--update` que gravou no lugar errado.
#   M4 — A COBERTURA (candidato fora da tabela). O conjunto de geradores é
#        DERIVADO da árvore (quem grava E cita caminho versionado): um gerador
#        novo que ninguém declarou é um gerado que ninguém mede. Mutação: um
#        script NOVO que grava e cita o artefato versionado, fora da tabela.
#   M5 — A ENTRADA STALE. Uma declaração que não declara saída nenhuma E não é
#        mais alcançada pela varredura é a tabela que ninguém revisa. Mutação:
#        uma entrada para um script que não grava nem cita versão.
#   M6 — O `reescreve` FORA DOS GLOBS. O gerador que reescreve um DIRETÓRIO (o
#        fixer de citações, o de comandos) não tem lista exata de saídas: o que
#        ele cobra é o prefixo estar no escopo do lint. Mutação: um prefixo que
#        nenhum globo cobre.
#   M7 — A SEGUNDA METADE DO ESCOPO. O artefato tem de estar FORA do
#        `.prettierignore`: um gerado declarado como ignorado sai do lint e
#        volta reprovando no merge (o caso do `public/openapi.json`). Mutação: a
#        bancada declara o artefato no `.prettierignore`.
#
# CADA METADE TEM AS DUAS DIREÇÕES, e é isso que a torna prova e não ensaio:
#   1. a bancada mutada com o guard INTACTO tem de REPROVAR (exit 1) pela âncora
#      da metade — o guard morde o defeito;
#   2. a MESMA bancada com a metade do guard CEGADA tem de PASSAR (exit 0) — a
#      metade é load-bearing: sem ela o defeito passa, e a primeira direção não
#      era um fixture quebrado (o CONTROLE da bancada sã fecha a outra ponta).
#
# A BANCADA é um repositório git de FIXTURE num `mktemp` (fora do projeto): o
# `package.json` do lint (a fonte dos globs), um gerador que grava o artefato
# pelo FORMATADOR da casa e o próprio `prettier-format.mjs` (o gerador e o
# formatador são os DOIS candidatos derivados). O `node_modules` é o do
# repositório (symlink): o prettier que mede e o que escreve é o REAL, o mesmo
# do `lint`. Nenhum arquivo do repositório é mutado — o que se muta é o GUARD,
# com backup e restauração conferida por checksum no `trap EXIT` (um `exit` no
# meio não deixa o guard mutado na árvore).
#
# A CIRURGIA: cada injeção casa exatamente 1 ocorrência (0 ou 2+ = a suíte PARA
# em vez de medir outra coisa), o guard mutado tem de continuar válido
# sintaticamente e o checksum tem de MUDAR.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

GUARD="scripts/check-generated-format.mjs"
SUITE="src/lib/__tests__/check-generated-format.test.ts"
PRETTIER_BIN="node_modules/.bin/prettier"

# ── Infra (fail-closed: sem a bancada não há o que medir) ─────────────────
for bin in git node python3; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "❌ infra: '$bin' ausente — a bancada não pode ser montada" >&2
    exit 2
  fi
done
if [ ! -x "$PRETTIER_BIN" ]; then
  echo "❌ infra: $PRETTIER_BIN ausente — dependências não instaladas (o guard mede a forma com o formatador do repositório)" >&2
  exit 2
fi

TMP_DIR="$(mktemp -d)"
MODELO="$TMP_DIR/modelo"
BANCADA="$TMP_DIR/bancada"
TABELA="$TMP_DIR/tabela.json"
F_DRIVER="$TMP_DIR/driver.json"
F_TEXTO="$TMP_DIR/driver.txt"

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

# ── Backup da FONTE + restauração VERIFICADA (trap EXIT) ──────────────────
# A mutação é aplicada NO LUGAR: é o arquivo que o driver importa. O checksum é
# a testemunha de que a árvore voltou — um `exit` no meio da suíte não pode
# deixar o guard cegado no repositório.
BACKUP="$TMP_DIR/guard.original.mjs"
cp "$GUARD" "$BACKUP"
GUARD_SUM="$(cksum "$GUARD" | cut -d' ' -f1)"

restore() {
  if [ -f "$BACKUP" ]; then cp -f "$BACKUP" "$GUARD" 2>/dev/null || true; fi
  rm -rf "$TMP_DIR"
}
trap restore EXIT

restaurar_original() {
  cp -f "$BACKUP" "$GUARD"
  if [ "$(cksum "$GUARD" | cut -d' ' -f1)" != "$GUARD_SUM" ]; then
    fail "RESTAURAÇÃO FALHOU (checksum do guard diverge) — restaure a partir de $BACKUP"
    exit 1
  fi
  pass "guard restaurado (checksum confere)"
}

# ── montar_modelo: a bancada SÃ (copiada por cenário) ─────────────────────
# O `package.json` declara o comando do lint — é dele que o guard DERIVA os
# globs (a régua única), então a bancada mede o escopo inteiro. O gerador grava
# pelo formatador da casa; o artefato nasce da execução DELE (o mesmo caminho de
# escrita que o guard julga).
montar_modelo() {
  mkdir -p "$MODELO/scripts" "$MODELO/docs"
  cat >"$MODELO/package.json" <<'JSON'
{
  "scripts": {
    "lint": "prettier --check --ignore-unknown 'scripts/**' 'docs/**' && eslint . --max-warnings 0"
  }
}
JSON
  cp scripts/prettier-format.mjs "$MODELO/scripts/prettier-format.mjs"
  cat >"$MODELO/scripts/gerador.mjs" <<'JS'
// O gerador da bancada: grava o artefato versionado pelo FORMATADOR da casa.
import { escreverJsonFormatado } from "./prettier-format.mjs"

const caminho = "docs/artefato.json"
escreverJsonFormatado(caminho, { zeta: 1, alfa: ["a", "b"] })
JS
  ln -s "$SCRIPT_DIR/node_modules" "$MODELO/node_modules"
  (cd "$MODELO" && node scripts/gerador.mjs)
  git -C "$MODELO" init -q
  git -C "$MODELO" config user.email "mutation@test"
  git -C "$MODELO" config user.name "mutation test"
  git -C "$MODELO" config core.autocrlf false
  git -C "$MODELO" add -A
  git -C "$MODELO" commit -qm "bancada"
}

# preparar_banco: uma cópia NOVA do modelo por cenário (o defeito de uma metade
# nunca vaza para a seguinte).
preparar_banco() {
  rm -rf "$BANCADA"
  cp -a "$MODELO" "$BANCADA"
}

# ── tabela_base: a declaração do fixture ──────────────────────────────────
# Os DOIS candidatos da bancada: o gerador (declara a saída) e o formatador
# (grava o arquivo do chamador — escrita crua DECLARADA, porque a escrita dele
# é o caminho declarado por todos os outros).
tabela_base() {
  cat >"$TABELA" <<'JSON'
[
  { "script": "scripts/gerador.mjs", "saidas": ["docs/artefato.json"] },
  {
    "script": "scripts/prettier-format.mjs",
    "leSo": "o formatador da bancada: a escrita dele e o caminho declarado",
    "escritasCruas": ["caminho"]
  }
]
JSON
}

# ── O DRIVER: a leitura por execução ──────────────────────────────────────
# Importa o guard (mutado, quando há mutação) e roda `analyze` sobre a bancada
# com a tabela do cenário. O stdout é o JSON da leitura; as asserções leem
# ARQUIVO (nunca `… | grep` sob pipefail).
rodar_driver() {
  set +e
  GUARD_URL="file://$SCRIPT_DIR/$GUARD" BANCADA="$BANCADA" TABELA="$TABELA" \
    node --input-type=module -e '
const { readFileSync } = await import("node:fs")
const mod = await import(process.env.GUARD_URL)
const geradores = JSON.parse(readFileSync(process.env.TABELA, "utf8"))
const r = await mod.analyze({ cwd: process.env.BANCADA, geradores })
process.stdout.write(
  JSON.stringify({
    exit: r.exit,
    texto: r.violations.join("\n"),
    candidatos: r.candidatos.join("\n"),
  }) + "\n",
)
' >"$F_DRIVER" 2>"$TMP_DIR/driver.err"
  DRIVER_EXIT=$?
  set -e
}

rodar_e_checar() { # <cenário> — o driver rodou e produziu leitura
  local cenario="$1"
  rodar_driver
  if [ "$DRIVER_EXIT" -ne 0 ]; then
    fail "$cenario: a LEITURA QUEBROU (driver exit $DRIVER_EXIT) — a mutação derrubou o módulo em vez de medir a régua"
    sed 's/^/      /' "$TMP_DIR/driver.err" | tail -6
    exit 1
  fi
}

campo() { python3 -c "import json,sys;print(json.load(open('$F_DRIVER'))[sys.argv[1]])" "$1"; }

exigir_exit() { # <esperado> <cenário>
  local esperado="$1" cenario="$2" obtido
  obtido="$(campo exit)"
  if [ "$obtido" != "$esperado" ]; then
    fail "$cenario: exit $obtido, esperado $esperado"
    campo texto >"$F_TEXTO"
    sed 's/^/      /' "$F_TEXTO"
    exit 1
  fi
  pass "$cenario (exit $esperado)"
}

exigir_ancora() { # <âncora> <cenário>
  local ancora="$1" cenario="$2"
  campo texto >"$F_TEXTO"
  if ! grep -qF -- "$ancora" "$F_TEXTO"; then
    fail "$cenario: o guard reprovou SEM a âncora esperada ('$ancora')"
    sed 's/^/      /' "$F_TEXTO"
    exit 1
  fi
  pass "$cenario (a âncora '$ancora' está no veredito)"
}

exigir_candidato() { # <rel> <cenário>
  local rel="$1" cenario="$2"
  campo candidatos >"$F_TEXTO"
  if ! grep -qxF -- "$rel" "$F_TEXTO"; then
    fail "$cenario: a derivação NÃO alcançou '$rel' (candidatos: $(tr '\n' ' ' <"$F_TEXTO"))"
    exit 1
  fi
  pass "$cenario (candidato derivado: $rel)"
}

# ── mutar <alvo> <troca>: substituição LITERAL, cirúrgica, no GUARD ───────
mutar() {
  local alvo="$1" troca="$2"
  ARQUIVO="$GUARD" ALVO="$alvo" NOVO="$troca" python3 - <<'PY'
import os
p = os.environ["ARQUIVO"]
s = open(p, encoding="utf-8").read()
n = s.count(os.environ["ALVO"])
if n != 1:
    raise SystemExit(f"mutacao nao-cirurgica no guard: {n} ocorrencia(s) do alvo (esperado 1)")
open(p, "w", encoding="utf-8").write(s.replace(os.environ["ALVO"], os.environ["NOVO"]))
PY
  if [ "$(cksum "$GUARD" | cut -d' ' -f1)" = "$GUARD_SUM" ]; then
    fail "a mutação não alterou o guard (checksum idêntico) — o alvo casou e a escrita não"
    exit 1
  fi
  if ! node --check "$GUARD" >/dev/null 2>&1; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: o guard mutado não é válido sintaticamente"
    exit 1
  fi
}

echo ""
echo "  ═══════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (o guard do GERADO deve MORDE 7x)"
echo "  ═══════════════════════════════════════════════════════════════════"

info "Montando a bancada (repo git de fixture + o prettier REAL do repositório)..."
montar_modelo
pass "modelo pronto: $(git -C "$MODELO" ls-files | wc -l) arquivo(s) versionado(s) no fixture"

# ═════════════════════════════════════════════════════════════════════════
# CONTROLE — a bancada sã com o guard intacto PASSA, e a derivação alcança os
# dois candidatos: o verde do controle não vem de uma tabela vazia.
# ═════════════════════════════════════════════════════════════════════════
header "CONTROLE — a bancada sã passa (e os candidatos SÃO derivados)"

preparar_banco
tabela_base
rodar_e_checar "controle"
exigir_exit "0" "controle: bancada sã + guard intacto"
exigir_candidato "scripts/gerador.mjs" "controle (o gerador da bancada)"
exigir_candidato "scripts/prettier-format.mjs" "controle (o formatador da bancada)"

# ═════════════════════════════════════════════════════════════════════════
# M1 — O ARTEFATO: a forma do gerado
# ═════════════════════════════════════════════════════════════════════════
header "M1 — o ARTEFATO fora da forma do prettier"

preparar_banco
# A forma que o `JSON.stringify(…, 2)` grava e o prettier NÃO mantém.
printf '{ "zeta":  1 }\n' >"$BANCADA/docs/artefato.json"
tabela_base
rodar_e_checar "M1"
exigir_exit "1" "M1: o guard REPROVA o artefato fora da forma"
exigir_ancora "NÃO sai como o prettier o deixa" "M1"
mutar "if (r.status !== 0) {" "if (false && r.status !== 0) {"
rodar_e_checar "M1 (metade cegada)"
exigir_exit "0" "M1 cego: a MESMA bancada passa com o --check desligado"
restaurar_original

# ═════════════════════════════════════════════════════════════════════════
# M2 — O CAMINHO DE ESCRITA: o gerador que volta a gravar CRU
# ═════════════════════════════════════════════════════════════════════════
header "M2 — o gerador volta a gravar CRU (sem o formatador)"

preparar_banco
cat >"$BANCADA/scripts/gerador.mjs" <<'JS'
// A MUTAÇÃO: o gerador volta ao `writeFileSync` + `JSON.stringify` (o defeito
// medido). A escrita é DECLARADA na tabela — a única regra em jogo é a do
// formatador, e é ela que o guard tem de cobrar.
import { writeFileSync } from "node:fs"

const caminho = "docs/artefato.json"
const dados = { zeta: 1, alfa: ["a", "b"] }
writeFileSync(caminho, JSON.stringify(dados, null, 2) + "\n")
JS
cat >"$TABELA" <<'JSON'
[
  {
    "script": "scripts/gerador.mjs",
    "saidas": ["docs/artefato.json"],
    "escritasCruas": ["caminho"]
  },
  {
    "script": "scripts/prettier-format.mjs",
    "leSo": "o formatador da bancada: a escrita dele e o caminho declarado",
    "escritasCruas": ["caminho"]
  }
]
JSON
rodar_e_checar "M2"
exigir_exit "1" "M2: o guard REPROVA o gerador sem o formatador"
exigir_ancora "SEM passar pelo formatador" "M2"
mutar "if (declara && !usaHelper) {" "if (false && declara && !usaHelper) {"
rodar_e_checar "M2 (metade cegada)"
exigir_exit "0" "M2 cego: a MESMA bancada passa com a regra do formatador desligada"
restaurar_original

# ═════════════════════════════════════════════════════════════════════════
# M3 — A SAÍDA VERSIONADA: o artefato fora do índice do git
# ═════════════════════════════════════════════════════════════════════════
header "M3 — a saída declarada NÃO está no git (fora do commit)"

preparar_banco
git -C "$BANCADA" rm --cached -q docs/artefato.json
tabela_base
rodar_e_checar "M3"
exigir_exit "1" "M3: o guard REPROVA a saída que não entra no commit"
exigir_ancora "não é versionada" "M3"
mutar "if (!versionados.has(rel)) {" "if (false && !versionados.has(rel)) {"
rodar_e_checar "M3 (metade cegada)"
exigir_exit "0" "M3 cego: a MESMA bancada passa sem a conferência de git ls-files"
restaurar_original

# ═════════════════════════════════════════════════════════════════════════
# M4 — A COBERTURA: um gerador NOVO que ninguém declarou
# ═════════════════════════════════════════════════════════════════════════
header "M4 — candidato derivado FORA da tabela (gerador novo sem declaração)"

preparar_banco
cat >"$BANCADA/scripts/outro.mjs" <<'JS'
// A MUTAÇÃO: um gerador novo que grava e cita o artefato versionado — a
// derivação o alcança e a tabela não o declara.
import { writeFileSync } from "node:fs"

writeFileSync("docs/artefato.json", JSON.stringify({ zeta: 1 }) + "\n")
JS
git -C "$BANCADA" add scripts/outro.mjs
tabela_base
rodar_e_checar "M4"
exigir_exit "1" "M4: o guard REPROVA o candidato fora da tabela"
exigir_ancora "NÃO está na tabela GERADORES" "M4"
mutar "if (!declarados.has(c)) {" "if (false && !declarados.has(c)) {"
rodar_e_checar "M4 (metade cegada)"
exigir_exit "0" "M4 cego: a MESMA bancada passa com a cobertura desligada"
restaurar_original

# ═════════════════════════════════════════════════════════════════════════
# M5 — A ENTRADA STALE: declaração que não mede nada
# ═════════════════════════════════════════════════════════════════════════
header "M5 — entrada STALE na tabela (script que não grava nem cita versão)"

preparar_banco
cat >"$BANCADA/scripts/leitor.mjs" <<'JS'
// A MUTAÇÃO: existe, não grava e não cita caminho versionado — a varredura não
// o alcança, então uma entrada sem saída para ele é a declaração que ninguém
// revisa.
console.log("leitor da bancada")
JS
cat >"$TABELA" <<'JSON'
[
  { "script": "scripts/gerador.mjs", "saidas": ["docs/artefato.json"] },
  {
    "script": "scripts/prettier-format.mjs",
    "leSo": "o formatador da bancada: a escrita dele e o caminho declarado",
    "escritasCruas": ["caminho"]
  },
  { "script": "scripts/leitor.mjs" }
]
JSON
rodar_e_checar "M5"
exigir_exit "1" "M5: o guard REPROVA a entrada STALE"
exigir_ancora "entrada STALE" "M5"
mutar "if (!declara && !base.candidatos.includes(g.script)) {" "if (false && !declara && !base.candidatos.includes(g.script)) {"
rodar_e_checar "M5 (metade cegada)"
exigir_exit "0" "M5 cego: a MESMA tabela passa com a regra de STALE desligada"
restaurar_original

# ═════════════════════════════════════════════════════════════════════════
# M6 — O `reescreve` FORA DOS GLOBS do lint
# ═════════════════════════════════════════════════════════════════════════
header "M6 — o \`reescreve\` declara prefixo fora dos globs do lint"

preparar_banco
cat >"$TABELA" <<'JSON'
[
  {
    "script": "scripts/gerador.mjs",
    "saidas": ["docs/artefato.json"],
    "reescreve": ["docs2/"]
  },
  {
    "script": "scripts/prettier-format.mjs",
    "leSo": "o formatador da bancada: a escrita dele e o caminho declarado",
    "escritasCruas": ["caminho"]
  }
]
JSON
rodar_e_checar "M6"
exigir_exit "1" "M6: o guard REPROVA o prefixo fora do lint"
exigir_ancora "que está fora dos globs do" "M6"
mutar "if (!coveredBy(globs, exemplo)) {" "if (false && !coveredBy(globs, exemplo)) {"
rodar_e_checar "M6 (metade cegada)"
exigir_exit "0" "M6 cego: a MESMA tabela passa com a cobertura do prefixo desligada"
restaurar_original

# ═════════════════════════════════════════════════════════════════════════
# M7 — O ARTEFATO no `.prettierignore` (a segunda metade do escopo)
# ═════════════════════════════════════════════════════════════════════════
header "M7 — o artefato é IGNORADO pelo .prettierignore (fora do lint)"

preparar_banco
printf 'docs/artefato.json\n' >"$BANCADA/.prettierignore"
tabela_base
rodar_e_checar "M7"
exigir_exit "1" "M7: o guard REPROVA o artefato ignorado pelo prettier"
exigir_ancora "IGNORADO pelo .prettierignore" "M7"
mutar "if (info?.ignored) {" "if (false && info?.ignored) {"
rodar_e_checar "M7 (metade cegada)"
exigir_exit "0" "M7 cego: a MESMA bancada passa com a leitura do ignore desligada"
restaurar_original

# ═════════════════════════════════════════════════════════════════════════
# INTEGRAÇÃO — a árvore DE VERDADE e a testemunha unitária (com o guard já
# restaurado): o verde do CI é o mesmo comando, e a suíte da régua confirma que
# a árvore ficou intacta depois das sete idas e voltas.
# ═════════════════════════════════════════════════════════════════════════
header "INTEGRAÇÃO — o guard real na árvore real + a suíte unitária"

set +e
SAIDA_REAL="$(node scripts/check-generated-format.mjs 2>&1)"
EXIT_REAL=$?
set -e
if [ "$EXIT_REAL" -ne 0 ]; then
  fail "integração: o guard real saiu $EXIT_REAL na árvore do repositório"
  echo "$SAIDA_REAL" | sed 's/^/      /'
  exit 1
fi
pass "integração: o guard real passa na árvore (o mesmo comando do CI)"

if [ -d "node_modules/vitest" ]; then
  set +e
  (cd "$SCRIPT_DIR" && NO_COLOR=1 bun x vitest run --config vitest.config.unit.ts "$SUITE") \
    >"$TMP_DIR/suite.bruto" 2>&1
  SUITE_EXIT=$?
  set -e
  if [ "$SUITE_EXIT" -ne 0 ]; then
    fail "testemunha unitária: a suíte da régua NÃO passou com o guard restaurado (exit $SUITE_EXIT)"
    sed 's/^/      /' "$TMP_DIR/suite.bruto" | tail -12
    exit 1
  fi
  pass "testemunha unitária: $(basename "$SUITE") passa com o guard restaurado"
else
  info "vitest ausente — a testemunha unitária NÃO foi julgada aqui"
fi

echo ""
echo -e "  ${GREEN}✅ test-mutation-generated-format: as SETE metades mordem (o defeito reprova e a metade cegada passa) e o guard real segue verde na árvore.${NC}"
echo ""
