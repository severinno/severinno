#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-github-dependencies.sh — Mutation test da CATRACA do
# inventário do GitHub (scripts/check-github-dependencies.mjs)
#
# Usage:
#   ./scripts/test-mutation-github-dependencies.sh
#
# Exit codes:
#   0 — as NOVE mutações foram DETECTADAS (pelo CLI e/ou pela suíte) e os
#       controles passaram ✅
#   1 — a catraca ficou INDIFERENTE a alguma mutação (não cegou, ou o vermelho
#       ficou GENÉRICO) OU um controle saiu falso ❌
#   2 — infra: guard, dado versionado, suíte ou python3 ausentes (fail-closed)
#
# O QUE ISTO PROVA (e por que não basta o guard passar hoje)
#
# O guard mede o que o GitHub sustenta no repositório e é uma CATRACA: uma
# dependência NOVA do GitHub falha o PR (nomeada, com a etapa e o substituto já
# declarados para a classe), e uma declaração que ENVELHECEU também falha. Um
# guard que roda e sai 0 prova que ele não ACUSOU — não prova que ele MEDIU. Os
# mecanismos que sustentam essa promessa são nove, e cada um tem aqui a sua
# mutação, com as DUAS direções (a que CEGA deixa o defeito passar; a que fica
# GENÉRICA acusa sem dizer o quê — as duas são regressão):
#
#   M1 — A COMPARAÇÃO DE CONJUNTOS (o que é NOVO numa lista). Cegá-la é a
#        cegueira mais direta: um `uses:` de terceiro novo entra na pipeline e a
#        catraca não anda — que é o defeito que este guard existe para pegar.
#   M2 — A OUTRA METADE DO CONJUNTO (o que SUMIU da declaração). Sem ela o corte
#        fica invisível: o item que já saiu do repositório continua declarado
#        para sempre e o número passa a mentir sobre o presente.
#   M3 — A COMPARAÇÃO DO CONTADOR (`medido > declarado`). As classes que não são
#        lista (referências a `ghcr.io`, plano de configuração do Actions) só têm
#        este lado; sem ele um registry/uma variável novos entram em silêncio.
#   M4 — A NOMEAÇÃO DA DEPENDÊNCIA NOVA. Um vermelho que não diz QUAL item
#        apareceu obriga quem lê a redescobrir o que o guard já sabia — e o
#        remédio do `--update` só é seguro porque o item está nomeado.
#   M5 — A NOMEAÇÃO DO DELTA do contador (`(N a mais)`). O mesmo, no lado em que
#        não há item: sem o número, "cresceu" não diz de quanto nem se é 1 ou 40.
#   M6 — O FAIL-CLOSED DO DADO AUSENTE. Sem ele a ausência viraria "nada
#        declarado" — e "não consegui ler" passaria a valer como veredito (exit
#        1) em vez de INDETERMINADO (exit 2).
#   M7 — O FAIL-CLOSED DO DADO ILEGÍVEL (JSON inválido). O mesmo pelo outro
#        caminho: um dado corrompido não pode escolher um veredito.# M8 — O FAIL-CLOSED DO CONTADOR INVÁLIDO (`Number.isInteger`). Um `declarado`
#        que não é número faz as DUAS comparações serem falsas (NaN não é maior
#        nem menor) — e a classe inteira passa a ser julgada por um valor que
#        ninguém escreveu.
#   M9 — O ESCOPO DA CONTAGEM (o auditor NÃO conta a si mesmo). O cabeçalho
#        deste guard e o `porque` da declaração CITAM o padrão para explicar a
#        classe; contá-los subia o medido de 50 para 52 no próprio commit que
#        declarou a classe (o auditor inflando a si mesmo ao se documentar) — e
#        o `--update` para 52 congelaria a inflação numa catraca que só pode
#        andar para BAIXO. A prosa que descreve a contagem não é um lugar onde o
#        flip não chegou.
#
# AS DUAS TESTEMUNHAS (e por que a ordem importa). Onde o veredito é do CLI, a

# prova é o EXIT CODE medido sobre o DEFEITO injetado no dado versionado (o CLI
# não aceita --root: o defeito é injetado no `ci/github-dependencies.json` real e
# restaurado por checksum). Onde a API do módulo é o que roda em todo PR, a
# testemunha é a suíte `check-github-dependencies.test.ts` — e ela é rodada com o
# DADO JÁ RESTAURADO, senão o vermelho dela viria do defeito (e não da mutação),
# que é exatamente a leitura falsa que uma prova por mutação não pode ter.
#
# O SETUP é cirúrgico e verificado como as mutações: 1 ocorrência exata, o
# marcador `MUTACAO M` no texto novo e o checksum do guard tendo mudado. O trap
# EXIT devolve o guard E o dado das cópias e FALHA se os checksums divergirem —
# um guard mutado esquecido no worktree é pior que a falha.
#
# Diferente das suítes que rodam o master: aqui o alvo tem 139ms por invocação,
# então o CLI roda ANTES e DEPOIS de cada mutação (o controle que faz "ficou
# cego" significar alguma coisa).
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

# A PROVA-DE-APLICAÇÃO — a régua ÚNICA de "a mutação APLICOU" (o gabarito dela é
# `scripts/test-mutation-mutacao-prova.sh`).
# shellcheck source=scripts/mutacao-prova.sh
. "$SCRIPT_DIR/scripts/mutacao-prova.sh"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'M1|A COMPARAÇÃO DE CONJUNTOS (o que é NOVO numa lista)'
  'M2|A OUTRA METADE DO CONJUNTO (o que SUMIU da declaração)'
  'M3|A COMPARAÇÃO DO CONTADOR (medido > declarado)'
  'M4|A NOMEAÇÃO DA DEPENDÊNCIA NOVA'
  'M5|A NOMEAÇÃO DO DELTA do contador ((N a mais))'
  'M6|O FAIL-CLOSED DO DADO AUSENTE'
  'M7|O FAIL-CLOSED DO DADO ILEGÍVEL (JSON inválido)'
  'M8|o FAIL-CLOSED do contador INVÁLIDO'
  'M9|O ESCOPO DA CONTAGEM (o auditor NÃO conta a si mesmo)'
)

GUARD="scripts/check-github-dependencies.mjs"
DATA="ci/github-dependencies.json"
SUITE_ARQUIVO="src/lib/__tests__/check-github-dependencies.test.ts"

# ── Colors ────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${CYAN}▸${NC} $1"; }

# ── Infra (fail-closed) ───────────────────────────────────────────────────

for alvo in "$SCRIPT_DIR/$GUARD" "$SCRIPT_DIR/$DATA" "$SCRIPT_DIR/$SUITE_ARQUIVO"; do
  if [ ! -f "$alvo" ]; then
    fail "infra: $alvo ausente — sem ele não há o que medir"
    exit 2
  fi
done
if ! command -v python3 >/dev/null 2>&1; then
  fail "infra: python3 ausente — as mutações cirúrgicas dependem dele"
  exit 2
fi

# ── Backup da FONTE + do DADO + restauração VERIFICADA (trap EXIT) ────────

TMP="$(mktemp -d "$MUT_SCRATCH/mut-XXXXXX")"
guard_backup="$TMP/guard.bak"
data_backup="$TMP/data.bak"
cp "$SCRIPT_DIR/$GUARD" "$guard_backup"
cp "$SCRIPT_DIR/$DATA" "$data_backup"
guard_sum="$(cksum "$guard_backup" | cut -d' ' -f1)"
data_sum="$(cksum "$data_backup" | cut -d' ' -f1)"

cleanup() {
  local rc=$?
  cp "$guard_backup" "$SCRIPT_DIR/$GUARD"
  cp "$data_backup" "$SCRIPT_DIR/$DATA"
  rm -f "$SCRIPT_DIR/$DATA.escondido"
  if [ "$(cksum "$SCRIPT_DIR/$GUARD" | cut -d' ' -f1)" != "$guard_sum" ]; then
    fail "RESTAURAÇÃO do guard FALHOU (checksum diverge) — restaure a partir de $guard_backup"
    rc=1
  fi
  if [ "$(cksum "$SCRIPT_DIR/$DATA" | cut -d' ' -f1)" != "$data_sum" ]; then
    fail "RESTAURAÇÃO do dado versionado FALHOU (checksum diverge) — restaure a partir de $data_backup"
    rc=1
  fi
  rm -rf "$TMP"
  exit "$rc"
}
trap cleanup EXIT

# ── mutar_guard: substituição CIRÚRGICA (exatamente 1 ocorrência) ─────────
# Uma mutação que casa 0 ou 2+ vezes não é cirúrgica: o script para em vez de
# medir outra coisa. O marcador "MUTACAO M" no texto novo é o que prova que a
# mutação APLICOU (o alvo pode existir e a escrita falhar).
mutar_guard() { # <alvo> <troca>: a cirurgia, o marcador e o checksum são da régua
  # COMPARTILHADA (`mutacao_aplicar`).
  mutacao_aplicar "$SCRIPT_DIR/$GUARD" "$1" "$2" "$guard_sum"
}

restaurar_guard() { cp "$guard_backup" "$SCRIPT_DIR/$GUARD"; }
restaurar_dado() {
  cp "$data_backup" "$SCRIPT_DIR/$DATA"
  rm -f "$SCRIPT_DIR/$DATA.escondido"
}

# ── criar_defeito: o DEFEITO versionado que a catraca existe para julgar ──
# O CLI não aceita --root: o defeito é injetado no dado do repositório (e
# restaurado no fim de cada bloco). Devolve no stdout o ALVO nomeável do
# defeito (o item removido), que é o texto que o vermelho TEM de citar.
criar_defeito() {
  DEFEITO_TIPO="$1" DATA_PATH="$SCRIPT_DIR/$DATA" python3 - <<'PY'
import json, os
p = os.environ["DATA_PATH"]
tipo = os.environ["DEFEITO_TIPO"]
d = json.load(open(p, encoding="utf-8"))
alvo = ""
escrever = True
if tipo == "item-novo":
    c = next(x for x in d["classes"] if x["id"] == "workflows")
    alvo = c["declarado"].pop(0)
elif tipo == "item-sumido":
    c = next(x for x in d["classes"] if x["id"] == "workflows")
    alvo = ".github/workflows/fantasma.yml"
    c["declarado"] = sorted(list(c["declarado"]) + [alvo])
elif tipo == "contador":
    c = next(x for x in d["classes"] if x["id"] == "ghcr-images")
    c["declarado"] = int(c["declarado"]) - 1
elif tipo == "contador-invalido":
    c = next(x for x in d["classes"] if x["id"] == "ghcr-images")
    c["declarado"] = "muitos"
elif tipo == "sem-dado":
    os.rename(p, p + ".escondido")
    escrever = False
elif tipo == "json-quebrado":
    open(p, "w", encoding="utf-8").write('{ "version": 1, "classes": [')
    escrever = False
else:
    raise SystemExit(f"defeito desconhecido: {tipo}")
if escrever:
    json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(alvo)
PY
}

# ── rodar_guard / rodar_suite (as duas testemunhas) ───────────────────────

rodar_guard() {
  set +e
  GUARD_OUT="$(cd "$SCRIPT_DIR" && node "$GUARD" 2>&1)"
  GUARD_EXIT=$?
  set -e
}

suite_disponivel() { [ -d "$SCRIPT_DIR/node_modules/vitest" ]; }

rodar_suite() {
  set +e
  SUITE_OUT="$(cd "$SCRIPT_DIR" && bun x vitest run --config vitest.config.unit.ts "$SUITE_ARQUIVO" 2>&1 | tail -8)"
  SUITE_EXIT=$?
  set -e
}

# ── Asserções do veredito (medem o CLI, não a intenção) ───────────────────

mostrar() { echo "$GUARD_OUT" | tail -5 | sed 's/^/      /'; }

exigir_exit() {
  local esperado="$1" cenario="$2"
  if [ "$GUARD_EXIT" -ne "$esperado" ]; then
    fail "$cenario: esperava exit $esperado e veio $GUARD_EXIT — o veredito não é o contrato"
    mostrar
    exit 1
  fi
}

exigir_nomeando() {
  local texto="$1" cenario="$2"
  # Herestring (não pipe): sob `set -o pipefail`, `echo | grep -q` pode falhar
  # por SIGPIPE — flaky pelo tamanho (a lição do próprio repositório).
  if ! grep -qF "$texto" <<<"$GUARD_OUT"; then
    fail "$cenario: o vermelho NÃO nomeia '$texto' — um vermelho genérico não prova QUAL fato é verificado"
    mostrar
    exit 1
  fi
}

exigir_sem_nomear() {
  local texto="$1" cenario="$2"
  if grep -qF "$texto" <<<"$GUARD_OUT"; then
    fail "$cenario: o vermelho ainda nomeia '$texto' — a mutação não tirou a nomeação"
    mostrar
    exit 1
  fi
}

exigir_suite_vermelha() {
  local cenario="$1"
  if ! suite_disponivel; then
    info "$cenario (suíte): NÃO julgada — node_modules/vitest ausente neste job (declarado, nunca silencioso)"
    return 0
  fi
  rodar_suite
  if [ "$SUITE_EXIT" -eq 0 ]; then
    fail "$cenario (suíte): a suíte unitária ficou VERDE com o mecanismo mutado — a testemunha não sente o que a mutação tira"
    echo "$SUITE_OUT" | sed 's/^/      /'
    exit 1
  fi
}

MUTACOES_DETECTADAS=0

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 MUTATION TEST — a catraca do inventário do GitHub"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ── CONTROLE A: o repositório REAL é verde (a catraca fechada hoje) ───────
info "CONTROLE A — o inventário declarado confere com o medido (a premissa)"
rodar_guard
exigir_exit 0 "CONTROLE A"
pass "CONTROLE A: guard verde no repositório real (exit 0) — a catraca não acusa o são"
echo ""

# ── M1: a COMPARAÇÃO DE CONJUNTOS (o que é NOVO numa lista) ───────────────
info "M1 — a comparação de conjuntos: o item NOVO numa lista"
ALVO_NOVO="$(criar_defeito "item-novo")"
rodar_guard
exigir_exit 1 "M1 (controle): o item novo é julgado"
exigir_nomeando "dependencia NOVA do GitHub — $ALVO_NOVO" "M1 (controle)"
pass "M1-controle: a declaração sem '$ALVO_NOVO' é reprovada NOMEANDO o item"
# A comparacao de CONJUNTOS vive na DERIVACAO (`novasDependencias`), que o gate e
# o canal periodico passam a compartilhar: o item medido que NAO esta declarado e
# o que "e novo". Neutraliza-la e nao pular nada (todo item declarado entra como
# novo? nao — e pular TUDO, que e o que faz a cegueira: nenhum item novo sai).
mutar_guard '        if (declarado.includes(item)) continue' \
  '        if (true) continue /* MUTACAO M1: a comparacao de CONJUNTOS (o que e NOVO) foi neutralizada */'
rodar_guard
exigir_exit 0 "M1 (mutação): sem a comparação de conjuntos"
exigir_suite_vermelha "M1"
restaurar_guard
restaurar_dado
pass "M1: o item novo passa em SILÊNCIO quando a comparação de conjuntos some (suíte VERMELHA)"
MUTACOES_DETECTADAS=$((MUTACOES_DETECTADAS + 1))
echo ""

# ── M2: a COMPARAÇÃO DE CONJUNTOS (o que SUMIU) ───────────────────────────
info "M2 — a outra metade do conjunto: o item declarado que SUMIU"
ALVO_SUMIDO="$(criar_defeito "item-sumido")"
rodar_guard
exigir_exit 1 "M2 (controle): a declaração envelhecida é julgada"
exigir_nomeando "declaracao ENVELHECIDA — $ALVO_SUMIDO" "M2 (controle)"
pass "M2-controle: o item fantasma '$ALVO_SUMIDO' é reprovado (o corte não fica invisível)"
mutar_guard '      const sumidos = declarado.filter((x) => !medido.includes(x))' \
  '      const sumidos = [] /* MUTACAO M2: a comparacao de CONJUNTOS (o que SUMIU) foi neutralizada */'
rodar_guard
exigir_exit 0 "M2 (mutação): sem a comparação do que sumiu"
exigir_suite_vermelha "M2"
restaurar_guard
restaurar_dado
pass "M2: a declaração envelhecida passa em SILÊNCIO quando a outra metade do conjunto some (suíte VERMELHA)"
MUTACOES_DETECTADAS=$((MUTACOES_DETECTADAS + 1))
echo ""

# ── M3: a COMPARAÇÃO DO CONTADOR (medido > declarado) ─────────────────────
info "M3 — a comparação do contador: as classes que não são lista"
criar_defeito "contador" >/dev/null
rodar_guard
exigir_exit 1 "M3 (controle): o contador a mais é julgado"
exigir_nomeando "(1 a mais)" "M3 (controle)"
pass "M3-controle: a dependência nova medida como NÚMERO é reprovada citando o delta"
mutar_guard '      } else if (medido > declarado) {' \
  '      } else if (false) { /* MUTACAO M3: a comparacao do CONTADOR (medido > declarado) foi neutralizada */'
rodar_guard
exigir_exit 0 "M3 (mutação): sem a comparação do contador"
exigir_suite_vermelha "M3"
restaurar_guard
restaurar_dado
pass "M3: o contador a mais passa em SILÊNCIO quando o lado '>' some (suíte VERMELHA)"
MUTACOES_DETECTADAS=$((MUTACOES_DETECTADAS + 1))
echo ""

# ── M4: a NOMEAÇÃO da dependência nova ───────────────────────────────────
info "M4 — a nomeação: o vermelho tem de dizer QUAL item apareceu"
ALVO_NOVO="$(criar_defeito "item-novo")"
rodar_guard
exigir_exit 1 "M4 (controle): o defeito é julgado"
exigir_nomeando "— $ALVO_NOVO" "M4 (controle)"
mutar_guard 'dependencia NOVA do GitHub — ${n.item}. Ela entra' \
  'dependencia NOVA do GitHub (sem nomear o item). Ela entra /* MUTACAO M4: a NOMEACAO da dependencia nova foi removida */'
rodar_guard
exigir_exit 1 "M4 (mutação): o defeito continua reprovado"
exigir_sem_nomear "— $ALVO_NOVO" "M4 (mutação)"
exigir_suite_vermelha "M4"
restaurar_guard
restaurar_dado
pass "M4: sem a nomeação o vermelho fica GENÉRICO (reprova, mas não diz o quê) — suíte VERMELHA"
MUTACOES_DETECTADAS=$((MUTACOES_DETECTADAS + 1))
echo ""

# ── M5: a NOMEAÇÃO do delta do contador ──────────────────────────────────
info "M5 — a nomeação do delta: '(N a mais)'"
criar_defeito "contador" >/dev/null
rodar_guard
exigir_exit 1 "M5 (controle): o contador a mais é julgado"
exigir_nomeando "(1 a mais)" "M5 (controle)"
mutar_guard '(${medido - declarado} a mais)' \
  '(o contador cresceu) /* MUTACAO M5: o DELTA do contador nao e mais nomeado */'
rodar_guard
exigir_exit 1 "M5 (mutação): o defeito continua reprovado"
exigir_sem_nomear "(1 a mais)" "M5 (mutação)"
exigir_suite_vermelha "M5"
restaurar_guard
restaurar_dado
pass "M5: sem o delta o vermelho não diz DE QUANTO cresceu — suíte VERMELHA"
MUTACOES_DETECTADAS=$((MUTACOES_DETECTADAS + 1))
echo ""

# ── M6: o FAIL-CLOSED do dado AUSENTE ────────────────────────────────────
info "M6 — fail-closed: o dado AUSENTE é infra (exit 2), nunca veredito"
criar_defeito "sem-dado" >/dev/null
rodar_guard
exigir_exit 2 "M6 (controle): o dado ausente"
pass "M6-controle: sem o dado o guard sai 2 (INDETERMINADO) — não presume 'nada declarado'"
mutar_guard '    throw new Error(`o inventario declarado (${DATA}) nao existe — sem ele nao ha catraca`)' \
  '    return { classes: [], estagios: [] } /* MUTACAO M6: o fail-closed do dado AUSENTE foi removido */'
rodar_guard
exigir_exit 1 "M6 (mutação): o dado ausente virou veredito"
restaurar_dado
exigir_suite_vermelha "M6"
restaurar_guard
restaurar_dado
pass "M6: sem o fail-closed a ausência do dado VIRA veredito (exit 1) em vez de INDETERMINADO (exit 2) — suíte VERMELHA"
MUTACOES_DETECTADAS=$((MUTACOES_DETECTADAS + 1))
echo ""

# ── M7: o FAIL-CLOSED do dado ILEGÍVEL (JSON inválido) ───────────────────
info "M7 — fail-closed: o dado ILEGÍVEL também é infra (exit 2)"
criar_defeito "json-quebrado" >/dev/null
rodar_guard
exigir_exit 2 "M7 (controle): o JSON corrompido"
pass "M7-controle: com o dado corrompido o guard sai 2 — um dado ilegível não escolhe veredito"
mutar_guard '    throw new Error(`o inventario declarado (${DATA}) nao e JSON valido: ${err?.message ?? err}`)' \
  '    return { classes: [], estagios: [] } /* MUTACAO M7: o fail-closed do JSON INVALIDO foi removido */'
rodar_guard
exigir_exit 1 "M7 (mutação): o dado corrompido virou veredito"
restaurar_dado
exigir_suite_vermelha "M7"
restaurar_guard
restaurar_dado
pass "M7: sem o fail-closed o JSON corrompido VIRA veredito em vez de INDETERMINADO — suíte VERMELHA"
MUTACOES_DETECTADAS=$((MUTACOES_DETECTADAS + 1))
echo ""

# ── M8: o FAIL-CLOSED do contador INVÁLIDO ───────────────────────────────
info "M8 — fail-closed: o contador declarado que não é número"
criar_defeito "contador-invalido" >/dev/null
rodar_guard
exigir_exit 1 "M8 (controle): o contador inválido é julgado"
exigir_nomeando "contador declarado invalido (muitos)" "M8 (controle)"
pass "M8-controle: um 'declarado' que não é número é reprovado como contador inválido"
mutar_guard '      if (!Number.isInteger(declarado)) {' \
  '      if (false) { /* MUTACAO M8: o fail-closed do contador INVALIDO foi removido */'
rodar_guard
exigir_exit 0 "M8 (mutação): o contador inválido passa"
exigir_suite_vermelha "M8"
restaurar_guard
restaurar_dado
pass "M8: sem o fail-closed o NaN faz as DUAS comparações serem falsas e a classe passa verde (suíte VERMELHA)"
MUTACOES_DETECTADAS=$((MUTACOES_DETECTADAS + 1))
echo ""

# ── M9: o auditor NÃO CONTA A SI MESMO (o escopo da contagem) ─────────────
info "M9 — o ESCOPO da contagem: a prosa do PRÓPRIO auditor não é dependência"
rodar_guard
exigir_exit 0 "M9 (controle): o repositório real é verde com o auditor fora da varredura"
pass "M9-controle: o medido é o do REPOSITÓRIO (50) e a classe confere com o declarado"
mutar_guard '  if (ARQUIVOS_DO_AUDITOR.has(rel)) return false' \
  '  if (false) return false /* MUTACAO M9: o auditor voltou a contar a PROPRIA prosa (o cabecalho do guard + o porque da declaracao) */'
rodar_guard
exigir_exit 1 "M9 (mutação): o auditor contando a si mesmo"
exigir_nomeando "(2 a mais)" "M9 (mutação)"
exigir_suite_vermelha "M9"
restaurar_guard
pass "M9: sem a exclusão o auditor infla a si mesmo (50 → 52, '(2 a mais)') — a catraca acusaria o commit que DOCUMENTA a classe (suíte VERMELHA)"
MUTACOES_DETECTADAS=$((MUTACOES_DETECTADAS + 1))
echo ""

# ── CONTROLE FINAL: restauração verificada por checksum ──────────────────
info "CONTROLE FINAL — o guard e o dado restaurados (checksums) e o são de novo verde"
if [ "$(cksum "$SCRIPT_DIR/$GUARD" | cut -d' ' -f1)" != "$guard_sum" ]; then
  fail "CONTROLE FINAL: o guard não voltou ao estado original"
  exit 1
fi
if [ "$(cksum "$SCRIPT_DIR/$DATA" | cut -d' ' -f1)" != "$data_sum" ]; then
  fail "CONTROLE FINAL: o dado versionado não voltou ao estado original"
  exit 1
fi
pass "CONTROLE FINAL: guard e dado idênticos aos de antes (a prova não deixa resíduo)"
rodar_guard
exigir_exit 0 "CONTROLE FINAL: o repositório real volta a passar"
pass "CONTROLE FINAL: o repositório real volta a passar (exit 0)"
echo ""

echo "  ═════════════════════════════════════════════════════════════════"
echo "   ✅ MUTATION TEST PASSED — as $MUTACOES_DETECTADAS mutações foram"
echo "      detectadas (CLI e/ou suíte) e os controles passaram"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""
