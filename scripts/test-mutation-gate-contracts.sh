#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-gate-contracts.sh — Mutation test do CONTRATO DE GATES
# CORE (as três regras que fazem `readAllGateContracts` medir o que ele promete)
#
# Usage:
#   ./scripts/test-mutation-gate-contracts.sh
#
# Exit codes:
#   0 — as TRÊS regras DETECTADAS: cada uma cortada deixa a suíte VERMELHA pela
#       âncora do PRÓPRIO contrato ✅
#   1 — suíte CEGA (verde com a mutação) / falhou por outro motivo / a mutação
#       não aplicou (não-cirúrgica) / uma âncora sumiu, virou ambígua ou caiu
#       fora do estado esperado / infra ❌
#
# POR QUE: o doctor responde "o que o manifesto EXIGE é CORE e roda o comando
# certo?". Essa pergunta tem TRÊS regras, e cada uma degrada em SILÊNCIO — o
# relatório continua saindo, as seções continuam ali, e o veredito passa a
# dizer PRONTA sobre um contrato de merge que ninguém mediu:
#
#   A) a FORJA DECLARANTE. Um contrato só é conferido contra as forjas que
#      DECLARAM aquele job (`declared.filter(df => df.jobIds.includes(jobId))`).
#      Sem o recorte, um job que só o GitHub exige (o `lint-guard`) passa a ser
#      cobrado da Gitea — "a forja gitea NÃO exige o job 'lint-guard'" — e o
#      fato acusa um defeito que não existe. Um FALSO POSITIVO num gate de
#      merge ensina o operador a ignorar o veredito, que é o pior desfecho
#      possível para um diagnóstico.
#
#   B) a RÉGUA. O comando esperado de cada contrato é o `command` da
#      INVARIANTE (`expectedCommand: inv.command`) — o COMANDO CANÔNICO, com os
#      argumentos, o MESMO para toda forja que declara aquele job. Enfraquecer
#      essa régua (aceitar qualquer comando) é o que reabre a assimetria que
#      este repositório já pagou uma vez: o mesmo commit aprovado no merge da
#      Gitea e rejeitado no GitHub, liberado pelo lado LAXO — a régua do job
#      deixa de ser medida e o gate vira decorativo. Trocar o `command` pelo
#      `matches` (a IDENTIDADE do gate, frouxa de propósito) reabre a mesma
#      assimetria por outro caminho: qualquer invocação do script passa,
#      inclusive sem o argumento que o canônico carrega.
#
#   C) o CONTRATO POR INVARIANTE×JOB. A chave do contrato é `${inv.id}|${jid}`,
#      não o job: SEIS invariantes (ts-nocheck, required-checks,
#      registry-source, runner-base, forge-parity, forge-workflow-scope)
#      compartilham o job `guards` da Gitea. Deduplicando pelo job, cinco delas
#      saem da lista de contratos e aparecem como COBERTAS sem nunca terem sido
#      olhadas — a regressão mais barata de cometer e a mais difícil de ver (a
#      suíte segue verde e o relatório segue dizendo que mediu).
#
# COMO: três mutações IN-PLACE em `scripts/forge-doctor.mjs`, cada uma com
# âncoras POR REGRA e um controle, no mesmo desenho dos outros
# `test-mutation-*.sh` deste repositório:
#
#   CONTROLE — arquivo íntegro → suíte VERDE (success=true, 0 falhas) e TODAS
#     as âncoras das TRÊS regras EXISTEM e PASSAM agora. Cada âncora tem de
#     casar EXATAMENTE UM teste: uma âncora ambígua mediria o fato errado e uma
#     renomeada/removida não teria o que acender — fail-fast AQUI, para a
#     detecção abaixo não ser vácuo;
#   MUTAÇÃO — regra cortada → suíte VERMELHA (success=false, MESMO total de
#     testes) com:
#     • CADA âncora da regra mutada FAILING (a regra tem de ter quem a meça);
#     • as âncoras INTACTAS PASSING — a prova de que a mutação é CIRÚRGICA: a
#       OUTRA regra deste mesmo fato e o veredito seguem medindo.
#
# ⚠️ Source-coupled (como os demais test-mutation-*.sh): o sed ancora em linhas
# literais (`const declaring = declared.filter`, `expectedCommand: inv.command`
# e `const key = \`${inv.id}|${jid}\``) e as asserções nos TÍTULOS dos testes de
# `src/lib/__tests__/forge-doctor.test.ts`. Reformular qualquer uma delas ou
# renomear um teste exige atualizar ESTE script junto — e ele FALHA (exit 1) em
# vez de passar em silêncio quando isso acontece.
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

DOCTOR="scripts/forge-doctor.mjs"
TEST_FILE="src/lib/__tests__/forge-doctor.test.ts"

TMP_DIR="$(mktemp -d "$MUT_SCRATCH/mut-XXXXXX")"
BACKUP_DIR="$TMP_DIR/backup"

RESULTS_CONTROL="$TMP_DIR/control.json"

# ── Caso A — a FORJA DECLARANTE ──────────────────────────────────────────
# O recorte deixa de valer para o job que SÓ o GitHub exige (o caso que a regra
# existe para proteger): a Gitea passa a ser cobrada por um job que ela não
# declara, e o fato produz a violação que ele existe para NÃO produzir.
C1_ANCHOR_DOC="const declaring = declared.filter"
C1_SED='/const declaring = declared\.filter/ s/.*/    const declaring = declared.filter((df) => (df.jobIds ?? []).includes(c.jobId) || (c.jobId === "lint-guard" \&\& df.forge === "gitea")) \/\/ MUTATION-GATE-DECLARING/'
C1_MARKER="// MUTATION-GATE-DECLARING"
# O recorte tem de continuar existindo UMA vez: a mutação ACRESCENTA uma
# condição ao mesmo filtro (não cria um segundo), e o `?? []` do original
# continua no lugar.
C1_LEFTOVER="(df.jobIds ?? []).includes(c.jobId)"
C1_LEFTOVER_EXPECTED="1"

# ── Caso B — a RÉGUA da invariante ───────────────────────────────────────
# `expectedCommand: inv.command` vira `/./`: QUALQUER `run:` do job satisfaz o
# contrato, então a régua para de ser medida — o furo que deixava o merge ser
# liberado pelo lado mais fraco.
C2_ANCHOR_DOC="expectedCommand: inv.command,"
C2_SED='/expectedCommand: inv\.command,/ s/.*/        expectedCommand: \/.\/, \/\/ MUTATION-GATE-RULER/'
C2_MARKER="// MUTATION-GATE-RULER"
C2_LEFTOVER=""
C2_LEFTOVER_EXPECTED="0"

# ── Caso C — o CONTRATO por invariante×job ───────────────────────────────
# A chave do dedup volta a ser o JOB: as invariantes que compartilham o job
# `guards` da Gitea somem da lista de contratos e passam a "cobertas" sem
# medição — a mutação é CIRÚRGICA por desenho (um único teste mede a chave).
C3_ANCHOR_DOC="const key = \`\${inv.id}|\${jid}\`"
C3_SED='/const key = `/ s/.*/      const key = jid \/\/ MUTATION-GATE-CONTRACT-KEY/'
C3_MARKER="// MUTATION-GATE-CONTRACT-KEY"
C3_LEFTOVER='const key = `${inv.id}|${jid}`'
C3_LEFTOVER_EXPECTED="0"

# ── Âncoras — UMA REGRA, AS SUAS TESTEMUNHAS ─────────────────────────────
# Formato: "nome da regra|substring ÚNICA do fullName do teste".
GATE_DESCRIBE="readAllGateContracts"

# A. a forja DECLARANTE: o recorte cortado tem de derrubar (1) a âncora da
# própria regra, (2) a prova de que o contrato do job declarado por UMA forja
# fica provado e (3) o controle da régua própria (o recorte é o que impede o
# falso positivo de sequestrar o caso legítimo).
C1_RED=(
  "A forja DECLARANTE (a regra)|a forja que NÃO declara o job não vira violação"
  "A contrato do job declarado por UMA forja segue provado|a régua é UMA: as duas forjas rodam o MESMO"
  "A régua própria da forja continua acusada|uma forja com régua PRÓPRIA"
)
# As outras duas regras deste mesmo fato (régua e chave invariante×job) e o
# veredito seguem medindo: sem isso, a mutação poderia ter matado o arquivo.
C1_INTACT=(
  "B o gate trocado continua acusado (a régua vive)|sem o comando da régua, o fato acusa o gate trocado"
  "C cada invariante que compartilha o job 'guards' segue medida|cada invariante que compartilha o job 'guards'"
  "o veredito segue funcionando|summarize — o veredito gate vermelho → BLOQUEADA"
)

# B. a RÉGUA: aceitar qualquer comando derruba tudo o que depende de o comando
# ser COMPARADO — inclusive o controle do gate trocado e a régua por
# invariante (que mede a régua de cada uma das NOVE do job `guards`).
C2_RED=(
  "B a régua é a da INVARIANTE, a mesma nas duas forjas|a régua é UMA: as duas forjas rodam o MESMO"
  "B a forja com régua PRÓPRIA é violação|uma forja com régua PRÓPRIA"
  "B o gate trocado é acusado|sem o comando da régua, o fato acusa o gate trocado"
  "B o comando do gate não é sequestrado pelo rótulo|um passo com 'check' no RÓTULO"
  "B o contrato por invariante×job mede a régua de CADA uma|cada invariante que compartilha o job 'guards'"
)
# A regra A (o recorte) não depende da régua: ela tem de seguir verde.
C2_INTACT=(
  "A o recorte da forja declarante sobrevive|a forja que NÃO declara o job não vira violação"
  "o veredito segue funcionando|summarize — o veredito gate vermelho → BLOQUEADA"
)

# C. o CONTRATO por invariante×job: só a âncora da chave cai (a mutação é
# cirúrgica por desenho — é o que prova que ela mede a chave, não o arquivo).
C3_RED=(
  "C cada invariante tem a SUA régua medida (a chave é invariante×job)|cada invariante que compartilha o job 'guards'"
)
C3_INTACT=(
  "A o recorte da forja declarante sobrevive|a forja que NÃO declara o job não vira violação"
  "B a régua é a da INVARIANTE|a régua é UMA: as duas forjas rodam o MESMO"
  "B a forja com régua PRÓPRIA é violação|uma forja com régua PRÓPRIA"
  "B o gate trocado é acusado|sem o comando da régua, o fato acusa o gate trocado"
  "B o comando do gate não é sequestrado pelo rótulo|um passo com 'check' no RÓTULO"
  "o veredito segue funcionando|summarize — o veredito gate vermelho → BLOQUEADA"
)

# Todas as âncoras — o CONTROLE exige cada uma VIVA (1 teste casando, passed).
ALL_ANCHORS=(
  "${C1_RED[@]}"
  "${C1_INTACT[@]}"
  "${C2_RED[@]}"
  "${C2_INTACT[@]}"
  "${C3_RED[@]}"
  "${C3_INTACT[@]}"
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
# cp do backup (NUNCA `git checkout --`) para não descartar edições locais
# não-commitadas de quem roda o script na própria máquina.
restore_doctor() {
  if [ -f "$BACKUP_DIR/doctor" ] && [ -f "$DOCTOR" ]; then
    cp "$BACKUP_DIR/doctor" "$DOCTOR"
    echo "  ↻ $DOCTOR restaurado do backup"
  fi
  rm -rf "$TMP_DIR"
}
trap restore_doctor EXIT

# ── Helpers ───────────────────────────────────────────────────────────────

# run_vitest: roda o arquivo de teste com o reporter JSON e captura output/exit.
run_vitest() {
  local results="$1"
  rm -f "$results"
  set +e
  VITEST_LOG="$(bun x vitest run --config vitest.config.unit.ts --reporter=json --outputFile="$results" "$TEST_FILE" 2>&1)"
  VITEST_EXIT=$?
  set -e
}

# results_summary: imprime "success|failed|passed|total" do JSON do vitest.
results_summary() {
  node -e '
    const fs = require("node:fs")
    const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    process.stdout.write(
      [j.success, j.numFailedTests, j.numPassedTests, j.numTotalTests].join("|"),
    )
  ' "$1"
}

# anchor_report: imprime "N|status1,status2" para os testes cujo fullName contém
# a substring — N é QUANTOS casaram. O `N` é o que impede âncora AMBÍGUA (uma
# substring que casa dois testes) de medir o fato errado em silêncio.
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

# assert_anchors: exige que CADA entrada de "$@" (formato "regra|substring")
# esteja no estado esperado ($1 = json, $2 = expected status, resto = âncoras).
# Imprime o total conferido no stdout.
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
      # Os diagnósticos vão para STDERR: `assert_anchors` roda dentro de um
      # `$(...)` (o stdout é o CONTADOR), então um `fail` no stdout seria
      # ENGOLIDO — a falha apareceria sem dizer QUAL âncora caiu.
      fail "âncora da regra '$name' fora do estado esperado." >&2
      fail "  \"$sub\" → $count teste(s) casaram, status '$statuses' (esperado 1 casando, '$expected')" >&2
      fail "Renomeou/removeu/duplicou um teste? Atualize as âncoras DESTE script." >&2
      return 1
    fi
    checked=$((checked + 1))
  done
  echo "$checked"
}

# ── CONTROLE — doctor íntegro → suíte VERDE, com TODAS as âncoras vivas ──
# Sem isto a detecção abaixo seria vácuo: âncora renomeada/removida (ou
# ambígua) não acenderia com a mutação, e o script passaria sem provar nada.
assert_control_pass() {
  info "CONTROLE — doctor íntegro → suíte deve ficar VERDE (exit 0)..."
  run_vitest "$RESULTS_CONTROL"
  echo "$VITEST_LOG" | tail -6

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
    fail "CONTROLE FALHOU: suíte não ficou verde com o doctor ÍNTEGRO"
    fail "  (exit=$VITEST_EXIT, success=$success, failed=$failed)."
    exit 1
  fi

  if ! CONTROL_ALIVE="$(assert_anchors "$RESULTS_CONTROL" passed "${ALL_ANCHORS[@]}")"; then
    fail "CONTROLE FALHOU: nem todas as âncoras das TRÊS regras estão vivas agora."
    exit 1
  fi

  CONTROL_TOTAL="$total"
  pass "Controle OK — $total testes verdes, com $CONTROL_ALIVE âncoras vivas (1 teste cada)"
}

# ── MUTAÇÃO — uma regra cortada → suíte VERMELHA ─────────────────────────
# Lê os globais CASE_* (definidos antes de cada chamada) e decide pelo JSON.
assert_mutation_detected() {
  local name="$1"
  local results="$TMP_DIR/mutation.json"
  info "MUTAÇÃO $name — suíte deve ficar VERMELHA..."

  # Fail-fast da mutação: aplicar, conferir o MARCADOR (o sed não trocou nada é
  # um caso próprio) e a sintaxe.
  if ! grep -Fq "$CASE_ANCHOR_DOC" "$DOCTOR"; then
    fail "MUTAÇÃO NÃO APLICOU: a âncora '$CASE_ANCHOR_DOC' não existe em $DOCTOR"
    fail "O doctor foi refatorado? Atualize a mutação DESTE script junto."
    exit 1
  fi
  sed -i "$CASE_SED" "$DOCTOR"
  if ! grep -Fq "$CASE_MARKER" "$DOCTOR"; then
    fail "MUTAÇÃO NÃO APLICOU (o sed não produziu o marcador)."
    exit 1
  fi
  # Não-cirúrgica por SINTAXE: um arquivo inválido derrubaria a suíte inteira
  # (erro de import), e a prova não isolaria a regra que ela nomeia.
  if ! node --check "$DOCTOR" >/dev/null 2>&1; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: o arquivo mutado não é válido sintaticamente."
    exit 1
  fi
  # Não-cirúrgica por CONTAGEM: a mutação não pode tocar em outra ocorrência da
  # mesma linha (o `expectedCommand`/a chave do contrato têm de sobreviver).
  if [ -n "$CASE_LEFTOVER" ]; then
    local remaining
    remaining="$(grep -cF "$CASE_LEFTOVER" "$DOCTOR" || true)"
    if [ "$remaining" != "$CASE_LEFTOVER_EXPECTED" ]; then
      fail "MUTAÇÃO NÃO-CIRÚRGICA: sobraram $remaining ocorrência(s) de '$CASE_LEFTOVER'"
      fail "  (esperado $CASE_LEFTOVER_EXPECTED)."
      exit 1
    fi
  fi
  pass "Mutação $name aplicada (sintaxe válida)"

  run_vitest "$results"
  echo "$VITEST_LOG" | tail -6

  # Caso 0 — SUÍTE CEGA: passou com a regra cortada. É exatamente a falha
  # silenciosa que este cenário existe para impedir.
  if [ "$VITEST_EXIT" -eq 0 ]; then
    fail "SUÍTE CEGA: o forge-doctor.test.ts passou (exit 0) com a regra cortada."
    fail "A regra '$name' não tem quem a meça — o contrato de merge pode voltar"
    fail "a ser medido sem a forja declarante, sem a régua ou por job em vez de invariante×job."
    exit 1
  fi

  if [ ! -f "$results" ]; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: o vitest não produziu JSON (a mutação quebrou"
    fail "o carregamento do arquivo, e não só a regra que ela afirma cortar)."
    exit 1
  fi

  local summary success failed total
  summary="$(results_summary "$results")"
  success="${summary%%|*}"
  failed="$(echo "$summary" | cut -d'|' -f2)"
  total="$(echo "$summary" | cut -d'|' -f4)"

  # Caso 1 — falhou por INFRA/erro de carregamento, não por asserção: o arquivo
  # não rodou inteiro (menos testes que o controle) ou o reporter saiu sem
  # falhas de teste.
  if [ "$success" != "false" ] || [ "$failed" = "0" ] || [ "$total" != "$CONTROL_TOTAL" ]; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: a suíte falhou por outro motivo"
    fail "  (success=$success, failed=$failed, total=$total; controle=$CONTROL_TOTAL)."
    fail "Cortar a regra tem de derrubar as asserções do contrato, não o arquivo inteiro."
    exit 1
  fi

  # Caso 2 — uma âncora da regra mutada NÃO caiu: a regra não tem quem a meça
  # (ou tem em outro lugar, e a prova seria decorativa).
  local red
  if ! red="$(assert_anchors "$results" failed "${CASE_RED[@]}")"; then
    fail "Nem toda âncora da regra '$name' caiu com ela cortada."
    exit 1
  fi

  # Caso 3 — uma âncora INTACTA caiu: a mutação não foi cirúrgica (matou o fato
  # inteiro, não a regra que ela nomeia), então a prova não isola a causa que
  # ela afirma isolar.
  local intact
  if ! intact="$(assert_anchors "$results" passed "${CASE_INTACT[@]}")"; then
    fail "Mutação $name NÃO-CIRÚRGICA: uma âncora que devia ficar INTACTA caiu."
    fail "A mutação deve cortar SÓ a regra que ela nomeia."
    exit 1
  fi

  pass "Mutação $name DETECTADA: suíte VERMELHA ($failed de $total testes falharam)"
  pass "  • $red âncora(s) da regra com o status FAILED"
  pass "  • $intact âncora(s) INTACTA(s) PASSED (mutação cirúrgica)"
  # Devolve o arquivo ao estado íntegro antes do próximo caso.
  cp "$BACKUP_DIR/doctor" "$DOCTOR"
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (as três regras do contrato de gates CORE)"
echo "   A. o recorte da forja DECLARANTE (job exigido por uma forja só)"
echo "   B. a RÉGUA da invariante (expectedCommand = inv.command)"
echo "   C. o CONTRATO por invariante×job (a chave \${inv.id}|\${jid})"
echo "   (scripts/forge-doctor.mjs IN-PLACE, backup + trap de restauração)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ── Backup ANTES de qualquer mutação (o trap restaura a partir dele) ─────

mkdir -p "$BACKUP_DIR"
cp "$DOCTOR" "$BACKUP_DIR/doctor"
pass "Backup do doctor criado ($BACKUP_DIR/doctor)"

# ── CONTROLE ──────────────────────────────────────────────────────────────

assert_control_pass

# ── MUTAÇÕES ──────────────────────────────────────────────────────────────

echo ""
info "Caso A — cortando o recorte da FORJA DECLARANTE (job exigido por uma forja só)..."
CASE_ANCHOR_DOC="$C1_ANCHOR_DOC"
CASE_SED="$C1_SED"
CASE_MARKER="$C1_MARKER"
CASE_LEFTOVER="$C1_LEFTOVER"
CASE_LEFTOVER_EXPECTED="$C1_LEFTOVER_EXPECTED"
CASE_RED=("${C1_RED[@]}")
CASE_INTACT=("${C1_INTACT[@]}")
assert_mutation_detected "A (a forja declarante)"

echo ""
info "Caso B — cortando a RÉGUA da invariante (qualquer comando satisfaz)..."
CASE_ANCHOR_DOC="$C2_ANCHOR_DOC"
CASE_SED="$C2_SED"
CASE_MARKER="$C2_MARKER"
CASE_LEFTOVER="$C2_LEFTOVER"
CASE_LEFTOVER_EXPECTED="$C2_LEFTOVER_EXPECTED"
CASE_RED=("${C2_RED[@]}")
CASE_INTACT=("${C2_INTACT[@]}")
assert_mutation_detected "B (a régua da invariante)"

echo ""
info "Caso C — cortando o CONTRATO por invariante×job (a chave volta a ser o job)..."
CASE_ANCHOR_DOC="$C3_ANCHOR_DOC"
CASE_SED="$C3_SED"
CASE_MARKER="$C3_MARKER"
CASE_LEFTOVER="$C3_LEFTOVER"
CASE_LEFTOVER_EXPECTED="$C3_LEFTOVER_EXPECTED"
CASE_RED=("${C3_RED[@]}")
CASE_INTACT=("${C3_INTACT[@]}")
assert_mutation_detected "C (o contrato por invariante×job)"

# ═════════════════════════════════════════════════════════════════════════
# Result (restore roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — as três regras do contrato de gates CORE"
pass "  • controle: doctor íntegro → verde, com as ${#ALL_ANCHORS[@]} âncoras vivas (1 teste cada)"
pass "  • A: forja declarante cortada → vermelha pela âncora da regra (${#C1_RED[@]})"
pass "  • B: régua da invariante cortada → vermelha (${#C2_RED[@]})"
pass "  • C: contrato por invariante×job cortado → vermelha (${#C3_RED[@]})"
pass "  • cirúrgicas: a outra regra do mesmo fato e o veredito seguem medindo"
pass "    e o arquivo roda inteiro em todos os casos"
exit 0
