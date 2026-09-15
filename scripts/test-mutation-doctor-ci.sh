#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-doctor-ci.sh — Mutation test do PERFIL `--ci` do doctor:
# AS TRÊS METADES da comparação de espelhos que o job de PR das duas forjas faz
#
# Usage:
#   ./scripts/test-mutation-doctor-ci.sh
#
# Exit codes:
#   0 — mutações DETECTADAS: com a régua removida, o job de PR de CADA forja
#       CONTINUA VERMELHO com a variável errada; e as outras duas metades
#       (o critério do "não comparado" e a função compartilhada da comparação)
#       fazem a suíte ficar VERMELHA pela âncora certa ✅
#   1 — suíte CEGA / a mutação ficou em SILÊNCIO (nenhuma metade pode passar
#       sem testemunha) / a remoção ABRIU BURACO (job verde com a variável
#       errada) / a mutação não aplicou / infra ❌
#
# POR QUE: o perfil `--ci` é o que roda no job de PR das DUAS forjas, e ele é
# julgado por UMA pergunta: "o VALOR das repository variables continua sendo o
# que o repositório declara?". Essa comparação tem TRÊS metades, e cada uma
# degrada em SILÊNCIO se for mexida sozinha — nenhuma delas estoura um erro:
#
#   1. A RÉGUA ENTREGUE (o gate). `check-doctor-ci.mjs` → `doctorFlags` monta as
#      flags `--expected`/`--expected-var` com o valor das `vars.*`. Sem elas o
#      doctor não estoura: ele cai no ramo "não comparado", segue conferindo só
#      EXISTÊNCIA e concordância local, e o relatório continua verde.
#   2. O CRITÉRIO DO "NÃO COMPARADO" (a função compartilhada). O
#      `mirrorDriftReport` (mesmo código do guard semanal, do CLI dele e do
#      publicador de issue) calcula `unproven` — QUAIS variáveis ficaram sem
#      valor passado. Removê-lo não falha nada: o relatório simplesmente PARA DE
#      DIZER o que não foi comparado, e "não medi" passa a parecer "está certo".
#   3. A FUNÇÃO COMPARTILHADA (a troca dela no doctor). Trocar
#      `mirrorDriftReport(...)` por uma versão local que devolve "sem drift"
#      mata o bloqueio do espelho E o `unproven` de uma vez — o doctor diz que
#      comparou (`▸ comparados com vars.…`) e não compara.
#
# Este é o irmão `--ci` do `test-mutation-doctor-mirrors.sh`: lá se muta a
# comparação DENTRO do doctor e o alvo é o guard semanal; aqui se muta cada uma
# destas três metades, e o alvo é o job de PR — provando, por EXECUÇÃO da linha
# `run:` que cada forja de fato roda, que nenhuma delas passa em silêncio.
#
# COMO: muta o arquivo da metade IN-PLACE (backup + trap EXIT de restauração,
# NUNCA `git checkout` — as edições locais de quem roda o script são
# preservadas) e decide com FATO estruturado, não com texto. Duas testemunhas
# por metade:
#
#   (a) A SUÍTE. Cada metade declara a suíte-alvo e as âncoras (substring ÚNICA
#       do fullName) que têm de FICAR VERMELHAS com a mutação e as que têm de
#       SEGUIR VERDES (mutação cirúrgica). Cada âncora tem de casar EXATAMENTE
#       um teste — âncora renomeado/ambíguo falha no CONTROLE, em vez de a
#       detecção virar vácuo. O total de testes do controle é conferido: um
#       arquivo que não roda inteiro é infra, não detecção;
#   (b) O JOB. A linha `run:` de cada forja — `.gitea/workflows/ci.yml` job
#       `guards` → `bun …`; `.github/workflows/pr-check.yml` job
#       `doctor-mirrors-guard` → `node …` — é EXTRAÍDA do YAML (não escrita à
#       mão) e executada com os valores DECLARADOS (`deploy/env.gitea.example`),
#       com `vars.BUN_VERSION` ERRADO e com o env PARCIAL. É o que MEDE a
#       metade no lugar onde ela decide o merge:
#         · valor errado → job VERMELHO nomeando a variável (o gate bloqueia);
#         · env parcial → job verde DIZENDO qual valor não foi comparado;
#         · metade 1 → a régua some do relatório e o job AINDA fica vermelho;
#         · metade 2 → o naming do "não comparado" SOME (silêncio medido) com o
#           veredito intacto — é exatamente por isso que a suíte é a testemunha;
#         · metade 3 → a régua CHEGA (`▸ comparados com vars.…`) e o bloqueio
#           NÃO sai: o job segue vermelho pela SEGUNDA régua, declarada.
#
# ⚠️ Source-coupled (como os demais test-mutation-*.sh): os sed ancoram nas
# linhas listadas abaixo; as asserções, nos títulos dos testes; e os fatos do
# job, em marcadores do relatório do doctor. Reformular qualquer um exige
# atualizar ESTE script junto — e ele FALHA (exit 1) em vez de passar em
# silêncio quando isso acontece.
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

GATE="scripts/check-doctor-ci.mjs"
SHARED="scripts/check-actrc-sync.mjs"
DOCTOR="scripts/forge-doctor.mjs"

SUITE_GATE="src/lib/__tests__/check-doctor-ci.test.ts"
SUITE_DOCTOR="src/lib/__tests__/forge-doctor.test.ts"

# O template comitado: é ele que diz o que o REPOSITÓRIO declara (a régua de
# referência dos dois lados — o que o gate entrega e o que a forja tem).
ENV_TEMPLATE="deploy/env.gitea.example"

TMP_DIR="$(mktemp -d)"
BACKUP_DIR="$TMP_DIR/backup"

RESULTS_CONTROL_GATE="$TMP_DIR/control-gate.json"
RESULTS_CONTROL_DOCTOR="$TMP_DIR/control-doctor.json"
RESULTS_MUTATION="$TMP_DIR/mutation.json"

# ── As três metades — o bug conhecido de cada uma ────────────────────────
# (âncora): a linha do arquivo que a mutação troca. Cada uma é conferida ANTES
# (presente e ÚNICA) e DEPOIS (ausente + marcador presente + sintaxe válida).
M1_FILE="$GATE"
M1_FROM="  return { flags, missing }"
M1_TO="  return { flags: [], missing } // MUTATION-DOCTOR-CI-RULER"
M1_SED="s|^  return { flags, missing }\$|${M1_TO}|"

M2_FILE="$SHARED"
M2_FROM="  const unproven = MIRROR_VARIABLES.filter"
M2_TO="  const unproven = [] // MUTATION-DOCTOR-CI-NOTCOMPARED"
M2_SED="s|^  const unproven = MIRROR_VARIABLES\\.filter.*|${M2_TO}|"

M3_FILE="$DOCTOR"
M3_FROM="  const report = mirrorDriftReport({"
M3_TO="  const report = ((_args) => ({ drift: [], warnings: [], mirrors: [], unproven: [] }))({ // MUTATION-DOCTOR-CI-SHARED"
M3_SED="s|^  const report = mirrorDriftReport({$|${M3_TO}|"

# ── Âncoras da suíte — por metade ────────────────────────────────────────
# Formato: "nome|substring ÚNICA do fullName do teste".
# EXPECTED_FAILURE: com a metade mutada, tem de FICAR VERMELHO.
# SURGICAL_PASS: o que a mutação NÃO pode tocar — a prova de que ela é cirúrgica.
M1_EXPECTED_FAILURES=(
  "a régua do registro (unit)|cobre TODAS as variáveis do registro"
  "a régua no valor em branco/ausente|variável AUSENTE não vira flag vazia"
)
M1_SURGICAL_PASSES=(
  "o nome da variável ausente (missing sobrevive)|o aviso nomeia cada variável e diz o remédio"
  "o caminho SAUDÁVEL (espelhos em sincronia → 0)|espelhos em sincronia com as variables"
  "a tradução do veredito (sem ela, o gate não decide)|3 (uso/erro) e null (nem executou)"
)

M2_EXPECTED_FAILURES=(
  "o critério do 'não comparado' (a variável sem valor é NOMEADA)|variável SEM valor passado → dúvida NOMINAL"
)
M2_SURGICAL_PASSES=(
  "o bloqueio do template segue (a metade vizinha está viva)|TEMPLATE divergente do valor declarado → BLOQUEIO"
  "o perfil --ci segue bloqueando a variável divergente|perfil --ci: uma variável DIVERGENTE bloqueia o PR"
)

M3_EXPECTED_FAILURES=(
  "o bloqueio do template morre com a função trocada|TEMPLATE divergente do valor declarado → BLOQUEIO"
  "o perfil --ci para de bloquear explicitamente|perfil --ci: uma variável DIVERGENTE bloqueia o PR"
)
M3_SURGICAL_PASSES=(
  "o espelho ausente (bloqueio DIRETO, fora da função)|espelho da forja ausente"
)

# ── Os jobs de PR — a linha que cada forja de fato executa ───────────────
# Formato: "forja|workflow|job". O comando NÃO é escrito aqui: ele é extraído
# do YAML — assim este script executa o que a pipeline executa, e não uma cópia
# que envelhece. (O contrato de que os dois lados chamam o MESMO script tem
# teste próprio em doctor-ci-workflow.test.ts.)
FORGES=(
  "gitea|.gitea/workflows/ci.yml|guards"
  "github|.github/workflows/pr-check.yml|doctor-mirrors-guard"
)

# ── Marcadores do relatório do doctor (source-coupled, de propósito) ─────
# DELIVERY_LINE: o doctor DIZ contra o que comparou — é a régua CHEGANDO.
# RULER_LINE:    o bloqueio da régua do gate (espelho × variável).
# AMBIENT_LINE:  o bloqueio da SEGUNDA régua (referências não versionadas, no
#                check-registry-source), que compara o AMBIENTE com as
#                declarações — é ela que mantém o job vermelho quando a régua
#                do gate some. Se um dia ela sumir, o job ficaria verde com a
#                variável errada e ESTE script falha (fail-closed).
# REMOVED_LINE:  o ramo "não comparado" (a metade 1 removida fica VISÍVEL).
# UNPROVEN_LINE: a nomeação do que NÃO foi comparado (a metade 2 removida fica
#                SILENCIOSA — e é esse o silêncio que a suíte tem de pegar).
DELIVERY_LINE="comparados com vars.BUN_VERSION"
RULER_LINE="alimenta a label do runner"
AMBIENT_LINE="diverge de deploy/env.gitea.example"
REMOVED_LINE="o VALOR não foi comparado"
UNPROVEN_LINE="nao foi comparado com a repository variable"
GATE_WARNING_LINE="::warning::"

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
restore_mutated() {
  local pair file
  for pair in "gate:$GATE" "shared:$SHARED" "doctor:$DOCTOR"; do
    if [ -f "$BACKUP_DIR/${pair%%:*}" ] && [ -f "${pair#*:}" ]; then
      cp "$BACKUP_DIR/${pair%%:*}" "${pair#*:}"
      echo "  ↻ ${pair#*:} restaurado do backup"
    fi
  done
  rm -rf "$TMP_DIR"
}
trap restore_mutated EXIT

# ── Helpers ───────────────────────────────────────────────────────────────

# run_suite: roda arquivo(s) de teste com o reporter JSON e captura output/exit.
run_suite() {
  local results="$1"
  shift
  rm -f "$results"
  set +e
  VITEST_LOG="$(bun x vitest run --config vitest.config.unit.ts --reporter=json --outputFile="$results" "$@" 2>&1)"
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
# a substring — N é QUANTOS casaram. O `N` é o que impede âncora AMBÍGUO (um
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

# gate_run_line: a linha `run:` que a pipeline executa no job pedido — extraída
# do YAML (e não escrita à mão). Vazio = não achou (o chamador falha).
gate_run_line() {
  node -e '
    const fs = require("node:fs")
    const yaml = require("js-yaml")
    const [file, job] = process.argv.slice(1)
    const wf = yaml.load(fs.readFileSync(file, "utf8"))
    const steps = wf?.jobs?.[job]?.steps ?? []
    const hit = steps.map((s) => s.run ?? "").find((r) => r.includes("check-doctor-ci.mjs"))
    process.stdout.write(hit ?? "")
  ' "$1" "$2"
}

# declared_value: o valor declarado no template comitado (a referência).
declared_value() {
  node -e '
    const fs = require("node:fs")
    const name = process.argv[1]
    const raw = fs.readFileSync(process.argv[2], "utf8")
    for (const line of raw.split(/\r?\n/)) {
      const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && m[1] === name) {
        process.stdout.write(m[2].trim().replace(/^["\x27]|["\x27]$/g, ""))
        break
      }
    }
  ' "$1" "$ENV_TEMPLATE"
}

# gate_run: executa a linha da forja COM os valores passados por ambiente (é
# assim que o workflow entrega as `vars.*` ao gate). GATE_EXIT é global porque
# um subshell comeria o exit code. Modos: declared | wrong | partial.
gate_run() {
  local cmd="$1" out="$2" mode="$3"
  local bunv registry ns
  case "$mode" in
    declared)
      bunv="$DECLARED_BUN_VERSION"; registry="$DECLARED_REGISTRY"; ns="$DECLARED_NAMESPACE" ;;
    wrong)
      bunv="$WRONG_BUN_VERSION"; registry="$DECLARED_REGISTRY"; ns="$DECLARED_NAMESPACE" ;;
    partial)
      bunv="$DECLARED_BUN_VERSION"; registry=""; ns="" ;;
    *)
      fail "gate_run: modo desconhecido '$mode'"; exit 1 ;;
  esac
  : > "$out"
  set +e
  BUN_VERSION="$bunv" IMAGE_REGISTRY="$registry" IMAGE_NAMESPACE="$ns" \
    bash -c "$cmd" >"$out" 2>&1
  GATE_EXIT=$?
  set -e
}

# forges_run: roda a linha de CADA forja no modo pedido e guarda o resultado em
# arrays paralelos (label de diagnóstico, exit e arquivo de saída).
FORGE_LABELS=()
FORGE_EXITS=()
FORGE_OUTS=()

forges_run() {
  local mode="$1" suffix="$2" entry forge file job cmd out
  FORGE_LABELS=(); FORGE_EXITS=(); FORGE_OUTS=()
  for entry in "${FORGES[@]}"; do
    forge="${entry%%|*}"
    file="$(echo "$entry" | cut -d'|' -f2)"
    job="$(echo "$entry" | cut -d'|' -f3)"
    cmd="$(gate_run_line "$file" "$job")"
    if [ -z "$cmd" ]; then
      fail "CONTRATO QUEBRADO: $file (job $job) não tem passo com check-doctor-ci.mjs."
      fail "O gate saiu do job de PR desta forja? Corrija a pipeline — e este script."
      exit 1
    fi
    out="$TMP_DIR/$forge-$suffix.log"
    gate_run "$cmd" "$out" "$mode"
    FORGE_LABELS+=("$forge ($job): $cmd")
    FORGE_EXITS+=("$GATE_EXIT")
    FORGE_OUTS+=("$out")
  done
}

# has: o arquivo contém a string? (grep -F, sem regex)
has() { grep -Fq "$2" "$1"; }

# assert_marker: $1=arquivo, $2=string, $3="must"|"must-not", $4=rótulo.
assert_marker() {
  local out="$1" marker="$2" want="$3" label="$4"
  if [ "$want" = "must" ] && ! has "$out" "$marker"; then
    fail "$label: o relatório NÃO contém \"$marker\"."
    fail "  Veja $out"
    exit 1
  fi
  if [ "$want" = "must-not" ] && has "$out" "$marker"; then
    fail "$label: o relatório ainda contém \"$marker\"."
    fail "  O que a mutação afirma remover continuava lá. Veja $out"
    exit 1
  fi
}

# assert_anchor: $1=JSON, $2=substring, $3=status esperado, $4=rótulo.
assert_anchor() {
  local report count statuses
  report="$(anchor_report "$1" "$2")"
  count="${report%%|*}"
  statuses="${report#*|}"
  if [ "$count" != "1" ] || [ "$statuses" != "$3" ]; then
    fail "$4: âncora \"$2\" → $count teste(s) casaram, status '$statuses'"
    fail "  (esperado 1 casando, '$3'). Renomeou/removeu/duplicou um teste?"
    fail "  Atualize os âncoras DESTE script."
    exit 1
  fi
}

# assert_anchor_set: $1=JSON, $2=status, resto="nome|substring"...
assert_anchor_set() {
  local results="$1" want="$2"
  shift 2
  local entry name sub ok=0
  for entry in "$@"; do
    name="${entry%%|*}"
    sub="${entry#*|}"
    assert_anchor "$results" "$sub" "$want" "$name"
    ok=$((ok + 1))
  done
  ANCHORS_CHECKED="$ok"
}

# suite_pass: suíte VERDE no controle, e as âncoras (todas) PASSANDO agora.
assert_control_suite() {
  local results="$1" label="$2"
  shift 2
  info "CONTROLE — $label → suíte deve ficar VERDE (exit 0)..."
  run_suite "$results" "$@"
  echo "$VITEST_LOG" | tail -4

  if [ ! -f "$results" ]; then
    fail "CONTROLE FALHOU: o vitest não produziu o JSON de resultados ($label)."
    fail "Ambiente sem node_modules? Este script precisa de bun install."
    exit 1
  fi

  local summary success failed total
  summary="$(results_summary "$results")"
  success="${summary%%|*}"
  failed="$(echo "$summary" | cut -d'|' -f2)"
  total="$(echo "$summary" | cut -d'|' -f4)"

  if [ "$VITEST_EXIT" -ne 0 ] || [ "$success" != "true" ] || [ "$failed" != "0" ]; then
    fail "CONTROLE FALHOU ($label): suíte não ficou verde no estado íntegro"
    fail "  (exit=$VITEST_EXIT, success=$success, failed=$failed)."
    fail "O fixture base não é válido — o mutation test não pode prosseguir."
    exit 1
  fi

  # TODAS as âncoras desta suíte têm de existir e passar AQUI: sem isso a
  # detecção de uma metade poderia ser vácuo (âncora renomeada/ambígua).
  assert_anchor_set "$results" "passed" "${CONTROL_ANCHORS[@]}"

  ANCHORS_IN_SUITE="$ANCHORS_CHECKED"
  SUITE_TOTAL="$total"
  pass "Controle OK — $label: $total testes verdes, $ANCHORS_IN_SUITE âncora(s) vivo(s)"
}

# suite_red: suíte VERMELHA com a mutação, e as âncoras no estado declarado.
assert_mutation_suite() {
  local results="$1" label="$2" total_control="$3"
  shift 3
  info "MUTAÇÃO ($label) — suíte deve ficar VERMELHA..."
  run_suite "$results" "$@"
  echo "$VITEST_LOG" | tail -4

  # Caso 0 — SUÍTE CEGA: passou com a metade removida. É a falha silenciosa.
  if [ "$VITEST_EXIT" -eq 0 ]; then
    fail "SUÍTE CEGA ($label): passou (exit 0) com a metade MUTADA."
    fail "A remoção voltaria em silêncio."
    exit 1
  fi
  if [ ! -f "$results" ]; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA ($label): o vitest não produziu JSON (a mutação"
    fail "quebrou o carregamento do arquivo, e não só a metade)."
    exit 1
  fi

  local summary success failed total
  summary="$(results_summary "$results")"
  success="${summary%%|*}"
  failed="$(echo "$summary" | cut -d'|' -f2)"
  total="$(echo "$summary" | cut -d'|' -f4)"

  if [ "$success" != "false" ] || [ "$failed" = "0" ] || [ "$total" != "$total_control" ]; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA ($label): a suíte falhou por outro motivo"
    fail "  (success=$success, failed=$failed, total=$total; controle=$total_control)."
    fail "Mutar a metade tem de derrubar as asserções dela, não o arquivo inteiro."
    exit 1
  fi

  assert_anchor_set "$results" "failed" "${MUTATION_EXPECTED[@]}"
  local red="$ANCHORS_CHECKED"
  assert_anchor_set "$results" "passed" "${MUTATION_SURGICAL[@]}"
  local green="$ANCHORS_CHECKED"

  pass "Mutação DETECTADA na suíte ($label): $failed de $total testes falharam"
  pass "  • $red âncora(s) da metade → FAILED"
  pass "  • $green âncora(s) cirúrgico(s) → PASSED"
}

# apply_mutation: troca a âncora na linha, com fail-fast dos DOIS lados.
apply_mutation() {
  local file="$1" from="$2" to="$3" sedexpr="$4" label="$5"
  local occurrences
  occurrences="$(grep -cF "$from" "$file" || true)"
  if [ "$occurrences" != "1" ]; then
    fail "MUTAÇÃO NÃO APLICOU ($label): '$from' aparece $occurrences vez(es) em $file"
    fail "  (esperado 1). O arquivo foi refatorado? Atualize este script junto."
    exit 1
  fi
  sed -i "$sedexpr" "$file"
  if grep -Fq "$from" "$file" || ! grep -Fq "$to" "$file"; then
    fail "MUTAÇÃO NÃO APLICOU ($label): o sed não trocou a linha."
    exit 1
  fi
  if ! node --check "$file" >/dev/null 2>&1; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA ($label): o arquivo mutado não é válido sintaticamente."
    exit 1
  fi
  pass "Metade mutada ($label): $file (sintaxe válida)"
}

restore_file() {
  local backup="$1" file="$2"
  cp "$backup" "$file"
}

# ── Fatos do JOB — o que cada modo tem de mostrar ────────────────────────

# CONTROLE: os três modos, com os fatos que provam que o gate funciona.
assert_control_jobs() {
  info "CONTROLE (job) — valor declarado → 0 · ERRADO → ≠ 0 · PARCIAL → 0 + naming..."

  local i
  forges_run "declared" "ctrl-declared"
  for i in "${!FORGE_LABELS[@]}"; do
    if [ "${FORGE_EXITS[$i]}" -ne 0 ]; then
      fail "CONTROLE FALHOU: ${FORGE_LABELS[$i]} ficou VERMELHO com os valores DECLARADOS"
      fail "  exit=${FORGE_EXITS[$i]} — o gate não é confiável neste checkout. Veja ${FORGE_OUTS[$i]}"
      exit 1
    fi
  done
  pass "  ▸ valor declarado → exit 0 nas duas forjas"

  forges_run "wrong" "ctrl-wrong"
  for i in "${!FORGE_LABELS[@]}"; do
    if [ "${FORGE_EXITS[$i]}" -eq 0 ]; then
      fail "CONTROLE FALHOU: ${FORGE_LABELS[$i]} ficou VERDE com vars.BUN_VERSION ERRADO."
      fail "  O gate não bloqueia o valor — a régua já não estava lá? Veja ${FORGE_OUTS[$i]}"
      exit 1
    fi
    assert_marker "${FORGE_OUTS[$i]}" "BUN_VERSION" "must" "${FORGE_LABELS[$i]}"
    assert_marker "${FORGE_OUTS[$i]}" "$RULER_LINE" "must" "${FORGE_LABELS[$i]}"
    assert_marker "${FORGE_OUTS[$i]}" "$AMBIENT_LINE" "must" "${FORGE_LABELS[$i]}"
    assert_marker "${FORGE_OUTS[$i]}" "$DELIVERY_LINE" "must" "${FORGE_LABELS[$i]}"
    assert_marker "${FORGE_OUTS[$i]}" "$REMOVED_LINE" "must-not" "${FORGE_LABELS[$i]}"
  done
  pass "  ▸ valor ERRADO → exit ≠ 0, nomeando BUN_VERSION, com as DUAS réguas no relatório"

  forges_run "partial" "ctrl-partial"
  for i in "${!FORGE_LABELS[@]}"; do
    if [ "${FORGE_EXITS[$i]}" -ne 0 ]; then
      fail "CONTROLE FALHOU: ${FORGE_LABELS[$i]} ficou VERMELHO com o env PARCIAL."
      fail "  exit=${FORGE_EXITS[$i]} — variável não configurada não é violação (é aviso). Veja ${FORGE_OUTS[$i]}"
      exit 1
    fi
    assert_marker "${FORGE_OUTS[$i]}" "$GATE_WARNING_LINE" "must" "${FORGE_LABELS[$i]}"
    assert_marker "${FORGE_OUTS[$i]}" "$UNPROVEN_LINE" "must" "${FORGE_LABELS[$i]}"
  done
  pass "  ▸ env PARCIAL → exit 0, com o ::warning:: e o NAMING do que não foi comparado"
}

# ── As três metades ──────────────────────────────────────────────────────

# METADE 1 — a régua que o gate entrega. A suíte é a do gate; o job de cada
# forja tem de CONTINUAR vermelho (a segunda régua cobre) — e a remoção tem de
# ficar VISÍVEL no relatório, não silenciosa.
mutation_gate_ruler() {
  info "═══ METADE 1/3 — a RÉGUA entregue pelo gate (doctorFlags) ═══"
  apply_mutation "$M1_FILE" "$M1_FROM" "$M1_TO" "$M1_SED" "metade 1"

  MUTATION_EXPECTED=("${M1_EXPECTED_FAILURES[@]}")
  MUTATION_SURGICAL=("${M1_SURGICAL_PASSES[@]}")
  assert_mutation_suite "$RESULTS_MUTATION" "metade 1" "$SUITE_TOTAL_GATE" "$SUITE_GATE"

  info "MUTAÇÃO (job) — a régua removida não pode abrir buraco no merge..."
  forges_run "wrong" "m1-wrong"
  local i
  for i in "${!FORGE_LABELS[@]}"; do
    if [ "${FORGE_EXITS[$i]}" -eq 0 ]; then
      fail "BURACO ABERTO: ${FORGE_LABELS[$i]} ficou VERDE com a régua removida e"
      fail "  vars.BUN_VERSION ERRADO. O job de PR desta forja aceitaria outra versão."
      fail "  Veja ${FORGE_OUTS[$i]}"
      exit 1
    fi
    assert_marker "${FORGE_OUTS[$i]}" "$RULER_LINE" "must-not" "${FORGE_LABELS[$i]}"
    assert_marker "${FORGE_OUTS[$i]}" "$REMOVED_LINE" "must" "${FORGE_LABELS[$i]}"
    assert_marker "${FORGE_OUTS[$i]}" "$AMBIENT_LINE" "must" "${FORGE_LABELS[$i]}"
  done
  pass "  ▸ as duas forjas seguem VERMELHAS: a régua sumiu (\"$REMOVED_LINE\") e a"
  pass "     segunda régua bloqueia — a remoção é MEDIDA, não silenciosa"

  restore_file "$BACKUP_DIR/gate" "$M1_FILE"
  pass "  ↻ metade 1 restaurada"
}

# METADE 2 — o critério do "não comparado" na função COMPARTILHADA. A suíte é a
# do doctor; no job o veredito NÃO muda (é por isso que é silencioso): o que
# some é a NOMEAÇÃO do que não foi comparado.
mutation_not_compared() {
  info "═══ METADE 2/3 — o CRITÉRIO do 'não comparado' (unproven, na função compartilhada) ═══"
  apply_mutation "$M2_FILE" "$M2_FROM" "$M2_TO" "$M2_SED" "metade 2"

  MUTATION_EXPECTED=("${M2_EXPECTED_FAILURES[@]}")
  MUTATION_SURGICAL=("${M2_SURGICAL_PASSES[@]}")
  assert_mutation_suite "$RESULTS_MUTATION" "metade 2" "$SUITE_TOTAL_DOCTOR" "$SUITE_DOCTOR"

  info "MUTAÇÃO (job) — o veredito intacto e o NAMING em silêncio (é o que a suíte pega)..."
  forges_run "partial" "m2-partial"
  local i
  for i in "${!FORGE_LABELS[@]}"; do
    if [ "${FORGE_EXITS[$i]}" -ne 0 ]; then
      fail "FATO INESPERADO: ${FORGE_LABELS[$i]} ficou VERMELHO com a metade 2 mutada."
      fail "  Esta metade é silenciosa por DESENHO (só some o naming) — se o veredito"
      fail "  mudou, a mutação não é cirúrgica. Veja ${FORGE_OUTS[$i]}"
      exit 1
    fi
    assert_marker "${FORGE_OUTS[$i]}" "$UNPROVEN_LINE" "must-not" "${FORGE_LABELS[$i]}"
    assert_marker "${FORGE_OUTS[$i]}" "$GATE_WARNING_LINE" "must" "${FORGE_LABELS[$i]}"
  done
  pass "  ▸ as duas forjas seguem VERDES e o relatório PARA DE DIZER o que não foi"
  pass "     comparado — silêncio medido, com a suíte como única testemunha"

  restore_file "$BACKUP_DIR/shared" "$M2_FILE"
  pass "  ↻ metade 2 restaurada"
}

# METADE 3 — a TROCA da função compartilhada no doctor (por uma versão local que
# devolve "sem drift"). A suíte é a do doctor; no job a régua CHEGA e o bloqueio
# NÃO sai — o job segue vermelho pela segunda régua, declarada.
mutation_shared_function() {
  info "═══ METADE 3/3 — a TROCA da FUNÇÃO COMPARTILHADA (mirrorDriftReport) ═══"
  apply_mutation "$M3_FILE" "$M3_FROM" "$M3_TO" "$M3_SED" "metade 3"

  MUTATION_EXPECTED=("${M3_EXPECTED_FAILURES[@]}")
  MUTATION_SURGICAL=("${M3_SURGICAL_PASSES[@]}")
  assert_mutation_suite "$RESULTS_MUTATION" "metade 3" "$SUITE_TOTAL_DOCTOR" "$SUITE_DOCTOR"

  info "MUTAÇÃO (job) — a régua chega e o bloqueio não sai..."
  forges_run "wrong" "m3-wrong"
  local i
  for i in "${!FORGE_LABELS[@]}"; do
    if [ "${FORGE_EXITS[$i]}" -eq 0 ]; then
      fail "BURACO ABERTO: ${FORGE_LABELS[$i]} ficou VERDE com a função compartilhada trocada."
      fail "  Veja ${FORGE_OUTS[$i]}"
      exit 1
    fi
    assert_marker "${FORGE_OUTS[$i]}" "$DELIVERY_LINE" "must" "${FORGE_LABELS[$i]}"
    assert_marker "${FORGE_OUTS[$i]}" "$RULER_LINE" "must-not" "${FORGE_LABELS[$i]}"
    assert_marker "${FORGE_OUTS[$i]}" "$AMBIENT_LINE" "must" "${FORGE_LABELS[$i]}"
  done
  pass "  ▸ as duas forjas seguem VERMELHAS: a régua CHEGOU (\"$DELIVERY_LINE\") e a"
  pass "     comparação sumiu — a segunda régua impede o buraco, e a suíte pega a troca"

  restore_file "$BACKUP_DIR/doctor" "$M3_FILE"
  pass "  ↻ metade 3 restaurada"
}

# ── Bootstrap ─────────────────────────────────────────────────────────────

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (perfil --ci do doctor, 3 metades)"
echo "   1. a régua entregue pelo gate · 2. o critério do 'não comparado'"
echo "   3. a função compartilhada da comparação"
echo "   (IN-PLACE, backup + trap de restauração nos TRÊS arquivos)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

mkdir -p "$BACKUP_DIR"
cp "$GATE" "$BACKUP_DIR/gate"
cp "$SHARED" "$BACKUP_DIR/shared"
cp "$DOCTOR" "$BACKUP_DIR/doctor"
pass "Backup criado: gate, shared (check-actrc-sync) e doctor"

# ── Os valores de referência (o que o REPOSITÓRIO declara) ────────────────
DECLARED_BUN_VERSION="$(declared_value "BUN_VERSION")"
DECLARED_REGISTRY="$(declared_value "IMAGE_REGISTRY")"
DECLARED_NAMESPACE="$(declared_value "IMAGE_NAMESPACE")"
if [ -z "$DECLARED_BUN_VERSION" ] || [ -z "$DECLARED_REGISTRY" ] || [ -z "$DECLARED_NAMESPACE" ]; then
  fail "INFRA: $ENV_TEMPLATE não declara BUN_VERSION/IMAGE_REGISTRY/IMAGE_NAMESPACE."
  fail "  Sem referência não há como montar o contraste valor certo × errado."
  exit 1
fi
WRONG_BUN_VERSION="0.0.0-mutacao"
pass "Referência: BUN_VERSION=$DECLARED_BUN_VERSION · IMAGE_REGISTRY=$DECLARED_REGISTRY · IMAGE_NAMESPACE=$DECLARED_NAMESPACE"
pass "Contraste: vars.BUN_VERSION=$WRONG_BUN_VERSION (o valor ERRADO que tem de bloquear)"

# As âncoras de CADA suíte — cada uma exigida VIVA no controle DA SUA suíte
# (uma âncora da suíte do doctor não existe na suíte do gate, e vice-versa).
GATE_ANCHORS=(
  "${M1_EXPECTED_FAILURES[@]}"
  "${M1_SURGICAL_PASSES[@]}"
)
DOCTOR_ANCHORS=(
  "${M2_EXPECTED_FAILURES[@]}"
  "${M2_SURGICAL_PASSES[@]}"
  "${M3_EXPECTED_FAILURES[@]}"
  "${M3_SURGICAL_PASSES[@]}"
)

# ── CONTROLE ──────────────────────────────────────────────────────────────

CONTROL_ANCHORS=("${GATE_ANCHORS[@]}")
assert_control_suite "$RESULTS_CONTROL_GATE" "suíte do gate" "$SUITE_GATE"
SUITE_TOTAL_GATE="$SUITE_TOTAL"
CONTROL_ANCHORS=("${DOCTOR_ANCHORS[@]}")
assert_control_suite "$RESULTS_CONTROL_DOCTOR" "suíte do doctor" "$SUITE_DOCTOR"
SUITE_TOTAL_DOCTOR="$SUITE_TOTAL"
assert_control_jobs

# ── AS TRÊS METADES ───────────────────────────────────────────────────────

mutation_gate_ruler
mutation_not_compared
mutation_shared_function

# ═════════════════════════════════════════════════════════════════════════
# Result (restore roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — as TRÊS metades da comparação de espelhos do"
pass "  perfil --ci (o gate de PR das duas forjas) têm testemunha: a suíte,"
pass "  e o FATO no job — nenhuma delas passa em silêncio."
pass "  • controle: suíte do gate ($SUITE_TOTAL_GATE testes) e do doctor ($SUITE_TOTAL_DOCTOR) verdes"
pass "  • controle: valor DECLARADO → 0 · ERRADO → ≠ 0 · PARCIAL → 0 + naming"
pass "  • metade 1 (a régua do gate): suíte vermelha; job de cada forja AINDA vermelho"
pass "  • metade 2 (o critério do 'não comparado'): suíte vermelha; silêncio MEDIDO no relatório"
pass "  • metade 3 (a função compartilhada trocada): suíte vermelha; régua chega e não compara"
exit 0
