#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-stack-per-commit.sh — Mutation test do
# `scripts/prove-stack-per-commit.mjs` ("cada commit da pilha passa SOZINHO?")
#
# Usage:
#   ./scripts/test-mutation-stack-per-commit.sh
#
# Exit codes:
#   0 — as OITO metades foram DETECTADAS (o veredito do gate muda com elas fora)
#       e os controles passaram ✅
#   1 — alguma regra NÃO sustentou o veredito (a mutação não cegou o gate, ou o
#       gate mudou por outro motivo) ❌
#   2 — infra: `git`/`node`/`bun`/`python3` ausentes do PATH ou o fixture não
#       pôde ser montado (a causa é DITA; nada de verde por não ter medido)
#
# O QUE ISTO PROVA (e por que o gate passar hoje não basta)
#
# O `prove-stack-per-commit` existe porque um commit pode NASCER vermelho no meio
# da pilha e só o TOPO ser olhado (medido: o vermelho do `2757e3a5` viajou 12
# commits até o topo). Ele julga cada commit num worktree próprio, e o veredito
# depende de TRÊS regras que, desligadas, deixariam o gate verde sobre uma pilha
# quebrada — e um gate de CI verde sobre um commit vermelho é PIOR que não ter
# gate: ele afirma o que não mediu. Esta suíte tira cada regra do lugar, uma por
# vez, e exige que o veredito MUDE:
#
#   M1 — a régua NOMEADA fora da DERIVAÇÃO (`testesAfetados`): o teste que só o
#        NOME alcança (`scripts/por-nome.mjs` → `por-nome-quebra.test.ts`, que lê
#        o arquivo por fs e não o importa) some do julgamento, e o commit que
#        nasceu vermelho por ele sai ✅.
#   M2 — a régua do GRAFO fora da DERIVAÇÃO: o teste que só o IMPORT alcança
#        (`src/lib/medido.mjs` → `confere-medido.test.ts`, um nome que a
#        convenção não casa) some, e o commit que nasceu vermelho por ele sai ✅.
#   M3 — o veredito POR COMMIT: a reprovação do teste afetado deixa de virar
#        `vermelho` — os DOIS commits que nascem vermelhos saem ✅ e a pilha sai
#        APROVADA.
#   M4 — o veredito da PILHA (`agregar`): os commits seguem vermelhos no
#        relatório, mas a SÉRIE deixa de julgar — o exit code do job fica 0
#        com dois commits vermelhos dentro (e um flake declarado).
#   M5 — o TETO: acima dele o gate sai 0 (verde) sem ter medido um único commit,
#        quando a regra é "acima do teto é INDETERMINADO, nunca verde".
#   M6 — a SEGUNDA TENTATIVA fora do julgamento: todo vermelho retentado cai no
#        ramo do flake, e os dois commits que reprovam DE VERDADE deixam de
#        reprovar a pilha — ela sai INDETERMINADA, com os repetíveis dentro.
#   M7 — a RE-MEDIÇÃO fora do caminho: o commit FLAKY do fixture volta a ser
#        publicado como vermelho e ENTRA no conjunto de reprovados — a
#        "regressão" falsa que o campo `flaky` existe para não deixar passar.
#   M8 — o GATE AUSENTE da árvore (o `CONJUNTO_SEMPRE` é o do HEAD, e um commit
#        anterior à criação de um gate não carrega o arquivo dele): sem o
#        classificador o comando volta a rodar, morre com `MODULE_NOT_FOUND` e o
#        commit PASSA a reprovar por um gate que ele não tem — a classe medida na
#        triagem de um run real (13 dos 59 vermelhos eram gate mais novo que a
#        árvore). As DUAS metades do controle são o outro lado da régua: com o
#        alvo PRESENTE reprovando o vermelho FICA (o ausente não amolece o que
#        existe), e com o alvo presente passando o commit segue verde.
#
# O FIXTURE É UM REPOSITÓRIO GIT DE VERDADE, com uma pilha de QUATRO commits
# sobre uma base sã: dois deles NASCEM VERMELHOS (cada um quebra EXATAMENTE UM
# dos dois testes, por uma régua diferente), o terceiro (o TOPO até então) os
# conserta, e o QUARTO nasce FLAKY — o teste dele falha na PRIMEIRA medição e
# passa na segunda, com a MESMA árvore. É a classe do defeito MEDIDA no
# repositório (um teste de integração que sobe container deu veredito diferente
# para a mesma árvore entre execuções): o topo verde esconde o vermelho do meio,
# e a re-medição é quem separa o vermelho que REPETE do que não repete. O
# flake do fixture é CONTROLADO, nunca sorteado: o marcador que o faz falhar uma
# vez vive FORA da árvore medida (cada tentativa materializa o commit num
# worktree NOVO) e `rodar_gate` o zera antes de cada execução. Os "testes" do
# fixture são scripts que LEVANTAM quando a expectativa não vale (o runner dele,
# `scripts/vitest-dofix.mjs`, reprova se algum levantar): o sujeito é o veredito
# do gate, e o vitest do repositório não é a régua desta suíte. As duas réguas
# são separáveis porque cada commit vermelho quebra UM teste que SÓ uma delas
# alcança: derrubar uma régua da derivação tira UM vermelho do veredito (e não os
# dois), e é isso que a detecção mede — o CONJUNTO de commits vermelhos, não o
# exit code.
#
# AS TRÊS LEITURAS. (1) o veredito do gate por EXECUÇÃO sobre o fixture — o
# mesmo CLI do job (`--json`), conferido pelo conjunto de commits vermelhos e
# pelo exit code; (2) a DERIVAÇÃO lida na fonte: o runner do fixture registra, por
# commit, os arquivos que RECEBEU (`PILHA_FIXTURE_LOG`), e é isso que mostra qual
# régua alcançou qual teste — o veredito diz que o commit ficou vermelho, o log
# diz POR ONDE o gate soube; (3) o `node --check` de cada mutação: uma mutação
# que não compila não prova régua nenhuma (o vermelho viria da sintaxe). O harness NÃO
# tem suíte unitária hoje — e este é o limite declarado desta suíte: quem mede as
# três regras é a EXECUÇÃO (um dublê de git/testes mediria outra coisa, e é
# justamente o worktree real que o gate afirma cobrir).
#
# LIMITES DECLARADOS:
#   - o fixture DECLARA o próprio runner: o `bun run vitest run --reporter=dot
#     <arquivos>` do gate chega no `scripts/vitest-dofix.mjs` do FIXTURE (um
#     script `vitest` no `package.json` dele), que importa cada arquivo recebido
#     e reprova se algum levantar. O que se mede é o VEREDITO do gate sobre o
#     exit code do runner — não o vitest. Um fixture com vitest de verdade
#     exigiria `node_modules`, e num job sem dependências esta suíte iria a
#     vermelho por AMBIENTE (a classe que o repositório já mediu: suíte vermelha
#     de mutação e suíte vermelha de ambiente não podem ser a mesma cor);
#   - o fixture cria um `node_modules` VAZIO: o gate trata "sem node_modules" como
#     INDETERMINADO (fail-closed dele, correto), e um fixture sem deps ficaria
#     todo indeterminado — não é isso que se mede aqui;
#   - o conjunto SEMPRE é trocado por `node -e 0` (`--sempre`): o fixture não
#     carrega os três guards de árvore, e o que esta suíte mede é a DERIVAÇÃO dos
#     testes afetados, o VEREDITO e o TETO — não o conjunto sempre (que tem as
#     suas próprias provas);
#   - as réguas são as DUAS de hoje (nome e grafo): uma terceira régua nova é
#     medida por ela mesma, e acrescentar uma metade aqui é acrescentar a linha
#     no bloco METADES;
#   - `git`/`bun`/`node` são os do ambiente (é o que o job roda): ausentes = exit
#     não-zero com a causa DITA, nunca um verde silencioso.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa.
METADES=(
  'M1|a régua NOMEADA fora da derivação: o commit vermelho que só o nome alcança sai verde'
  'M2|a régua do GRAFO fora da derivação: o commit vermelho que só o import alcança sai verde'
  'M3|o veredito POR COMMIT: a reprovação do teste afetado deixa de virar vermelho'
  'M4|o veredito da PILHA (agregar): nada mais reprova nem indetermina a série, e o exit vira 0'
  'M5|o TETO: acima dele o gate sai verde sem ter medido um único commit'
  'M6|a 2ª tentativa fora do JULGAMENTO: todo vermelho retentado vira flake e os repetíveis deixam de reprovar'
  'M7|a RE-MEDIÇÃO fora do caminho: o commit flaky volta a ser publicado como vermelho repetível'
  'M8|o GATE AUSENTE da árvore deixa de reprovar: o comando que o commit não carrega vira INDETERMINADO nomeado'
)

ALVO="$SCRIPT_DIR/scripts/prove-stack-per-commit.mjs"
FIXTURE_DIR="" # montado em TMP_DIR (abaixo), depois das cores

TMP_DIR="$(mktemp -d)"
# O marcador do FLAKE CONTROLADO: fora da árvore medida, e zerado antes de cada
# execução do gate (senão a 2ª rodada mediria um commit que já não flakeia).
FLAKE_MARCA="$TMP_DIR/flake-marca"

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
alvo_backup="$TMP_DIR/prove-stack-per-commit.original.mjs"
cp "$ALVO" "$alvo_backup"
alvo_sum="$(cksum "$ALVO" | cut -d' ' -f1)"

cleanup() {
  cp -f "$alvo_backup" "$ALVO" 2>/dev/null || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

restaurar_original() {
  cp -f "$alvo_backup" "$ALVO"
  if [ "$(cksum "$ALVO" | cut -d' ' -f1)" != "$alvo_sum" ]; then
    fail "RESTAURAÇÃO FALHOU (checksum do harness diverge) — restaure a partir de $alvo_backup"
    exit 1
  fi
}

# ── mutar: substituição CIRÚRGICA (exatamente 1 ocorrência) ───────────────
# Uma mutação que casa 0 ou 2+ vezes não é cirúrgica: o script PARA em vez de
# medir outra coisa. O marcador "MUTACAO M" no texto novo prova que ela APLICOU,
# o checksum prova que o arquivo MUDOU, e o `node --check` prova que ela é
# sintaticamente válida (mutação que não compila não mede régua nenhuma).
mutar() {
  ALVO="$ALVO" ANTES="$1" DEPOIS="$2" python3 - <<'PY'
import os
p = os.environ["ALVO"]
old, new = os.environ["ANTES"], os.environ["DEPOIS"]
s = open(p).read()
n = s.count(old)
if n != 1:
    raise SystemExit(f"mutacao nao-cirurgica no harness: {n} ocorrencia(s) do alvo (esperado 1)")
open(p, "w").write(s.replace(old, new))
PY
  if ! grep -qF 'MUTACAO M' "$ALVO"; then
    fail "a mutação não aplicou no harness (nada a medir)"
    exit 1
  fi
  if [ "$(cksum "$ALVO" | cut -d' ' -f1)" = "$alvo_sum" ]; then
    fail "a mutação não alterou o harness (checksum idêntico) — o alvo casou mas a escrita não"
    exit 1
  fi
  if ! node --check "$ALVO" >/dev/null 2>&1; then
    fail "a mutação deixou o harness com sintaxe INVÁLIDA (o vermelho viria da sintaxe, não da régua)"
    exit 1
  fi
}

# ── O FIXTURE: um repositório git de verdade, com a pilha de três commits ──
# base sã → C1 vermelho SÓ pela régua nomeada → C2 vermelho SÓ pelo grafo →
# C3 (o TOPO) que conserta os dois. O `node_modules` do repo medido entra por
# symlink (é ele que o gate liga no worktree de cada commit).
montar_fixture() {
  FIXTURE_DIR="$TMP_DIR/fixture"
  mkdir -p "$FIXTURE_DIR/src/lib/__tests__" "$FIXTURE_DIR/scripts" "$FIXTURE_DIR/node_modules"

  # O runner DECLARADO pelo fixture (o `vitest` que o gate procura): recebe
  # `run --reporter=dot <arquivos>`, importa cada arquivo e reprova se algum
  # levantar. O exit code dele é o veredito que o gate lê.
  cat >"$FIXTURE_DIR/scripts/vitest-dofix.mjs" <<'ARQ'
// O runner do FIXTURE (declarado no package.json como o script `vitest`): o que
// o gate mede é o exit code do runner sobre os TESTES AFETADOS que ele derivou.
// Os arquivos recebidos vão para o log quando `PILHA_FIXTURE_LOG` existe — é a
// leitura da DERIVAÇÃO por quem chamou (o commit e os arquivos que ele pediu).
import { appendFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"

const arquivos = process.argv.slice(2).filter((a) => !a.startsWith("-") && a !== "run")

if (process.env.PILHA_FIXTURE_LOG) {
  let sha = "?"
  try {
    sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  } catch {
    /* sem git: o log registra o cwd */
  }
  appendFileSync(process.env.PILHA_FIXTURE_LOG, `${sha} ${arquivos.join(" ")}\n`)
}

let falhas = 0
for (const a of arquivos) {
  try {
    await import(pathToFileURL(resolve(process.cwd(), a)).href)
  } catch (e) {
    falhas++
    console.error(`✗ ${a}: ${e.message}`)
  }
}

if (arquivos.length === 0) {
  console.error("o runner do fixture não recebeu arquivo nenhum")
  process.exit(2)
}
process.exit(falhas > 0 ? 1 : 0)
ARQ

  cat >"$FIXTURE_DIR/package.json" <<'ARQ'
{
  "name": "fixture-pilha",
  "private": true,
  "scripts": { "vitest": "node scripts/vitest-dofix.mjs" }
}
ARQ

  cat >"$FIXTURE_DIR/src/lib/medido.js" <<'ARQ'
export const valor = 1
ARQ
  cat >"$FIXTURE_DIR/scripts/por-nome.js" <<'ARQ'
export const MARCA = "v1"
ARQ
  # O teste que SÓ o GRAFO alcança: o nome dele não casa com o do arquivo.
  cat >"$FIXTURE_DIR/src/lib/__tests__/confere-medido.test.js" <<'ARQ'
import { valor } from "../medido.js"

if (valor !== 1) throw new Error(`o valor medido devia ser 1 e veio ${valor}`)
ARQ
  # O teste que SÓ a régua NOMEADA alcança: lê o arquivo por fs e não o importa.
  cat >"$FIXTURE_DIR/src/lib/__tests__/por-nome-quebra.test.js" <<'ARQ'
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const src = readFileSync(join(raiz, "scripts/por-nome.js"), "utf8")

if (!src.includes('MARCA = "v1"')) throw new Error("a marca declarada no script mudou")
ARQ

  (
    cd "$FIXTURE_DIR"
    git init -q .
    git config user.email "suite@example.invalid"
    git config user.name "suite de mutação"
    git add -A
    git commit -qm "base sa: a implementacao e os dois testes"
  )
  BASE_SHA="$(git -C "$FIXTURE_DIR" rev-parse HEAD)"

  (
    cd "$FIXTURE_DIR"
    sed -i 's/export const MARCA = "v1"/export const MARCA = "v2"/' scripts/por-nome.js
    git commit -qam "nasce VERMELHO pela regua nomeada"
  )
  SHA_NOME="$(git -C "$FIXTURE_DIR" rev-parse HEAD)"

  (
    cd "$FIXTURE_DIR"
    sed -i 's/export const valor = 1/export const valor = 2/' src/lib/medido.js
    git commit -qam "nasce VERMELHO pelo grafo de imports"
  )
  SHA_GRAFO="$(git -C "$FIXTURE_DIR" rev-parse HEAD)"

  (
    cd "$FIXTURE_DIR"
    sed -i 's/export const MARCA = "v2"/export const MARCA = "v1"/' scripts/por-nome.js
    sed -i 's/export const valor = 2/export const valor = 1/' src/lib/medido.js
    git commit -qam "conserta os dois — o TOPO verde"
  )
  SHA_TOPO="$(git -C "$FIXTURE_DIR" rev-parse HEAD)"

  # O commit FLAKY — a classe que o instrumento não sabia nomear: o teste dele
  # falha na PRIMEIRA medição e passa na segunda, com a MESMA árvore. O marcador
  # vive FORA do fixture de propósito: cada tentativa materializa o commit num
  # worktree NOVO, então um marcador dentro da árvore não sobreviveria à 2ª
  # medição — e o teste mediria o worktree, não a re-medição.
  (
    cd "$FIXTURE_DIR"
    cat >src/lib/flaky.js <<'ARQ'
export const marca = "flake"
ARQ
    cat >src/lib/__tests__/flaky.test.js <<ARQ
import { existsSync, writeFileSync } from "node:fs"

// O FLAKE CONTROLADO: reprova UMA vez e passa depois. O marcador está fora da
// árvore medida (cada tentativa tem o seu worktree), e é `rodar_gate` quem o
// zera — o flake do fixture é determinístico, nunca sorteado.
const MARCA = "$FLAKE_MARCA"
if (!existsSync(MARCA)) {
  writeFileSync(MARCA, "1")
  throw new Error("a 1ª medição deste commit falha — flake CONTROLADO")
}
ARQ
    git add -A
    git commit -qm "nasce FLAKY: falha na 1ª medição e passa na 2ª"
  )
  SHA_FLAKE="$(git -C "$FIXTURE_DIR" rev-parse HEAD)"

  # Os shas CURTOS: é a forma que o veredito publica (e a que as expectativas
  # comparam) — comparar o curto contra o longo reprovaria o próprio controle.
  NOME_C="${SHA_NOME:0:8}"
  GRAFO_C="${SHA_GRAFO:0:8}"
  TOPO_C="${SHA_TOPO:0:8}"
  FLAKE_C="${SHA_FLAKE:0:8}"

  # FAIL-CLOSED: o fixture só vale com as CINCO refs e os QUATRO commits da
  # pilha. Uma base que não nasceu (git sem identidade, commit recusado) mediria
  # outra pilha — e um erro de fixture é INFRA (exit 2), não um veredito.
  [ -n "$BASE_SHA" ] && [ -n "$SHA_NOME" ] && [ -n "$SHA_GRAFO" ] && [ -n "$SHA_TOPO" ] &&
    [ -n "$SHA_FLAKE" ] &&
    [ "$(git -C "$FIXTURE_DIR" rev-list --count "$BASE_SHA..HEAD" 2>/dev/null)" = "4" ]
}

# ── rodar_gate: o CLI REAL, sobre o fixture (globais GATE_EXIT/GATE_ERR) ───
# O `--sempre "node -e 0"` troca o conjunto sempre (declarado no cabeçalho): o
# fixture não carrega os três guards de árvore, e o que se mede aqui é a
# derivação, o veredito e o teto.
GATE_EXIT=0
GATE_OUT="$TMP_DIR/out.json"
GATE_ERR="$TMP_DIR/err.txt"
LOG_FIXTURE="$TMP_DIR/derivacao.log"

rodar_gate() {
  set +e
  rm -f "$LOG_FIXTURE"
  # O flake do fixture é CONTROLADO: o marcador volta a faltar antes de cada
  # execução, senão a 2ª rodada mediria um commit que já não flakeia (o teste
  # falha UMA vez, e só uma).
  rm -f "$FLAKE_MARCA"
  (cd "$SCRIPT_DIR" && PILHA_FIXTURE_LOG="$LOG_FIXTURE" node "$ALVO" --root "$FIXTURE_DIR" \
    --base "$BASE_SHA" --sempre "node -e 0" --json "$@" >"$GATE_OUT" 2>"$GATE_ERR")
  GATE_EXIT=$?
  set -e
}

# A DERIVAÇÃO lida na fonte: os arquivos que o runner do fixture recebeu NAQUELE
# commit (o gate passa os testes afetados como argumentos ao runner).
#
# DEDUPLICADO de propósito: um commit VERMELHO é medido DUAS vezes (a re-medição
# passa os MESMOS arquivos outra vez), e a leitura aqui é QUAIS réguas alcançaram
# o commit — quem diz QUANTAS vezes ele foi medido é `exigir_medicoes`.
derivacao_do() {
  python3 - "$LOG_FIXTURE" "$1" <<'PY'
import sys

log, sha = sys.argv[1], sys.argv[2]
try:
    linhas = open(log).read().splitlines()
except FileNotFoundError:
    linhas = []
vistos, fora = set(), []
for linha in linhas:
    campos = linha.split()
    if campos and campos[0].startswith(sha):
        for arquivo in campos[1:]:
            if arquivo not in vistos:
                vistos.add(arquivo)
                fora.append(arquivo)
print(" ".join(fora))
PY
}

# ── exigir_medicoes: QUANTAS vezes o runner foi chamado para aquele commit ──
# A RE-MEDIÇÃO é observável na fonte, e é o custo extra dito por quem o pagou:
# um commit VERMELHO é medido duas vezes, um VERDE uma só (o retry é só do
# vermelho). Sem esta leitura, o custo do retry viveria só no motivo do veredito.
exigir_medicoes() {
  local cenario="$1" sha="$2" esperado="$3" real
  real="$(python3 - "$LOG_FIXTURE" "$sha" <<'PY'
import sys

log, sha = sys.argv[1], sys.argv[2]
try:
    linhas = open(log).read().splitlines()
except FileNotFoundError:
    linhas = []
print(sum(1 for l in linhas if l.split() and l.split()[0].startswith(sha)))
PY
)"
  if [ "$real" != "$esperado" ]; then
    fail "$cenario: o runner foi chamado $real vez(es) no commit $sha (esperado $esperado) — a re-medição não aconteceu como declarado"
    exit 1
  fi
}

# Os commits vermelhos do veredito (shas curtos, na ordem do relatório).
vermelhos() {
  python3 -c 'import json,sys
d = json.load(open(sys.argv[1]))
print(" ".join(c["sha"][:8] for c in d["resultados"] if c["veredito"] == "vermelho"))' "$GATE_OUT"
}

# A ordem do relatório é a da pilha (do mais antigo ao mais novo): a comparação
# é de CONJUNTO, não de sequência. O `sed` (e não o `grep`) tira a linha vazia:
# com `set -o pipefail`, um `grep` sem casar nada devolveria 1 e a suíte MORRERIA
# em silêncio justamente na comparação de um conjunto vazio (medido).
ordenar() { tr ' ' '\n' | sed '/^$/d' | sort | tr '\n' ' ' | sed 's/ *$//'; }

mostrar_gate() {
  # `|| true`: com pipefail, o `head` que fecha o pipe cedo devolve SIGPIPE ao
  # `sed` — e um diagnóstico que derruba o script esconderia o próprio defeito.
  { tail -14 "$GATE_OUT"; tail -3 "$GATE_ERR"; } 2>/dev/null | sed 's/^/      /' | head -18 || true
}

# ── exigir: o veredito (exit E conjunto de vermelhos) ─────────────────────
# Não basta o exit: um vermelho vindo de OUTRO commit (ou de um gate que
# morresse) não é a prova da metade. A régua é o CONJUNTO de commits reprovados.
exigir() {
  local cenario="$1" exit_esperado="$2" vermelhos_esperados="$3"
  local reais esperados
  reais="$(ordenar <<<"$(vermelhos)")"
  esperados="$(ordenar <<<"$vermelhos_esperados")"
  if [ "$GATE_EXIT" -ne "$exit_esperado" ]; then
    fail "$cenario: exit $GATE_EXIT (esperado $exit_esperado)"
    mostrar_gate
    exit 1
  fi
  if [ "$reais" != "$esperados" ]; then
    fail "$cenario: commits vermelhos '$reais' (esperado '$esperados')"
    mostrar_gate
    exit 1
  fi
}

# ── exigir_derivacao: o que o runner RECEBEU naquele commit ───────────────
# É a régua lida no lugar em que ela decide: o veredito mostra o vermelho, o log
# mostra qual régua o alcançou (e, desligada, que NADA foi entregue ao runner).
exigir_derivacao() {
  local cenario="$1" sha="$2" esperado="$3" real
  real="$(ordenar <<<"$(derivacao_do "$sha")")"
  if [ "$real" != "$(ordenar <<<"$esperado")" ]; then
    fail "$cenario: o runner recebeu '$real' no commit $sha (esperado '$esperado')"
    exit 1
  fi
}

# ── exigir_flake: o commit FLAKY é DECLARADO como tal ─────────────────────
# O dado de máquina é a régua (o `--json`): `flaky: true`, `tentativas: 2` e
# veredito INDETERMINADO — nunca verde (não sei) e nunca vermelho (não reprova),
# com o motivo nomeando o FLAKE. E o agregado conta-o à parte: um flake não pode
# se confundir com "não consegui medir" nem sumir dentro dos vermelhos.
exigir_flake() {
  local cenario="$1" sha="$2" erro
  if ! erro="$(python3 - "$GATE_OUT" "$sha" 2>&1 <<'PY'
import json, sys

d = json.load(open(sys.argv[1]))
sha = sys.argv[2]
alvo = [c for c in d["resultados"] if c["sha"].startswith(sha)]
if len(alvo) != 1:
    raise SystemExit(f"{sha} não está (uma vez) no relatório: nada a julgar")
c = alvo[0]
if not (c["flaky"] is True and c["tentativas"] == 2 and c["veredito"] == "indeterminado"):
    raise SystemExit(
        f"esperado FLAKE DECLARADO (flaky=true, tentativas=2, indeterminado) e veio "
        f"flaky={c['flaky']} tentativas={c['tentativas']} veredito={c['veredito']}"
    )
if "FLAKE" not in c["motivo"]:
    raise SystemExit(f"o motivo não nomeia o flake: {c['motivo'][:120]}")
if d.get("flakes") != 1:
    raise SystemExit(f"o agregado devia contar 1 flake e contou {d.get('flakes')}")
PY
)"; then
    fail "$cenario: $erro"
    mostrar_gate
    exit 1
  fi
}

# ── exigir_ausente: o gate ausente é INDETERMINADO com a razão NOMEADA ────
# A régua não é o exit sozinho: um indeterminado por OUTRA causa (worktree,
# node_modules) não é a prova desta metade — o motivo tem de NOMEAR o arquivo
# que a árvore não carrega, o `--json` tem de marcar `ausente: true` naquele
# gate, e NENHUM commit pode estar vermelho (é isso que a metade tira do lugar).
exigir_ausente() {
  local cenario="$1" exit_esperado="$2" sha="$3" arquivo="$4" erro
  if [ "$GATE_EXIT" -ne "$exit_esperado" ]; then
    fail "$cenario: exit $GATE_EXIT (esperado $exit_esperado)"
    mostrar_gate
    exit 1
  fi
  if [ -n "$(ordenar <<<"$(vermelhos)")" ]; then
    fail "$cenario: commits vermelhos '$(vermelhos)' (esperado NENHUM) — o gate ausente voltou a reprovar"
    mostrar_gate
    exit 1
  fi
  if ! erro="$(python3 - "$GATE_OUT" "$sha" "$arquivo" 2>&1 <<'PY'
import json, sys

d = json.load(open(sys.argv[1]))
sha, arquivo = sys.argv[2], sys.argv[3]
alvo = [c for c in d["resultados"] if c["sha"].startswith(sha)]
if len(alvo) != 1:
    raise SystemExit(f"{sha} não está (uma vez) no relatório: nada a julgar")
c = alvo[0]
if c["veredito"] != "indeterminado":
    raise SystemExit(f"esperado INDETERMINADO e veio {c['veredito']} (motivo: {c['motivo'][:160]})")
if arquivo not in c["motivo"]:
    raise SystemExit(f"o motivo não NOMEIA o gate ausente: {c['motivo'][:160]}")
if "ausente" not in c["motivo"]:
    raise SystemExit(f"o motivo não diz a CLASSE (ausente): {c['motivo'][:160]}")
ausentes = [s for s in c["sempre"] if s.get("ausente") is True]
if len(ausentes) != 1:
    raise SystemExit(f"o --json devia marcar 1 gate ausente e marcou {len(ausentes)}: {c['sempre']}")
ind = sum(1 for x in d["resultados"] if x["veredito"] == "indeterminado")
if ind != 1:
    raise SystemExit(f"esperado 1 commit indeterminado no relatório e veio {ind}")
PY
)"; then
    fail "$cenario: $erro"
    mostrar_gate
    exit 1
  fi
}

# ── exigir_teto: o gate recusa MEDIR acima do teto (sem veredito nenhum) ──
exigir_teto() {
  local cenario="$1" exit_esperado="$2" trecho="$3"
  if [ "$GATE_EXIT" -ne "$exit_esperado" ]; then
    fail "$cenario: exit $GATE_EXIT (esperado $exit_esperado) — o teto não decidiu"
    mostrar_gate
    exit 1
  fi
  if ! grep -Fq "$trecho" "$GATE_ERR"; then
    fail "$cenario: o gate não nomeou '$trecho' (o motivo do teto tem de sair dito)"
    mostrar_gate
    exit 1
  fi
}

echo -e "${CYAN}═══ Mutation test: a pilha commit a commit (prove-stack-per-commit) ═══${NC}"
echo "  harness: $ALVO"

# ── 0. O FIXTURE (a pilha com os DOIS vermelhos e o topo verde) ───────────
# ── INFRA: o que a suíte exige do ambiente (dito, nunca silencioso) ────────
# O gate roda `git worktree` + `bun run vitest` (o runner do fixture) e a suíte
# compara vereditos em python: sem um deles nada é medido, e um verde por não
# saber seria exatamente o defeito que esta suíte existe para impedir.
for prog in git node bun python3; do
  if ! command -v "$prog" >/dev/null 2>&1; then
    fail "infra: '$prog' não está no PATH — o fixture e o gate o exigem (nada medido)"
    exit 2
  fi
done

header "FIXTURE: dois commits que NASCEM vermelhos, o topo verde"
if ! montar_fixture; then
  fail "infra: o fixture não pôde ser montado (a causa está acima) — nada foi medido"
  exit 2
fi
echo "  fixture: $FIXTURE_DIR"
echo "  base: ${BASE_SHA:0:8} · vermelho pelo NOME: ${SHA_NOME:0:8} · vermelho pelo GRAFO: ${SHA_GRAFO:0:8} · TOPO: ${SHA_TOPO:0:8} · FLAKY: ${SHA_FLAKE:0:8}"
pass "fixture montado (4 commits na pilha: dois vermelhos por réguas DIFERENTES, um topo que conserta, um FLAKY controlado)"

# ── 1. CONTROLE A: o gate vê EXATAMENTE os dois vermelhos ─────────────────
header "CONTROLE A: os dois commits vermelhos são vistos, e só eles"
rodar_gate
exigir "CONTROLE A" 1 "$NOME_C $GRAFO_C"
# E a derivação, lida na fonte: cada commit vermelho recebeu EXATAMENTE o teste
# que a SUA régua alcança (nenhum dos dois recebeu o do outro).
exigir_derivacao "CONTROLE A (nome)" "$NOME_C" "src/lib/__tests__/por-nome-quebra.test.js"
exigir_derivacao "CONTROLE A (grafo)" "$GRAFO_C" "src/lib/__tests__/confere-medido.test.js"
exigir_flake "CONTROLE A" "$FLAKE_C"
# E o CUSTO da re-medição, medido na fonte: os TRÊS commits que reprovam na 1ª
# tentativa foram medidos duas vezes, e o TOPO (verde) uma só — o retry é do
# vermelho, nunca do verde.
exigir_medicoes "CONTROLE A (retry)" "$NOME_C" 2
exigir_medicoes "CONTROLE A (retry)" "$GRAFO_C" 2
exigir_medicoes "CONTROLE A (retry)" "$FLAKE_C" 2
exigir_medicoes "CONTROLE A (retry)" "$TOPO_C" 1
pass "CONTROLE A: exit 1 e o veredito reprova os DOIS commits que nasceram vermelhos ($(vermelhos)) — é este vermelho que cada mutação tem de cegar"
pass "CONTROLE A: os três commits vermelhos na 1ª tentativa foram medidos DUAS vezes e o topo (verde) UMA só — o custo do retry sai dito"
pass "CONTROLE A: o FLAKY $FLAKE_C fica FORA dos vermelhos — a 1ª tentativa reprovou e a 2ª passou na MESMA árvore, e ele é declarado como flake (não como regressão)"
pass "CONTROLE A: a derivação separa as réguas (o commit do NOME recebeu só $(derivacao_do "$NOME_C"), o do GRAFO só $(derivacao_do "$GRAFO_C"))"

# ── 2. CONTROLE B: o TOPO passa SOZINHO (a classe do defeito) ─────────────
# É a razão de o gate existir: medido só o topo — o que o PR faz — a pilha
# parece sã. O vermelho do meio não aparece em lugar nenhum.
header "CONTROLE B: o TOPO sozinho passa (é ele que esconde o vermelho)"
rodar_gate --only "$SHA_TOPO"
exigir "CONTROLE B" 0 ""
pass "CONTROLE B: o commit do topo passa SOZINHO (exit 0) — sem o gate, a pilha reprovada do CONTROLE A sairia verde num PR"

# ── 3. MUTAÇÃO M1: a régua NOMEADA fora da derivação ──────────────────────
header "MUTAÇÃO M1: a régua nomeada sai da derivação dos testes afetados"
mutar '  return { testes: [...new Set([...porNome, ...porGrafo])].sort(), porNome, porGrafo }' \
  '  return { testes: [...new Set([...porGrafo])].sort(), porNome, porGrafo } /* MUTACAO M1 */'
rodar_gate
exigir "M1" 1 "$GRAFO_C"
exigir_derivacao "M1" "$NOME_C" ""
pass "M1: o commit vermelho que só o NOME alcançava SAIU do veredito (vermelhos $(vermelhos)) e o runner dele NÃO RECEBEU arquivo nenhum — a régua nomeada é load-bearing (ele só não vira a pilha porque o outro vermelho segue visto)"
restaurar_original
rodar_gate
exigir "M1 (régua restaurada)" 1 "$NOME_C $GRAFO_C"
pass "M1: com a régua de volta os DOIS vermelhos voltam ao veredito"

# ── 4. MUTAÇÃO M2: a régua do GRAFO fora da derivação ─────────────────────
header "MUTAÇÃO M2: a régua do grafo de imports sai da derivação"
mutar '  return { testes: [...new Set([...porNome, ...porGrafo])].sort(), porNome, porGrafo }' \
  '  return { testes: [...new Set([...porNome])].sort(), porNome, porGrafo } /* MUTACAO M2 */'
rodar_gate
exigir "M2" 1 "$NOME_C"
exigir_derivacao "M2" "$GRAFO_C" ""
pass "M2: o commit vermelho que só o IMPORT alcançava SAIU do veredito (vermelhos $(vermelhos)) e o runner dele NÃO RECEBEU arquivo nenhum — o grafo é a régua que a convenção de nome não substitui"
restaurar_original
rodar_gate
exigir "M2 (régua restaurada)" 1 "$NOME_C $GRAFO_C"
pass "M2: com o grafo de volta os DOIS vermelhos voltam ao veredito"

# ── 5. MUTAÇÃO M3: o veredito POR COMMIT ──────────────────────────────────
header "MUTAÇÃO M3: a reprovação do teste afetado deixa de virar vermelho"
mutar '    const id = `vitest(${afetados.testes.length} arquivo(s))`
    resultadosSempre.push({ id, ok: r.ok, ms: r.ms, motivo: r.motivo })
    if (!r.ok) {' \
  '    const id = `vitest(${afetados.testes.length} arquivo(s))`
    resultadosSempre.push({ id, ok: r.ok, ms: r.ms, motivo: r.motivo })
    if (false /* MUTACAO M3 */) {'
rodar_gate
exigir "M3" 0 ""
pass "M3: os dois commits que NASCEM vermelhos saem ✅ e a pilha sai APROVADA (exit 0) — o veredito por commit é o que reprova"
restaurar_original
rodar_gate
exigir "M3 (veredito restaurado)" 1 "$NOME_C $GRAFO_C"
pass "M3: com o veredito de volta a pilha reprova de novo (exit 1)"

# ── 6. MUTAÇÃO M4: o veredito da PILHA (agregar) ──────────────────────────
# As DUAS réguas da série saem juntas: o vermelho deixa de reprovar e o
# indeterminado deixa de impedir o verde. É a metade inteira do `agregar` — o
# `if` de um lado só deixaria a série INDETERMINADA (exit 2) por causa do flake
# do fixture, e o que se mede aqui é o job ficando VERDE com os vermelhos dentro.
header "MUTAÇÃO M4: a SÉRIE deixa de julgar (agregar)"
mutar '  if (vermelhos > 0)
    return { veredito: "broken", exit: EXIT.BROKEN, vermelhos, indeterminados, flakes }
  if (indeterminados > 0)
    return { veredito: "unavailable", exit: EXIT.UNAVAILABLE, vermelhos, indeterminados, flakes }' \
  '  if (false /* MUTACAO M4 */)
    return { veredito: "broken", exit: EXIT.BROKEN, vermelhos, indeterminados, flakes }
  if (false /* MUTACAO M4 */)
    return { veredito: "unavailable", exit: EXIT.UNAVAILABLE, vermelhos, indeterminados, flakes }'
rodar_gate
exigir "M4" 0 "$NOME_C $GRAFO_C"
pass "M4: o relatório SEGUE dizendo os dois vermelhos ($(vermelhos)) e o EXIT vira 0 — o job do CI ficaria verde com dois commits vermelhos dentro"
restaurar_original
rodar_gate
exigir "M4 (agregar restaurado)" 1 "$NOME_C $GRAFO_C"
pass "M4: com o agregar de volta a série REPROVA (exit 1) mesmo com os dois vermelhos no relatório"

# ── 7. MUTAÇÃO M5: o TETO ─────────────────────────────────────────────────
# A pilha do fixture tem três commits: com `--max-commits 1` ela está ACIMA do
# teto, e a regra é INDETERMINADO (exit 2) — nunca verde por não ter medido.
header "MUTAÇÃO M5: acima do teto o gate sai verde sem medir"
rodar_gate --max-commits 1
exigir_teto "CONTROLE do teto" 2 "e o teto é 1"
pass "CONTROLE do teto: a pilha acima do teto é INDETERMINADA (exit 2) e o motivo nomeia o teto"
mutar '`Suba o teto com --max-commits se a medição couber no tempo.`,
    )
    process.exit(EXIT.UNAVAILABLE)' \
  '`Suba o teto com --max-commits se a medição couber no tempo.`,
    )
    process.exit(EXIT.OK) /* MUTACAO M5 */'
rodar_gate --max-commits 1
exigir_teto "M5" 0 "INDETERMINADO"
pass "M5: a mesma pilha acima do teto sai VERDE (exit 0) sem ter medido um único commit — o teto é o que impede o verde por não saber"
restaurar_original
rodar_gate --max-commits 1
exigir_teto "M5 (teto restaurado)" 2 "e o teto é 1"
pass "M5: com o teto de volta a pilha acima dele volta a ser INDETERMINADA (exit 2)"

# ── 8. MUTAÇÃO M6: a SEGUNDA TENTATIVA fora do julgamento ─────────────────
# O que separa "defeito do commit" de "flake do ambiente" é a REPETIÇÃO. Tirando
# o ramo que lê a 2ª tentativa como "repetiu", todo vermelho retentado cai no
# ramo do flake — e os dois commits que reprovam de verdade saem da conta como
# "não é determinístico": a pilha deixa de reprovar sem que nada tenha sido
# consertado, que é a mentira ao contrário do verde-por-não-medir.
header "MUTAÇÃO M6: a 2ª tentativa deixa de julgar o vermelho repetível"
mutar '  if (segunda.veredito === "vermelho")' \
  '  if (false /* MUTACAO M6 */)'
rodar_gate
exigir "M6" 2 ""
pass "M6: os DOIS vermelhos REPETÍVEIS deixaram de reprovar (vermelhos '$(vermelhos)') e o exit virou 2 (INDETERMINADO) — a régua da repetição é o que separa o defeito do commit do flake do ambiente"
restaurar_original
rodar_gate
exigir "M6 (repetição restaurada)" 1 "$NOME_C $GRAFO_C"
exigir_flake "M6 (repetição restaurada)" "$FLAKE_C"
pass "M6: com a régua de volta os dois repetíveis voltam a reprovar (exit 1) e o flake continua declarado como flake"

# ── 9. MUTAÇÃO M7: a RE-MEDIÇÃO fora do caminho ───────────────────────────
# Sem a re-medição, um commit que flakeia é publicado como "vermelho" e entra no
# conjunto de reprovados — a "regressão" que não existe, que faz o instrumento
# acusar o que não mediu (e que ensina quem lê a ignorar o vermelho dele).
header "MUTAÇÃO M7: a re-medição sai do caminho (o flake vira 'vermelho')"
mutar '      primeira.veredito === "vermelho"
        ? juntarTentativas(primeira, medir())' \
  '      false /* MUTACAO M7 */
        ? juntarTentativas(primeira, medir())'
rodar_gate
exigir "M7" 1 "$NOME_C $GRAFO_C $FLAKE_C"
exigir_medicoes "M7" "$FLAKE_C" 1
pass "M7: sem a re-medição o commit FLAKY entra no conjunto de reprovados ($(vermelhos)) — é a regressão falsa que o campo \`flaky\` existe para não deixar passar"
restaurar_original
rodar_gate
exigir "M7 (re-medição restaurada)" 1 "$NOME_C $GRAFO_C"
exigir_flake "M7 (re-medição restaurada)" "$FLAKE_C"
pass "M7: com a re-medição de volta o flaky sai dos reprovados e volta a ser declarado como flake"

# ── 10. MUTAÇÃO M8: o GATE AUSENTE da árvore do commit ──────────────
# O `CONJUNTO_SEMPRE` é o do HEAD: um commit ANTERIOR à criação de um gate não
# carrega o arquivo dele, o `node` existe, o arquivo não, e o processo morre com
# `MODULE_NOT_FOUND` e exit 1. Lido como vermelho, isso ACUSA o commit de um
# defeito que ele não tem (medido na triagem do run 35922847378: **13 dos 59
# vermelhos** eram gate mais novo que a árvore). O que se mede aqui é a RÉGUA: a
# existência do ALVO do comando — nunca o exit code.
header "MUTAÇÃO M8: o gate que a árvore do commit não carrega"
GATE_AUSENTE="node scripts/gate-ausente-do-fixture.mjs"
# O CONTROLE da classe: o commit do TOPO passa SOZINHO (CONTROLE B), e com um
# gate que a árvore dele não carrega ele sai INDETERMINADO com a razão nomeada —
# não reprovado.
rodar_gate --only "$SHA_TOPO" --sempre "$GATE_AUSENTE"
exigir_ausente "CONTROLE do gate ausente" 2 "$TOPO_C" "gate-ausente-do-fixture.mjs"
pass "CONTROLE do gate ausente: o commit cujo gate a árvore não carrega é INDETERMINADO (exit 2, vermelhos '$(vermelhos)') e o motivo NOMEIA o arquivo — não consegui julgar não é reprovou"
# O CONTROLE do outro lado da régua: o MESMO commit com um gate que EXISTE e
# reprova — o vermelho TEM de ficar.
rodar_gate --only "$SHA_TOPO" --sempre "node -e process.exit(1)"
exigir "CONTROLE do gate presente que reprova" 1 "$TOPO_C"
pass "CONTROLE do gate presente que reprova: o vermelho continua ($(vermelhos)) — a classificação é do ALVO, não do exit code"
# A MUTAÇÃO: o classificador deixa de olhar a árvore (o comando volta a rodar e
# o `MODULE_NOT_FOUND` volta a ser lido como REPROVAÇÃO do commit).
mutar 'return existsSync(resolve(dir, alvo))' \
  'return true /* MUTACAO M8 */'
rodar_gate --only "$SHA_TOPO" --sempre "$GATE_AUSENTE"
exigir "M8" 1 "$TOPO_C"
pass "M8: sem o classificador o gate AUSENTE volta a REPROVAR o commit (vermelhos '$(vermelhos)', exit 1) — o commit é acusado de um gate que ele não tem"
restaurar_original
rodar_gate --only "$SHA_TOPO" --sempre "$GATE_AUSENTE"
exigir_ausente "M8 (classificador restaurado)" 2 "$TOPO_C" "gate-ausente-do-fixture.mjs"
rodar_gate --only "$SHA_TOPO" --sempre "node -e process.exit(1)"
exigir "M8 (gate presente que reprova, restaurado)" 1 "$TOPO_C"
pass "M8: com o classificador de volta o ausente volta a ser INDETERMINADO e o gate PRESENTE que reprova segue vermelho — o ausente não amoleceu o que existe"

# ── 11. CONTROLE FINAL: a árvore ficou como estava ────────────────────────
header "CONTROLE FINAL: restauração verificada por checksum"
rodar_gate
exigir "CONTROLE FINAL" 1 "$NOME_C $GRAFO_C"
pass "CONTROLE FINAL: o harness restaurado volta a reprovar os MESMOS dois commits — nada ficou mutado"

echo
echo -e "${GREEN}═══ MUTATION TEST PASSED — as 8 metades foram detectadas pelo veredito do gate, e a escrita ficou como estava ═══${NC}"
