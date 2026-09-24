#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-bench-freshness.sh — Mutation test da RÉGUA DA IDADE
# (scripts/bench-freshness.mjs)
#
# Usage:
#   ./scripts/test-mutation-bench-freshness.sh
#
# Exit codes:
#   0 — as ONZE mutações DETECTADAS (por EXECUÇÃO e/ou pela suíte) e os controles
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
  'M9|a FONTE da forma no commit de origem: assumindo "a origem é o HEAD", a doc-hashes volta a passar'
  'M10|o fail-closed da PERGUNTA: sem o master daquele commit, "não perguntei" vira "está no commit"'
  'M11|o ESCOPO da matriz: com o master sozinho, as SUÍTES que ele cita saem do relógio'
  'M12|a DATA do item datado: com o relógio da run, o item se re-data a cada execução e nunca envelhece'
)
cd "$SCRIPT_DIR"

GUARD="scripts/bench-freshness.mjs"
SUITE="src/lib/__tests__/bench-freshness.test.ts"
# A RÉGUA DAS FORMAS (o outro lado da idade: o CONTEÚDO do commit de origem) tem a
# suíte DELA, e as metades M9/M10 são dela. As duas rodam na mesma chamada — uma
# testemunha por arquivo seria uma segunda execução do mesmo vitest.
SUITE_FORMAS="src/lib/__tests__/bench-form-origin.test.ts"

# O MASTER da matriz vem da RÉGUA (não de um caminho escrito à mão): é a mesma
# constante com que a régua monta o escopo do relógio da matriz.
MASTER="$(node -e 'import("./scripts/bench-families.mjs").then((m) => console.log(m.MASTER_DOS_SUBTESTS))')"

# As SUÍTES que o master CITA — derivadas do PRÓPRIO arquivo (a mesma leitura que
# a régua faz), para o controle e a M11 compararem com o que o master declara.
# Uma lista à mão aqui divergiria no dia em que um sub-test novo entrasse.
suites_do_master() {
  python3 - "$MASTER" <<'PY'
import re, sys
txt = open(sys.argv[1], encoding="utf-8").read()
ini = txt.index("SUBTESTS=(")
fim = txt.index("\n)", ini)
caminhos = set()
for linha in txt[ini:fim].splitlines():
    velho = re.match(r'\s*"([^"|]+)\|(.+)\|([^"|]+)"\s*$', linha)
    if velho:
        caminhos.add(velho.group(3).strip())
        continue
    m = re.match(r'\s*"([^"|]+)\|([^"]+)"\s*$', linha)
    if m:
        caminhos.add(m.group(2).strip())
print(",".join(sorted(caminhos)))
PY
}

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
elif campo == "bench:origem":
    # AS ORIGENS das famílias do bench (família@commit): a idade delas pode ser
    # ZERO — é o estado SANO logo depois do ato que as mediu —, então o sinal que
    # não pode sumir é a própria origem lida, não o número de commits atrás.
    print(",".join(f'{x["family"]}@{x["commit"]}' for x in fam if x.get("kind") == "bench-family" and x.get("commit")))
elif campo == "ancora:month":
    idades = [x["behind"] for x in fam if x.get("anchorKind") == "month" and isinstance(x.get("behind"), int)]
    print(max(idades) if idades else "-")
elif campo == "fonte-ilegivel":
    print(",".join(x["family"] for x in fam if x.get("kind") == "fonte-ilegivel"))
elif campo == "forms:state":
    print((f.get("forms") or {}).get("state"))
elif campo == "forms:fora":
    print(len((f.get("forms") or {}).get("missing") or []))
elif campo == "forms:ids":
    print(",".join(f'{m.get("family")}/{m.get("form")}' for m in ((f.get("forms") or {}).get("missing") or [])))
elif campo == "forms:sem-resposta":
    print((f.get("forms") or {}).get("semResposta"))
elif campo.startswith("matriz:"):
    # O RELÓGIO DA MATRIZ: o estado, o lag, o escopo (a LISTA de caminhos) e o
    # teto DELA (o número e a procedência).
    m = f.get("matrix") or {}
    esc = m.get("escopo") or {}
    teto = m.get("teto") or {}
    k = campo.split(":", 1)[1]
    if k == "state":
        print(m.get("state"))
    elif k == "lag":
        print(m.get("lag"))
    elif k == "aged":
        print("sim" if m.get("aged") else "nao")
    elif k == "paths":
        print(",".join(esc.get("paths") or []))
    elif k == "escopo-state":
        print(esc.get("state"))
    elif k == "teto":
        print(teto.get("teto"))
    elif k == "teto-origem":
        print(teto.get("origem"))
    elif k == "teto-paths":
        print(teto.get("paths"))
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
    --outputFile="$RESULTS" "$SUITE" "$SUITE_FORMAS" 2>&1 | tail -3 || code=$?
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
# O CLI sai 1 também por uma FORMA medida que o commit de origem não tem — a
# classe que a régua ganhou (`forms.missing`): ela é uma DÍVIDA do ato anterior
# (a árvore foi medida antes de a suíte entrar no commit), e o repositório fica
# nesse estado até o próximo ato. Exigir exit 0 aqui faria o controle depender do
# estado do repositório (verde com a dívida fechada, vermelho com ela aberta), e
# um controle que só passa num dos dois não é controle: o que se exige é que o
# vermelho venha DESSA classe, nomeada.
CTRL_FORA="$(fato forms:fora)"
if [ "$CLI_EXIT" -ne 0 ] && [ -z "$CTRL_FORA" ]; then
  fail "CONTROLE FALHOU: o CLI saiu $CLI_EXIT e NENHUMA forma medida está fora do commit de origem — o vermelho não é da classe declarada."
  cat "$CLI_JSON"
  exit 1
fi
if [ -n "$CTRL_FORA" ]; then
  info "CONTROLE: o repositório REAL tem ${CTRL_FORA} forma(s) medida(s) fora do commit de origem ($(fato forms:ids)) — a régua a NOMEIA (o vermelho é dela), e o remédio é o ato com a árvore commitada"
fi
CTRL_STATE="$(fato state)"
CTRL_BEHIND="$(fato behindMax)"
CTRL_TABELAS="$(fato behind:declared-table)"
CTRL_MES="$(fato ancora:month)"
CTRL_BENCH="$(fato behind:bench-family)"
CTRL_ORIGENS="$(fato bench:origem)"
# O RELÓGIO DA MATRIZ no controle: o ESCOPO publicado tem de conter TODAS as
# suítes que o master cita (derivadas do próprio master). Sem esta asserção a
# M11 mediria a mutação contra o vazio — e um escopo que já nascesse só com o
# master faria a mutação passar despercebida.
CTRL_MATRIZ_STATE="$(fato matriz:state)"
CTRL_MATRIZ_PATHS="$(fato matriz:paths)"
CTRL_CITADAS="$(suites_do_master)"
if [ -z "$CTRL_CITADAS" ]; then
  fail "CONTROLE FALHOU: o master ($MASTER) não declara NENHUMA suíte — sem suítes não há o que o escopo da matriz julgue."
  exit 1
fi
if [ "$CTRL_MATRIZ_STATE" != "measured" ]; then
  fail "CONTROLE FALHOU: o relógio da MATRIZ não foi medido no repositório real ('$CTRL_MATRIZ_STATE') — a régua não pode julgar o que não mediu."
  exit 1
fi
CTRL_FORA_ESCOPO="$(python3 - "$CTRL_CITADAS" "$CTRL_MATRIZ_PATHS" <<'PY'
import sys
citadas = [c for c in sys.argv[1].split(",") if c]
dentro = set(c for c in sys.argv[2].split(",") if c)
print(" ".join(c for c in citadas if c not in dentro))
PY
)"
if [ -n "$CTRL_FORA_ESCOPO" ]; then
  fail "CONTROLE FALHOU: as suítes citadas pelo master NÃO estão no escopo do relógio da matriz (${CTRL_FORA_ESCOPO}) — o escopo é o master + as suítes que ele cita."
  exit 1
fi
CTRL_ESCOPO_N="$(echo "$CTRL_MATRIZ_PATHS" | tr ',' '\n' | grep -c .)"
ctrl_citadas_n="$(echo "$CTRL_CITADAS" | tr ',' '\n' | grep -c .)"
pass "Controle OK — o relógio da matriz mede ${CTRL_ESCOPO_N} caminho(s), com as ${ctrl_citadas_n} suíte(s) que o master cita DENTRO do escopo"
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
for par in "behindMax:$CTRL_BEHIND" "tabelas:$CTRL_TABELAS" "mes:$CTRL_MES"; do
  nome="${par%%:*}"
  valor="${par#*:}"
  if ! [[ "$valor" =~ ^[0-9]+$ ]] || [ "$valor" -le 0 ]; then
    fail "CONTROLE FALHOU: $nome saiu '$valor' — sem idade não há o que a mutação possa colapsar (mediria outra coisa)."
    exit 1
  fi
done
# A idade das FAMÍLIAS do bench pode ser ZERO — é o estado SANO logo depois do
# ato que as mediu (o remédio da própria régua), e exigi-la positiva faria o
# controle depender do estado do repositório: verde com a régua velha, vermelho
# logo depois de movê-la. O que não pode faltar é a ORIGEM lida (o commit de onde
# a idade é derivada) — sem ela a régua devolveria `null` em tudo e as asserções
# passariam por vacuidade.
if [ -z "$CTRL_ORIGENS" ]; then
  fail "CONTROLE FALHOU: nenhuma família do bench tem origem lida (a régua devolveria 'sem idade' em tudo) — a mutação mediria outra coisa."
  exit 1
fi
pass "Controle OK — as idades de hoje: a mais antiga ${CTRL_BEHIND} commit(s), a tabela do README ${CTRL_TABELAS}, a âncora de MÊS ${CTRL_MES}, as ${CTRL_BENCH} de atraso do bench (0 = recém-medida, o estado são) sobre ${CTRL_ORIGENS}"

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
M1_ORIGENS="$(fato bench:origem)"
if [ "$M1_DECL" != "0" ]; then
  fail "M1 NÃO DETECTADA: com a origem datada por HEAD as declarações datadas ainda medem $M1_DECL commit(s) atrás."
  exit 1
fi
if [ "$M1_BENCH" != "$CTRL_BENCH" ]; then
  fail "M1 DETECTADA fora de escopo: a idade das FAMÍLIAS do bench (que vem do commit da baseline, não de uma data) passou de $CTRL_BENCH para $M1_BENCH."
  exit 1
fi
if [ "$M1_ORIGENS" != "$CTRL_ORIGENS" ]; then
  fail "M1 DETECTADA fora de escopo: a ORIGEM das famílias do bench (o commit gravado na baseline, não uma data) mudou de '$CTRL_ORIGENS' para '$M1_ORIGENS'."
  exit 1
fi
pass "M1 DETECTADA pela RÉGUA por execução: a tabela do README caiu de ${CTRL_TABELAS} para 0 commit(s) atrás (a idade foi colapsada) e as origens do bench seguiram intactas (${M1_BENCH} de atraso, ${M1_ORIGENS}) — a mutação atinge só a origem DATADA"

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
mutar '      teto: reserva,
      origem: "reserva declarada",' \
  '      teto: reserva,
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
pass "Régua restaurada — base íntegra para a mutação M9"

# ── MUTAÇÃO M9 — a FONTE da forma no commit de origem ─────────────────────
# A pergunta é "o que a origem CONTÉM?", e ela não se responde com o commit: o
# commit é só um hash até alguém perguntar-lhe pelos arquivos. Assumindo "a
# origem é o HEAD, então o que eu medi está lá", a fresta real volta a passar —
# foi por ela que a `doc-hashes` ficou invisível (medida com a suíte no ÍNDICE,
# num ato cujo commit de origem não a tem).
#
# TESTEMUNHA: a SUÍTE (o fixture da `doc-hashes`) E o CLI — no repositório de
# hoje a forma fora do commit existe (`forms.missing` do controle), e a mutação
# tem de ZERAR a classe. Se o ato seguinte já tiver fechado a dívida, a suíte
# continua sendo a testemunha: o fixture dela não depende do estado do repo.
header "MUTAÇÃO M9 — a fonte da forma no commit de origem (a origem é o HEAD)"
info "Assumindo que a família medida no commit de origem está, por isso, no commit..."
mutar '    const formas = FORM_SECTION[family]?.(bench) ?? []
    if (formas.length === 0) continue' \
  '    const formas = FORM_SECTION[family]?.(bench) ?? []
    if (formas.length === 0) continue
    // MUTACAO M9: a origem e o HEAD, entao o que eu medi esta la
    if (commit === (meta?.commit ?? null)) continue'
pass "Mutação M9 aplicada (sintaxe válida)"

cli
M9_FORA="$(fato forms:fora)"
M9_STATE="$(fato forms:state)"
if [ "${M9_FORA:-1}" -gt 0 ]; then
  fail "M9 NÃO DETECTADA: com a fonte assumida pelo commit de origem a régua AINDA acha $M9_FORA forma(s) fora."
  exit 1
fi
if [ "$M9_STATE" != "measured" ]; then
  fail "M9 DETECTADA fora de escopo: o fato das formas saiu '$M9_STATE' em vez de medido."
  exit 1
fi
pass "M9 DETECTADA pela RÉGUA por execução: a classe some ($M9_STATE, 0 forma(s) fora) — assumir a origem pelo HEAD cega a régua${CTRL_FORA:+, contra as ${CTRL_FORA} do controle}"

SUITE_EXIT=0
run_suite || SUITE_EXIT=$?
if [ "$SUITE_EXIT" -eq 0 ]; then
  fail "M9 NÃO DETECTADA pela suíte: assumir a origem pelo HEAD passou em silêncio."
  exit 1
fi
pass "M9 DETECTADA também pela suíte unitária (exit $SUITE_EXIT) — o fixture da doc-hashes fica vermelho sem o master DAQUELE commit"

cp "$BACKUP" "$GUARD"
pass "Régua restaurada — base íntegra para a mutação M10"

# ── MUTAÇÃO M10 — o fail-closed da PERGUNTA (sem o master daquele commit) ─
# Um commit pode não ter o master dos sub-tests (a matriz ainda não existia ali,
# o caminho mudou). Nesse caso a pergunta "de qual arquivo veio esta forma?" NÃO
# PÔDE ser feita — e uma pergunta que não foi feita não é "está no commit": ela
# entra em `semResposta` e impede o item datado de fechar. Sem ela, o silêncio de
# uma pergunta impossível passa a valer como prova.
#
# TESTEMUNHA: só a SUÍTE, e isso é declarado — no repositório de hoje o master do
# commit de origem É legível (o CLI mostra o caminho feliz: `semResposta` zero),
# e é o fixture que mede o caminho em que a pergunta não pode ser feita.
header "MUTAÇÃO M10 — o fail-closed da pergunta (sem o master daquele commit)"
info "Fazendo a pergunta que não pôde ser feita sumir em silêncio..."
mutar '      if (fonte.via === "sem-master") {
        // A pergunta não PÔDE ser feita (aquele commit não tem o mapa id→script)
        // — e isso é diferente do limite da família que não nomeia fonte: sai
        // contado em `semResposta`, que também não deixa o item fechar.
        semResposta += 1
        continue
      }' \
  '      if (fonte.via === "sem-master") {
        continue // MUTACAO M10: a pergunta impossivel vira "esta no commit"
      }'
pass "Mutação M10 aplicada (sintaxe válida)"

SUITE_EXIT=0
run_suite || SUITE_EXIT=$?
if [ "$SUITE_EXIT" -eq 0 ]; then
  fail "M10 NÃO DETECTADA: a suíte passou com a pergunta impossível sumindo em silêncio."
  fail "No repositório real o master da origem é legível (o CLI mostra o caminho feliz): sem a suíte, a regra ficaria sem testemunha nenhuma."
  exit 1
fi
pass "M10 DETECTADA pela suíte unitária (exit $SUITE_EXIT) — sem o mapa daquele commit a forma sai como NÃO perguntada, e nunca como \"está no commit\""

cp "$BACKUP" "$GUARD"
pass "Régua restaurada — base íntegra para a mutação M11"

# ── MUTAÇÃO M11 — o ESCOPO da matriz (só o master, sem as SUÍTES) ───────
# A matriz é o master E AS SUÍTES QUE ELE CITA, e é nelas que o CUSTO mora: um
# corpo de suíte que muda move o número declarado do job (e o PISO do job
# `guards`, que dele se soma) tanto quanto um sub-test novo. Com o relógio
# contando só os commits do master, a classe que a régua existe para pegar — a
# suíte que mudou depois do ato, SEM mexer em contagem nenhuma — volta a passar em
# silêncio; e o teto, que é o ritmo do MESMO recorte, passa a medir outra coisa.
#
# TESTEMUNHA: as DUAS — o CLI (o escopo publicado tem de conter TODAS as suítes
# que o master cita, derivadas do próprio master) e a suíte unitária (o escopo
# esperado do fixture, que mede a união origem × HEAD).
header "MUTAÇÃO M11 — o escopo da matriz (só o master, sem as suítes)"
info "Tirando as suítes que o master cita do relógio da matriz..."
mutar '  const paths = [
    ...new Set([MASTER_DOS_SUBTESTS, ...escopoDaOrigem.suites, ...escopoDoHead.suites]),
  ].sort()' \
  '  // MUTACAO M11: o escopo da matriz vira so o master
  const paths = [MASTER_DOS_SUBTESTS]'
pass "Mutação M11 aplicada (sintaxe válida)"

cli
M11_PATHS="$(fato matriz:paths)"
M11_ESCOPO_N="$(echo "$M11_PATHS" | tr ',' '\n' | grep -c .)"
M11_FALTANDO="$(python3 - "$CTRL_CITADAS" "$M11_PATHS" <<'PY'
import sys
citadas = [c for c in sys.argv[1].split(",") if c]
dentro = set(c for c in sys.argv[2].split(",") if c)
print(" ".join(c for c in citadas if c not in dentro))
PY
)"
if [ -z "$M11_FALTANDO" ]; then
  fail "M11 NÃO DETECTADA: o escopo seguiu com as suítes do master (${M11_PATHS})."
  exit 1
fi
pass "M11 DETECTADA pela RÉGUA por execução: o escopo caiu de ${CTRL_ESCOPO_N} para ${M11_ESCOPO_N} caminho(s) e as suítes citadas SAÍRAM dele (${M11_FALTANDO})"
# O RECORTE do TETO anda junto do escopo: um teto medido noutro recorte seria a
# segunda régua do mesmo número (o ritmo da matriz é o ritmo DESTES caminhos).
M11_TETO_PATHS="$(fato matriz:teto-paths)"
if [ "$M11_TETO_PATHS" != "$M11_ESCOPO_N" ]; then
  fail "M11 DETECTADA fora de escopo: o recorte do teto ($M11_TETO_PATHS) divergiu do escopo ($M11_ESCOPO_N)."
  exit 1
fi
pass "M11 também confere o RECORTE do teto: ele mede os MESMOS ${M11_TETO_PATHS} caminho(s) do escopo — a mutação moveu os dois juntos"

SUITE_EXIT=0
run_suite || SUITE_EXIT=$?
if [ "$SUITE_EXIT" -eq 0 ]; then
  fail "M11 NÃO DETECTADA pela suíte: o escopo sem as suítes citadas passou em silêncio."
  exit 1
fi
pass "M11 DETECTADA também pela suíte unitária (exit $SUITE_EXIT) — o escopo do fixture perde as suítes que o master cita"

# ── MUTAÇÃO M12 — a DATA DO ITEM DATADO (`matrixItem.declaredAt`) ─────────
# O item que o doctor ABRE quando o registro do ato fica atrás da matriz leva a
# data do PRIMEIRO COMMIT que a matriz ganhou depois do ato (`since.date`), e não
# o relógio da run — de propósito: um item que se re-datasse a cada execução
# nunca envelheceria, e a dívida ficaria eternamente "de hoje" (é o mesmo defeito
# que o registro datado (`ci/unproven.json`) existe para não ter: uma lacuna sem
# data não vence e nunca é reafirmada).
#
# TESTEMUNHA: só a SUÍTE — no repositório de hoje o relógio da matriz está dentro
# do teto (`lag` 0), então NENHUM item está aberto e não há onde o CLI ver a data;
# o fixture da matriz vencida é quem mede o item, a data dele e a procedência.
header "MUTAÇÃO M12 — a data do ITEM DATADO (da história, não do relógio da run)"
info "Trocando a data do item pelo relógio da run..."
mutar '  const declaradoEm = matrix.since?.date ?? null' \
  '  // MUTACAO M12: a data do item sai do relogio da RUN, nao da historia
  const declaradoEm = new Date().toISOString().slice(0, 10)'
pass "Mutação M12 aplicada (sintaxe válida)"

SUITE_EXIT=0
run_suite || SUITE_EXIT=$?
if [ "$SUITE_EXIT" -eq 0 ]; then
  fail "M12 NÃO DETECTADA: a suíte passou com o item datado pelo relógio da run."
  fail "No repositório real isso não aparece (nenhum item aberto: o relógio da matriz está dentro do teto): sem a suíte, o item datado ficaria sem testemunha nenhuma."
  exit 1
fi
pass "M12 DETECTADA pela suíte unitária (exit $SUITE_EXIT) — a data do item sai da HISTÓRIA e não se renova a cada run"

cp "$BACKUP" "$GUARD"
pass "Régua RESTAURADA (checksum conferido abaixo)"

# ── CONTROLE FINAL — a árvore voltou ao comportamento original ────────────
header "CONTROLE FINAL — a régua restaurada volta a MEDIR o mesmo fato"
if ! cmp -s "$BACKUP" "$GUARD"; then
  fail "A régua NÃO voltou ao estado original (backup ≠ atual)."
  exit 1
fi
cli
# O exit 1 de uma FORMA fora do commit de origem é a mesma classe tolerada no
# controle inicial (a dívida do ato anterior): o que o controle final exige é que
# a régua RESTAURADA meça o MESMO fato de antes das mutações — a idade e a
# classe, iguais às do controle.
if { [ "$CLI_EXIT" -ne 0 ] && [ "$(fato forms:fora)" = "0" ]; } || [ "$(fato behindMax)" != "$CTRL_BEHIND" ]; then
  fail "CONTROLE FINAL FALHOU: a régua restaurada mede $(fato behindMax) commit(s) (esperado $CTRL_BEHIND) e saiu $CLI_EXIT."
  exit 1
fi
if [ "$(fato forms:fora)" != "$CTRL_FORA" ]; then
  fail "CONTROLE FINAL FALHOU: a régua restaurada acha $(fato forms:fora) forma(s) fora do commit de origem (esperado $CTRL_FORA)."
  exit 1
fi
# O ESCOPO da matriz volta com as suítes: a M11 mutou justamente ele, e uma
# restauração que perdesse a união deixaria a régua cega sem que o checksum
# pegasse (o alvo da mutação é uma LINHA, e o backup é do arquivo inteiro — este
# é o controle que prova que a linha voltou ao que era).
CTRL_FINAL_ESCOPO_DE_FORA="$(python3 - "$CTRL_CITADAS" "$(fato matriz:paths)" <<'PY'
import sys
citadas = [c for c in sys.argv[1].split(",") if c]
dentro = set(c for c in sys.argv[2].split(",") if c)
print(" ".join(c for c in citadas if c not in dentro))
PY
)"
if [ -n "$CTRL_FINAL_ESCOPO_DE_FORA" ]; then
  fail "CONTROLE FINAL FALHOU: a régua restaurada perdeu suítes do escopo da matriz (${CTRL_FINAL_ESCOPO_DE_FORA})."
  exit 1
fi
pass "Controle final OK — a régua restaurada mede de novo ${CTRL_BEHIND} commit(s), as ${CTRL_FORA} forma(s) fora do commit de origem E as suítes do escopo da matriz saem do MESMO estado"

# ── Veredito ──────────────────────────────────────────────────────────────
echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo -e "   ${GREEN}✅ MUTATION TEST PASSOU${NC} — as ONZE regras são LOAD-BEARING:"
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
echo "      • a FONTE da forma no commit de origem → assumindo que a origem É o"
echo "        HEAD, a doc-hashes (medida com a suíte no índice) volta a passar"
echo "      • o fail-closed da PERGUNTA → sem o master daquele commit, uma"
echo "        pergunta que não pôde ser feita vale como 'está no commit'"
echo "      • o ESCOPO da matriz → com o master sozinho, a suíte que mudou"
echo "        depois do ato deixa de mover o relógio da matriz"
echo "      Cada metade é CIRÚRGICA (o alvo tem de aparecer UMA vez, o arquivo"
echo "      segue com sintaxe válida) e é restaurada entre as medições, com a"
echo "      régua medindo o mesmo fato de novo no controle final."
echo "  ═════════════════════════════════════════════════════════════════"
echo ""
