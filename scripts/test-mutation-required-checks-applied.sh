#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-required-checks-applied.sh — Mutation test da metade
# APLICADA do contrato de required checks (o RENAME que exige a reaplicação
# declarada)
#
# Usage:
#   ./scripts/test-mutation-required-checks-applied.sh
#
# Exit codes:
#   0 — as DEZ mutações foram DETECTADAS pela suíte (e os controles passaram) ✅
#       — ou a testemunha se declarou NÃO JULGÁVEL (sem `vitest`), dito em voz
#       alta
#   1 — suíte CEGA (verde com a mutação) / vermelha pelo motivo errado / controle
#       falso / a mutação não aplicou / infra ❌
#
# O QUE ISTO PROVA (e por que a suíte verde não basta)
#
# Quem bloqueia o merge NÃO é `ci/required-checks.json`: é a proteção APLICADA na
# forja. Uma mudança que renomeia o `name:` de um job required — ou que põe/tira
# um job da lista — muda o CONTEXTO exigido, e a forja continua exigindo o
# ANTIGO: o PR trava num check que nunca mais roda, sem nenhuma linha de gate
# parecer errada. Foi para isso que existe a DECLARAÇÃO da reaplicação
# (`ci/required-checks-applied.json`, escrita por `apply-required-checks.mjs
# --apply`), comparada com os contextos derivados AGORA pelo
# `check-required-checks.mjs`.
#
# Essa promessa tem QUATRO metades, e "suíte verde" não distingue "mediu" de "não
# havia o que medir" — mutar uma delas e continuar verde é a regressão silenciosa:
#
#   M1 — a régua do RENAME (derivado ⊄ aplicado): o contexto que passou a existir
#        não está declarado. Mutação: o laço sobre `derivado.contexts` deixa de
#        rodar ⇒ o rename passa a ser aceito e a forja fica exigindo o contexto
#        velho.
#   M2 — a régua do ÓRFÃO (aplicado ⊄ derivado): a declaração exige um check que
#        o repositório não produz mais. É a MESMA comparação vista do outro lado;
#        mutar uma não pode cegar a outra.
#   M3 — o FIO em `main()`: a metade aplicada deixa de ser julgada (as duas réguas
#        intactas, o veredito sem elas). Mutar a regra e mutar quem a chama são
#        regressões diferentes.
#   M4 — o FAIL-CLOSED do carregamento: `loadApplied` passa a devolver `null` em
#        vez de estourar quando o arquivo não existe ⇒ "não consegui ler" vira
#        "nada a comparar" e o PR fica verde sem declaração nenhuma.
#   M5 — o applier RESPEITA o alvo (`buildAppliedRecord`): mutação que reescreve a
#        declaração de TODAS as forjas ⇒ uma forja fora do `--forge` passa a
#        declarar como aplicado algo que ninguém aplicou.
#   M6 — o applier não gera CHURN (`buildAppliedRecord`): mutação que reescreve o
#        arquivo em todo `--apply` ⇒ um diff em cada rodada, que o operador aprende
#        a ignorar (um arquivo ignorado não declara nada).
#   M9 — o applier DECLARA a forja que recusa a feature (`buildAppliedRecord`):
#        mutação que não grava o marcador ⇒ a declaração diria que a proteção
#        existe, e o gate novo daquela forja não poderia nem ser declarado (o
#        verde que esconde o fato que importa).
#   M10 — o MOTIVO do marcador (`validateApplied`): mutação que aceita
#        `unsupported` sem razão ⇒ a forja é declarada sem portão sem dizer por
#        quê, e o veredito publica um estado sobre o qual ninguém pode agir.
#
# E as DUAS metades do veredito LOCAL (`--staged`, o recorte do pre-commit), que
# têm testemunha própria (`required-checks-staged-cli.test.ts` — repositório git
# temporário + a CLI de verdade):
#
#   M7 — a FONTE do veredito local é o ÍNDICE (`indexIo` ⇒ `git show :path`).
#        Mutação: ler a ÁRVORE de trabalho ⇒ o commit passa a ser julgado por um
#        conteúdo que NÃO é o dele — o rename corrigido na árvore e ainda no
#        índice (o que vai para o merge) deixaria de ser visto.
#   M8 — o FAIL-CLOSED do índice: `stagedPaths` estoura quando o git não responde
#        (fora de repositório). Mutação: devolver a lista vazia ⇒ "não consegui
#        ler o índice" passa a ser "nada a julgar", e TODO commit sai verde do
#        hook — inclusive o rename.
#
# A TESTEMUNHA é `src/lib/__tests__/required-checks-applied.test.ts`, que monta
# repositórios temporários e roda a CLI de verdade (`--root`): quem julga é o
# processo que o CI executa, e não uma segunda implementação do julgamento. A
# mutação é aplicada NO LUGAR, nos arquivos do repositório, e a árvore é
# restaurada por checksum no mesmo trap.
#
# LIMITE DECLARADO (o que esta prova NÃO cobre): as OITO mutações vivem no MESMO
# arquivo — `scripts/check-required-checks.mjs`. As duas que atacam as funções
# que ESCREVEM a declaração (`buildAppliedRecord`/`writeAppliedRecord`), que o
# applier importa: elas são a régua da declaração, mas o CAMINHO do applier
# (autenticar na forja e chamar essas funções) exige token e não é exercitado
# aqui — quem o cobre é o `apply-required-checks --check` do cron de drift, contra
# a forja de verdade.
#
# AS ÂNCORAS (o vermelho tem de ser O vermelho certo)
#
# Um erro de sintaxe na mutação, um `node_modules` quebrado ou um host sem
# recursos deixam a suíte vermelha por outro motivo — e o script aprovaria uma
# medição que não aconteceu. Por isso cada mutação exige DOIS conjuntos:
#   - os fatos que TÊM de cair (a metade mutada);
#   - os fatos que TÊM de seguir VERDES (as OUTRAS metades) — é isso que separa
#     "esta régua morreu" de "a suíte explodiu inteira".
#
# AMBIENTE DECLARADO, NUNCA UM VERDE POR OMISSÃO
#
# O ensaio exige `vitest` instalado. Sem ele a testemunha NÃO JULGA — e isso é
# DITO com o motivo, em vez de virar um verde que ninguém mediu.
#
# Pipeline:
#   1. CONTROLE (a testemunha existe e mede): suíte VERDE sem mutação
#   2.  M1..M8: cada mutação ⇒ suíte VERMELHA pelas âncoras da metade mutada, com
#      as outras metades VERDES (M1..M6 na testemunha da metade APLICADA, M7/M8
#      na do veredito LOCAL `--staged`)
#   3. CONTROLE FINAL: restaurados os dois arquivos (checksum conferido), a suíte
#      volta a ser VERDE — a árvore ficou como estava
#   4. Cleanup (trap EXIT — restaura os fontes e remove o temp, mesmo com falha)
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'M1|a régua do RENAME (derivado ⊄ aplicado): o contexto que passou a existir'
  'M2|a régua do ÓRFÃO (aplicado ⊄ derivado): a declaração exige um check inexistente'
  'M3|o FIO em main(): a metade aplicada deixa de ser julgada'
  'M4|o FAIL-CLOSED do carregamento: loadApplied passa a devolver null em'
  'M5|o applier RESPEITA o alvo (buildAppliedRecord)'
  'M6|o applier não gera CHURN (buildAppliedRecord)'
  'M7|a FONTE do veredito local é o ÍNDICE (indexIo ⇒ git show :path)'
  'M8|o FAIL-CLOSED do índice: stagedPaths estoura quando o git não responde'
  'M9|o applier DECLARA a forja que recusa a feature (buildAppliedRecord)'
  'M10|o MOTIVO do marcador (validateApplied): mutação que aceita'
)
# O guard: julga as DUAS metades (M1..M4) E é a fonte única das funções que
# ESCREVEM a declaração (M5/M6) — o applier só as importa e as chama.
GUARD="$SCRIPT_DIR/scripts/check-required-checks.mjs"
# Quem REAPLICA (o call site da declaração; não é mutado aqui — ver LIMITE).
APPLIER="$SCRIPT_DIR/scripts/apply-required-checks.mjs"
# A testemunha: repositórios temporários + a CLI de verdade.
SUITE_ARQUIVO="src/lib/__tests__/required-checks-applied.test.ts"
# A testemunha do VEREDITO LOCAL (`--staged`): repositório git de verdade + CLI.
SUITE_ESTAGIADO="src/lib/__tests__/required-checks-staged-cli.test.ts"
# Qual delas esta mutação julga (trocada nos cenários M7/M8).
WITNESS="$SUITE_ARQUIVO"

# ── As âncoras (títulos dos testes, como o vitest os reporta) ─────────────
# A metade do RENAME: é AQUI que a mudança de contexto sem reaplicação morre.
ANCORA_RENAME="sem a declaração, o rename falha nomeando o JOB e os DOIS contextos"
# A mesma régua vista do outro lado: o check NOVO no manifesto sem reaplicação.
ANCORA_NOVO="um required check NOVO no manifesto sem reaplicação falha"
# O ÓRFÃO: a declaração exige o que o repositório não produz mais.
ANCORA_ORFAO="um contexto ÓRFÃO declarado"
# O fail-closed: sem o arquivo, o guard NÃO pode passar.
ANCORA_SEM_ARQUIVO="sem o arquivo, o guard falha com o remédio"
# O applier: a declaração é do alvo, e o carimbo não gera churn.
ANCORA_FORA_DO_ALVO="uma forja FORA do alvo mantém a declaração anterior"
ANCORA_SEM_CHURN="um apply SEM mudança de contexto não reescreve o arquivo"
# A forja que RECUSA a feature: o applier DECLARA o estado (o marcador entra), e
# o estado não pode ficar MUDO (razão + data, publicadas no veredito).
ANCORA_SEM_PORTAO="o applier grava o marcador quando a forja RECUSA"
ANCORA_MARCADOR_MUDO="sem o MOTIVO o guard reprova"

# ── As âncoras do VEREDITO LOCAL (`--staged`) ─────────────────────────────
# O rename STAGED sem a declaração: é AQUI que o commit morre no hook.
ANCORA_STAGED_RENAME="o rename STAGED sem a declaração da reaplicação REPROVA o commit"
# O rename com a declaração reaplicada junto: o fluxo que tem de passar.
ANCORA_STAGED_PASSA="o MESMO rename com a declaração reaplicada junto PASSA"
# A FONTE: o índice é o commit; a árvore não é.
ANCORA_STAGED_INDICE="LÊ O ÍNDICE"
ANCORA_STAGED_SO_ARVORE="rename só na ÁRVORE"
# O fail-closed: índice ilegível não é "nada a julgar".
ANCORA_STAGED_ILEGIVEL="índice ILEGÍVEL é exit 2"
# O recorte: um commit que não toca o contrato não roda o guard.
ANCORA_STAGED_RECORTE="nada staged"

TMP_DIR="$(mktemp -d)"

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

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (o RENAME exige a reaplicação DECLARADA)"
echo "  ═════════════════════════════════════════════════════════════════"
echo "  guard (as réguas + a declaração): scripts/check-required-checks.mjs"
echo "  applier (quem a escreve):         scripts/apply-required-checks.mjs"
echo "  suíte (a testemunha): $SUITE_ARQUIVO"

# ── Backup das FONTES + restauração VERIFICADA (trap EXIT) ────────────────
# As mutações são aplicadas NO LUGAR, nos arquivos do repositório (é deles que a
# suíte importa e que a CLI roda). Backup e restauração entram no MESMO trap: um
# `exit` no meio do caminho não pode deixar a árvore mutada — e o checksum é
# quem prova que ela voltou.
guard_backup="$TMP_DIR/check-required-checks.original.mjs"
cp "$GUARD" "$guard_backup"
guard_sum="$(cksum "$GUARD" | cut -d' ' -f1)"

cleanup() {
  cp -f "$guard_backup" "$GUARD" 2>/dev/null || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

restaurar_originais() {
  cp -f "$guard_backup" "$GUARD"
  if [ "$(cksum "$GUARD" | cut -d' ' -f1)" != "$guard_sum" ]; then
    fail "RESTAURAÇÃO FALHOU (checksum diverge) — restaure a partir de $TMP_DIR"
    exit 1
  fi
}

# ── mutar_arquivo: substituição CIRÚRGICA (exatamente 1 ocorrência) ───────
# Uma mutação que casa 0 ou 2+ vezes não é cirúrgica: o script para em vez de
# medir outra coisa. A escrita é CONFERIDA pelo checksum — uma mutação que não
# aplicasse passaria como "suíte imune".
mutar_arquivo() {
  ARQ="$1" ALVO="$2" NOVO="$3" REF="$4" python3 - <<'PY'
import os
p = os.environ["ARQ"]
old, new = os.environ["ALVO"], os.environ["NOVO"]
s = open(p).read()
n = s.count(old)
if n != 1:
    raise SystemExit(f"mutacao nao-cirurgica em {p}: {n} ocorrencia(s) do alvo (esperado 1)")
open(p, "w").write(s.replace(old, new))
PY
  if [ "$(cksum "$1" | cut -d' ' -f1)" = "$4" ]; then
    fail "a mutação não alterou $1 (checksum idêntico) — o alvo casou mas a escrita não"
    exit 1
  fi
}

# ── A testemunha: a suíte ─────────────────────────────────────────────────
suite_disponivel() { [ -d "$SCRIPT_DIR/node_modules/vitest" ]; }

mostrar_suite() { sed 's/^/      /' "$SUITE_SAIDA" | tail -14; }

rodar_suite() {
  SUITE_SAIDA="$TMP_DIR/suite.txt"
  set +e
  (cd "$SCRIPT_DIR" && NO_COLOR=1 bun x vitest run --config vitest.config.unit.ts "$WITNESS") \
    > "$TMP_DIR/suite.bruto" 2>&1
  SUITE_EXIT=$?
  set -e
  # ANSI FORA antes de julgar: o `bun x vitest` colore mesmo com a saída
  # redirecionada, e uma sequência de escape no começo da linha esconderia o
  # `FAIL`/`×` de todas as âncoras (medido: a primeira versão desta prova
  # acusou "vermelho pelo motivo errado" por causa disto).
  sed -E $'s/\033\\[[0-9;]*[a-zA-Z]//g' "$TMP_DIR/suite.bruto" > "$SUITE_SAIDA"
  # As linhas de FALHA, capturadas UMA vez (e por herestring na comparação: sob
  # `set -o pipefail`, `… | grep -q` é a classe de SIGPIPE que este repositório
  # gateia em `check-pipefail-sigpipe`). Duas formas contam: o resumo por
  # arquivo (`×título`) e o bloco de diagnóstico (`FAIL arquivo > suíte > título`)
  # — o prefixo é ancorado no começo da linha para não casar citação de código.
  FAIL_LINES="$(grep -E "^[[:space:]]*(FAIL|×)" "$SUITE_SAIDA" || true)"
}

# ── exigir_suite_verde: o controle (a testemunha mede e não acusa) ────────
exigir_suite_verde() {
  local cenario="$1"
  rodar_suite
  if [ "$SUITE_EXIT" -ne 0 ]; then
    fail "$cenario: a suíte ficou VERMELHA sem mutação — o vermelho seguinte não provaria nada (ambiente)"
    mostrar_suite
    exit 1
  fi
  pass "$cenario: suíte VERDE (exit 0) — a testemunha mede, e o vermelho da mutação é dela"
}

# ── exigir_vermelho: a mutação TEM de ser notada, PELO MOTIVO certo ───────
# $1 = cenário | $2 = âncoras que TÊM de cair (separadas por `|`)
# $3 = âncoras que TÊM de seguir VERDES (separadas por `|`)
exigir_vermelho() {
  local cenario="$1" devidos="$2" intocadas="$3"
  local IFS='|'
  rodar_suite
  if [ "$SUITE_EXIT" -eq 0 ]; then
    fail "$cenario: a suíte ficou VERDE com a metade mutada — ela não é load-bearing (regressão silenciosa: a forja volta a exigir o contexto ANTIGO e o PR trava num check que nunca roda)"
    mostrar_suite
    exit 1
  fi
  local faltando="" a
  for a in $devidos; do
    if ! grep -qF "$a" <<<"$FAIL_LINES"; then faltando="$faltando
      · $a"; fi
  done
  if [ -n "$faltando" ]; then
    fail "$cenario: a suíte ficou vermelha, mas NÃO pelas âncoras desta metade — o vermelho não é o desta regressão (mutação aplicada no alvo errado? suíte quebrada?):
$faltando"
    mostrar_suite
    exit 1
  fi
  local caiu=""
  for a in $intocadas; do
    if grep -qF "$a" <<<"$FAIL_LINES"; then caiu="$caiu
      · $a"; fi
  done
  if [ -n "$caiu" ]; then
    fail "$cenario: a mutação derrubou TAMBÉM as outras metades — o que se mediu foi a suíte inteira quebrando, não esta régua:
$caiu"
    mostrar_suite
    exit 1
  fi
  pass "$cenario: suíte VERMELHA pela metade mutada — e as outras metades seguem verdes"
}

# ── A testemunha pode julgar? Então o CONTROLE roda primeiro ──────────────
header "CONTROLE: a testemunha existe e MEDE (vitest instalado)"
if ! suite_disponivel; then
  info "NÃO JULGÁVEL — node_modules/vitest ausente neste host (o motivo é este, declarado, nunca um verde por omissão)"
  exit 0
fi
pass "vitest instalado: a testemunha pode julgar"
exigir_suite_verde "CONTROLE"

# ── M1: a régua do RENAME (derivado ⊄ aplicado) ───────────────────────────
# O laço que acusa "o contexto que o manifesto deriva AGORA não está declarado"
# deixa de rodar: o rename (e o job novo) passam a ser aceitos, e a proteção da
# forja fica apontando para o contexto ANTIGO.
header "M1 (a régua do RENAME): o contexto derivado que não está declarado deixa de acusar"
mutar_arquivo "$GUARD" '    for (const { jobId, context } of derivado.contexts) {' \
  '    for (const { jobId, context } of []) { // MUTACAO M1' "$guard_sum"
exigir_vermelho "M1" "$ANCORA_RENAME|$ANCORA_NOVO" "$ANCORA_ORFAO|$ANCORA_SEM_ARQUIVO"
restaurar_originais

# ── M2: a régua do ÓRFÃO (aplicado ⊄ derivado) ────────────────────────────
# A comparação é SIMÉTRICA: mutar a metade que acusa o órfão não pode cegar a
# metade do rename (e vice-versa). É por isso que cada mutação exige as outras
# âncoras verdes.
# (O fato do RENAME cai AQUI também — e isso é honesto: aquele caso é reportado
# pelas DUAS direções: o contexto novo que não está declarado E o antigo que
# ficou órfão. Quem separa as réguas é o fato do ÓRFÃO e o do check NOVO: cada um
# só cai na SUA direção.)
header "M2 (a régua do ÓRFÃO): a declaração que exige o que o repositório não produz deixa de acusar"
mutar_arquivo "$GUARD" '    for (const context of contextos) {' \
  '    for (const context of []) { // MUTACAO M2' "$guard_sum"
exigir_vermelho "M2" "$ANCORA_ORFAO" "$ANCORA_NOVO|$ANCORA_SEM_ARQUIVO"
restaurar_originais

# ── M3: o FIO em `main()` — a metade aplicada deixa de ser JULGADA ────────
# As duas réguas intactas e o veredito sem elas: o guard volta a julgar só o
# manifesto (que continua perfeito) e sai 0 com a forja exigindo o contexto
# velho. Mutar a regra e mutar quem a chama são regressões diferentes.
header "M3 (o FIO em main()): as duas réguas intactas, mas o veredito não as usa"
mutar_arquivo "$GUARD" '  if (applied !== null) violations.push(...validateApplied(applied, resolved))' \
  '  if (false) violations.push(...validateApplied(applied, resolved)) // MUTACAO M3' "$guard_sum"
exigir_vermelho "M3" "$ANCORA_RENAME|$ANCORA_NOVO|$ANCORA_ORFAO" "$ANCORA_SEM_ARQUIVO"
restaurar_originais

# ── M4: o FAIL-CLOSED do carregamento ────────────────────────────────────
# `loadApplied` devolve `null` em vez de estourar quando a declaração não
# existe: "não consegui ler" passaria a ser lido como "nada a comparar", que é o
# verde por acidente desta classe (o PR sem declaração nenhuma ficaria verde).
header "M4 (fail-closed): a declaração ausente deixa de ser problema"
mutar_arquivo "$GUARD" '  const raw = io.readFile(APPLIED_PATH)
  if (raw === null) {' \
  '  const raw = io.readFile(APPLIED_PATH)
  if (raw === null) {
    return null // MUTACAO M4: fail-open' "$guard_sum"
exigir_vermelho "M4" "$ANCORA_SEM_ARQUIVO" "$ANCORA_RENAME|$ANCORA_ORFAO"
restaurar_originais

# ── M5: o applier reescreve a declaração de TODAS as forjas ───────────────
# `--forge gitea` mantém a declaração do github (a proteção dela não foi tocada
# nem lida nesta rodada). Sem isso, o applier declararia como aplicado o que
# ninguém aplicou, e o guard ficaria verde sobre uma forja divergente.
header "M5 (o ALVO do apply): a forja fora do alvo passa a ser declarada como aplicada"
mutar_arquivo "$GUARD" '    const contextos = aplicadaAgora
      ? data.contexts.map((c) => c.context)
      : (anterior?.contexts ?? data.contexts.map((c) => c.context))' \
  '    const contextos = data.contexts.map((c) => c.context) // MUTACAO M5' "$guard_sum"
exigir_vermelho "M5" "$ANCORA_FORA_DO_ALVO" "$ANCORA_RENAME"
restaurar_originais

# ── M6: o applier reescreve o arquivo em TODO apply (churn) ───────────────
# O carimbo de data não pode gerar churn: um diff de uma linha em cada `--apply`
# ensina o operador a ignorar este arquivo — e um arquivo ignorado não declara
# nada.
header "M6 (o CARIMBO): uma reaplicação sem mudança de contexto passa a sujar a árvore"
mutar_arquivo "$GUARD" '  const mudou =
    JSON.stringify(record.forges) !== JSON.stringify(atual?.forges ?? null) ||
    atual?.version !== SUPPORTED_VERSION' \
  '  const mudou = true // MUTACAO M6' "$guard_sum"
exigir_vermelho "M6" "$ANCORA_SEM_CHURN" "$ANCORA_RENAME"
restaurar_originais

# ── M9: o applier deixa de DECLARAR a forja que recusa a feature ─────────
# A forja que responde 403 de plano/visibilidade não tem portão NENHUM, e é isso
# que a declaração registra (`unsupported: {reason, readAt}`). Sem o marcador, a
# declaração diria que a proteção existe — e o operador nem conseguiria declarar
# um gate novo daquela forja (o guard reprova o contexto sem a declaração).
header "M9 (o marcador): a forja que RECUSA a feature deixa de ser declarada sem portão"
mutar_arquivo "$GUARD" '      if (unsupported[forge]) {' \
  '      if (false) { // MUTACAO M9' "$guard_sum"
exigir_vermelho "M9" "$ANCORA_SEM_PORTAO" "$ANCORA_MARCADOR_MUDO|$ANCORA_RENAME|$ANCORA_SEM_CHURN"
restaurar_originais

# ── M10: o estado "sem portão" passa a ser MUDO ──────────────────────────
# O marcador existe mas a RAZÃO não é exigida: a forja é declarada sem portão sem
# dizer por quê, e quem lê o veredito não distingue "o plano continua sem a
# feature" de "alguém pôs o marcador". A data já é exigida (M10 muta só a razão).
header "M10 (o MOTIVO do marcador): 'sem portão' passa a ser aceito sem a razão"
mutar_arquivo "$GUARD" '        if (reason.length === 0) {' \
  '        if (false) { // MUTACAO M10' "$guard_sum"
exigir_vermelho "M10" "$ANCORA_MARCADOR_MUDO" "$ANCORA_SEM_PORTAO|$ANCORA_RENAME|$ANCORA_SEM_CHURN"
restaurar_originais

# ── M7: a FONTE do veredito local — o ÍNDICE, não a árvore ────────────────
# O `indexIo` deixa de ler `git show :path` e passa a ler o arquivo da árvore: o
# commit volta a ser julgado por um conteúdo que NÃO é o dele. As DUAS direções
# caem juntas, e é isso que prova a fonte: o rename que está SÓ no índice deixa
# de ser visto, e o que está SÓ na árvore passa a ser acusado.
WITNESS="$SUITE_ESTAGIADO"
header "CONTROLE (--staged): a testemunha do veredito local existe e MEDE"
exigir_suite_verde "CONTROLE (--staged)"

header "M7 (a FONTE): o veredito local passa a ler a ÁRVORE em vez do ÍNDICE"
mutar_arquivo "$GUARD" '    readFile: (relativePath) => {
      const r = runGit(root, ["show", `:${relativePath}`])' \
  '    readFile: (relativePath) => {
      return existsSync(join(root, relativePath)) ? readFileSync(join(root, relativePath), "utf8") : null // MUTACAO M7: a ARVORE
      const r = runGit(root, ["show", `:${relativePath}`])' "$guard_sum"
# Cai a metade do ÍNDICE (o commit julgado por um conteúdo que não é o dele). O
# fato do rename STAGED segue verde de propósito: ele casa pela lista do índice,
# que existe nos dois modos — quem separa as fontes é o fato do índice. E o do
# "rename só na ÁRVORE" segue verde porque o RECORTE o descarta antes da leitura
# (índice limpo = nada a julgar): é a outra metade da mesma lei.
exigir_vermelho "M7" "$ANCORA_STAGED_INDICE" "$ANCORA_STAGED_RENAME|$ANCORA_STAGED_SO_ARVORE|$ANCORA_STAGED_RECORTE"
restaurar_originais

# ── M8: o FAIL-CLOSED do índice ──────────────────────────────────────────
# `stagedPaths` estoura quando o git não responde (fora de repositório, git
# ausente, índice ilegível) e o CLI transforma isso em exit 2. Mutado para
# devolver a lista vazia, "não consegui ler o índice" vira "nada a julgar" — o
# verde por acidente desta classe, e TODO commit sai verde do hook, inclusive o
# do rename.
header "M8 (fail-closed do índice): o git que não responde passa a ser 'nada a julgar'"
mutar_arquivo "$GUARD" '  if (r.error || r.status !== 0) {
    const detalhe = String(r.stderr ?? "")' \
  '  if (false) { // MUTACAO M8: fail-open do índice
    const detalhe = String(r.stderr ?? "")' "$guard_sum"
# Cai SÓ o fato do índice ilegível, e isso é a medida exata desta metade: com o
# git funcionando, `stagedPaths` devolve a mesma lista com ou sem o estouro — o
# que a mutação muda é o caso de FALHA (sem repositório), que passa de "não
# consegui ler" (2) para "nada a julgar" (0). As outras metades seguem verdes,
# incluindo o rename staged: o que se mediu foi o fail-closed, não o recorte.
exigir_vermelho "M8" "$ANCORA_STAGED_ILEGIVEL" "$ANCORA_STAGED_RENAME|$ANCORA_STAGED_INDICE|$ANCORA_STAGED_PASSA|$ANCORA_STAGED_SO_ARVORE|$ANCORA_STAGED_RECORTE"
restaurar_originais

# ── CONTROLE FINAL: a árvore ficou como estava ────────────────────────────
WITNESS="$SUITE_ARQUIVO"
header "CONTROLE FINAL: restauradas as fontes, a suíte volta a ser VERDE"
exigir_suite_verde "CONTROLE FINAL"

header "VEREDITO"
pass "MUTATION TEST PASSED — a metade APLICADA do contrato de required checks é"
pass "load-bearing: renomear o \`name:\` de um required check (ou pôr/tirar um job"
pass "da lista) sem a reaplicação DECLARADA deixa o PR VERMELHO nomeando o job e"
pass "os dois contextos, e as NOVE metades que sustentam isso — as duas réguas"
pass "da comparação, o fio que as julga em main() e o fail-closed da declaração"
pass "ausente —, mais as duas que fazem a declaração significar \"aplicado\" no"
pass "applier (o alvo e o carimbo sem churn), as duas da forja que RECUSA a feature"
pass "(o marcador é GRAVADO, e ele não pode ser MUDO) e as duas do veredito LOCAL (a FONTE"
pass "é o ÍNDICE, e o índice ilegível é problema) —, caem cada uma no seu fato"
pass "quando mutadas. A forja não volta a exigir um check inexistente em silêncio,"
pass "e o commit também não sai do hook com a divergência escondida."
exit 0
