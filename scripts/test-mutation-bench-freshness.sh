#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-bench-freshness.sh — Mutation test da RÉGUA DA IDADE
# (scripts/bench-freshness.mjs)
#
# Usage:
#   ./scripts/test-mutation-bench-freshness.sh
#
# Exit codes:
#   0 — as OITO mutações DETECTADAS (por EXECUÇÃO e/ou pela suíte) e os controles
#       mordendo ✅
#   1 — régua CEGA a alguma mutação (não viu / não acusou) / mutação não-cirúrgica
#       / infra ❌
#
# POR QUE: a régua da idade existe para impedir um número DECLARADO de envelhecer
# em silêncio — ela é o que transforma "de quando é este número?" em veredito. Uma
# régua de idade que ficasse cega não acusaria nada e o repositório seguiria
# publicando o mesmo verde: é a única classe de guard em que o verde CEGO é
# indistinguível do verde honesto sem uma testemunha. Cada regra que o veredito
# consome ganha a sua metade aqui.
#
# DUAS testemunhas, e o teste exige a que a mutação atinge:
#   (1) a RÉGUA por EXECUÇÃO — o CLI (`node scripts/bench-freshness.mjs --json`)
#       sobre o REPOSITÓRIO REAL, com as três fontes de hoje (6 famílias medidas
#       do bench, 27 números declarados do modelo e as tabelas de custo do README).
#       Não é leitura do arquivo: é o fato que o doctor e o publicador consomem.
#       Para o fail-closed da FONTE o CLI recebe `--file` apontando para um arquivo
#       que não existe — o caminho "não consegui ler" medido de ponta a ponta.
#   (2) a SUÍTE unitária (`src/lib/__tests__/bench-freshness.test.ts`), que julga
#       as funções puras e é a única testemunha das duas metades que o repositório
#       de hoje NÃO consegue mostrar (está dito em cada uma).
#
# UMA MUTAÇÃO POR REGRA (a unidade é a REGRA, não o arquivo):
#   M1 — a DERIVAÇÃO da origem pela DATA (`commitOfDate`): datando tudo por HEAD,
#        toda declaração fica a ZERO commits atrás da árvore — a régua declara
#        frescor sem ter medido nada, que é o defeito que ela existe para nomear.
#   M2 — a ÂNCORA de MÊS (`anchorBefore`): `mm/aaaa` resolve no ÚLTIMO commit do
#        mês; no PRIMEIRO dia ela resolve um mês ANTES do que declara, e a idade
#        sai MAIOR do que é (o número parece mais velho do que é, sem ninguém ver).
#   M3 — o TETO POR TIPO (`FRESHNESS_CEILINGS`): a prosa de custo do README não
#        tem teto (a idade dela é PUBLICADA, porque a doc é re-medida quando o
#        GUARD muda, não por calendário). Com o teto das famílias, a mesma âncora
#        de 412 commits passa a VENCER e o canal abre dívida para sempre.
#   M4 — a FRONTEIRA do teto (`isAged`): `>` vira `>=` e uma declaração
#        exatamente NO teto passa a vencer. Witness: só a SUÍTE — no repositório
#        de hoje nenhuma declaração está exatamente nos 150 (e é isso que a
#        fronteira precisa de um fixture para ser vista).
#   M5 — o fail-closed da FONTE (`readFreshness`): a fonte ILEGÍVEL vira uma
#        unidade `fonte-ilegivel` no fato; sem ela, "não consegui ler" vira "nada
#        a julgar" e o veredito fica MEDIDO (verde) sobre um arquivo que ninguém
#        leu.
#   M6 — o fail-closed da DECLARAÇÃO (`modelDeclarations`): um `ms` SEM a própria
#        data entra como `declaracao-sem-origem` (o `meta.date` do arquivo é a
#        data do ATO, não a da medição). Sem a unidade, o número sem origem some
#        do veredito em silêncio. Witness: só a SUÍTE — o modelo real carrega a
#        data de TODOS os seus números (que é, em si, a prova de que a regra é
#        seguida).
#   M7 — o TETO DERIVADO do ritmo (`tetoDoRitmo`): voltando ao literal, o teto
#        deixa de seguir o repositório — um repositório que acelerou passa a ter
#        o teto do ritmo de meses atrás, e o canal acusa (ou deixa passar) pelo
#        número ERRADO. Witness: as DUAS — o CLI, recomputando o teto a partir do
#        que o próprio fato mediu (`piso × ciclos` contra `commits ÷ janela`), e a
#        suíte, que fixa os dois lados do produto (ritmo alto × piso).
#   M8 — a PROCEDÊNCIA do teto (`teto.origem`): com a reserva se declarando
#        "medido", um teto de fail-closed (o git não respondeu o ritmo) sai com a
#        cara de um teto medido de agora — a diferença entre veredito e dúvida
#        some justamente onde ela decide. Witness: só a SUÍTE — no repositório de
#        hoje o ritmo É medido, e é a suíte que mede o caminho da reserva.
#
# CADA mutação é CIRÚRGICA: o injetor recusa alvo ausente ou ambíguo (o alvo tem
# de aparecer UMA vez) e o arquivo mutado tem de continuar com sintaxe válida —
# aplicar no lugar errado mediria outra coisa, e o harness estaria mentindo ao se
# declarar detector.
#
# COMO: muta a régua IN-PLACE (backup + trap EXIT de restauração, NUNCA
# `git checkout`) e restaura entre as mutações, para cada uma ser medida contra a
# base íntegra; o controle final confere o checksum e o veredito de volta ao
# original.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'M1|a DERIVAÇÃO da origem pela DATA: datando por HEAD, toda idade colapsa a zero'
  'M2|a ÂNCORA de MÊS no ÚLTIMO commit: no primeiro dia, a origem fica um mês atrás'
  'M3|o TETO POR TIPO: com teto na prosa do README, a tabela de custo passa a vencer'
  'M4|a FRONTEIRA do teto: com >=, a declaração exatamente no teto vira vencida'
  'M5|o fail-closed da FONTE: sem a unidade, "não consegui ler" vira "nada a julgar"'
  'M6|o fail-closed da DECLARAÇÃO: sem a data própria, o número some do veredito'
  'M7|o TETO DERIVADO do ritmo: com o literal, o teto deixa de seguir o repositório'
  'M8|a PROCEDÊNCIA do teto: com a reserva se dizendo "medido", a dúvida vira veredito'
)
cd "$SCRIPT_DIR"

GUARD="scripts/bench-freshness.mjs"
SUITE="src/lib/__tests__/bench-freshness.test.ts"

TMP_DIR="$(mktemp -d)"
BACKUP="$TMP_DIR/bench-freshness.mjs.backup"
RESULTS="$TMP_DIR/results.json"
CLI_JSON="$TMP_DIR/cli.json"

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

# ── Testemunha (1) — a RÉGUA por EXECUÇÃO (o CLI, sobre o repositório real) ─
# `cli [args...]`: roda o CLI, guarda o exit em CLI_EXIT e o fato em $CLI_JSON.
CLI_EXIT=0
cli() {
  local code=0
  node "$GUARD" --json "$@" >"$CLI_JSON" 2>"$TMP_DIR/cli.err" || code=$?
  CLI_EXIT=$code
}

# `fato <campo>`: lê do fato o que a asserção precisa. Campos: `state`,
# `behindMax`, `aged`, `unknown`, `behind:<kind>` (a MAIOR idade entre as
# declarações daquele tipo), `aged:<kind>` (os ids vencidos daquele tipo),
# `ancora:month` (a maior idade entre as âncoras de MÊS — `mm/aaaa`) e os do
# teto: `teto` (o número), `teto:origem`, `teto:commits`, `teto:commitsPorCiclo`,
# `teto:janelaDias`, `teto:ciclos`, `teto:cicloDias`, `teto:pisoDeCiclo`.
fato() {
  python3 - "$CLI_JSON" "$1" <<'PY'
import json, sys
path, campo = sys.argv[1], sys.argv[2]
f = json.load(open(path, encoding="utf-8"))
fam = f.get("families") or []
if campo == "state":
    print(f.get("state"))
elif campo == "behindMax":
    print(f.get("behindMax"))
elif campo in ("aged", "unknown"):
    print(",".join(f.get(campo) or []))
elif campo.startswith("behind:"):
    k = campo.split(":", 1)[1]
    idades = [x["behind"] for x in fam if x.get("kind") == k and isinstance(x.get("behind"), int)]
    print(max(idades) if idades else "-")
elif campo.startswith("aged:"):
    k = campo.split(":", 1)[1]
    print(",".join(x["family"] for x in fam if x.get("state") == "aged" and x.get("kind") == k))
elif campo == "ancora:month":
    idades = [x["behind"] for x in fam if x.get("anchorKind") == "month" and isinstance(x.get("behind"), int)]
    print(max(idades) if idades else "-")
elif campo == "fonte-ilegivel":
    print(",".join(x["family"] for x in fam if x.get("kind") == "fonte-ilegivel"))
elif campo == "teto":
    print((f.get("teto") or {}).get("teto"))
elif campo.startswith("teto:"):
    print((f.get("teto") or {}).get(campo.split(":", 1)[1]))
else:
    raise SystemExit("campo desconhecido: " + campo)
PY
}

# ── Testemunha (2) — a SUÍTE unitária ─────────────────────────────────────
# Devolve o exit code do vitest.
run_suite() {
  rm -f "$RESULTS"
  local code=0
  # `|| code=$?` em vez de `set +e`: a função roda sob `set -e`, e um `set +e`
  # interno DESLIGARIA o errexit no chamador (o escopo do shell é global).
  bun x vitest run --config vitest.config.unit.ts --reporter=json \
    --outputFile="$RESULTS" "$SUITE" 2>&1 | tail -3 || code=$?
  return "$code"
}

# mutar <alvo> <troca>: substituição LITERAL, com o arquivo relido para provar
# que aplicou (o alvo tem de aparecer UMA vez) e que a sintaxe continua válida.
mutar() {
  local alvo="$1" troca="$2"
  python3 - "$GUARD" "$alvo" "$troca" <<'PY'
import sys
path, alvo, troca = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path, encoding="utf-8").read()
if src.count(alvo) != 1:
    print(f"MUTACAO NAO-CIRURGICA: '{alvo}' aparece {src.count(alvo)}x (esperado 1)", file=sys.stderr)
    sys.exit(1)
open(path, "w", encoding="utf-8").write(src.replace(alvo, troca))
PY
  if ! node --check "$GUARD" >/dev/null 2>&1; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: o arquivo mutado não é válido sintaticamente."
    exit 1
  fi
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   MUTATION TEST — régua da IDADE das declarações datadas ($GUARD)"
echo "  ═════════════════════════════════════════════════════════════════"

cp "$GUARD" "$BACKUP"
pass "Backup da régua (restauração por checksum no fim)"

# ── CONTROLE — a régua MEDE no estado íntegro ─────────────────────────────
# Sem este passo, uma régua que devolvesse um fato vazio (ou "sem idade" em
# tudo) passaria como detector: as asserções de cada metade são RELATIVAS ao
# controle, então o controle precisa ser ele mesmo não-trivial.
header "CONTROLE — a régua mede as três fontes no repositório real"
cli
if [ "$CLI_EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: o CLI saiu $CLI_EXIT (esperado 0 = medido e nada vencido)."
  cat "$CLI_JSON"
  exit 1
fi
CTRL_STATE="$(fato state)"
CTRL_BEHIND="$(fato behindMax)"
CTRL_TABELAS="$(fato behind:declared-table)"
CTRL_MES="$(fato ancora:month)"
CTRL_BENCH="$(fato behind:bench-family)"
CTRL_AGED="$(fato aged)"
if [ "$CTRL_STATE" != "measured" ]; then
  fail "CONTROLE FALHOU: o fato não está medido ($CTRL_STATE)."
  exit 1
fi
if [ -z "$CTRL_AGED" ]; then
  pass "Controle OK — medido e nada vencido (o estado de hoje do repositório)"
else
  fail "CONTROLE FALHOU: há declaração VENCIDA no repositório real ($CTRL_AGED) — a régua está certa, o repositório é que tem dívida; mova a régua com o ato do bench antes de rodar esta suíte."
  exit 1
fi
# O controle tem de ter IDADE: uma régua que devolvesse `null` em tudo (ou um
# repositório de um commit) faria todas as asserções passarem por vacuidade.
for par in "behindMax:$CTRL_BEHIND" "tabelas:$CTRL_TABELAS" "mes:$CTRL_MES" "bench:$CTRL_BENCH"; do
  nome="${par%%:*}"
  valor="${par#*:}"
  if ! [[ "$valor" =~ ^[0-9]+$ ]] || [ "$valor" -le 0 ]; then
    fail "CONTROLE FALHOU: $nome saiu '$valor' — sem idade não há o que a mutação possa colapsar (mediria outra coisa)."
    exit 1
  fi
done
pass "Controle OK — as idades de hoje: a mais antiga ${CTRL_BEHIND} commit(s), a tabela do README ${CTRL_TABELAS}, a âncora de MÊS ${CTRL_MES}, a família do bench ${CTRL_BENCH}"

if run_suite; then
  pass "Controle OK — suíte unitária verde com a régua intacta"
else
  fail "CONTROLE FALHOU: a suíte unitária não ficou verde no estado íntegro."
  exit 1
fi

# ── MUTAÇÃO M1 — a DERIVAÇÃO da origem pela DATA ──────────────────────────
# `commitOfDate` resolve a âncora no commit IMEDIATAMENTE anterior a ela. Datando
# por HEAD, toda declaração datada passa a ter ZERO commits atrás: a régua diz
# "fresca" sobre números que ninguém re-mediu — o verde cego que ela existe para
# não produzir.
header "MUTAÇÃO M1 — a derivação da origem pela data (commitOfDate)"
info "Fazendo a âncora resolver no próprio HEAD em vez do commit anterior a ela..."
mutar '  const saida = run("git", ["rev-list", "-1", `--before=${anchorBefore(anchor)}`, head], {' \
  '  const saida = run("git", ["rev-parse", head], { // MUTACAO M1: toda data vira HEAD'
pass "Mutação M1 aplicada (sintaxe válida)"

cli
# A asserção é sobre as declarações DATADAS (as tabelas do README e os números do
# modelo): a idade das FAMÍLIAS do bench vem do commit gravado na baseline, não de
# uma data — e a mutação não pode mexer nela (é o segundo lado da asserção).
M1_DECL="$(fato behind:declared-table)"
M1_BENCH="$(fato behind:bench-family)"
if [ "$M1_DECL" != "0" ]; then
  fail "M1 NÃO DETECTADA: com a origem datada por HEAD as declarações datadas ainda medem $M1_DECL commit(s) atrás."
  exit 1
fi
if [ "$M1_BENCH" != "$CTRL_BENCH" ]; then
  fail "M1 DETECTADA fora de escopo: a idade das FAMÍLIAS do bench (que vem do commit da baseline, não de uma data) passou de $CTRL_BENCH para $M1_BENCH."
  exit 1
fi
pass "M1 DETECTADA pela RÉGUA por execução: a tabela do README caiu de ${CTRL_TABELAS} para 0 commit(s) atrás (a idade foi colapsada) e a família do bench seguiu em ${M1_BENCH} — a mutação atinge só a origem DATADA"

SUITE_EXIT=0
run_suite || SUITE_EXIT=$?
if [ "$SUITE_EXIT" -eq 0 ]; then
  fail "M1 NÃO DETECTADA pela suíte: a origem datada por HEAD passou em silêncio."
  exit 1
fi
pass "M1 DETECTADA também pela suíte unitária (exit $SUITE_EXIT)"

cp "$BACKUP" "$GUARD"
pass "Régua restaurada — base íntegra para a mutação M2"

# ── MUTAÇÃO M2 — a ÂNCORA de MÊS no ÚLTIMO commit ─────────────────────────
# A forma `mm/aaaa` NÃO declara o dia, e a régua resolve a âncora no ÚLTIMO
# commit daquele mês (o mais novo possível). No PRIMEIRO dia, a origem resolve um
# mês ANTES do que está escrito: a idade sai MAIOR do que é, e a declaração passa
# a parecer mais velha do que o dono declarou.
header "MUTAÇÃO M2 — a âncora de MÊS (o último commit do mês, não o primeiro dia)"
info "Resolvendo a âncora de mês no PRIMEIRO dia em vez do último..."
mutar '  return `${proximo} 00:00:00`' \
  '  return `${anchor.date} 00:00:00` // MUTACAO M2: o primeiro dia, nao o fim do mes'
pass "Mutação M2 aplicada (sintaxe válida)"

cli
M2_MES="$(fato ancora:month)"
if ! [[ "$M2_MES" =~ ^[0-9]+$ ]]; then
  fail "M2 NÃO DETECTADA: a âncora de mês saiu '$M2_MES' (sem idade) — a derivação parou de resolver."
  exit 1
fi
if [ "$M2_MES" -le "$CTRL_MES" ]; then
  fail "M2 NÃO DETECTADA: a âncora de mês mede ${M2_MES} commit(s) atrás, e o controle ${CTRL_MES} — o primeiro dia tinha de resolver MAIS atrás (um mês antes do declarado)."
  exit 1
fi
pass "M2 DETECTADA pela RÉGUA por execução: a mesma âncora passa de ${CTRL_MES} para ${M2_MES} commit(s) atrás — um mês inventado para trás"

SUITE_EXIT=0
run_suite || SUITE_EXIT=$?
if [ "$SUITE_EXIT" -eq 0 ]; then
  fail "M2 NÃO DETECTADA pela suíte: a âncora de mês no primeiro dia passou em silêncio."
  exit 1
fi
pass "M2 DETECTADA também pela suíte unitária (exit $SUITE_EXIT)"

cp "$BACKUP" "$GUARD"
pass "Régua restaurada — base íntegra para a mutação M3"

# ── MUTAÇÃO M3 — o TETO POR TIPO ──────────────────────────────────────────
# A prosa de custo do README (as tabelas do próprio README, ancoradas em
# 01..03/08/2026) NÃO tem teto: ela é re-medida quando o GUARD muda, não por
# calendário, e um teto em commits compararia o ritmo do CÓDIGO com o da DOC —
# alerta que sempre acende. Com o teto das famílias, as MESMAS âncoras passam a
# vencer e o canal abre dívida por um número que ninguém re-mediu por outro
# motivo.
header "MUTAÇÃO M3 — o teto por tipo (a prosa do README sem teto)"
info "Dando à tabela de custo do README o teto das famílias..."
mutar '  "declared-table": null,' \
  '  "declared-table": FRESHNESS_MAX_COMMITS_BEHIND, // MUTACAO M3: teto unico para todo tipo'
pass "Mutação M3 aplicada (sintaxe válida)"

cli
M3_AGED="$(fato aged:declared-table)"
M3_TOTAL="$(fato aged)"
if [ -z "$M3_AGED" ]; then
  fail "M3 NÃO DETECTADA: nenhuma tabela do README venceu com o teto aplicado."
  exit 1
fi
if [ "$CLI_EXIT" -eq 0 ]; then
  fail "M3 NÃO DETECTADA pelo exit code: com declaração vencida o CLI ainda saiu 0."
  exit 1
fi
pass "M3 DETECTADA pela RÉGUA por execução: as tabelas do README passam a VENCER (${M3_AGED}) e o veredito sai ${CLI_EXIT} — a idade que era PUBLICADA vira dívida"

SUITE_EXIT=0
run_suite || SUITE_EXIT=$?
if [ "$SUITE_EXIT" -eq 0 ]; then
  fail "M3 NÃO DETECTADA pela suíte: o teto único para todo tipo passou em silêncio."
  exit 1
fi
pass "M3 DETECTADA também pela suíte unitária (exit $SUITE_EXIT) — e nenhuma das ${M3_TOTAL} vencidas é de outro tipo"

cp "$BACKUP" "$GUARD"
pass "Régua restaurada — base íntegra para a mutação M4"

# ── MUTAÇÃO M4 — a FRONTEIRA do teto (`>` vs `>=`) ────────────────────────
# O teto é "até N commits atrás é fresco": uma declaração EXATAMENTE no teto é
# fato declarado, não dívida. Com `>=` o limite vira a primeira dívida, e o canal
# abre alerta para uma declaração que ninguém deixou envelhecer.
#
# TESTEMUNHA: só a SUÍTE, e isso é declarado — no repositório de hoje NENHUMA
# declaração está exatamente nos 150 commits (a mais próxima é a da âncora de
# 16/09, dezenas de commits abaixo), então o CLI não tem onde ver a fronteira. A
# suíte tem o fixture exato (`behind === teto` fresco × `teto + 1` vencido).
header "MUTAÇÃO M4 — a fronteira do teto (uma declaração NO teto é fresca)"
info "Trocando a comparação do teto por >=..."
mutar '  return teto !== null && typeof behind === "number" && behind > teto' \
  '  return teto !== null && typeof behind === "number" && behind >= teto // MUTACAO M4: o teto vira divida'
pass "Mutação M4 aplicada (sintaxe válida)"

SUITE_EXIT=0
run_suite || SUITE_EXIT=$?
if [ "$SUITE_EXIT" -eq 0 ]; then
  fail "M4 NÃO DETECTADA: a suíte passou com a declaração NO teto virando vencida."
  fail "No repositório real isso não aparece (nenhuma declaração está nos 150): sem a suíte, a fronteira ficaria sem testemunha nenhuma."
  exit 1
fi
pass "M4 DETECTADA pela suíte unitária (exit $SUITE_EXIT) — no teto é fresca, teto + 1 é vencida"

cp "$BACKUP" "$GUARD"
pass "Régua restaurada — base íntegra para a mutação M5"

# ── MUTAÇÃO M5 — o fail-closed da FONTE ───────────────────────────────────
# O bench ILEGÍVEL (ausente, JSON inválido, truncado) entra no fato como uma
# unidade `fonte-ilegivel`: "não consegui ler" é veredito INDETERMINADO, nunca
# "nenhuma família velha". Sem a unidade, o fato sai MEDIDO — o arquivo que
# ninguém leu passa a contar como árvore sã, que é a forma mais cara do verde
# falso (um indeterminado permanente alguém investiga; um verde ninguém olha).
header "MUTAÇÃO M5 — o fail-closed da FONTE (o bench ilegível)"
# A unidade `fonte-ilegivel` é o que carrega "não consegui ler" para dentro do
# fato, e é ELA que o doctor (seção 9/9) e o publicador leem para dizer
# INDETERMINADA e para suspender o fechamento. O `rc` do CLI com um unknown no
# fato é 0 por desenho (o limite está escrito no cabeçalho do módulo): o que esta
# metade mede é a PERDA da unidade, não o código de saída.
info "Medindo o fail-closed ANTES de mutar: --file apontando para um arquivo que não existe..."
cli --file docs/benchmarks/nao-existe.json
CTRL_ILEGIVEL_UNIDADE="$(fato fonte-ilegivel)"
CTRL_ILEGIVEL_BENCH="$(fato behind:bench-family)"
if [ -z "$CTRL_ILEGIVEL_UNIDADE" ]; then
  fail "CONTROLE FALHOU: a fonte ilegível não virou a unidade \`fonte-ilegivel\` no fato."
  cat "$CLI_JSON"
  exit 1
fi
if [ "$CTRL_ILEGIVEL_BENCH" != "-" ]; then
  fail "CONTROLE FALHOU: a fonte ilegível ainda mediu famílias do bench ($CTRL_ILEGIVEL_BENCH commit(s) atrás)."
  exit 1
fi
pass "Controle OK — arquivo ausente: a unidade \`${CTRL_ILEGIVEL_UNIDADE}\` entra no fato (unknown, com o motivo) e as famílias do bench ficam FORA, porque não foram lidas"

info "Fazendo o fato tomar as famílias do bench mesmo quando a fonte não foi lida..."
mutar '    bench.state === "measured"' \
  '    true // MUTACAO M5: a fonte ilegivel entra como "nada a julgar"'
pass "Mutação M5 aplicada (sintaxe válida)"

cli --file docs/benchmarks/nao-existe.json
M5_UNIDADE="$(fato fonte-ilegivel)"
M5_UNKNOWN="$(fato unknown)"
M5_STATE="$(fato state)"
if [ -n "$M5_UNIDADE" ]; then
  fail "M5 NÃO DETECTADA: a unidade \`fonte-ilegivel\` ainda está no fato ($M5_UNIDADE)."
  exit 1
fi
if [ -n "$M5_UNKNOWN" ]; then
  fail "M5 DETECTADA parcialmente: a unidade sumiu, mas o fato ainda acusa $M5_UNKNOWN sem idade."
  exit 1
fi
if [ "$M5_STATE" != "measured" ]; then
  fail "M5 NÃO DETECTADA: o fato saiu '$M5_STATE' em vez de MEDIDO (o 'nada a julgar' é o defeito)."
  exit 1
fi
pass "M5 DETECTADA pela RÉGUA por execução: 'não consegui ler' SAI do fato — nenhuma unidade, nenhum unknown e o estado MEDIDO (o doctor diria PRONTA e o publicador fecharia a dívida sobre um arquivo que ninguém leu)"

SUITE_EXIT=0
run_suite || SUITE_EXIT=$?
if [ "$SUITE_EXIT" -eq 0 ]; then
  fail "M5 NÃO DETECTADA pela suíte: a fonte ilegível virando 'nada a julgar' passou em silêncio."
  exit 1
fi
pass "M5 DETECTADA também pela suíte unitária (exit $SUITE_EXIT)"

cp "$BACKUP" "$GUARD"
pass "Régua restaurada — base íntegra para a mutação M6"

# ── MUTAÇÃO M6 — o fail-closed da DECLARAÇÃO (o `ms` sem a própria data) ──
# O número declarado SEM a data DELE não é datado por decurso: o `meta.date` do
# arquivo é a data do ATO, não a da medição. Ele entra no fato como
# `declaracao-sem-origem` (unknown, com o motivo nomeado). Sem a unidade, o
# número sem origem desaparece do veredito — que é exatamente "nenhum número
# declarado vive sem data de origem visível" deixando de valer.
#
# TESTEMUNHA: só a SUÍTE, e isso é declarado — o modelo real carrega a `date` de
# TODOS os seus 27 números (o dono o recusa no `--check` quando falta), então o
# CLI não tem onde ver a regra morder. O que o repositório mostra é o estado
# SAUDÁVEL da regra; a suíte mostra o que acontece quando ela some.
header "MUTAÇÃO M6 — o fail-closed da DECLARAÇÃO (número sem data própria)"
info "Fazendo o número sem a própria data sumir do fato em silêncio..."
mutar '    if (!entry.date) {
' '    if (!entry.date) {
      return // MUTACAO M6: o numero sem data propria some do veredito
'
pass "Mutação M6 aplicada (sintaxe válida)"

SUITE_EXIT=0
run_suite || SUITE_EXIT=$?
if [ "$SUITE_EXIT" -eq 0 ]; then
  fail "M6 NÃO DETECTADA: a suíte passou com o número sem data própria sumindo do fato."
  exit 1
fi
pass "M6 DETECTADA pela suíte unitária (exit $SUITE_EXIT) — o número sem a própria data sai como \`declaracao-sem-origem\`, nomeado"

# A suíte é a testemunha da regra; o CLI é a testemunha de que ela NÃO morde no
# repositório real (todo número declarado de hoje tem a data dele). As duas
# juntas dizem o que importa: a regra existe e o corpus está conforme.
cli
M6_UNKNOWN="$(fato unknown)"
if [ -n "$M6_UNKNOWN" ]; then
  fail "o repositório real tem declaração SEM idade ($M6_UNKNOWN) — a régua está certa, o corpus é que precisa da data própria em cada número."
  exit 1
fi
pass "E no repositório real nenhuma declaração ficou sem idade: os 27 números do modelo carregam a data DELE"

cp "$BACKUP" "$GUARD"
pass "Régua restaurada — base íntegra para a mutação M7"

# ── MUTAÇÃO M7 — o TETO DERIVADO do ritmo (`tetoDoRitmo`) ─────────────────
# O teto nasceu declarado à mão (150) e passou a ser o PRODUTO do ritmo medido
# (`ciclos × commits por ciclo`, com o piso declarado). Voltando ao literal, o
# teto deixa de seguir o repositório: um repositório que acelerou continua com o
# teto do ritmo de meses atrás — apertado em silêncio (acusa quem tem menos de
# uma semana de calendário) — e um que desacelerou fica frouxo (não acusa quem
# passou meses sem re-medição).
#
# TESTEMUNHA: as DUAS. O CLI porque o repositório mede o ritmo de verdade e o
# fato é AUTO-DESCRITO: o teto tem de ser o produto do que o próprio fato mediu
# (`piso × ciclos` contra `commits ÷ janelaDias × ciclos`, recomputado AQUI a
# partir do fato — sem uma segunda cópia da regra no harness). A suíte porque
# fixa os dois lados do produto (ritmo alto → 300; ritmo baixo → o piso) — no
# repositório de hoje o ritmo dá um número só, e um só não distingue produto de
# coincidência.
header "MUTAÇÃO M7 — o teto DERIVADO do ritmo (o literal volta)"
info "Devolvendo o teto ao literal declarado, em vez do produto do ritmo medido..."
mutar '    teto: Math.max(piso, bruto),' \
  '    teto: FRESHNESS_MAX_COMMITS_BEHIND, // MUTACAO M7: o teto volta a ser declarado a mao'
pass "Mutação M7 aplicada (sintaxe válida)"

cli
M7_ORIGEM="$(fato teto:origem)"
M7_TETO="$(fato teto)"
M7_COMMITS="$(fato teto:commits)"
M7_ESPERADO="$(python3 - "$CLI_JSON" <<'PY'
import json, sys
t = json.load(open(sys.argv[1], encoding="utf-8")).get("teto") or {}
commits, janela, ciclo, ciclos, piso = (
    t.get(k) for k in ("commits", "janelaDias", "cicloDias", "ciclos", "pisoDeCiclo")
)
print(max(piso * ciclos, round(commits / (janela / ciclo) * ciclos)))
PY
)"
if [ "$M7_ORIGEM" != "medido" ]; then
  fail "M7 NÃO DETECTADA: o teto saiu com origem '$M7_ORIGEM' (esperado 'medido') — a régua não mediu o ritmo."
  exit 1
fi
if [ "$M7_TETO" = "$M7_ESPERADO" ]; then
  fail "M7 NÃO DETECTADA pelo CLI: o teto ($M7_TETO) continua sendo o produto do ritmo medido (${M7_COMMITS} commits → $M7_ESPERADO)."
  exit 1
fi
pass "M7 DETECTADA pela RÉGUA por execução: com ${M7_COMMITS} commits na janela o teto tinha de ser $M7_ESPERADO, e saiu $M7_TETO (o literal) — o teto deixou de seguir o repositório"

SUITE_EXIT=0
run_suite || SUITE_EXIT=$?
if [ "$SUITE_EXIT" -eq 0 ]; then
  fail "M7 NÃO DETECTADA pela suíte: o teto literal passou em silêncio."
  fail "No repositório de hoje o ritmo dá UM número: sem a suíte, o produto e a coincidência ficariam indistinguíveis."
  exit 1
fi
pass "M7 DETECTADA também pela suíte unitária (exit $SUITE_EXIT) — os dois lados do produto e a reserva ficam fixos"

cp "$BACKUP" "$GUARD"
pass "Régua restaurada — base íntegra para a mutação M8"

# ── MUTAÇÃO M8 — a PROCEDÊNCIA do teto (`teto.origem`) ────────────────────
# O teto tem DUAS origens: `medido` (o ritmo de agora) e `reserva declarada` (o
# git não respondeu o ritmo — fail-closed). Se a reserva se declarar "medido",
# um teto de emergência sai com a cara de um teto medido: a diferença entre
# VEREDITO e DÚVIDA ("o repositório anda assim" × "não consegui medir") some
# justamente onde ela decide — no relatório, no doctor e na issue.
#
# TESTEMUNHA: só a SUÍTE, e isso é declarado — no repositório de hoje o ritmo É
# medido (o CLI mostra o caminho feliz), e é o fixture que mede o caminho da
# reserva, onde a origem passa a mentir.
header "MUTAÇÃO M8 — a procedência do teto (a reserva se dizendo medido)"
info "Fazendo o caminho da reserva se declarar medido..."
mutar '      teto: FRESHNESS_MAX_COMMITS_BEHIND,
      origem: "reserva declarada",' \
  '      teto: FRESHNESS_MAX_COMMITS_BEHIND,
      origem: "medido", // MUTACAO M8: a reserva vira medicao'
pass "Mutação M8 aplicada (sintaxe válida)"

SUITE_EXIT=0
run_suite || SUITE_EXIT=$?
if [ "$SUITE_EXIT" -eq 0 ]; then
  fail "M8 NÃO DETECTADA: a suíte passou com a reserva se declarando 'medido'."
  exit 1
fi
pass "M8 DETECTADA pela suíte unitária (exit $SUITE_EXIT) — a reserva sai nomeada, e o teto de emergência não se confunde com uma medição"

cp "$BACKUP" "$GUARD"
pass "Régua RESTAURADA (checksum conferido abaixo)"

# ── CONTROLE FINAL — a árvore voltou ao comportamento original ────────────
header "CONTROLE FINAL — a régua restaurada volta a MEDIR o mesmo fato"
if ! cmp -s "$BACKUP" "$GUARD"; then
  fail "A régua NÃO voltou ao estado original (backup ≠ atual)."
  exit 1
fi
cli
if [ "$CLI_EXIT" -ne 0 ] || [ "$(fato behindMax)" != "$CTRL_BEHIND" ]; then
  fail "CONTROLE FINAL FALHOU: a régua restaurada mede $(fato behindMax) commit(s) (esperado $CTRL_BEHIND) e saiu $CLI_EXIT."
  exit 1
fi
pass "Controle final OK — a régua restaurada mede de novo ${CTRL_BEHIND} commit(s) e sai 0"

# ── Veredito ──────────────────────────────────────────────────────────────
echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo -e "   ${GREEN}✅ MUTATION TEST PASSOU${NC} — as OITO regras são LOAD-BEARING:"
echo "      • a DERIVAÇÃO da origem pela DATA → datada por HEAD, a régua"
echo "        declara frescor sem ter medido nada"
echo "      • a ÂNCORA de MÊS no último commit → no primeiro dia, a idade"
echo "        sai um mês maior do que o dono declarou"
echo "      • o TETO POR TIPO → com teto na prosa do README, a idade"
echo "        PUBLICADA vira dívida (e o canal alerta para sempre)"
echo "      • a FRONTEIRA do teto → no teto é fresco; com >=, dívida"
echo "      • o fail-closed da FONTE → sem a unidade, o arquivo que ninguém"
echo "        leu conta como árvore sã (estado MEDIDO, rc=0)"
echo "      • o fail-closed da DECLARAÇÃO → sem a unidade, o número sem a"
echo "        própria data some do veredito em silêncio"
echo "      • o TETO DERIVADO do ritmo → com o literal, o teto deixa de seguir"
echo "        o repositório (apertado num que acelerou, frouxo num que parou)"
echo "      • a PROCEDÊNCIA do teto → com a reserva se dizendo medido, a dúvida"
echo "        (o git não respondeu o ritmo) sai com cara de veredito"
echo "      Cada metade é CIRÚRGICA (o alvo tem de aparecer UMA vez, o arquivo"
echo "      segue com sintaxe válida) e é restaurada entre as medições, com a"
echo "      régua medindo o mesmo fato de novo no controle final."
echo "  ═════════════════════════════════════════════════════════════════"
echo ""
