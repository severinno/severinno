#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-stack-per-commit.sh — Mutation test do
# `scripts/prove-stack-per-commit.mjs` ("cada commit da pilha passa SOZINHO?")
#
# Usage:
#   ./scripts/test-mutation-stack-per-commit.sh
#
# Exit codes:
#   0 — as CINCO metades foram DETECTADAS (o veredito do gate muda com elas fora)
#       e os controles passaram ✅
#   1 — alguma regra NÃO sustentou o veredito (a mutação não cegou o gate, ou o
#       gate mudou por outro motivo) ❌
#   2 — infra: `git`/`node`/`bun`/`python3` ausentes do PATH ou o fixture não
#       pôde ser montado (a causa é DITA; nada de verde por não ter medido)
#
# O QUE ISTO PROVA (e por que o gate passar hoje não basta)
#
# O `prove-stack-per-commit` existe porque um commit pode NASCER vermelho no meio
# da pilha e só o TOPO ser olhado (medido: o vermelho do `eee4f65e` viajou 12
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
#        relatório, mas a SÉRIE deixa de reprovar — o exit code do job fica 0
#        com dois commits vermelhos dentro.
#   M5 — o TETO: acima dele o gate sai 0 (verde) sem ter medido um único commit,
#        quando a regra é "acima do teto é INDETERMINADO, nunca verde".
#
# O FIXTURE É UM REPOSITÓRIO GIT DE VERDADE, com uma pilha de TRÊS commits sobre
# uma base sã: dois deles NASCEM VERMELHOS (cada um quebra EXATAMENTE UM dos dois
# testes, por uma régua diferente) e o TOPO os conserta — é a classe do defeito
# medida no repositório: o topo verde esconde o vermelho do meio. Os "testes" do
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
  'M4|o veredito da PILHA (agregar): o vermelho deixa de reprovar a série, e o exit vira 0'
  'M5|o TETO: acima dele o gate sai verde sem ter medido um único commit'
)

ALVO="$SCRIPT_DIR/scripts/prove-stack-per-commit.mjs"
FIXTURE_DIR="" # montado em TMP_DIR (abaixo), depois das cores

TMP_DIR="$(mktemp -d)"

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

  # Os shas CURTOS: é a forma que o veredito publica (e a que as expectativas
  # comparam) — comparar o curto contra o longo reprovaria o próprio controle.
  NOME_C="${SHA_NOME:0:8}"
  GRAFO_C="${SHA_GRAFO:0:8}"
  TOPO_C="${SHA_TOPO:0:8}"

  # FAIL-CLOSED: o fixture só vale com as QUATRO refs e os TRÊS commits da
  # pilha. Uma base que não nasceu (git sem identidade, commit recusado) mediria
  # outra pilha — e um erro de fixture é INFRA (exit 2), não um veredito.
  [ -n "$BASE_SHA" ] && [ -n "$SHA_NOME" ] && [ -n "$SHA_GRAFO" ] && [ -n "$SHA_TOPO" ] &&
    [ "$(git -C "$FIXTURE_DIR" rev-list --count "$BASE_SHA..HEAD" 2>/dev/null)" = "3" ]
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
  (cd "$SCRIPT_DIR" && PILHA_FIXTURE_LOG="$LOG_FIXTURE" node "$ALVO" --root "$FIXTURE_DIR" \
    --base "$BASE_SHA" --sempre "node -e 0" --json "$@" >"$GATE_OUT" 2>"$GATE_ERR")
  GATE_EXIT=$?
  set -e
}

# A DERIVAÇÃO lida na fonte: os arquivos que o runner do fixture recebeu NAQUELE
# commit (o gate passa os testes afetados como argumentos ao runner).
derivacao_do() {
  python3 - "$LOG_FIXTURE" "$1" <<'PY'
import sys

log, sha = sys.argv[1], sys.argv[2]
try:
    linhas = open(log).read().splitlines()
except FileNotFoundError:
    linhas = []
for linha in linhas:
    campos = linha.split()
    if campos and campos[0].startswith(sha):
        print(" ".join(campos[1:]))
PY
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
echo "  base: ${BASE_SHA:0:8} · vermelho pelo NOME: ${SHA_NOME:0:8} · vermelho pelo GRAFO: ${SHA_GRAFO:0:8} · TOPO: ${SHA_TOPO:0:8}"
pass "fixture montado (3 commits na pilha: dois vermelhos por réguas DIFERENTES, um topo que conserta)"

# ── 1. CONTROLE A: o gate vê EXATAMENTE os dois vermelhos ─────────────────
header "CONTROLE A: os dois commits vermelhos são vistos, e só eles"
rodar_gate
exigir "CONTROLE A" 1 "$NOME_C $GRAFO_C"
# E a derivação, lida na fonte: cada commit vermelho recebeu EXATAMENTE o teste
# que a SUA régua alcança (nenhum dos dois recebeu o do outro).
exigir_derivacao "CONTROLE A (nome)" "$NOME_C" "src/lib/__tests__/por-nome-quebra.test.js"
exigir_derivacao "CONTROLE A (grafo)" "$GRAFO_C" "src/lib/__tests__/confere-medido.test.js"
pass "CONTROLE A: exit 1 e o veredito reprova os DOIS commits que nasceram vermelhos ($(vermelhos)) — é este vermelho que cada mutação tem de cegar"
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
header "MUTAÇÃO M4: o vermelho deixa de reprovar a SÉRIE (agregar)"
mutar '  if (vermelhos > 0) return { veredito: "broken", exit: EXIT.BROKEN, vermelhos, indeterminados }' \
  '  if (false /* MUTACAO M4 */) return { veredito: "broken", exit: EXIT.BROKEN, vermelhos, indeterminados }'
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

# ── 8. CONTROLE FINAL: a árvore ficou como estava ─────────────────────────
header "CONTROLE FINAL: restauração verificada por checksum"
rodar_gate
exigir "CONTROLE FINAL" 1 "$NOME_C $GRAFO_C"
pass "CONTROLE FINAL: o harness restaurado volta a reprovar os MESMOS dois commits — nada ficou mutado"

echo
echo -e "${GREEN}═══ MUTATION TEST PASSED — as 5 metades foram detectadas pelo veredito do gate, e a escrita ficou como estava ═══${NC}"
