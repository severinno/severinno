#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-env-mirror.sh — Mutation tests do check-env-mirror
#
# Usage:
#   ./scripts/test-mutation-env-mirror.sh
#
# Exit codes:
#   0 — as QUATRO mutações DETECTADAS: cada defesa cortada deixa a suíte
#       VERMELHA pela âncora da sua prova ✅
#   1 — suíte CEGA (verde com a mutação) / falhou por outro motivo / a mutação
#       não aplicou / uma âncora sumiu ou virou ambígua / infra ❌
#
# POR QUE: o `scripts/check-env-mirror.mjs` reconciliaria o env do host com o
# template comitado — e as quatro defesas que ele tem contra fazer isso ERRADO
# não são o mesmo fio:
#
#   A) O PORTÃO DA CONTA (`applyFix`). Reaplica o plano em memória e compara o
#      que a MESMA regra ainda acusa com o que o plano nomeou como decisão
#      humana. Se sobrar violação que ele não explicou, NADA é escrito: aquilo é
#      uma divergência que este reconciliador não entende, e escrever seria
#      APAGAR a dúvida em vez de mostrá-la.
#
#   B) A DEFESA DO SEGREDO (`applyFix`). O plano nunca edita um nome de
#      `SECRET_ENV_VARIABLES`; a defesa existe para o dia em que a regra mudar
#      (uma variável nova entrando na lista) e o único valor que o host poderia
#      receber seria o PLACEHOLDER COMITADO — um segredo publicado no VPS.
#
#   C) `maskSecrets`. O plano também nunca edita um segredo, mas o CONTEXTO do
#      diff alcança: um segredo a menos de três linhas de uma correção entra no
#      patch como linha ` ` (inalterada) e levaria o valor REAL junto — para o
#      terminal, para o PR, para o chat. Mascarar custa a aplicabilidade literal
#      com `git apply` e é exatamente o trade-off que o desenho escolhe.
#
#   D) O SEGREDO AUSENTE VIRA `add`. A tentação é tratar "declarado no template
#      e ausente no host" igual às outras variáveis (acrescentar com o valor do
#      template) — e o valor do template, num segredo, é o PLACEHOLDER. O ramo
#      certo devolve DECISÃO HUMANA: o valor real só o operador tem.
#
# Nenhuma das quatro é visível pelo exit code no caso comum (o guard sai 1 por
# divergência e 0 em sincronia, com ou sem elas) — quem as mede são a suíte e o
# `--fix`. Por isso a prova é por MUTAÇÃO, uma por defesa, cada uma exigindo o
# âncora da SUA prova vermelho e as âncoras das outras PASSING: se as quatro
# caírem juntas, o que morreu foi o comando, não a defesa nomeada.
#
# COMO: muta `scripts/check-env-mirror.mjs` IN-PLACE (backup + trap de
# restauração, NUNCA `git checkout`), uma defesa por vez, e roda o vitest REAL
# (precisa de node_modules — por isso o job é o do seed-guards.yml, NÃO a matriz
# node-pura do master) em src/lib/__tests__/check-env-mirror.test.ts, decidindo
# pelo JSON do reporter (--reporter=json), não por texto:
#
#   CONTROLE — arquivo íntegro → suíte VERDE (success=true, 0 falhas) e TODAS as
#     âncoras das quatro mutações EXISTEM e PASSAM agora. Cada âncora tem de
#     casar EXATAMENTE UM teste: uma âncora ambígua mediria a prova errada (e
#     uma renomeada/removida não teria o que acender) — fail-fast AQUI, para a
#     detecção abaixo não ser vácuo;
#   MUTAÇÃO — defesa cortada → suíte VERMELHA (success=false) com:
#     • CADA âncora da PROVA mutada FAILING;
#     • as âncoras INTACTAS PASSING — a prova de que a mutação é CIRÚRGICA: as
#       outras três defesas e o caminho saudável seguem de pé, então o que
#       morreu foi a defesa nomeada e não o comando inteiro. O nº total de
#       testes também tem de bater com o do controle (o arquivo rodou INTEIRO).
#
# ⚠️ Source-coupled (como os demais test-mutation-*.sh): as trocas ancoram em
# linhas literais do guard (o portão da conta, o filtro do segredo, o retorno da
# máscara e o desvio do segredo-ausente — este último pela JANELA de três linhas,
# porque o alvo se repete no arquivo) e as asserções nos títulos dos testes.
# Reformular qualquer uma delas ou renomear um teste exige atualizar ESTE script
# junto — e ele FALHA (exit 1) em vez de passar em silêncio quando isso acontece.
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
cd "$SCRIPT_DIR"

# A RÉGUA ÚNICA da prova-de-aplicação (`mutacao_aplicar`): a troca num arquivo do
# REPOSITÓRIO passa por ela — o `check-mutation-count` recusa a cirurgia privada
# (`sed -i`) em QUALQUER `scripts/test-mutation-*.sh`, e uma troca sem a prova de
# que aplicou mede o alvo ÍNTEGRO (o verde em VÁCUO). O gabarito dela é
# `scripts/test-mutation-mutacao-prova.sh`.
# shellcheck source=scripts/mutacao-prova.sh
. "$SCRIPT_DIR/scripts/mutacao-prova.sh"

GUARD="scripts/check-env-mirror.mjs"
TEST_FILE="src/lib/__tests__/check-env-mirror.test.ts"

TMP_DIR="$(mktemp -d "$MUT_SCRATCH/mut-XXXXXX")"
BACKUP_DIR="$TMP_DIR/backup"
RESULTS_CONTROL="$TMP_DIR/control.json"

# ── Caso A — o PORTÃO DA CONTA vira no-op ────────────────────────────────
# Sem o portão, uma violação que o plano não explicou vira ESCRITA silenciosa
# (o `write(plan.reconciled)` do fim). A linha mutada é condicional: o caminho
# que FECHA a conta (unexplained === 0) segue intacto — é a âncora cirúrgica.
C1_ANCHOR_DOC="  if (unexplained !== 0) {"
# A troca é o par LITERAL que a régua única aplica (o alvo casa UM sítio só, e o
# payload carrega o marcador `MUTACAO`): o `sed -i` da forma antiga trocava a
# linha sem PROVAR que a escrita entrou.
C1_LINHA="$C1_ANCHOR_DOC"
C1_MARKER="  if (false) { // MUTACAO M1: MUTATION-ENV-MIRROR-A"

# ── Caso B — a DEFESA DO SEGREDO vira no-op ──────────────────────────────
# O filtro passa a devolver [] e o plano com um SEGREDO é escrito.
C2_ANCHOR_DOC="  const forbidden = plan.edits.filter((e) => classifyEnvVariable(e.name) === \"secret\")"
C2_LINHA="$C2_ANCHOR_DOC"
C2_MARKER="  const forbidden = [] // MUTACAO M2: MUTATION-ENV-MIRROR-B"

# ── Caso C — `maskSecrets` vira no-op ────────────────────────────────────
# O patch volta a sair com o valor REAL no contexto (e o relatório passa a
# dizê-lo "byte-exato", que é a mentira perigosa: `git apply` funcionaria e o
# segredo iria junto).
C3_ANCHOR_DOC='      return `${m[1]}${assign[1]}${assign[2]}=${MASK}`'
C3_LINHA="$C3_ANCHOR_DOC"
C3_MARKER='      return line // MUTACAO M3: MUTATION-ENV-MIRROR-C'

# ── Caso D — o SEGREDO AUSENTE vira `add` ───────────────────────────────
# O desvio do passo 2 (nome declarado no template e ausente no host) deixa de
# mandar segredo para `manual` e cai no `else`: vira edição `add` com o valor do
# template — o placeholder comitado gravado no host. A mutação é ESCOPADA ao
# laço (a outra ocorrência da mesma linha, no passo 4, tem de SOBREVIVER).
C4_ANCHOR_DOC="  for (const name of [...template.keys()].sort()) {"
# Aqui o alvo NÃO é único: `if (classifyEnvVariable(name) === "secret") {`
# aparece DUAS vezes no guard (o passo 2 e o passo 4), e a régua exige um alvo
# CIRÚRGICO. A janela LITERAL de três linhas (o `ADDR,+2` da forma antiga) é o
# que dá o sítio: a mutação atinge o passo 2 e o passo 4 SOBREVIVE — o CONTROLE
# que o LEFTOVER conta.
C4_LINHA='  for (const name of [...template.keys()].sort()) {
    if (host.has(name)) continue
    if (classifyEnvVariable(name) === "secret") {'
C4_MARKER='  for (const name of [...template.keys()].sort()) {
    if (host.has(name)) continue
    if (false) { // MUTACAO M4: MUTATION-ENV-MIRROR-D'
C4_LEFTOVER='    if (classifyEnvVariable(name) === "secret") {'
C4_LEFTOVER_EXPECTED="1"

# ── Âncoras — UMA PROVA POR ÂNCORA ───────────────────────────────────────
# Formato: "nome da prova|substring ÚNICA do fullName do teste".
# `RED` = a prova mutada; `INTACT` = o que NÃO pode cair junto (a cirurgia).
#
# As âncoras evitam backticks de propósito: dentro de string com aspas duplas,
# backtick é substituição de comando no bash.
C1_RED=(
  "portão da conta (violação não explicada → recusa e nada é escrito)|violação que o plano NÃO explicou → recusa e não escreve nada"
)
C1_INTACT=(
  "a defesa do segredo (a outra recusa do mesmo applyFix)|defesa em profundidade: plano que tentaria escrever um SEGREDO é recusado"
  "o caminho saudável (conta fechada → escreve)|plano que fecha a conta → escreve o conteúdo reconciliado"
)

C2_RED=(
  "defesa do segredo (plano com SEGREDO → recusado)|defesa em profundidade: plano que tentaria escrever um SEGREDO é recusado"
)
C2_INTACT=(
  "portão da conta|violação que o plano NÃO explicou → recusa e não escreve nada"
  "o caminho saudável (conta fechada → escreve)|plano que fecha a conta → escreve o conteúdo reconciliado"
)

C3_RED=(
  "maskSecrets (o valor do segredo no CONTEXTO do diff)|mascara o valor de um segredo que caia no CONTEXTO"
  "maskSecrets na ponta (o segredo nunca sai da CLI)|o segredo NUNCA aparece na saída"
)
C3_INTACT=(
  "o plano do host (a máscara não decide o que muda)|variável comum AUSENTE no host → UMA edição"
  "o caminho saudável (conta fechada → escreve)|plano que fecha a conta → escreve o conteúdo reconciliado"
)

C4_RED=(
  "segredo ausente no host → decisão humana, nunca edição|SEGREDO ausente/vazio/igual ao template → manual nos três, nunca edição"
)
C4_INTACT=(
  "a variável COMUM ausente segue virando add (o outro ramo do mesmo if)|variável comum AUSENTE no host → UMA edição"
  "o portão da conta|violação que o plano NÃO explicou → recusa e não escreve nada"
)

ALL_ANCHORS=(
  "${C1_RED[@]}"
  "${C1_INTACT[@]}"
  "${C2_RED[@]}"
  "${C2_INTACT[@]}"
  "${C3_RED[@]}"
  "${C3_INTACT[@]}"
  "${C4_RED[@]}"
  "${C4_INTACT[@]}"
)

# ── Colors ────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

# ── Restore (trap EXIT — SEMPRE restaura, mesmo com falha) ───────────────
restore_guard() {
  if [ -f "$BACKUP_DIR/guard" ] && [ -f "$GUARD" ]; then
    cp "$BACKUP_DIR/guard" "$GUARD"
    echo "  ↻ $GUARD restaurado do backup"
  fi
  rm -rf "$TMP_DIR"
}
trap restore_guard EXIT

# ── Helpers ───────────────────────────────────────────────────────────────

run_vitest() {
  local results="$1"
  rm -f "$results"
  set +e
  VITEST_LOG="$(bun x vitest run --config vitest.config.unit.ts --reporter=json --outputFile="$results" "$TEST_FILE" 2>&1)"
  VITEST_EXIT=$?
  set -e
}

results_summary() {
  node -e '
    const fs = require("node:fs")
    const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    process.stdout.write(
      [j.success, j.numFailedTests, j.numPassedTests, j.numTotalTests].join("|"),
    )
  ' "$1"
}

anchor_report() {
  node -e '
    const fs = require("node:fs")
    const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    const sub = process.argv[2]
    const hits = (j.testResults ?? [])
      .flatMap((f) => f.assertionResults ?? [])
      .filter((r) => (r.fullName ?? "").includes(sub))
    process.stdout.write(
      hits.length === 0 ? "0|absent" : `${hits.length}|${hits.map((h) => h.status).join(",")}`,
    )
  ' "$1" "$2"
}

# assert_anchors: exige que CADA entrada de "$@" (formato "prova|substring")
# esteja no estado esperado ($1 = json, $2 = status). Imprime o total no stdout.
assert_anchors() {
  local results="$1" expected="$2"
  shift 2
  local entry name sub report count statuses checked=0
  for entry in "$@"; do
    name="${entry%%|*}"
    sub="${entry#*|}"
    report="$(anchor_report "$results" "$sub")"
    count="${report%%|*}"
    statuses="${report#*|}"
    if [ "$count" != "1" ] || [ "$statuses" != "$expected" ]; then
      fail "âncora da prova '$name' fora do estado esperado."
      fail "  \"$sub\" → $count teste(s) casaram, status '$statuses' (esperado 1 casando, '$expected')"
      fail "Renomeou/removeu/duplicou um teste? Atualize as âncoras DESTE script."
      return 1
    fi
    checked=$((checked + 1))
  done
  echo "$checked"
}

# ── CONTROLE — guard íntegro → suíte VERDE, com TODAS as âncoras vivas ───
assert_control_pass() {
  info "CONTROLE — guard íntegro → suíte deve ficar VERDE (exit 0)..."
  run_vitest "$RESULTS_CONTROL"
  echo "$VITEST_LOG" | tail -5

  if [ ! -f "$RESULTS_CONTROL" ]; then
    fail "CONTROLE FALHOU: o vitest não produziu o JSON de resultados."
    fail "Ambiente sem node_modules? Este script precisa de bun install."
    exit 1
  fi

  local summary success failed total
  summary="$(results_summary "$RESULTS_CONTROL")"
  success="${summary%%|*}"
  failed="$(echo "$summary" | cut -d'|' -f2)"
  total="$(echo "$summary" | cut -d'|' -f4)"

  if [ "$VITEST_EXIT" -ne 0 ] || [ "$success" != "true" ] || [ "$failed" != "0" ]; then
    fail "CONTROLE FALHOU: suíte não ficou verde com o guard ÍNTEGRO"
    fail "  (exit=$VITEST_EXIT, success=$success, failed=$failed)."
    exit 1
  fi

  if ! CONTROL_ALIVE="$(assert_anchors "$RESULTS_CONTROL" passed "${ALL_ANCHORS[@]}")"; then
    fail "CONTROLE FALHOU: nem todas as âncoras das QUATRO provas estão vivas agora."
    exit 1
  fi

  CONTROL_TOTAL="$total"
  pass "Controle OK — $total testes verdes, com $CONTROL_ALIVE âncoras vivas (1 teste cada)"
}

# ── MUTAÇÃO — uma defesa cortada → suíte VERMELHA ────────────────────────
# Lê os globais CASE_* (definidos antes de cada chamada) e decide pelo JSON.
assert_mutation_detected() {
  local name="$1"
  local results="$TMP_DIR/mutation.json"
  info "MUTAÇÃO $name — suíte deve ficar VERMELHA..."

  if ! grep -Fq "$CASE_ANCHOR_DOC" "$GUARD"; then
    fail "MUTAÇÃO NÃO APLICOU: a âncora '$CASE_ANCHOR_DOC' não existe em $GUARD"
    fail "O guard foi refatorado? Atualize a mutação DESTE script junto."
    exit 1
  fi
  mutacao_aplicar "$GUARD" "$CASE_LINHA" "$CASE_MARKER" "$(cksum "$GUARD" | cut -d' ' -f1)"
  if ! grep -Fq "$CASE_MARKER" "$GUARD"; then
    fail "MUTAÇÃO NÃO APLICOU (a régua não produziu o marcador)."
    exit 1
  fi
  if [ -n "$CASE_LEFTOVER" ]; then
    local remaining
    remaining="$(grep -cF "$CASE_LEFTOVER" "$GUARD" || true)"
    if [ "$remaining" != "$CASE_LEFTOVER_EXPECTED" ]; then
      fail "MUTAÇÃO NÃO-CIRÚRGICA: sobraram $remaining ocorrência(s) de '$CASE_LEFTOVER'"
      fail "  (esperado $CASE_LEFTOVER_EXPECTED — o desvio do passo 4 tem de sobreviver)"
      exit 1
    fi
  fi
  if ! node --check "$GUARD" >/dev/null 2>&1; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: o arquivo mutado não é válido sintaticamente."
    exit 1
  fi
  pass "Mutação $name aplicada (sintaxe válida)"

  run_vitest "$results"
  echo "$VITEST_LOG" | tail -5

  if [ "$VITEST_EXIT" -eq 0 ]; then
    fail "SUÍTE CEGA: o check-env-mirror.test.ts passou (exit 0) com a defesa mutada."
    exit 1
  fi

  if [ ! -f "$results" ]; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: o vitest não produziu JSON (a mutação quebrou"
    fail "o carregamento do arquivo, e não só a defesa que ela afirma cortar)."
    exit 1
  fi

  local summary success failed total
  summary="$(results_summary "$results")"
  success="${summary%%|*}"
  failed="$(echo "$summary" | cut -d'|' -f2)"
  total="$(echo "$summary" | cut -d'|' -f4)"

  if [ "$success" != "false" ] || [ "$failed" = "0" ] || [ "$total" != "$CONTROL_TOTAL" ]; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: a suíte falhou por outro motivo"
    fail "  (success=$success, failed=$failed, total=$total; controle=$CONTROL_TOTAL)."
    fail "Cortar a defesa tem de derrubar a sua prova, não o arquivo inteiro."
    exit 1
  fi

  local red
  if ! red="$(assert_anchors "$results" failed "${CASE_RED[@]}")"; then
    fail "A prova do caso $name NÃO caiu com a defesa mutada."
    exit 1
  fi

  local intact
  if ! intact="$(assert_anchors "$results" passed "${CASE_INTACT[@]}")"; then
    fail "Mutação $name NÃO-CIRÚRGICA: uma âncora que devia ficar INTACTA caiu."
    fail "A mutação deve cortar SÓ a defesa que ela nomeia."
    exit 1
  fi

  pass "Mutação $name DETECTADA: suíte VERMELHA ($failed de $total testes falharam)"
  pass "  • $red prova(s) com a âncora FAILED"
  pass "  • $intact âncora(s) INTACTA(s) PASSED (mutação cirúrgica)"
  cp "$BACKUP_DIR/guard" "$GUARD"
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (as quatro defesas do check-env-mirror)"
echo "   A. o portão da conta vira no-op (escrita sem a conta fechar)"
echo "   B. a defesa do segredo vira no-op (placeholder comitado no host)"
echo "   C. maskSecrets vira no-op (o valor real sai no patch)"
echo "   D. o segredo ausente vira add (o placeholder gravado no host)"
echo "   (scripts/check-env-mirror.mjs IN-PLACE, backup + trap de restauração)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

mkdir -p "$BACKUP_DIR"
cp "$GUARD" "$BACKUP_DIR/guard"
pass "Backup do guard criado ($BACKUP_DIR/guard)"

assert_control_pass

echo ""
info "Caso A — cortando o portão da conta..."
CASE_ANCHOR_DOC="$C1_ANCHOR_DOC"
CASE_LINHA="$C1_LINHA"
CASE_MARKER="$C1_MARKER"
CASE_LEFTOVER=""
CASE_LEFTOVER_EXPECTED="0"
CASE_RED=("${C1_RED[@]}")
CASE_INTACT=("${C1_INTACT[@]}")
assert_mutation_detected "A (portão da conta)"

echo ""
info "Caso B — cortando a defesa do segredo..."
CASE_ANCHOR_DOC="$C2_ANCHOR_DOC"
CASE_LINHA="$C2_LINHA"
CASE_MARKER="$C2_MARKER"
CASE_LEFTOVER=""
CASE_LEFTOVER_EXPECTED="0"
CASE_RED=("${C2_RED[@]}")
CASE_INTACT=("${C2_INTACT[@]}")
assert_mutation_detected "B (defesa do segredo)"

echo ""
info "Caso C — tornando maskSecrets um no-op..."
CASE_ANCHOR_DOC="$C3_ANCHOR_DOC"
CASE_LINHA="$C3_LINHA"
CASE_MARKER="$C3_MARKER"
CASE_LEFTOVER=""
CASE_LEFTOVER_EXPECTED="0"
CASE_RED=("${C3_RED[@]}")
CASE_INTACT=("${C3_INTACT[@]}")
assert_mutation_detected "C (maskSecrets)"

echo ""
info "Caso D — fazendo o segredo ausente virar add..."
CASE_ANCHOR_DOC="$C4_ANCHOR_DOC"
CASE_LINHA="$C4_LINHA"
CASE_MARKER="$C4_MARKER"
CASE_LEFTOVER="$C4_LEFTOVER"
CASE_LEFTOVER_EXPECTED="$C4_LEFTOVER_EXPECTED"
CASE_RED=("${C4_RED[@]}")
CASE_INTACT=("${C4_INTACT[@]}")
assert_mutation_detected "D (segredo ausente vira add)"

echo ""
pass "MUTATION TEST PASSED — as quatro defesas do check-env-mirror"
pass "  • controle: guard íntegro → verde, com as ${#ALL_ANCHORS[@]} âncoras vivas (1 teste cada)"
pass "  • A: portão da conta cortado → vermelha pela prova da recusa (${#C1_RED[@]})"
pass "  • B: defesa do segredo cortada → vermelha pela prova da recusa (${#C2_RED[@]})"
pass "  • C: máscara no-op → vermelha na unidade E na ponta (${#C3_RED[@]})"
pass "  • D: segredo ausente vira add → vermelha pela prova do manual (${#C4_RED[@]})"
pass "  • cirúrgicas: as OUTRAS defesas e o caminho saudável seguem de pé"
exit 0
