#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-doctor-facts.sh — Mutation tests do forge-doctor
#
# Usage:
#   ./scripts/test-mutation-doctor-facts.sh
#
# Exit codes:
#   0 — as TRÊS mutações DETECTADAS: cada fio cortado deixa a suíte VERMELHA
#       pelas âncoras de CADA fato ✅
#   1 — suíte CEGA (verde com a mutação) / falhou por outro motivo / a mutação
#       não aplicou / uma âncora sumiu ou virou ambígua / infra ❌
#
# POR QUE: o doctor não MEDE os fatos da forja — ele os TRANSPORTA para o
# veredito. Essa travessia tem TRÊS fios, e cada um é uma regressão silenciosa
# de um tipo diferente:
#
#   A) o fio VIOLAÇÃO→BLOQUEIO. Cada seção (contrato de merge, o GATE do
#      bring-up no contrato, guards, imagem, prova do bloqueio, espelhos,
#      referências não versionadas, contrato da imagem publicada, registro do
#      runner nas duas forjas, interpolação do compose, branch protection
#      registrada e o pré-requisito 0 do bring-up)
#      termina em `blockers.push(...)`, e `blockers` é o que faz o veredito ser
#      BLOQUEADA. Cortar esse fio e a forja quebrada passa: o doctor continua
#      rodando, continua imprimindo todas as seções e passa a dizer PRONTA —
#      nenhum dos fatos acusa sozinho, porque quem acusa é a SOMA.
#
#   B) o fio da HONESTIDADE DO VEREDITO. Um fato NÃO PROVADO (gate que não
#      executou, env ausente, prova indisponível, registro ilegível, protection
#      sem token…) empurra para `unknowns`, e `unknowns` é o que impede o
#      veredito de ser PRONTA. Uma forja que o doctor não conseguiu MEDIR não é
#      uma forja sã — dizer PRONTA aqui é a FALSA SEGURANÇA que este comando
#      existe para não produzir (e é pior que o bloqueio errado: bloqueio
#      errado alguém investiga, "pronta" ninguém olha).
#
#   C) o fio do que o relatório NÃO COBRE. `unproven` é a lista do que o doctor,
#      por desenho, NÃO prova daqui (a permissão do token, o smoke, o env de
#      outro host, o socket do job, o recorte do --ci e cada seção pulada por
#      flag). É a única parte do relatório que diz o LIMITE dele. Cortá-la
#      transforma "não medi isto" em "isto está certo" — e quem lê não tem como
#      saber que a pergunta ficou aberta.
#
# COMO: três mutações, cada uma com âncoras POR FATO (a unidade é o FATO, não o
# arquivo) e o mesmo controle:
#
#   A) `const blockers = []` (em `summarize`) → objeto com `push` no-op. Todo
#      `blockers.push(...)` do doctor vira inócuo com UMA edição, porque é
#      literalmente o mesmo fio (as seções só diferem no que empurram).
#   B) o ternário do veredito deixa de consultar `unknowns.length` — o doctor
#      continua LISTANDO o que não provou, mas para de dizer INDETERMINADA.
#      É a mutação mais perigosa desta família: todas as linhas do relatório
#      continuam ali, e o veredito é o único lugar onde "não medi" vira
#      "pode confiar no merge".
#   C) o retorno de `summarize` passa a devolver `unproven: []` — o veredito
#      fica intacto (PRONTA segue PRONTA, BLOQUEADA segue BLOQUEADA) e só some a
#      declaração do que o doctor não cobre. Sem esta mutação, "declarar o
#      limite" seria uma promessa escrita na prosa; com ela, apagar a lista
#      acende a suíte.
#
# Cada mutação é IN-PLACE com backup + trap de restauração (NUNCA
# `git checkout`), roda o vitest REAL (precisa de node_modules — por isso o job
# é o do seed-guards.yml, NÃO a matriz node-pura do master) em
# src/lib/__tests__/forge-doctor.test.ts e decide pelo JSON do reporter
# (--reporter=json), não por texto:
#
#   CONTROLE — arquivo íntegro → suíte VERDE (success=true, 0 falhas) e TODAS as
#     âncoras das TRÊS mutações EXISTEM e PASSAM agora. Cada âncora tem de casar
#     EXATAMENTE UM teste: uma âncora ambígua mediria o fato errado (e uma
#     renomeada/removida não teria o que acender) — fail-fast AQUI, para a
#     detecção abaixo não ser vácuo;
#   MUTAÇÃO — fio cortado → suíte VERMELHA (success=false) com:
#     • CADA âncora da mutação FAILING — não basta a suíte cair: nenhum fato pode
#       ficar sem a sua prova (o fio é um só, o efeito tem de aparecer em TODOS);
#     • as âncoras INTACTAS PASSING — a prova de que a mutação é CIRÚRGICA: o
#       caminho SAUDÁVEL segue chegando a PRONTA e o caminho da VIOLAÇÃO segue
#       bloqueando. O que morreu foi o fio mutado, não o veredito inteiro. O nº
#       total de testes também tem de bater com o do controle.
#
# ⚠️ Source-coupled (como os demais test-mutation-*.sh): o sed ancora nas linhas
# literais de `summarize` (o coletor de blockers, o ternário do veredito e o
# `return`), e as asserções nos títulos dos testes. Reformular qualquer uma
# delas ou renomear um teste exige atualizar ESTE script junto — e ele FALHA
# (exit 1) em vez de passar em silêncio quando isso acontece.
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

DOCTOR="scripts/forge-doctor.mjs"
TEST_FILE="src/lib/__tests__/forge-doctor.test.ts"

TMP_DIR="$(mktemp -d)"
BACKUP_DIR="$TMP_DIR/backup"

RESULTS_CONTROL="$TMP_DIR/control.json"

# ── Caso A — o fio violação→bloqueio ─────────────────────────────────────
# O `blockers` é o FIO único: todas as seções do doctor terminam nele. A
# mutação o troca por um objeto com `push` no-op — a linha CONTINUA válida
# sintaticamente e `blockers.length` (undefined) deixa de ser > 0, então o
# veredito para de enxergar QUALQUER violação.
C1_ANCHOR_DOC="export function summarize(facts) {"
C1_SED='/^export function summarize(facts) {$/,+1 s/^  const blockers = \[\]$/  const blockers = { push() {} } \/\/ MUTATION-DOCTOR-FACTS/'
C1_MARKER="  const blockers = { push() {} } // MUTATION-DOCTOR-FACTS"
# O coletor de `readMirrors` tem o MESMO texto e NÃO pode ser tocado (mutar
# aquele não cortaria o fio de `summarize`, e a prova seria de outro invariante).
C1_LEFTOVER="  const blockers = []"
C1_LEFTOVER_EXPECTED="1"

# ── Caso B — o veredito deixa de declarar o NÃO PROVADO ──────────────────
# A mutação tira `unknowns.length` do ternário: `blockers` continua mandando
# (BLOQUEADA segue BLOQUEADA) e o não-provado some do veredito. O relatório
# segue listando cada `unknown` — por isso só uma âncora de VEREDITO pega isto.
C2_ANCHOR_DOC="unknowns.length > 0 ? VERDICT.UNKNOWN : VERDICT.READY"
C2_SED='/unknowns.length > 0 ? VERDICT.UNKNOWN : VERDICT.READY/ s/: unknowns.length > 0 ? VERDICT.UNKNOWN : VERDICT.READY/: VERDICT.READY/'
C2_MARKER="VERDICT.BLOCKED : VERDICT.READY"

# ── Caso C — o relatório deixa de declarar o que NÃO COBRE ───────────────
# A mutação esvazia a lista `unproven` no retorno de `summarize`. O veredito
# fica INTACTO de propósito: o que morre é a declaração do limite.
C3_ANCHOR_DOC="  return { verdict, blockers, unknowns, unproven }"
C3_SED='/^  return { verdict, blockers, unknowns, unproven }$/ s/unproven }$/unproven: [] } \/\/ MUTATION-DOCTOR-UNPROVEN/'
C3_MARKER="unproven: [] } // MUTATION-DOCTOR-UNPROVEN"

# ── Âncoras — UM FATO TRANSPORTADO POR ÂNCORA ────────────────────────────
# Formato: "nome do fato|substring ÚNICA do fullName do teste".
# A unidade é o FATO, não o arquivo: se um fato perder o fio, a sua âncora tem
# de cair — cortar o fio de TODOS com uma edição só vale como prova se cada
# fato tiver a sua testemunha.
C1_RED=(
  "contrato de merge (o que o repo DECLARA)|check:required-checks vermelho BLOQUEIA pelo contrato"
  "guards da forja|um gate vermelho → BLOQUEADA e o relatório nomeia o gate"
  "imagem do runner (ausente no registry)|registry 404 na tag → BLOQUEADA, mesmo com todos os guards verdes"
  "prova do bloqueio da imagem|prova VIOLADA → BLOQUEADA mesmo com a imagem presente e todos os guards verdes"
  "espelhos das variáveis da imagem|espelho divergente do VALOR declarado → BLOQUEADA"
  "referências não versionadas da imagem|VIOLADA → BLOQUEADA, com a violação no relatório de bloqueios"
  "contrato da imagem PUBLICADA|VIOLADO bloqueia: o job roda uma imagem que não cumpre a promessa do build"
  "registro do act_runner|registro VELHO bloqueia, nomeando o arquivo lido e o remédio do guard"
  "registro do runner do GitHub|o registro do GitHub DIVERGENTE bloqueia mesmo com TODO o resto verde"
  "interpolação do compose|a interpolação VIOLADA bloqueia mesmo com guards, imagem e prova verdes"
  "branch protection REGISTRADA|a branch protection em DRIFT bloqueia mesmo com guards, imagem, prova e render verdes"
  "gate do bring-up no contrato de merge|GATE do bring-up fora do contrato → BLOQUEADA, nomeando a forja e o remédio"
  "pré-requisito 0 do bring-up (o env do host × o template comitado)|divergente → BLOQUEIA, e a linha do pré-requisito"
)
# A cirurgia do caso A: o caminho SAUDÁVEL. A mutação corta o fio da violação,
# não o veredito — uma forja sem violação nenhuma continua chegando a PRONTA.
C1_INTACT=(
  "o caminho saudável (nenhuma violação)|forja completa e registry 200 → PRONTA"
)

# ── Caso B — as MESMAS seções, do lado HONESTO ───────────────────────────
# Uma âncora por fato que tem caminho de NÃO PROVADO (é o espelho da lista
# acima: onde lá a violação bloqueia, aqui a ausência de prova rebaixa).
C2_RED=(
  "guards da forja|gate NÃO executado (timeout/binário ausente) → INDETERMINADA, nunca PRONTA"
  "imagem do runner|env ausente no checkout (exit 2) → INDETERMINADA: falta de prova não é prova de falha"
  "prova do bloqueio da imagem|prova indisponível (sem bash/bring-up) → INDETERMINADA, nunca PRONTA"
  "espelhos das variáveis da imagem|SEM o valor da variável → INDETERMINADA (a metade que prova existência não é a que prova o valor)"
  "referências não versionadas da imagem|INDETERMINADO rebaixa para INDETERMINADA e nomeia o que faltou (sem os não aplicáveis)"
  "contrato da imagem PUBLICADA|INDETERMINADO não bloqueia e não vira pronta: é ausência de prova"
  "registro do act_runner|INDISPONÍVEL (sem docker/container/registro ilegível) rebaixa e diz POR QUÊ"
  "registro do runner do GitHub|sem token / API fora → INDETERMINADA, nunca 'em sincronia'"
  "interpolação do compose|indisponível → INDETERMINADA (nunca 'pronta' sem a prova)"
  "branch protection REGISTRADA|não lida (sem token de administração) → INDETERMINADA, nunca 'pronta'"
  "gate do bring-up não conferido|GATE do bring-up não conferido → INDETERMINADA (nunca 'pronta' por omissão)"
  "pré-requisito 0 do bring-up|sem o env do host → INDETERMINADA, nomeando o pré-requisito, o comando e o lugar onde rodá-lo"
  "dívida aberta no board|dívida ABERTA no board rebaixa o veredito mesmo com TODO o resto verde"
)
# A cirurgia do caso B: os DOIS caminhos que NÃO dependem de `unknowns` têm de
# seguir inteiros — o saudável chega a PRONTA e a violação bloqueia. Sem isso, a
# mutação poderia ter matado o veredito inteiro em vez de só a honestidade.
C2_INTACT=(
  "o caminho saudável (nada não-prodado)|forja completa e registry 200 → PRONTA"
  "o caminho da violação (o bloqueio não vem de unknowns)|check:required-checks vermelho BLOQUEIA pelo contrato"
)

# ── Caso C — o que o relatório NÃO Cobre ─────────────────────────────────
# Uma âncora por limite declarado: cada seção que o doctor NÃO cobre daqui (ou
# que foi PULADA por flag) tem de ter quem cobre a declaração dela.
C3_RED=(
  "os quatro limites de desenho (token, smoke, env de outro host, socket do job)|sempre declara o que NÃO cobre (branch protection, smoke, env do VPS)"
  "guards pulados por --no-guards|--no-guards rebaixa o veredito a INDETERMINADA e o diz no relatório"
  "prova pulada por --no-proof|--no-proof rebaixa o veredito e o declara no 'NÃO cobre'"
  "o recorte do perfil --ci|o veredito NOMEIA o perfil no topo do não-provado (não parece flag esquecida no YAML)"
  "render pulado por --no-compose-render|pulada por --no-compose-render → INDETERMINADA, e o relatório diz o que ficou de fora"
  "protection pulada por --no-protection|pulada por --no-protection → INDETERMINADA e o relatório diz o que ficou de fora"
  "contrato da imagem pulado por --no-image-contract|--no-image-contract rebaixa o veredito E entra no NÃO CUBRE"
  "registro do runner pulado por --no-runner-labels|--no-runner-labels declara-se: pendência nomeada E o que o veredito NÃO cobre"
  "o skip das DUAS forjas no registro|--no-runner-labels cobre as DUAS forjas (na pendência e no 'NÃO cobre')"
  "a permissão do token (a leitura COM o aplicador)|o que NÃO é provado nomeia a leitura COM o aplicador (a permissão do token)"
)
# A cirurgia do caso C: o veredito fica INTACTO (é o mesmo cuidado do caso B, ao
# contrário) — PRONTA segue PRONTA e BLOQUEADA segue BLOQUEADA.
C3_INTACT=(
  "o caminho saudável (veredito intocado)|forja completa e registry 200 → PRONTA"
  "o caminho da violação (veredito intocado)|check:required-checks vermelho BLOQUEIA pelo contrato"
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

# run_vitest: roda o arquivo de teste com o reporter JSON e captura
# output/exit. $1 = caminho do JSON de resultados.
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

# assert_anchors: exige que CADA entrada de "$@" (formato "fato|substring")
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
      fail "âncora do fato '$name' fora do estado esperado."
      fail "  \"$sub\" → $count teste(s) casaram, status '$statuses' (esperado 1 casando, '$expected')"
      fail "Renomeou/removeu/duplicou um teste? Atualize as âncoras DESTE script."
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
    fail "O fixture base não é válido — o mutation test não pode prosseguir."
    exit 1
  fi

  if ! CONTROL_ALIVE="$(assert_anchors "$RESULTS_CONTROL" passed "${ALL_ANCHORS[@]}")"; then
    fail "CONTROLE FALHOU: nem todas as âncoras das TRÊS mutações estão vivas agora."
    exit 1
  fi

  CONTROL_TOTAL="$total"
  pass "Controle OK — $total testes verdes, com $CONTROL_ALIVE âncoras vivas (1 teste cada)"
}

# ── MUTAÇÃO — um fio cortado → suíte VERMELHA ────────────────────────────
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
  if [ -n "$CASE_LEFTOVER" ]; then
    local remaining
    remaining="$(grep -cF "$CASE_LEFTOVER" "$DOCTOR" || true)"
    if [ "$remaining" != "$CASE_LEFTOVER_EXPECTED" ]; then
      fail "MUTAÇÃO NÃO-CIRÚRGICA: sobraram $remaining ocorrência(s) de '$CASE_LEFTOVER'"
      fail "  (esperado $CASE_LEFTOVER_EXPECTED — o coletor de readMirrors tem de sobreviver)"
      exit 1
    fi
  fi
  if ! node --check "$DOCTOR" >/dev/null 2>&1; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: o arquivo mutado não é válido sintaticamente."
    exit 1
  fi
  pass "Mutação $name aplicada (sintaxe válida)"

  run_vitest "$results"
  echo "$VITEST_LOG" | tail -6

  # Caso 0 — SUÍTE CEGA: passou com o fio cortado. É exatamente a falha
  # silenciosa que este cenário existe para impedir.
  if [ "$VITEST_EXIT" -eq 0 ]; then
    fail "SUÍTE CEGA: o forge-doctor.test.ts passou (exit 0) com o fio cortado."
    exit 1
  fi

  if [ ! -f "$results" ]; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: o vitest não produziu JSON (a mutação quebrou"
    fail "o carregamento do arquivo, e não só o fio que ela afirma cortar)."
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
    fail "Cortar o fio tem de derrubar as asserções dos fatos, não o arquivo inteiro."
    exit 1
  fi

  # Caso 2 — uma âncora do fio mutado NÃO caiu: o fio é um só, então TODAS as
  # âncoras dele têm de ficar vermelhas. Uma que siga verde significa que ela não
  # mede o fio (mede outra coisa) — a prova daquele fato seria decorativa.
  local red
  if ! red="$(assert_anchors "$results" failed "${CASE_RED[@]}")"; then
    fail "Nem todo fato transportado caiu com o fio do caso $name cortado."
    fail "A âncora que seguiu verde não mede o fio — veja o log acima."
    exit 1
  fi

  # Caso 3 — uma âncora INTACTA caiu: a mutação não foi cirúrgica (matou o
  # veredito inteiro, não o fio que ela afirma cortar), então a prova não isola
  # a causa que ela afirma isolar.
  local intact
  if ! intact="$(assert_anchors "$results" passed "${CASE_INTACT[@]}")"; then
    fail "Mutação $name NÃO-CIRÚRGICA: uma âncora que devia ficar INTACTA caiu."
    fail "A mutação deve cortar SÓ o fio que ela nomeia, não o veredito."
    exit 1
  fi

  pass "Mutação $name DETECTADA: suíte VERMELHA ($failed de $total testes falharam)"
  pass "  • $red fato(s)/limite(s) com a âncora FAILED"
  pass "  • $intact âncora(s) INTACTA(s) PASSED (mutação cirúrgica)"
  # Devolve o arquivo ao estado íntegro antes do próximo caso.
  cp "$BACKUP_DIR/doctor" "$DOCTOR"
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (os três fios do veredito do doctor)"
echo "   A. 'const blockers = []' → push no-op (violação→bloqueio)"
echo "   B. o ternário para de consultar unknowns.length (a honestidade)"
echo "   C. 'unproven' volta vazio (o que o relatório NÃO cobre)"
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
info "Caso A — cortando o fio violação→bloqueio (o coletor de blockers)..."
CASE_ANCHOR_DOC="$C1_ANCHOR_DOC"
CASE_SED="$C1_SED"
CASE_MARKER="$C1_MARKER"
CASE_LEFTOVER="$C1_LEFTOVER"
CASE_LEFTOVER_EXPECTED="$C1_LEFTOVER_EXPECTED"
CASE_RED=("${C1_RED[@]}")
CASE_INTACT=("${C1_INTACT[@]}")
assert_mutation_detected "A (violação→bloqueio)"

echo ""
info "Caso B — cortando a honestidade do veredito (o ternário de unknowns)..."
CASE_ANCHOR_DOC="$C2_ANCHOR_DOC"
CASE_SED="$C2_SED"
CASE_MARKER="$C2_MARKER"
CASE_LEFTOVER=""
CASE_LEFTOVER_EXPECTED="0"
CASE_RED=("${C2_RED[@]}")
CASE_INTACT=("${C2_INTACT[@]}")
assert_mutation_detected "B (o veredito deixa de declarar o não-provado)"

echo ""
info "Caso C — cortando o que o relatório NÃO cobre (a lista unproven)..."
CASE_ANCHOR_DOC="$C3_ANCHOR_DOC"
CASE_SED="$C3_SED"
CASE_MARKER="$C3_MARKER"
CASE_LEFTOVER=""
CASE_LEFTOVER_EXPECTED="0"
CASE_RED=("${C3_RED[@]}")
CASE_INTACT=("${C3_INTACT[@]}")
assert_mutation_detected "C (o relatório deixa de declarar o que NÃO cobre)"

# ═════════════════════════════════════════════════════════════════════════
# Result (restore roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — os três fios do veredito do doctor"
pass "  • controle: doctor íntegro → verde, com as ${#ALL_ANCHORS[@]} âncoras vivas (1 teste cada)"
pass "  • A: violação→bloqueio cortado → vermelha por CADA fato (${#C1_RED[@]})"
pass "  • B: veredito sem o não-provado → vermelha por CADA fato (${#C2_RED[@]})"
pass "  • C: 'NÃO cobre' vazio → vermelha por CADA limite (${#C3_RED[@]})"
pass "  • cirúrgicas: o caminho SAUDÁVEL segue PRONTA, o da VIOLAÇÃO segue bloqueando"
pass "    e o arquivo roda inteiro em todos os casos"
exit 0
