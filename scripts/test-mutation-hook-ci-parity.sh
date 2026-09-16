#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-hook-ci-parity.sh — Mutation test do guard de PARIDADE
# entre os hooks locais e o CI (scripts/check-hook-ci-parity.mjs)
#
# Usage:
#   ./scripts/test-mutation-hook-ci-parity.sh
#
# Exit codes:
#   0 — as SEIS mutações DETECTADAS: cada uma deixa o guard VERMELHO pela
#       asserção da PRÓPRIA regra, com as regras irmãs seguindo de pé ✅
#   1 — guard CEGO (verde com alguma mutação) / falhou por outra regra / a
#       mutação não aplicou (não-cirúrgica) / a árvore não voltou ao estado
#       original / infra ❌
#
# POR QUE: o veredito LOCAL (o hook) e o do MERGE (o CI) são dados por dois
# conjuntos de comandos escritos em dois lugares. Enquanto essa duplicação for
# invisível, ela diverge em SILÊNCIO — e o sintoma é sempre o mesmo: "passou
# aqui e quebrou lá" (ou o inverso, "travou aqui e nem era o gate do CI":
# `.husky/pre-push` rodava `bunx tsc --noEmit` SEM o heap de 4GB que o script
# `typecheck` carrega — o mesmo commit estourava a memória no push e passava no
# merge, por uma régua que só o hook tinha). O guard existe para tornar essa
# diferença MEDIDA; este script prova que ele não pode ser cegado.
#
# AS SEIS REGRESSÕES (cada uma degrada em silêncio, por um caminho diferente):
#
#   A) A DIVERGÊNCIA REAL VOLTA. Os hooks trocam o comando canônico do CI por
#      uma SEGUNDA RÉGUA do mesmo instrumento (`bun run typecheck` → `bunx tsc
#      --noEmit`, nos DOIS hooks — é o estado exato que este repositório teve:
#      o heap de 4GB que o script `typecheck` carrega não existia no hook, e o
#      mesmo commit estourava a memória no push e passava no merge). Aqui a
#      detecção é DUPLA e independente: (1) o comando não é o do CI nem está
#      declarado; (2) o invariante `typecheck` do CORE deixa de rodar em
#      QUALQUER hook e não está em HOOK_NOT_RUN. Duas regras, um fato — a que
#      sobrar ainda pega.
#   B) COMANDO NOVO SEM DECISÃO. Um gate entra no hook (o que torna o veredito
#      local mais largo que o do CI) sem entrar em HOOK_DECLARED. Sem a regra,
#      o hook reprova (ou aprova) onde o merge faz o contrário.
#   C) RECORTE SEM RAZÃO ESCRITA. A declaração existe, mas o `why` some: o
#      hook mede OUTRA coisa que o CI e ninguém sabe por quê — a decisão de
#      escopo vira folclore.
#   D) DECLARAÇÃO QUE ENVELHECEU. O comando do hook muda de forma e a entrada
#      de HOOK_DECLARED continua lá, casando com nada: a decisão para de medir
#      o que ela dizia medir, e o arquivo segue parecendo auditado.
#   E) GATE DO CORE SUMIDO DA LISTA. Um invariante sai de HOOK_NOT_RUN sem
#      entrar no hook: ele passa a não rodar em lugar nenhum, em silêncio.
#   F) HOOK FANTASMA. HOOKS aponta para um arquivo que não existe: a categoria
#      inteira deixa de ser varrida e o guard sai verde sobre o que não leu.
#
# COMO: mutações IN-PLACE nos arquivos REAIS (backup + trap de restauração —
# NUNCA `git checkout`), no mesmo desenho dos outros `test-mutation-*.sh` deste
# repositório. É IN-PLACE de propósito: o guard lê o worktree (é o objeto do
# veredito), e uma cópia em temp mediria outro repositório.
#
#   CONTROLE — árvore íntegra → guard VERDE (exit 0) e as 5 métricas base
#     (violações=0, linhas do relatório, HOOK_NOT_RUN, CORE sem cobertura);
#   MUTAÇÃO — guard VERMELHO (exit 1) com EXATAMENTE o número de violações
#     esperado, CADA uma nomeando o que a regra acusa, e as métricas irmãs
#     conferidas (as linhas do relatório NÃO podem encolher: um guard que
#     aborta cedo também "falha", só que por não ter medido).
#
# RESTAURAÇÃO PROVADA: cada arquivo tocado é restaurado no trap E conferido por
# `cksum` contra o hash capturado no início. Um mutation test que deixa a
# árvore suja (ou que se declara verde sem ter restaurado) é pior que nenhum.
#
# ⚠️ Source-coupled: os sed ancoram em LINHAS dos arquivos reais e as mensagens
# reproduzem a saída do guard. Reformular a mensagem em
# scripts/check-hook-ci-parity.mjs exige atualizar as duas coisas juntas (o
# sintoma é "falhou, mas não pela asserção esperada" — não é guard cego).
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

GUARD="scripts/check-hook-ci-parity.mjs"
PRE_COMMIT=".husky/pre-commit"
PRE_PUSH=".husky/pre-push"
MARKER_FILE="scripts/check-hook-ci-parity.mjs"

TMP_DIR="$(mktemp -d)"
BACKUP="$TMP_DIR/orig"
mkdir -p "$BACKUP"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }
header() { echo -e "\n${CYAN}═══ $1 ═══${NC}"; }

# ── Backup + hash de origem (a restauração é PROVADA, não prometida) ──────

TRACKED=("$GUARD" "$PRE_COMMIT" "$PRE_PUSH")
declare -a ORIG_HASH=()

for f in "${TRACKED[@]}"; do
  mkdir -p "$BACKUP/$(dirname "$f")"
  cp -p "$f" "$BACKUP/$f"
  ORIG_HASH+=("$(cksum <"$f")")
done

restore() {
  for f in "${TRACKED[@]}"; do
    cp -p "$BACKUP/$f" "$f"
  done
}

verify_restored() {
  local i=0
  for f in "${TRACKED[@]}"; do
    if [ "$(cksum <"$f")" != "${ORIG_HASH[$i]}" ]; then
      return 1
    fi
    i=$((i + 1))
  done
  return 0
}

cleanup() {
  restore
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# ── Harness ──────────────────────────────────────────────────────────────

JSON_OUT="$TMP_DIR/out.json"
VIOLATIONS="$TMP_DIR/violations.txt"
GUARD_EXIT=0

run_guard() {
  set +e
  node "$GUARD" --json >"$JSON_OUT" 2>"$TMP_DIR/err.txt"
  GUARD_EXIT=$?
  set -e
  node -e '
    const fs = require("node:fs")
    const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    fs.writeFileSync(process.argv[2], j.violations.join("\n") + "\n")
    console.log(
      [j.violations.length, j.rows.length, j.notRun.length, j.missing.length].join("|"),
    )
  ' "$JSON_OUT" "$VIOLATIONS" >"$TMP_DIR/metrics.txt" 2>/dev/null || true
}

# summary <label>: ecoa "violacoes|linhas|notRun|missing"
summary() {
  local out
  out="$(cat "$TMP_DIR/metrics.txt")"
  echo "$out"
}

# violated <substring>: 0 se a violação estiver na lista
violated() {
  grep -Fq "$1" "$VIOLATIONS"
}

# assert_exit <esperado> <rótulo> — fail-fast com o output cru no diagnóstico
assert_exit() {
  if [ "$GUARD_EXIT" -ne "$1" ]; then
    fail "$2: exit=$GUARD_EXIT (esperado $1)"
    sed 's/^/      /' "$TMP_DIR/err.txt" | head -8
    exit 1
  fi
}

# assert_violations <n> <rótulo> — o número EXATO (cirurgia, não "qualquer vermelho")
assert_violations() {
  local n
  n="$(node -e '
    const fs = require("node:fs")
    const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    console.log(j.violations.length)
  ' "$JSON_OUT")"
  if [ "$n" -ne "$1" ]; then
    fail "$2: $n violações (esperado $1)"
    sed 's/^/      /' "$VIOLATIONS" | head -8
    exit 1
  fi
}

# assert_intact_rows <n> <rótulo> — o relatório NÃO pode encolher (medir × abortar)
assert_intact_rows() {
  local rows
  rows="$(node -e '
    const fs = require("node:fs")
    const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    console.log(j.rows.length)
  ' "$JSON_OUT")"
  if [ "$rows" -ne "$1" ]; then
    fail "$2: o relatório tem $rows linhas (esperado $1) — o guard parou de medir comandos"
    exit 1
  fi
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-hook-ci-parity deve ACENDER)"
echo "  ═════════════════════════════════════════════════════════════════"

# ═════════════════════════════════════════════════════════════════════════
# CONTROLE — a árvore íntegra é VERDE, e as métricas base são capturadas
# ═════════════════════════════════════════════════════════════════════════

header "CONTROLE: hooks + guard íntegros → verde (as métricas base)"

run_guard
assert_exit 0 "CONTROLE"
CONTROL_METRICS="$(summary)"
BASE_ROWS="$(node -e '
  const fs = require("node:fs")
  const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
  console.log(j.rows.length)
' "$JSON_OUT")"
BASE_NOT_RUN="$(node -e '
  const fs = require("node:fs")
  const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
  console.log(j.notRun.length)
' "$JSON_OUT")"
pass "controle verde (exit 0) — violações|linhas|notRun|missing = $CONTROL_METRICS"

# ── MUTAÇÃO A — a divergência REAL volta (segunda régua do typecheck) ────

header "MUTAÇÃO A: os hooks voltam a rodar \`bunx tsc --noEmit\` (segunda régua)"
sed -i 's/bun run typecheck/bunx tsc --noEmit/g' "$PRE_PUSH" "$PRE_COMMIT"
if ! grep -Fq 'bunx tsc --noEmit' "$PRE_PUSH" || ! grep -Fq 'bunx tsc --noEmit' "$PRE_COMMIT"; then
  fail "mutação A não aplicou (o sed não produziu o marcador nos dois hooks)"
  exit 1
fi
run_guard
assert_exit 1 "MUTAÇÃO A"
assert_violations 2 "MUTAÇÃO A"
if ! violated 'bunx tsc --noEmit'; then
  fail "mutação A: o guard não nomeou o comando divergente"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
if ! violated "invariante do CORE 'typecheck' nao roda em nenhum hook"; then
  fail "mutação A: a segunda metade (o CORE perdeu o gate do hook) não acendeu"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
assert_intact_rows "$BASE_ROWS" "MUTAÇÃO A"
pass "A DETECTADA (exit 1, 2 violações): comando divergente E o invariante 'typecheck' sem hook"
pass "  (as $BASE_ROWS linhas do relatório seguem: o guard mediu, não abortou)"
restore

# ── MUTAÇÃO B — comando novo no hook sem decisão ────────────────────────

header "MUTAÇÃO B: gate novo no pre-commit sem entrada em HOOK_DECLARED"
printf '\nnode scripts/check-ghost-guard.mjs &\n' >>"$PRE_COMMIT"
if ! grep -Fq 'node scripts/check-ghost-guard.mjs' "$PRE_COMMIT"; then
  fail "mutação B não aplicou"
  exit 1
fi
run_guard
assert_exit 1 "MUTAÇÃO B"
assert_violations 1 "MUTAÇÃO B"
if ! violated 'check-ghost-guard.mjs'; then
  fail "mutação B: o guard não nomeou o comando novo"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
if ! violated 'NAO DECLARADO'; then
  fail "mutação B: o guard acusou outro motivo em vez de 'NAO DECLARADO'"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
assert_intact_rows "$((BASE_ROWS + 1))" "MUTAÇÃO B"
pass "B DETECTADA (exit 1, 1 violação): o comando novo é nomeado e exige decisão escrita"
restore

# ── MUTAÇÃO C — recorte sem razão escrita ───────────────────────────────

header "MUTAÇÃO C: recorte declarado com o 'why' esvaziado"
sed -i 's|^    why: "recorte --staged: a ARVORE.*|    why: "curto",|' "$GUARD"
if ! grep -Fq 'why: "curto",' "$GUARD"; then
  fail "mutação C não aplicou (o sed não produziu o marcador)"
  exit 1
fi
run_guard
assert_exit 1 "MUTAÇÃO C"
assert_violations 1 "MUTAÇÃO C"
if ! violated "SEM razao escrita"; then
  fail "mutação C: o guard não cobrou a razão escrita"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
assert_intact_rows "$BASE_ROWS" "MUTAÇÃO C"
if ! node -e '
  const j = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))
  const row = j.rows.find((r) => r.cmd.includes("check-bun-mirror.mjs --staged"))
  process.exit(row && row.status === "recorte" ? 0 : 1)
' "$JSON_OUT"; then
  fail "mutação C: a linha virou outro estado — a checagem de INSTRUMENTO (irmã) caiu junto"
  exit 1
fi
pass "C DETECTADA (exit 1, 1 violação): razão exigida, e o recorte segue reconhecido como"
pass "  o MESMO instrumento do canônico (a outra metade da regra não morreu)"
restore

# ── MUTAÇÃO D — declaração que envelheceu ───────────────────────────────

header "MUTAÇÃO D: entrada de HOOK_DECLARED que não casa com comando nenhum"
sed -i 's|^    match: /\^bun run fuzz\$/|    match: /^bun run fuzz-que-nao-existe$/|' "$GUARD"
if ! grep -Fq 'fuzz-que-nao-existe' "$GUARD"; then
  fail "mutação D não aplicou (o sed não produziu o marcador)"
  exit 1
fi
run_guard
assert_exit 1 "MUTAÇÃO D"
assert_violations 2 "MUTAÇÃO D"
if ! violated 'entrada de HOOK_DECLARED que NAO casa com nenhum comando'; then
  fail "mutação D: o guard não acusou a declaração stale"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
if ! violated 'bun run fuzz'; then
  fail "mutação D: o comando que perdeu a declaração não foi nomeado"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
assert_intact_rows "$BASE_ROWS" "MUTAÇÃO D"
pass "D DETECTADA (exit 1, 2 violações): a declaração stale E o comando que ficou sem decisão"
restore

# ── MUTAÇÃO E — gate do CORE fora do hook e fora de HOOK_NOT_RUN ────────

header "MUTAÇÃO E: invariante do CORE removido de HOOK_NOT_RUN"
sed -i 's|^    ids: \["pipefail-sigpipe"\],$|    ids: [],|' "$GUARD"
if ! grep -Fq 'ids: [],' "$GUARD"; then
  fail "mutação E não aplicou (o sed não produziu o marcador)"
  exit 1
fi
run_guard
assert_exit 1 "MUTAÇÃO E"
assert_violations 1 "MUTAÇÃO E"
if ! violated "invariante do CORE 'pipefail-sigpipe' nao roda em nenhum hook"; then
  fail "mutação E: o gate sumido não foi nomeado"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
if [ "$(node -e '
  const j = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))
  console.log(j.missing.join(","))
' "$JSON_OUT")" != "pipefail-sigpipe" ]; then
  fail "mutação E: 'missing' não isolou o invariante removido"
  exit 1
fi
if [ "$(node -e '
  const j = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))
  console.log(j.notRun.length)
' "$JSON_OUT")" -ne "$((BASE_NOT_RUN - 1))" ]; then
  fail "mutação E: a lista de HOOK_NOT_RUN não encolheu exatamente 1"
  exit 1
fi
assert_intact_rows "$BASE_ROWS" "MUTAÇÃO E"
pass "E DETECTADA (exit 1, 1 violação): um gate do contrato de merge não pode sumir sem decisão"
restore

# ── MUTAÇÃO F — hook declarado que não existe (fail-closed) ─────────────

header "MUTAÇÃO F: HOOKS aponta para um arquivo de hook inexistente"
sed -i 's|^export const HOOKS = \["\.husky/pre-commit", "\.husky/pre-push"\]$|export const HOOKS = [".husky/pre-commit", ".husky/pre-push", ".husky/pre-ghost"]|' "$GUARD"
if ! grep -Fq '.husky/pre-ghost' "$GUARD"; then
  fail "mutação F não aplicou (o sed não produziu o marcador)"
  exit 1
fi
run_guard
assert_exit 1 "MUTAÇÃO F"
assert_violations 1 "MUTAÇÃO F"
if ! violated 'hook declarado nao existe'; then
  fail "mutação F: o hook fantasma não foi acusado"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
assert_intact_rows "$BASE_ROWS" "MUTAÇÃO F"
pass "F DETECTADA (exit 1, 1 violação): fail-closed — não se varre o que não se leu"
restore

# ═════════════════════════════════════════════════════════════════════════
# RESTAURAÇÃO — hashes idênticos aos do início (a árvore volta limpa)
# ═════════════════════════════════════════════════════════════════════════

header "RESTAURAÇÃO"

if ! verify_restored; then
  fail "a árvore NÃO voltou ao estado original — mutation test deixou lixo"
  exit 1
fi
pass "os ${#TRACKED[@]} arquivos tocados voltaram ao hash de origem (cksum idêntico)"

run_guard
assert_exit 0 "PÓS-RESTAURAÇÃO"
pass "guard verde de novo (exit 0) — a mutação foi 100% do harness, não da árvore"

header "VEREDITO"
pass "MUTATION TEST PASSED — as 6 regressões do veredito local↔CI são detectadas:"
pass "  A) segunda régua no hook (detecção DUPLA: comando + cobertura do CORE)"
pass "  B) comando novo sem decisão   C) recorte sem razão escrita"
pass "  D) declaração que envelheceu   E) gate do CORE sumido da lista"
pass "  F) hook fantasma (fail-closed)"
echo ""
exit 0
