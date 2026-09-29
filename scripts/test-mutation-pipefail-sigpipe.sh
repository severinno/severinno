#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-pipefail-sigpipe.sh — Mutation test do guard
# check-pipefail-sigpipe
#
# Prova que o scripts/check-pipefail-sigpipe.mjs REALMENTE pega a VOLTA da
# classe SIGPIPE — e que ele não acusa o que não é a classe.
#
# O DEFEITO QUE ISTO PROTEGE: sob `set -o pipefail`, `algo | grep -q PADRAO`
# pode terminar 141 MESMO com o padrão encontrado (`grep -q` fecha o stdin no
# primeiro casamento; o produtor leva SIGPIPE se ainda tiver bytes para
# escrever). É INTERMITENTE — depende do tamanho da saída — e o sintoma aponta
# para a asserção que ACHOU o texto. Foi assim que 11 `test-mutation-*.sh`
# ficaram vermelhos sem causa aparente (09/2026).
#
# COMO (e por que assim): o guard é executado com `--root` contra um FIXTURE
# (nunca no worktree), e a evidência é o EXIT CODE dele — não a leitura do
# código do guard. Um harness que lê o código mede a intenção; este mede o
# comportamento.
#
# Pipeline:
#   1. CONTROLE (repo real): guard passa — hoje SEM dívida declarada (o baseline
#      foi removido depois que o `--fix` aposentou as 216 ocorrências)
#   2. CONTROLE (fixture com HERESTRING): não acende — o remédio passa
#   3. CONTROLE (script .sh SEM pipefail): não acende — sem pipefail a soma do
#      pipeline é o status do grep, e não é esta classe
#   4. CONTROLE (heredoc que ESCREVE o padrão): não acende — corpo de heredoc é
#      TEXTO, não código (senão o guard acusaria os próprios fixtures)
#   5. MUTAÇÃO A (.sh com pipefail + `echo "$OUT" | grep -Fq`): DEVE FALHAR
#      (exit 1), nomeando arquivo+linha e sugerindo o herestring
#   6. MUTAÇÃO B (workflow `shell: bash` + run com pipe para grep quieto):
#      DEVE FALHAR — `shell: bash` é o gatilho do pipefail no runner
#   7. CONTROLE (o MESMO workflow SEM `shell:`): REPROVA, e a ocorrência sai
#      marcada como a premissa do RUNNER — o passo sem pipefail não é poupado (a
#      segurança dele dependeria de uma premissa que não é deste repositório)
#   7b. MUTAÇÃO F (a premissa do shell default, com passos LIMPOS para o exit 1
#      só poder vir da DECLARAÇÃO): `defaults:` no arquivo e no job ligando o
#      pipefail FALHAM nomeando o escopo e a contagem; a forma INLINE sai
#      INDETERMINADA; o passo `- run: |` com `shell:` depois do corpo entra na
#      varredura com o rótulo certo; e `defaults:` sem pipefail PASSA dizendo que
#      a fonte é a declaração
#   7c. MUTAÇÃO G (o `--fix` não corrompe a expressão do runner): o produtor com
#      `${{ ... }}` fica INTEIRO dentro da captura; a PROVA desfaz a máscara com
#      `sed` e exige que a reescrita saia corrompida (o teste tem de morder)
#   8. MUTAÇÃO C (baseline): cota igual PASSA; uma ocorrência ACIMA da cota
#      FALHA — a dívida declarada não pode esconder crescimento
#   9. MUTAÇÃO D (--fix): reescreve o caso mecânico — echo E produtor vivo — e
#      COMPRIME a continuação; o guard então sai 0. Prova também o que ele NÃO
#      toca (corpo de heredoc, grep não-quieto) e que é IDEMPOTENTE
#  10. MUTAÇÃO E (a dívida não se RE-DECLARA em silêncio): `--update` sem
#      `--reason` recusa e NÃO grava; com razão, grava razão + data + a JANELA do
#      módulo compartilhado; decisão VENCIDA vira `::warning::` no run normal e
#      VIOLAÇÃO no `--review` (o job semanal); sem razão escrita OU com data
#      impossível é violação nos DOIS modos (fail-closed)
# 7d. CONTROLE H1 + MUTAÇÕES H2/H3 (o ESCOPO da varredura): um workflow que
#      mistura todas as formas (`defaults:` de arquivo e de job, `- uses:`,
#      `- run:` inline, `- run: |` com continuação, heredoc, corpo vazio e
#      `shell:` DEPOIS do `run:`) tem o passo de corpo VAZIO nomeado — e a soma
#      FECHA (julgados + vazios = declarados, contados DA FIXTURE). A H2 remove a
#      conta do corpo vazio do guard e exige que o passo suma do relatório; a H3
#      limita a leitura do `run:` inline à PRIMEIRA linha e exige que a
#      ocorrência da continuação suma — as duas provam que H1/H3 têm dentes.
#  11. MUTAÇÕES R1/R2/R3 (o CANAL do remédio, a outra ponta do `--fix`): o patch
#      que o `pr-remedy-comment` publica no PR tem de APLICAR pelo `git apply`
#      (o hunk sem contexto é recusado — e o comentário prometeria um remendo
#      inaplicável em silêncio), o preview NÃO pode gravar (quem grava é o
#      `--fix`), e os dois fixers têm de ter marcadores PRÓPRIOS (um marcador
#      comum faria a reconciliação de um retirar o comentário do outro)
#  12. INFRA: --root inexistente → exit 2 · flag desconhecida → exit 3
#  13. Cleanup (trap EXIT) — que TAMBÉM restaura as fontes mutadas por H2/H3 e
#      pelo CANAL (unified-patch.mjs e pr-remedy-comment.mjs entram na cópia de
#      segurança com checksum, como o guard e a régua)
#
# Usage:
#   ./scripts/test-mutation-pipefail-sigpipe.sh
#
# Exit codes:
#   0 — mutações DETECTADAS + controles passam ✅
#   1 — guard CEGO (mutação passou) OU controle falso-positivo ❌
# =============================================================================

set -euo pipefail

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
  'A|A: sh com pipefail e pipe para grep quieto DEVE FALHAR'
  'B|B: workflow com shell bash e pipe para grep quieto'
  'C|C: baseline — cota igual PASSA'
  'D|D: o --fix reescreve o caso mecânico'
  'E|E: a dívida não se RE-DECLARA em silêncio'
  'E1|update SEM --reason RECUSA e não grava nada (fail-closed)'
  'E2|update --reason declara, com a JANELA do módulo compartilhado'
  'E3|decisão VENCIDA avisa no run normal e BLOQUEIA no --review'
  'E4|dívida SEM razão escrita é violação nos DOIS modos (fail-closed)'
  'E5|data civil impossível (2026-02-30) é violação'
  'F|a premissa do shell default, com passos LIMPOS para o exit 1'
  'F1|defaults: do ARQUIVO ligando o pipefail DEVE FALHAR (passos limpos)'
  'F2|defaults: do JOB DEVE FALHAR (e só o job dele é reclassificado)'
  'F3|defaults: INLINE é INDETERMINADO (não ler ≠ não haver)'
  'F4|passo com a CHAVE na própria linha (- run:) é varrido'
  'G|G: o --fix não corrompe a expressão do runner'
  'H|o ESCOPO da varredura'
  'H2|sem a conta do corpo vazio o passo SOME do relatório'
  'H3|ler só a PRIMEIRA linha do run: inline torna o passo invisível'
  'R1|R1: o patch APLICA byte a byte, com a cicatriz no MEIO do arquivo'
  'R2|o preview NÃO grava: quem grava é o --fix'
  'R3|os dois fixers têm marcadores PRÓPRIOS: a reconciliação de um não pode'
)
GUARD="$SCRIPT_DIR/scripts/check-pipefail-sigpipe.mjs"
# As outras três fontes do CANAL do remédio: a construção do diff (compartilhada
# com o gate do `bash -n`), o publicador que leva o patch ao PR e a DECLARAÇÃO do
# canal deste fixer (o marcador mora nela: o registro é DESCOBERTO desde que a
# lista à mão saiu do publicador, e é ele que a R3 muta).
UNIFIED="$SCRIPT_DIR/scripts/unified-patch.mjs"
PUBLISHER="$SCRIPT_DIR/scripts/pr-remedy-comment.mjs"
CANAL="$SCRIPT_DIR/scripts/remedy-canal/pipefail-sigpipe.mjs"
# A RÉGUA DOS PASSOS (o corpo do `run:`, bloco × escalar, a dobra da continuação)
# vive na FONTE ÚNICA, e é ELA que o H3 muta: o guard importa `workflowRunBodies`
# de lá, então mutar a leitura do passo só muda o veredito se o guard de fato a
# consome — uma cópia local sobreviveria à mutação e o script falharia como CEGO.
RULER="$SCRIPT_DIR/scripts/forge-workflows.mjs"

TMP_DIR="$(mktemp -d "$MUT_SCRATCH/mut-XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
header() { echo -e "\n${CYAN}═══ $1 ═══${NC}"; }

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (pipefail x grep quieto deve GATEAR)"
echo "  ═════════════════════════════════════════════════════════════════"

# ── CONTROLE 1: repo real ─────────────────────────────────────────────────

header "CONTROLE: guard passa no repo real (sem dívida declarada)"
if node "$GUARD" > "$TMP_DIR/ctrl-real.txt" 2>&1; then
  pass "guard PASS no repo real (exit 0)"
else
  ctrl_exit=$?
  fail "guard FALHOU no repo real (exit $ctrl_exit)"
  cat "$TMP_DIR/ctrl-real.txt"
  exit 1
fi

# ── helpers de fixture ────────────────────────────────────────────────────

nova_raiz() {
  rm -rf "${TMP_DIR:?}/fx"
  mkdir -p "$TMP_DIR/fx/scripts"
  echo "$TMP_DIR/fx"
}

rodar() {
  local raiz="$1" saida="$2"
  set +e
  node "$GUARD" --root "$raiz" > "$saida" 2>&1
  echo $?
  set -e
}

# `--review`: o modo do CRON (decisão vencida é violação).
rodar_review() {
  local raiz="$1" saida="$2"
  set +e
  node "$GUARD" --root "$raiz" --review > "$saida" 2>&1
  echo $?
  set -e
}

# Datas DINÂMICAS: a janela de revisão precisa de uma base que não envelheça com
# o arquivo do teste — um `declaredAt` literal de hoje vence em 6 meses e o caso
# passaria a medir a idade da fixture em vez do que ele quer medir.
hoje() { node -e 'process.stdout.write(new Date().toISOString().slice(0, 10))'; }
dias_atras() {
  node -e "process.stdout.write(new Date(Date.now() - $1 * 86400000).toISOString().slice(0, 10))"
}
# A janela NÃO é escrita aqui: é lida do módulo compartilhado que a define
# (`allowlist-review.mjs`). Duas janelas para a mesma pergunta divergem no dia em
# que alguém ajustar uma delas — e o teste passaria a provar a cópia.
JANELA="$(node --input-type=module -e "import { DEFAULT_REVIEW_DAYS } from '$SCRIPT_DIR/scripts/allowlist-review.mjs'; process.stdout.write(String(DEFAULT_REVIEW_DAYS))")"

# ── CONTROLE 2: herestring não acende ─────────────────────────────────────

header "CONTROLE: o REMÉDIO (herestring) não acende o guard"
raiz="$(nova_raiz)"
cat > "$raiz/scripts/ok.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
OUT=$(echo oi)
if grep -Fq "oi" <<< "$OUT"; then
  echo achou
fi
SH
exit_code="$(rodar "$raiz" "$TMP_DIR/ctrl-herestring.txt")"
if [ "$exit_code" -ne 0 ]; then
  fail "FALSO POSITIVO: herestring rejeitado (exit $exit_code)"
  cat "$TMP_DIR/ctrl-herestring.txt"
  exit 1
fi
pass "herestring passa (exit 0) — o gate mede o PIPE, não o grep"

# ── CONTROLE 3: sem pipefail não é a classe ───────────────────────────────

header "CONTROLE: script SEM pipefail não acende (não é a classe)"
raiz="$(nova_raiz)"
cat > "$raiz/scripts/sem-pipefail.sh" <<'SH'
#!/usr/bin/env bash
set -eu
OUT=$(echo oi)
if echo "$OUT" | grep -Fq "oi"; then
  echo achou
fi
SH
exit_code="$(rodar "$raiz" "$TMP_DIR/ctrl-sem-pipefail.txt")"
if [ "$exit_code" -ne 0 ]; then
  fail "FALSO POSITIVO: sem pipefail o SIGPIPE do produtor não é observado (exit $exit_code)"
  cat "$TMP_DIR/ctrl-sem-pipefail.txt"
  exit 1
fi
pass "sem pipefail passa (exit 0) — o escopo é o pipefail, não o texto"

# ── CONTROLE 4: corpo de heredoc é TEXTO ──────────────────────────────────

header "CONTROLE: heredoc que ESCREVE o padrão não acende (fixture != código)"
raiz="$(nova_raiz)"
cat > "$raiz/scripts/gera-fixture.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
cat > /tmp/fixture-gerado.sh <<'FIXTURE'
#!/usr/bin/env bash
set -euo pipefail
echo "$OUT" | grep -Fq "padrao"
FIXTURE
echo escrito
SH
exit_code="$(rodar "$raiz" "$TMP_DIR/ctrl-heredoc.txt")"
if [ "$exit_code" -ne 0 ]; then
  fail "FALSO POSITIVO: o corpo do heredoc foi lido como código (exit $exit_code)"
  cat "$TMP_DIR/ctrl-heredoc.txt"
  exit 1
fi
pass "heredoc passa (exit 0) — fixture dentro de heredoc não é execução"

# ── MUTAÇÃO A: .sh com pipefail + pipe para grep quieto ───────────────────

header 'MUTAÇÃO A: echo "$OUT" | grep -Fq sob pipefail'
raiz="$(nova_raiz)"
cat > "$raiz/scripts/mutado.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
OUT=$(echo oi)
if ! echo "$OUT" | grep -Fq "oi"; then
  exit 1
fi
SH
exit_code="$(rodar "$raiz" "$TMP_DIR/mut-a.txt")"
if [ "$exit_code" -ne 1 ]; then
  fail "guard CEGO: não falhou com o pipe sob pipefail (exit $exit_code)"
  cat "$TMP_DIR/mut-a.txt"
  exit 1
fi
if ! grep -qF "scripts/mutado.sh" "$TMP_DIR/mut-a.txt"; then
  fail "falhou, mas NÃO nomeou o arquivo da violação"
  cat "$TMP_DIR/mut-a.txt"
  exit 1
fi
if ! grep -qF '<<< "$OUT"' "$TMP_DIR/mut-a.txt"; then
  fail "falhou, mas NÃO sugeriu o herestring (o remédio é o valor do guard)"
  cat "$TMP_DIR/mut-a.txt"
  exit 1
fi
if ! grep -qF "SIGPIPE" "$TMP_DIR/mut-a.txt"; then
  fail "falhou sem nomear a causa (SIGPIPE) — diagnóstico opaco"
  cat "$TMP_DIR/mut-a.txt"
  exit 1
fi
pass "mutação A DETECTADA: pipe quieto sob pipefail falha, nomeia arquivo e sugere herestring"

# ── MUTAÇÃO B / CONTROLE 5: o gatilho é `shell: bash` ─────────────────────

header 'MUTAÇÃO B: workflow com shell bash e pipe para grep quieto'
montar_workflow() {
  local raiz="$1" shell_linha="$2"
  mkdir -p "$raiz/.github/workflows"
  if [ -n "$shell_linha" ]; then
    cat > "$raiz/.github/workflows/ci.yml" <<YAML
name: Fake CI

on:
  push:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Passo com pipe quieto
$shell_linha
        run: |
          OUT=\$(echo oi)
          if echo "\$OUT" | grep -q "oi"; then
            echo achou
          fi
YAML
  else
    cat > "$raiz/.github/workflows/ci.yml" <<'YAML'
name: Fake CI

on:
  push:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Passo SEM shell declarado
        run: |
          OUT=$(echo oi)
          if echo "$OUT" | grep -q "oi"; then
            echo achou
          fi
YAML
  fi
}

raiz="$(nova_raiz)"
montar_workflow "$raiz" "        shell: bash"
exit_code="$(rodar "$raiz" "$TMP_DIR/mut-b.txt")"
if [ "$exit_code" -ne 1 ]; then
  fail "guard CEGO: não falhou com o pipe quieto no workflow com shell bash (exit $exit_code)"
  cat "$TMP_DIR/mut-b.txt"
  exit 1
fi
if ! grep -qF ".github/workflows/ci.yml" "$TMP_DIR/mut-b.txt"; then
  fail "falhou, mas NÃO nomeou o workflow (a varredura das forjas está fora?)"
  cat "$TMP_DIR/mut-b.txt"
  exit 1
fi
pass "mutação B DETECTADA: o shell bash liga o pipefail e o pipeline é acusado"

header "CONTROLE: o MESMO workflow SEM \`shell:\` declarado TAMBÉM reprova (marca própria)"
# ATENÇÃO ao que este controle mede HOJE: o passo sem `shell:` NÃO é poupado —
# a varredura cobre os dois contextos, porque a segurança dele dependeria do
# shell default do RUNNER (uma premissa que não é deste repositório). O que o
# teste prova é que a MARCA distingue os dois casos: a causa é a mesma, o
# diagnóstico (e o valor da ocorrência) não.
raiz="$(nova_raiz)"
montar_workflow "$raiz" ""
exit_code="$(rodar "$raiz" "$TMP_DIR/ctrl-shell-default.txt")"
if [ "$exit_code" -ne 1 ]; then
  fail "guard CEGO: o passo sem \`shell:\` (premissa do runner) passou (exit $exit_code)"
  cat "$TMP_DIR/ctrl-shell-default.txt"
  exit 1
fi
if ! grep -qF 'SHELL DEFAULT do runner' "$TMP_DIR/ctrl-shell-default.txt"; then
  fail 'acusou sem marcar que o contexto é a premissa do RUNNER (diagnóstico no lugar errado)'
  cat "$TMP_DIR/ctrl-shell-default.txt"
  exit 1
fi
pass 'o passo sem shell declarado reprova e a ocorrência sai marcada como premissa do RUNNER (exit 1)'

# ── MUTAÇÃO F: a PREMISSA do shell default ──────────────────────────────
#
# O passo sem `shell:` é lido como o default do RUNNER (`bash -e`) — uma
# premissa que NÃO é deste repositório. Um `defaults: run: shell:` é a única
# forma de trocá-la DAQUI, e ele reclassifica o escopo inteiro numa linha, sem
# que nenhum passo mude no diff. Por isso os fixtures abaixo têm passos LIMPOS:
# o exit 1 só pode vir da PREMISSA, não de uma ocorrência de pipe.

header 'MUTAÇÃO F1: `defaults:` do ARQUIVO ligando o pipefail DEVE FALHAR (passos limpos)'
raiz="$(nova_raiz)"
mkdir -p "$raiz/.github/workflows"
cat > "$raiz/.github/workflows/ci.yml" <<'YAML'
name: Fake CI

on:
  push:

defaults:
  run:
    shell: bash

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Limpo
        run: echo oi
      - name: Outro limpo
        run: |
          OUT=$(echo oi)
          echo "$OUT"
YAML
exit_code="$(rodar "$raiz" "$TMP_DIR/mut-f1.txt")"
if [ "$exit_code" -ne 1 ]; then
  fail "guard CEGO: a declaração ligou o pipefail para o escopo e o gate passou (exit $exit_code)"
  cat "$TMP_DIR/mut-f1.txt"
  exit 1
fi
for agulha in 'A PREMISSA DO SHELL DEFAULT MUDOU' 'shell: bash' 'workflow inteiro' '2 passo(s)'; do
  if ! grep -qF -- "$agulha" "$TMP_DIR/mut-f1.txt"; then
    fail "falhou, mas não nomeou '$agulha' — o fato tem de ser acionável"
    cat "$TMP_DIR/mut-f1.txt"
    exit 1
  fi
done
pass 'mutação F1 DETECTADA: a declaração que liga o pipefail FALHA nomeando o escopo e os passos'

header 'MUTAÇÃO F2: `defaults:` do JOB DEVE FALHAR (e só o job dele é reclassificado)'
raiz="$(nova_raiz)"
mkdir -p "$raiz/.github/workflows"
cat > "$raiz/.github/workflows/ci.yml" <<'YAML'
name: Fake CI

on:
  push:

jobs:
  comDefault:
    runs-on: ubuntu-latest
    defaults:
      run:
        shell: bash -leo pipefail
    steps:
      - name: Limpo
        run: echo oi
  semDefault:
    runs-on: ubuntu-latest
    steps:
      - name: Limpo
        run: echo oi
YAML
exit_code="$(rodar "$raiz" "$TMP_DIR/mut-f2.txt")"
if [ "$exit_code" -ne 1 ]; then
  fail "guard CEGO: a declaração do JOB não falhou o gate (exit $exit_code)"
  cat "$TMP_DIR/mut-f2.txt"
  exit 1
fi
if ! grep -qF -- 'job `comDefault`' "$TMP_DIR/mut-f2.txt"; then
  fail 'falhou, mas não nomeou o JOB — sem isso o operador procura no lugar errado'
  cat "$TMP_DIR/mut-f2.txt"
  exit 1
fi
if ! grep -qF -- '1 passo(s)' "$TMP_DIR/mut-f2.txt"; then
  fail 'o fato não contou os passos reclassificados (a conta é o valor do relatório)'
  cat "$TMP_DIR/mut-f2.txt"
  exit 1
fi
pass 'mutação F2 DETECTADA: o escopo da declaração do job sai nomeado, com a conta de passos'

header 'CONTROLE: `defaults:` que NÃO liga o pipefail passa — mas a fonte é DITA'
raiz="$(nova_raiz)"
mkdir -p "$raiz/.github/workflows"
cat > "$raiz/.github/workflows/ci.yml" <<'YAML'
name: Fake CI

on:
  push:

defaults:
  run:
    shell: bash -e {0}

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Limpo
        run: echo oi
YAML
exit_code="$(rodar "$raiz" "$TMP_DIR/ctrl-default-neutro.txt")"
if [ "$exit_code" -ne 0 ]; then
  fail "FALSO POSITIVO: \`defaults:\` sem pipefail não é premissa mudada (exit $exit_code)"
  cat "$TMP_DIR/ctrl-default-neutro.txt"
  exit 1
fi
if ! grep -qF 'por `defaults:` do repositório' "$TMP_DIR/ctrl-default-neutro.txt"; then
  fail 'passou, mas não atribuiu o passo à declaração — a fonte tem de ser dita, não presumida'
  cat "$TMP_DIR/ctrl-default-neutro.txt"
  exit 1
fi
pass 'defaults sem pipefail passa (exit 0) e o relatório diz que a fonte é a DECLARAÇÃO'

header 'MUTAÇÃO F3: `defaults:` INLINE é INDETERMINADO (não ler ≠ não haver)'
raiz="$(nova_raiz)"
mkdir -p "$raiz/.github/workflows"
cat > "$raiz/.github/workflows/ci.yml" <<'YAML'
name: Fake CI

on:
  push:

defaults: {run: {shell: bash}}

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Limpo
        run: echo oi
YAML
exit_code="$(rodar "$raiz" "$TMP_DIR/mut-f3.txt")"
if [ "$exit_code" -ne 1 ]; then
  fail "guard CEGO: forma inline não lida passou como se não houvesse declaração (exit $exit_code)"
  cat "$TMP_DIR/mut-f3.txt"
  exit 1
fi
if ! grep -qF 'INLINE' "$TMP_DIR/mut-f3.txt"; then
  fail 'falhou, mas não nomeou a forma que ele não lê'
  cat "$TMP_DIR/mut-f3.txt"
  exit 1
fi
pass 'mutação F3 DETECTADA: a forma inline sai INDETERMINADA, com o remédio em bloco'

header 'MUTAÇÃO F4: passo com a CHAVE na própria linha (`- run:`) é varrido'
raiz="$(nova_raiz)"
mkdir -p "$raiz/.github/workflows"
cat > "$raiz/.github/workflows/ci.yml" <<'YAML'
name: Fake CI

on:
  push:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: |
          OUT=$(echo oi)
          if echo "$OUT" | grep -q "oi"; then
            echo achou
          fi
        shell: bash
YAML
exit_code="$(rodar "$raiz" "$TMP_DIR/mut-f4.txt")"
if [ "$exit_code" -ne 1 ]; then
  fail "guard CEGO: o passo \`- run:\` (forma de 36 dos passos do repo) ficou INVISÍVEL (exit $exit_code)"
  cat "$TMP_DIR/mut-f4.txt"
  exit 1
fi
if ! grep -qF 'pipefail declarado' "$TMP_DIR/mut-f4.txt"; then
  fail 'acusou, mas não leu o `shell:` DEPOIS do corpo (o rótulo diria que é o runner)'
  cat "$TMP_DIR/mut-f4.txt"
  exit 1
fi
pass 'mutação F4 DETECTADA: o passo com a chave na linha do item entra na varredura'

# ── MUTAÇÃO G: o --fix não pode CORROMPER a expressão do runner ──────────

header 'MUTAÇÃO G: --fix mantém o PRODUTOR com `${{ }}` inteiro dentro da captura'
raiz="$(nova_raiz)"
mkdir -p "$raiz/.github/workflows"
cat > "$raiz/.github/workflows/ci.yml" <<'YAML'
name: Fake CI

on:
  push:

jobs:
  check:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
    steps:
      - name: Espera
        shell: bash
        run: |
          for _ in $(seq 1 30); do
            if docker exec ${{ job.services.postgres.id }} \
              psql -U u -d d -tAc "SELECT 1" 2>/dev/null | grep -qx 1; then
              echo pronto
            fi
          done
YAML
set +e
node "$GUARD" --root "$raiz" --fix > "$TMP_DIR/fix-g.txt" 2>&1
FIX_EXIT=$?
set -e
if [ "$FIX_EXIT" -ne 0 ]; then
  fail "--fix saiu $FIX_EXIT no caso com expressão (esperado 0)"
  cat "$TMP_DIR/fix-g.txt"
  exit 1
fi
corrigido="$raiz/.github/workflows/ci.yml"
if ! grep -qF '<<< "$(docker exec ${{ job.services.postgres.id }} psql' "$corrigido"; then
  fail 'o --fix deixou o `docker exec` FORA da captura (o defeito dos 12 passos com shell default)'
  cat "$corrigido"
  exit 1
fi
exit_code="$(rodar "$raiz" "$TMP_DIR/fix-g-depois.txt")"
if [ "$exit_code" -ne 0 ]; then
  fail "guard ainda acusa depois do --fix no passo com expressão (exit $exit_code)"
  cat "$TMP_DIR/fix-g-depois.txt"
  exit 1
fi
pass 'mutação G DETECTADA: a expressão fica dentro do produtor capturado e o guard fecha em 0'

header 'PROVA: sem a MÁSCARA o --fix corrompe — o caso acima morde'
GUARD_SEM_MASCARA="$TMP_DIR/guard-sem-mascara.mjs"
sed 's|splitPipelines(maskGithubExpressions(command))|splitPipelines(command)|g' \
  "$GUARD" > "$GUARD_SEM_MASCARA"
if cmp -s "$GUARD" "$GUARD_SEM_MASCARA"; then
  fail 'a mutação não mudou o guard (o sed não casou — o caso G deixaria de provar a máscara)'
  exit 1
fi
raiz="$(nova_raiz)"
mkdir -p "$raiz/.github/workflows"
cat > "$raiz/.github/workflows/ci.yml" <<'YAML'
name: Fake CI

on:
  push:

jobs:
  check:
    steps:
      - name: Espera
        shell: bash
        run: |
          if docker exec ${{ job.services.postgres.id }} \
            psql -U u -d d -tAc "SELECT 1" 2>/dev/null | grep -qx 1; then
            echo pronto
          fi
YAML
set +e
node "$GUARD_SEM_MASCARA" --root "$raiz" --fix > "$TMP_DIR/fix-g-mutado.txt" 2>&1
set -e
if grep -qF '<<< "$(docker exec ${{ job.services.postgres.id }} psql' "$raiz/.github/workflows/ci.yml"; then
  fail 'a máscara não é load-bearing: sem ela o --fix acertou igual (o caso G não mede nada)'
  cat "$raiz/.github/workflows/ci.yml"
  exit 1
fi
pass 'sem a máscara a reescrita SAI CORROMPIDA — é a máscara que mantém o caso G verde'

# ── MUTAÇÃO C: a dívida declarada não esconde crescimento ─────────────────

header "MUTAÇÃO C: baseline com cota 1 + DUAS ocorrências DEVE FALHAR"
raiz="$(nova_raiz)"
mkdir -p "$raiz/docs/quality"
cat > "$raiz/scripts/duas.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
A=$(echo a)
B=$(echo b)
if echo "$A" | grep -q "a"; then echo ok; fi
if echo "$B" | grep -q "b"; then echo ok; fi
SH
cat > "$raiz/docs/quality/pipefail-sigpipe-baseline.json" <<JSON
{
  "version": 1,
  "declaredAt": "$(hoje)",
  "reason": "fixture do mutation test: a cota existe para o caso ACIMA dela",
  "reviewAfterDays": $JANELA,
  "total": 1,
  "files": { "scripts/duas.sh": 1 }
}
JSON
if grep -qF "docs/quality/pipefail-sigpipe-baseline.json" "$GUARD"; then
  pass "o guard lê o baseline do caminho declarado"
else
  fail "o guard não conhece o caminho do baseline"
  exit 1
fi
exit_code="$(rodar "$raiz" "$TMP_DIR/mut-c.txt")"
if [ "$exit_code" -ne 1 ]; then
  fail "baseline ESCONDEU crescimento: cota 1 com 2 ocorrências passou (exit $exit_code)"
  cat "$TMP_DIR/mut-c.txt"
  exit 1
fi
if ! grep -qF "scripts/duas.sh" "$TMP_DIR/mut-c.txt"; then
  fail "falhou sem nomear o arquivo com a ocorrência acima da cota"
  cat "$TMP_DIR/mut-c.txt"
  exit 1
fi
pass "mutação C DETECTADA: ocorrência ACIMA da cota falha mesmo com dívida declarada"

header "CONTROLE: cota IGUAL às ocorrências passa (a dívida declarada é respeitada)"
cat > "$raiz/docs/quality/pipefail-sigpipe-baseline.json" <<JSON
{
  "version": 1,
  "declaredAt": "$(hoje)",
  "reason": "fixture do mutation test: cota igual às ocorrências",
  "reviewAfterDays": $JANELA,
  "total": 2,
  "files": { "scripts/duas.sh": 2 }
}
JSON
exit_code="$(rodar "$raiz" "$TMP_DIR/ctrl-cota.txt")"
if [ "$exit_code" -ne 0 ]; then
  fail "a cota declarada foi ignorada (exit $exit_code)"
  cat "$TMP_DIR/ctrl-cota.txt"
  exit 1
fi
pass "cota igual passa (exit 0) — dívida declarada não vira ruído vermelho"

# ── MUTAÇÃO D: o --fix aposenta o caso mecânico ───────────────────────────

header 'MUTAÇÃO D: --fix reescreve o caso mecânico (e SÓ ele)'
raiz="$(nova_raiz)"
cat > "$raiz/scripts/devido.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
OUT=$(echo oi)
if ! echo "$OUT" | grep -Fq "oi"; then
  exit 1
fi
if docker ps | grep -q "alive"; then
  echo vivo
fi
if docker compose ps \
      | grep -qi "healthy"; then
  echo saudavel
fi
echo "$OUT" | grep -n "leitura" >/dev/null
cat > /tmp/fixture-gerado.sh <<'FIXTURE'
echo "$X" | grep -q "texto de fixture"
FIXTURE
SH
antes="$(rodar "$raiz" "$TMP_DIR/fix-antes.txt")"
if [ "$antes" -ne 1 ]; then
  fail "fixture mal montada: esperado exit 1 ANTES do --fix, obtido $antes"
  cat "$TMP_DIR/fix-antes.txt"
  exit 1
fi
set +e
node "$GUARD" --root "$raiz" --fix > "$TMP_DIR/fix-saida.txt" 2>&1
FIX_EXIT=$?
set -e
if [ "$FIX_EXIT" -ne 0 ]; then
  fail "--fix saiu $FIX_EXIT (esperado 0)"
  cat "$TMP_DIR/fix-saida.txt"
  exit 1
fi
corrigido="$raiz/scripts/devido.sh"
if ! grep -qF '<<< "$OUT"' "$corrigido"; then
  fail "--fix não reescreveu o produtor echo (o caso real do defeito de 09/2026)"
  cat "$corrigido"
  exit 1
fi
if ! grep -qF '<<< "$(docker ps)"' "$corrigido"; then
  fail "--fix não reescreveu o produtor VIVO (docker ps) — o caso que só tem pipe"
  cat "$corrigido"
  exit 1
fi
if ! grep -qF 'grep -qi "healthy" <<< "$(docker compose ps)"' "$corrigido"; then
  fail "--fix não COMPRIMIU a continuação (o \\\\ existia para o pipeline caber)"
  cat "$corrigido"
  exit 1
fi
if ! grep -qF 'echo "$X" | grep -q "texto de fixture"' "$corrigido"; then
  fail "--fix reescreveu o CORPO DO HEREDOC (fixture é texto, não código)"
  cat "$corrigido"
  exit 1
fi
if ! grep -qF 'grep -n "leitura"' "$corrigido"; then
  fail "--fix mexeu num grep NÃO-quieto (fora do escopo da classe)"
  cat "$corrigido"
  exit 1
fi
pass "--fix reescreveu echo + produtor vivo + continuação, sem tocar heredoc nem grep de leitura"

depois="$(rodar "$raiz" "$TMP_DIR/fix-depois.txt")"
if [ "$depois" -ne 0 ]; then
  fail "guard ainda acusa depois do --fix (exit $depois) — o remédio não fechou a classe"
  cat "$TMP_DIR/fix-depois.txt"
  exit 1
fi
pass "o guard sai 0 no fixture depois do --fix (a reescrita fechou a ocorrência)"

header "CONTROLE: --fix é IDEMPOTENTE (não grava de novo o que já está corrigido)"
antes_hash="$(cksum < "$corrigido")"
set +e
node "$GUARD" --root "$raiz" --fix > "$TMP_DIR/fix-2a.txt" 2>&1
SEGUNDA_EXIT=$?
set -e
if [ "$SEGUNDA_EXIT" -ne 0 ]; then
  fail "a segunda execução de --fix saiu $SEGUNDA_EXIT"
  cat "$TMP_DIR/fix-2a.txt"
  exit 1
fi
if [ "$antes_hash" != "$(cksum < "$corrigido")" ]; then
  fail "--fix reescreveu um arquivo que já estava correto"
  exit 1
fi
if ! grep -qF -- "0 linha(s) reescrita(s)" "$TMP_DIR/fix-2a.txt"; then
  fail "--fix não declarou que não houve o que reescrever"
  cat "$TMP_DIR/fix-2a.txt"
  exit 1
fi
pass "segunda execução não grava nada (idempotente e fail-closed por construção)"

# ── INFRA ─────────────────────────────────────────────────────────────────

# ── MUTAÇÃO E: a dívida declarada não se re-declara em silêncio ───────────
#
# O baseline foi APOSENTADO (216 → 0, arquivo removido) e o `--update` é a
# comporta que poderia reabri-lo: sem estas provas, um comando devolvia 200
# exceções, o gate ficava verde, e a dívida voltava por DIGITAÇÃO em vez de
# decisão. As três condições são as que o guard prometia em prosa — declarado,
# justificado, vencível — e que agora são mecanismo.

header "MUTAÇÃO E1: --update SEM --reason RECUSA e não grava nada (fail-closed)"
raiz="$(nova_raiz)"
cat > "$raiz/scripts/devido.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
OUT=$(echo oi)
if ! echo "$OUT" | grep -Fq "oi"; then
  exit 1
fi
SH
BASELINE_FX="$raiz/docs/quality/pipefail-sigpipe-baseline.json"
set +e
node "$GUARD" --root "$raiz" --update > "$TMP_DIR/e1.txt" 2>&1
E1_EXIT=$?
set -e
if [ "$E1_EXIT" -ne 3 ]; then
  fail "esperado exit 3 (uso inválido) para --update sem --reason, obtido $E1_EXIT"
  cat "$TMP_DIR/e1.txt"
  exit 1
fi
if [ -e "$BASELINE_FX" ]; then
  fail "o baseline foi GRAVADO apesar da recusa — a dívida reabriria em silêncio"
  cat "$BASELINE_FX"
  exit 1
fi
if ! grep -qF -- "--reason" "$TMP_DIR/e1.txt"; then
  fail "recusou sem nomear a decisão escrita (--reason)"
  cat "$TMP_DIR/e1.txt"
  exit 1
fi
if ! grep -qF -- "--fix" "$TMP_DIR/e1.txt"; then
  fail "recusou sem oferecer a alternativa barata (consertar com --fix)"
  cat "$TMP_DIR/e1.txt"
  exit 1
fi
pass "mutação E1 DETECTADA: declarar dívida exige a razão escrita, e a recusa não grava nada"

header "MUTAÇÃO E2: --update --reason declara, com a JANELA do módulo compartilhado"
set +e
node "$GUARD" --root "$raiz" --update --reason "fixture: produtor vivo, revisao humana" > "$TMP_DIR/e2.txt" 2>&1
E2_EXIT=$?
set -e
if [ "$E2_EXIT" -ne 0 ]; then
  fail "--update COM --reason deveria declarar (exit 0), obtido $E2_EXIT"
  cat "$TMP_DIR/e2.txt"
  exit 1
fi
if [ ! -f "$BASELINE_FX" ]; then
  fail "--update --reason não gravou o baseline"
  exit 1
fi
if ! grep -qF '"reason": "fixture: produtor vivo, revisao humana"' "$BASELINE_FX"; then
  fail "a RAZÃO não foi para o arquivo — justificativa que só existe na caixa de entrada não é decisão registrada"
  cat "$BASELINE_FX"
  exit 1
fi
if ! grep -qF "\"reviewAfterDays\": $JANELA" "$BASELINE_FX"; then
  fail "a janela gravada NÃO é a do módulo compartilhado ($JANELA) — segunda janela para a mesma pergunta"
  cat "$BASELINE_FX"
  exit 1
fi
if ! grep -qF "\"declaredAt\": \"$(hoje)\"" "$BASELINE_FX"; then
  fail "a data da decisão não foi registrada (é ela que a janela mede)"
  cat "$BASELINE_FX"
  exit 1
fi
pass "mutação E2 DETECTADA: a dívida fica DECLARADA (razão + data + janela compartilhada) no arquivo"

header "MUTAÇÃO E3: decisão VENCIDA avisa no run normal e BLOQUEIA no --review"
cat > "$BASELINE_FX" <<JSON
{
  "version": 1,
  "declaredAt": "$(dias_atras $((JANELA + 30)))",
  "reason": "fixture: decisao antiga de proposito",
  "reviewAfterDays": $JANELA,
  "total": 1,
  "files": { "scripts/devido.sh": 1 }
}
JSON
# Cota IGUAL às ocorrências: a única coisa fora da janela é a DATA. Se o run
# normal bloqueasse aqui, uma data travaria o PR de todo mundo (o oposto do
# desenho); se saísse verde e MUDO, a dívida venceria sem ninguém ver.
exit_code="$(rodar "$raiz" "$TMP_DIR/e3-normal.txt")"
if [ "$exit_code" -ne 0 ]; then
  fail "run normal BLOQUEOU a decisão vencida (exit $exit_code) — uma data não pode travar o PR de todos"
  cat "$TMP_DIR/e3-normal.txt"
  exit 1
fi
if ! grep -qF "::warning::" "$TMP_DIR/e3-normal.txt"; then
  fail "run normal passou em SILÊNCIO sobre a decisão vencida (a dívida venceria sem ninguém ver)"
  cat "$TMP_DIR/e3-normal.txt"
  exit 1
fi
if ! grep -qF "VENCEU" "$TMP_DIR/e3-normal.txt"; then
  fail "o aviso não nomeia o estado (VENCEU) nem a janela"
  cat "$TMP_DIR/e3-normal.txt"
  exit 1
fi
exit_code="$(rodar_review "$raiz" "$TMP_DIR/e3-review.txt")"
if [ "$exit_code" -ne 1 ]; then
  fail "--review NÃO escalou a decisão vencida (exit $exit_code) — o cron ficaria verde"
  cat "$TMP_DIR/e3-review.txt"
  exit 1
fi
if ! grep -qF "SEM REVISÃO" "$TMP_DIR/e3-review.txt"; then
  fail "--review falhou sem nomear o que falta (a revisão da decisão)"
  cat "$TMP_DIR/e3-review.txt"
  exit 1
fi
pass "mutação E3 DETECTADA: vencida = ::warning:: no PR e violação no job semanal"

header "MUTAÇÃO E4: dívida SEM razão escrita é violação nos DOIS modos (fail-closed)"
cat > "$BASELINE_FX" <<JSON
{
  "version": 1,
  "declaredAt": "$(hoje)",
  "reviewAfterDays": $JANELA,
  "total": 1,
  "files": { "scripts/devido.sh": 1 }
}
JSON
exit_code="$(rodar "$raiz" "$TMP_DIR/e4-normal.txt")"
if [ "$exit_code" -ne 1 ]; then
  fail "dívida SEM reason passou no run normal (exit $exit_code) — apagar a razão seria o jeito de nunca decidir"
  cat "$TMP_DIR/e4-normal.txt"
  exit 1
fi
if ! grep -qF "reason" "$TMP_DIR/e4-normal.txt"; then
  fail "a violação não nomeia o campo que falta (reason)"
  cat "$TMP_DIR/e4-normal.txt"
  exit 1
fi
exit_code="$(rodar_review "$raiz" "$TMP_DIR/e4-review.txt")"
if [ "$exit_code" -ne 1 ]; then
  fail "dívida SEM reason passou no --review (exit $exit_code)"
  cat "$TMP_DIR/e4-review.txt"
  exit 1
fi
pass "mutação E4 DETECTADA: sem razão escrita a dívida não se sustenta em modo nenhum"

header "MUTAÇÃO E5: data civil impossível ('2026-02-30') é violação"
cat > "$BASELINE_FX" <<JSON
{
  "version": 1,
  "declaredAt": "2026-02-30",
  "reason": "fixture: data impossivel de proposito",
  "reviewAfterDays": $JANELA,
  "total": 1,
  "files": { "scripts/devido.sh": 1 }
}
JSON
exit_code="$(rodar "$raiz" "$TMP_DIR/e5.txt")"
if [ "$exit_code" -ne 1 ]; then
  fail "data impossível (2026-02-30) foi ACEITA (exit $exit_code) — o guard estaria medindo outra data"
  cat "$TMP_DIR/e5.txt"
  exit 1
fi
if ! grep -qF "2026-02-30" "$TMP_DIR/e5.txt"; then
  fail "a violação não cita a data inválida (diagnóstico opaco)"
  cat "$TMP_DIR/e5.txt"
  exit 1
fi
pass "mutação E5 DETECTADA: data civil impossível não passa (parser do módulo compartilhado)"

header "CONTROLE: --reason com texto VAZIO é uso inválido (não declara em branco)"
set +e
node "$GUARD" --root "$raiz" --update --reason "" > "$TMP_DIR/e6.txt" 2>&1
E6_EXIT=$?
set -e
if [ "$E6_EXIT" -ne 3 ]; then
  fail "razão vazia deveria ser uso inválido (exit 3), obtido $E6_EXIT"
  cat "$TMP_DIR/e6.txt"
  exit 1
fi
pass "razão vazia é recusada (exit 3) — 'declarei' sem dizer nada não é decisão"

header "INFRA: --root inexistente e flag desconhecida são fail-closed"
exit_code="$(rodar "$TMP_DIR/nao-existe" "$TMP_DIR/infra.txt")"
if [ "$exit_code" -ne 2 ]; then
  fail "esperado exit 2 (infra) para --root inexistente, obtido $exit_code"
  cat "$TMP_DIR/infra.txt"
  exit 1
fi
pass "'--root' inexistente é fail-closed (exit 2)"

set +e
node "$GUARD" --nao-existe > "$TMP_DIR/uso.txt" 2>&1
USO_EXIT=$?
set -e
if [ "$USO_EXIT" -ne 3 ]; then
  fail "esperado exit 3 (uso inválido) para flag desconhecida, obtido $USO_EXIT"
  cat "$TMP_DIR/uso.txt"
  exit 1
fi
pass "flag desconhecida é uso inválido (exit 3)"

# ── MUTAÇÃO H: o ESCOPO da varredura — nada some em silêncio ──────────────
#
# O valor do guard não é o que ele ACUSA: é o que ele NÃO acusa. Duas classes de
# "varre menos do que parece" moravam no mesmo lugar:
#
#   (a) o `run:` DECLARADO com corpo VAZIO — não há o que julgar, mas o passo
#       não pode SUMIR da conta: um passo a menos no denominador é um gate que
#       varre menos do que diz;
#   (b) o `- run:` INLINE com continuação — o YAML dobra `run: cmd` + as linhas
#       mais indentadas num escalar ÚNICO (a quebra vira espaço), e ler só a
#       primeira linha julga o passo por METADE: o `| grep -q` da segunda ficava
#       invisível.
#
# H1 mede a CONTA contra um workflow que mistura TODAS as formas — e a fixture é
# LIMPA de propósito: o relatório do escopo só sai no caminho verde, que é
# justamente onde um gate que varre menos do que parece se esconde. H2 e H3 mutam
# o GUARD (no lugar, com restauração no trap) para provar que as asserções
# MORDEM: a mutação é detectada pelo que ele deixa de DIZER.

header 'CONTROLE H1: corpo `run:` vazio sai NOMEADO e a soma da varredura FECHA'
raiz="$(nova_raiz)"
mkdir -p "$raiz/.gitea/workflows"
cat > "$raiz/.gitea/workflows/misto.yml" <<'YML'
on:
  pull_request:
defaults:
  run:
    shell: bash -e {0}
jobs:
  a:
    defaults:
      run:
        shell: bash -e {0}
    steps:
      - uses: actions/checkout@v4
      - run: echo limpo-a
      - run: |
          docker compose ps --format '{{.Names}}' \
            | grep -i runner
      - run: |
          cat <<'EOF'
          echo "$OUT" | grep -q padrao
          EOF
      - run: |
  b:
    steps:
      - run: echo limpo-b
      - run: printf '%s' "$X" | grep -c valor
        shell: bash
YML
# A CONTA vem DA FIXTURE, não de um número escrito à mão: o denominador é o que o
# arquivo declara como passo `run:`. Um literal aqui envelheceria em silêncio no
# dia em que a fixture mudasse — e a prova passaria a medir a si mesma.
DECLARADOS="$(grep -c '^ *- run:' "$raiz/.gitea/workflows/misto.yml")"
LINHA_VAZIA="$(grep -n '^ *- run: |$' "$raiz/.gitea/workflows/misto.yml" | tail -1 | cut -d: -f1)"
exit_code="$(rodar "$raiz" "$TMP_DIR/h1.txt")"
if [ "$exit_code" -ne 0 ]; then
  fail "a fixture LIMPA deveria passar (exit $exit_code) — a conta do escopo não é violação"
  cat "$TMP_DIR/h1.txt"
  exit 1
fi
if ! grep -qF "fora do escopo da varredura" "$TMP_DIR/h1.txt"; then
  fail "o passo de corpo VAZIO não foi NOMEADO — 'N passos' sem dizer QUAIS não distingue 'não havia o que julgar' de 'o gate não olhou'"
  cat "$TMP_DIR/h1.txt"
  exit 1
fi
if ! grep -qF "misto.yml:$LINHA_VAZIA" "$TMP_DIR/h1.txt"; then
  fail "o relatório não aponta a LINHA do passo vazio (esperado misto.yml:$LINHA_VAZIA)"
  cat "$TMP_DIR/h1.txt"
  exit 1
fi
set +e
node "$GUARD" --root "$raiz" --json > "$TMP_DIR/h1.json" 2>&1
set -e
if ! DECLARADOS="$DECLARADOS" LINHA_VAZIA="$LINHA_VAZIA" node -e '
  const fs = require("node:fs")
  const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
  const declarados = Number(process.env.DECLARADOS)
  const linhaVazia = Number(process.env.LINHA_VAZIA)
  const s = j.scanned
  const soma = s.runStepsComPipefail + s.runStepsSemPipefail + s.passosCorpoVazio
  const erro = []
  if (soma !== declarados)
    erro.push(`a soma NAO FECHA: ${s.runStepsComPipefail}+${s.runStepsSemPipefail}+${s.passosCorpoVazio}=${soma} != ${declarados} passo(s) declarados`)
  if (s.passosCorpoVazio !== 1) erro.push(`passosCorpoVazio=${s.passosCorpoVazio} (esperado 1)`)
  if (j.foraDoEscopo.length !== 1)
    erro.push(`foraDoEscopo=${j.foraDoEscopo.length} entrada(s) (esperado 1)`)
  else {
    if (j.foraDoEscopo[0].line !== linhaVazia)
      erro.push(`foraDoEscopo[0].line=${j.foraDoEscopo[0].line} != ${linhaVazia}`)
    if (!/VAZIO/.test(j.foraDoEscopo[0].motivo))
      erro.push(`o motivo nao nomeia a classe: ${j.foraDoEscopo[0].motivo}`)
  }
  if (s.passosComShellNoPasso !== 1)
    erro.push(`passosComShellNoPasso=${s.passosComShellNoPasso} — o shell: DEPOIS do run: nao foi lido como do PASSO`)
  if (erro.length) {
    console.error(erro.join("\n"))
    process.exit(1)
  }
' "$TMP_DIR/h1.json"; then
  fail "o relatório --json da varredura não fecha a conta (acima)"
  cat "$TMP_DIR/h1.json"
  exit 1
fi
pass "controle H1: o corpo vazio sai nomeado com arquivo+linha, a soma fecha contra os $DECLARADOS passo(s) da própria fixture, e o shell: depois do run: é do PASSO"

# A partir daqui as FONTES são mutadas NO LUGAR (o `--root` é do fixture, os
# arquivos mutados são os do repositório): o backup e a restauração verificada
# entram no MESMO trap, porque um `exit` no meio do caminho não pode deixar a
# árvore com a mutação dentro. O backup mora em $TMP_DIR porque NADA aqui apaga
# esse diretório no meio da prova (só o cleanup, depois de restaurar).
guard_backup="$TMP_DIR/guard.original.mjs"
ruler_backup="$TMP_DIR/ruler.original.mjs"
unified_backup="$TMP_DIR/unified.original.mjs"
publisher_backup="$TMP_DIR/publisher.original.mjs"
canal_backup="$TMP_DIR/canal.original.mjs"
cp "$GUARD" "$guard_backup"
cp "$RULER" "$ruler_backup"
cp "$UNIFIED" "$unified_backup"
cp "$PUBLISHER" "$publisher_backup"
cp "$CANAL" "$canal_backup"
guard_sum="$(cksum "$GUARD" | cut -d' ' -f1)"
ruler_sum="$(cksum "$RULER" | cut -d' ' -f1)"
unified_sum="$(cksum "$UNIFIED" | cut -d' ' -f1)"
publisher_sum="$(cksum "$PUBLISHER" | cut -d' ' -f1)"
canal_sum="$(cksum "$CANAL" | cut -d' ' -f1)"
trap 'cp -f "$guard_backup" "$GUARD" 2>/dev/null || true; cp -f "$ruler_backup" "$RULER" 2>/dev/null || true; cp -f "$unified_backup" "$UNIFIED" 2>/dev/null || true; cp -f "$publisher_backup" "$PUBLISHER" 2>/dev/null || true; cp -f "$canal_backup" "$CANAL" 2>/dev/null || true; rm -rf "$TMP_DIR"' EXIT
restaurar_originais() {
  cp -f "$guard_backup" "$GUARD"
  cp -f "$ruler_backup" "$RULER"
  cp -f "$unified_backup" "$UNIFIED"
  cp -f "$publisher_backup" "$PUBLISHER"
  cp -f "$canal_backup" "$CANAL"
  if [ "$(cksum "$GUARD" | cut -d' ' -f1)" != "$guard_sum" ] || [ "$(cksum "$RULER" | cut -d' ' -f1)" != "$ruler_sum" ] || [ "$(cksum "$UNIFIED" | cut -d' ' -f1)" != "$unified_sum" ] || [ "$(cksum "$PUBLISHER" | cut -d' ' -f1)" != "$publisher_sum" ] || [ "$(cksum "$CANAL" | cut -d' ' -f1)" != "$canal_sum" ]; then
    fail "RESTAURAÇÃO FALHOU (checksum diverge) — restaure a partir de $TMP_DIR"
    exit 1
  fi
}
# ── mutar_arquivo: o mesmo contrato do `mutar_guard`, para as OUTRAS fontes
# que o canal do remédio usa (a construção do patch e o publicador).
#
# A troca vai pela RÉGUA (`mutacao_aplicar_sem_marcador`): a CIRURGIA (exatamente
# 1 ocorrência do alvo) e o CONTEÚDO (o checksum mudou) são as MESMAS provas do
# caminho estrito, no MESMO sítio. O que este caminho DISPENSA é a prova do
# MARCADOR, e ele a dispensa POR DECLARAÇÃO — o payload é um FRAGMENTO no MEIO da
# linha do alvo, e um comentário de marcador engoliria o que vem depois dele (a
# dispensa é a mesma que o `SEM_MARCADOR` do master declara).
#
# A cópia LOCAL desta prova (um `python3` privado escrevendo na ÁRVORE) é o que a
# regra da cirurgia privada do `check-mutation-count` recusa: a checagem que mora
# dentro da suíte mede o alvo SEM a régua única — e uma escrita que não entrasse
# deixaria a suíte verde sobre o arquivo ÍNTEGRO.
MOTIVO_SEM_MARCADOR='o payload é um FRAGMENTO no MEIO da linha do alvo (a assinatura do `fixAll`): um comentário de marcador engoliria o resto da linha, e a troca — LITERAL, com CIRURGIA e CONTEÚDO provados pela régua — não o comporta'
mutar_arquivo() {
  mutacao_aplicar_sem_marcador "$1" "$2" "$3" "$4" "$MOTIVO_SEM_MARCADOR"
}
mutar_guard() { # <alvo> <troca>: a cirurgia, o marcador e o checksum são da régua
  # COMPARTILHADA (`mutacao_aplicar`).
  mutacao_aplicar "$GUARD" "$1" "$2" "$guard_sum"
}
# ── mutar_regua: o mesmo contrato, mas sobre a RÉGUA (fonte única) ────────
# Usado pelo H3: o alvo é a LINHA DA RÉGUA, e o checksum de referência é o DELA
# — sem isso, uma mutação que não aplicasse passaria como "guard imune".
mutar_regua() { # <alvo> <troca>: a cirurgia, o marcador e o checksum são da régua
  # COMPARTILHADA (`mutacao_aplicar`).
  mutacao_aplicar "$RULER" "$1" "$2" "$ruler_sum"
}

header "MUTAÇÃO H2: sem a conta do corpo vazio o passo SOME do relatório"
mutar_guard '    passosCorpoVazio += counts.corpoVazio' '    passosCorpoVazio += 0 // MUTACAO H2'
mutar_guard '    for (const v of passosVazios) {' '    for (const v of []) { // MUTACAO H2'
exit_code="$(rodar "$raiz" "$TMP_DIR/h2.txt")"
if [ "$exit_code" -ne 0 ]; then
  fail "com o corpo vazio fora da conta o guard mudou de veredito (exit $exit_code) — a conta não é violação, a mutação tinha de ser silenciosa no exit"
  cat "$TMP_DIR/h2.txt"
  exit 1
fi
if grep -qF "fora do escopo da varredura" "$TMP_DIR/h2.txt"; then
  fail "mutação H2 NÃO detectada: sem a conta do corpo vazio o relatório AINDA nomeia o passo — o controle H1 não morde"
  cat "$TMP_DIR/h2.txt"
  exit 1
fi
pass "mutação H2 DETECTADA: o corpo vazio desaparece do relatório junto com a conta — é o que a asserção do controle H1 prende"
restaurar_originais

header 'CONTROLE H3: o `- run:` inline com continuação entra na varredura INTEIRO'
raiz3="$(nova_raiz)"
mkdir -p "$raiz3/.github/workflows"
cat > "$raiz3/.github/workflows/inline.yml" <<'YML'
on:
  pull_request:
jobs:
  unico:
    steps:
      - run: docker ps \
          | grep -q runner
YML
exit_code="$(rodar "$raiz3" "$TMP_DIR/h3.txt")"
if [ "$exit_code" -ne 1 ]; then
  fail "o passo inline com CONTINUAÇÃO passou (exit $exit_code) — o \`| grep -q\` da segunda linha ficou invisível (o passo julgado por METADE)"
  cat "$TMP_DIR/h3.txt"
  exit 1
fi
if ! grep -qF 'grep -q runner <<< "$(docker ps)"' "$TMP_DIR/h3.txt"; then
  fail "a ocorrência não saiu com as DUAS metades do pipeline dobrado (o remédio tem de ser o comando inteiro)"
  cat "$TMP_DIR/h3.txt"
  exit 1
fi
pass "controle H3: o pipeline dobrado pelo YAML é lido INTEIRO e o remédio carrega as duas metades"

header 'MUTAÇÃO H3: ler só a PRIMEIRA linha do `run:` inline torna o passo invisível'
# O alvo é a RÉGUA: a leitura do escalar dobrado (o `run: cmd \` + a continuação)
# mora na fonte única, e o guard a consome por `workflowRunBodies` — mutar a cópia
# local (se ela voltasse a existir) deixaria a prova verde e o script como CEGO.
mutar_regua '      const partes = [runInline]
      let k = runIdx + 1
      for (; k < bloco.length; k++) {' '      const partes = [runInline]
      let k = runIdx + 1
      for (; k < runIdx + 1; k++) { // MUTACAO H3'
exit_code="$(rodar "$raiz3" "$TMP_DIR/h3-mut.txt")"
if [ "$exit_code" -ne 0 ]; then
  fail "mutação H3 NÃO detectada: com a leitura limitada à primeira linha o guard AINDA achou a ocorrência"
  cat "$TMP_DIR/h3-mut.txt"
  exit 1
fi
pass "mutação H3 DETECTADA: a leitura da continuação é o que faz a ocorrência aparecer — é a regressão que o controle H3 prende"
restaurar_originais

# ══════════════════════════════════════════════════════════════════════════
# O CANAL DO REMÉDIO (R): o preview que vai AO PR tem de ser o MESMO remendo
# ══════════════════════════════════════════════════════════════════════════
# O `--fix` já era provado (caso D). O que NÃO era medido é a OUTRA ponta do
# mesmo remédio: o patch que o `pr-remedy-comment` publica como comentário no PR.
# Três propriedades, cada uma com o seu mutante:
#
#   R1 — o patch APLICA byte a byte (`git apply`), com a cicatriz no MEIO do
#        arquivo: um hunk SEM contexto é recusado pelo `git apply`, e o
#        comentário do PR prometeria um remendo inaplicável — em SILÊNCIO,
#        porque quem lê o comentário só descobriria ao aplicar;
#   R2 — o preview NÃO grava: quem grava é o `--fix`. Um `dry: false` aqui
#        mudaria a árvore de quem só pediu para VER o patch;
#   R3 — os dois fixers têm marcadores PRÓPRIOS: a reconciliação de um não pode
#        escolher (nem retirar) o comentário do outro. Um marcador comum faz
#        exatamente isso, e o aviso do outro gate some do PR sem ninguém notar.

nova_raiz_r() {
  rm -rf "${TMP_DIR:?}/fxr"
  mkdir -p "$TMP_DIR/fxr/scripts"
  cat > "$TMP_DIR/fxr/scripts/alvo.sh" <<'SHR'
#!/usr/bin/env bash
set -euo pipefail

antes=1
echo "$OUT" | grep -q "runner"
depois=2
SHR
  echo "$TMP_DIR/fxr"
}

# O patch do PREVIEW, pelo MESMO caminho que o publicador usa (`remedyPatch`).
# Ecoa o nº de remendos e grava o patch em $2.
preview_patch() {
  RAIZ="$1" SAIDA="$2" GUARD_PATH="$GUARD" node --input-type=module -e '
import { writeFileSync } from "node:fs"
const { remedyPatch } = await import(process.env.GUARD_PATH)
const r = remedyPatch(process.env.RAIZ)
writeFileSync(process.env.SAIDA, r.patch)
process.stdout.write(String((r.fixed ?? []).length))
'
}

# Um repo git com o fixture NO ÍNDICE: é contra ele que o `git apply` do
# operador roda (o patch é relativo à raiz do repositório).
repo_com_alvo() {
  local destino
  destino="$(mktemp -d "$TMP_DIR/$1.XXXXXX")"
  mkdir -p "$destino/scripts"
  cp "$RAIZ_R/scripts/alvo.sh" "$destino/scripts/alvo.sh"
  git -C "$destino" init -q
  git -C "$destino" add -A
  git -C "$destino" -c user.email=t@t -c user.name=t commit -qm base
  echo "$destino"
}

header 'CONTROLE R1: o patch do PREVIEW aplica pelo `git apply` (cicatriz no MEIO do arquivo)'
RAIZ_R="$(nova_raiz_r)"
repo_r1="$(repo_com_alvo repo-r1)"
remendos="$(preview_patch "$RAIZ_R" "$TMP_DIR/r1.patch")"
if [ "$remendos" != "1" ]; then
  fail "o preview do SIGPIPE não remendou o caso mecânico (fixed=$remendos) — nada a provar sobre aplicar"
  exit 1
fi
set +e
git -C "$repo_r1" apply "$TMP_DIR/r1.patch" > "$TMP_DIR/r1-apply.txt" 2>&1
apply_exit=$?
set -e
if [ "$apply_exit" -ne 0 ]; then
  fail "o patch publicado NÃO aplica (exit $apply_exit) — o comentário prometeria um remendo inaplicável"
  cat "$TMP_DIR/r1-apply.txt"
  exit 1
fi
if ! grep -qF 'grep -q "runner" <<< "$OUT"' "$repo_r1/scripts/alvo.sh"; then
  fail "o patch aplicou mas o arquivo não ficou com o herestring — o remendo publicado não é o do --fix"
  cat "$repo_r1/scripts/alvo.sh"
  exit 1
fi
# A ponta que importa: depois de aplicar, o gate SAI 0 — o remédio do PR
# realmente fecha a cicatriz, e não só "aplica".
exit_r1="$(rodar "$repo_r1" "$TMP_DIR/r1-pos.txt")"
if [ "$exit_r1" -ne 0 ]; then
  fail "depois de aplicar o patch o gate AINDA reprova (exit $exit_r1) — o remendo fecharia o comentário e não o defeito"
  cat "$TMP_DIR/r1-pos.txt"
  exit 1
fi
pass 'controle R1: o patch do preview aplica pelo `git apply` E o gate no repo remendado fecha em 0'

header 'MUTAÇÃO R1: sem CONTEXTO no hunk o patch do preview deixa de aplicar'
mutar_arquivo "$UNIFIED" '{ file, contexto = 3 } = {}' '{ file, contexto = 0 } = {}' "$unified_sum"
repo_r1m="$(repo_com_alvo repo-r1m)"
preview_patch "$RAIZ_R" "$TMP_DIR/r1m.patch" > /dev/null
set +e
git -C "$repo_r1m" apply "$TMP_DIR/r1m.patch" > "$TMP_DIR/r1m-apply.txt" 2>&1
apply_mut=$?
set -e
if [ "$apply_mut" -eq 0 ]; then
  fail "mutação R1 NÃO detectada: sem contexto o patch AINDA aplicou — o contexto do hunk não é o que faz o remendo aplicar"
  cat "$TMP_DIR/r1m.patch"
  exit 1
fi
pass "mutação R1 DETECTADA: sem contexto o \`git apply\` recusa o patch do preview (exit $apply_mut) — é o CONTEXTO que o torna aplicável"
restaurar_originais

header 'CONTROLE R2: o PREVIEW não grava — quem grava é o `--fix`'
preview_patch "$RAIZ_R" "$TMP_DIR/r2.patch" > /dev/null
sum_intacto="$(cksum "$RAIZ_R/scripts/alvo.sh" | cut -d' ' -f1)"
if ! grep -qF '| grep -q "runner"' "$RAIZ_R/scripts/alvo.sh"; then
  fail "o preview GRAVOU no arquivo (a cicatriz já não está lá) — o canal de aviso não pode mexer na árvore"
  cat "$RAIZ_R/scripts/alvo.sh"
  exit 1
fi
pass 'controle R2: o preview monta o patch e NÃO grava (a cicatriz segue no arquivo, o mesmo checksum)'

header 'MUTAÇÃO R2: o preview com `dry: false` GRAVA — é o `dry` que separa MEDIR de GRAVAR'
mutar_arquivo "$GUARD" 'const r = fixAll(root, { dry: true })' 'const r = fixAll(root, { dry: false })' "$guard_sum"
preview_patch "$RAIZ_R" "$TMP_DIR/r2m.patch" > /dev/null
sum_mutado="$(cksum "$RAIZ_R/scripts/alvo.sh" | cut -d' ' -f1)"
if [ "$sum_mutado" = "$sum_intacto" ]; then
  fail "mutação R2 NÃO detectada: com \`dry: false\` o arquivo segue intacto — o alvo não casou no guard"
  exit 1
fi
pass 'mutação R2 DETECTADA: com `dry: false` o preview GRAVA no repositório — o canal de aviso vira remédio aplicado sem pedir'
restaurar_originais

# ── R3: os dois fixers no MESMO PR ────────────────────────────────────────
# A reconciliação roda contra um canal DUBLÊ: a lista traz o comentário do gate
# do `bash -n` (id 11) e o do SIGPIPE (id 22), e o SIGPIPE é reconciliado com
# `body: null` (a cicatriz dele sumiu). Com marcadores próprios, SÓ o 22 sai.
reconcilia_pipefail() {
  PUBLISHER="$PUBLISHER" node --input-type=module -e '
const { reconcileRemedy, FIXERS } = await import(process.env.PUBLISHER)
const comentarios = [
  { id: 11, body: "aviso do gate bash -n\n<!-- run-syntax-remedy -->" },
  { id: 22, body: "aviso do gate SIGPIPE\n<!-- pipefail-sigpipe-remedy -->" },
]
const chamadas = []
const request = async (_c, method, path) => {
  chamadas.push(method + " " + path)
  if (method === "GET") return { status: 200, data: comentarios }
  return { status: method === "DELETE" ? 204 : 201, data: {} }
}
const r = await reconcileRemedy({
  request,
  config: {},
  kind: "github",
  pr: 7,
  body: null,
  marker: FIXERS["pipefail-sigpipe"].marker,
})
process.stdout.write(JSON.stringify({ action: r.action, id: r.id, chamadas }))
'
}

# Lê o JSON da reconciliação (gravado em $1) e ecoa as exclusões, uma por ' | '.
delecoes_de() {
  node -e 'const j = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))
process.stdout.write(j.chamadas.filter((c) => c.startsWith("DELETE")).join(" | "))' "$1"
}

header 'CONTROLE R3: marcadores PRÓPRIOS — reconciliar o SIGPIPE não toca o comentário do `bash -n`'
reconcilia_pipefail > "$TMP_DIR/r3.json"
del_controle="$(delecoes_de "$TMP_DIR/r3.json")"
if [ "$del_controle" != "DELETE /issues/comments/22" ]; then
  fail "a reconciliação do SIGPIPE não retirou EXATAMENTE o comentário dele (exclusões: '$del_controle')"
  cat "$TMP_DIR/r3.json"
  exit 1
fi
pass 'controle R3: a cicatriz do SIGPIPE sumiu e SÓ o comentário do SIGPIPE foi retirado (id 22) — o do `bash -n` (id 11) fica'

header 'MUTAÇÃO R3: um marcador COMUM faz a reconciliação retirar o comentário do OUTRO gate'
mutar_arquivo "$CANAL" 'marker: "<!-- pipefail-sigpipe-remedy -->",' 'marker: "<!-- run-syntax-remedy -->",' "$canal_sum"
reconcilia_pipefail > "$TMP_DIR/r3m.json"
del_mutado="$(delecoes_de "$TMP_DIR/r3m.json")"
case "$del_mutado" in
  *"/issues/comments/11"*)
    pass 'mutação R3 DETECTADA: com o marcador comum o comentário do `bash -n` (id 11) é retirado junto — um aviso que ainda valia some do PR'
    ;;
  *)
    fail "mutação R3 NÃO detectada: com o marcador comum as exclusões foram '$del_mutado' (o comentário do outro gate devia cair)"
    cat "$TMP_DIR/r3m.json"
    exit 1
    ;;
esac
restaurar_originais

header "VEREDITO"
pass "MUTATION TEST PASSED — o guard pega o pipe quieto sob pipefail (script E"
pass 'workflow com shell bash E no passo sem shell declarado, com a marca da premissa),'
pass "reprova a DECLARAÇÃO de shell default que liga o pipefail (nomeando escopo e"
pass "passos reclassificados) sem acusar herestring/script sem pipefail/heredoc,"
pass "respeita a cota do baseline sem esconder crescimento, e o --fix aposenta o"
pass "caso mecânico sem tocar fixture, sem perder expressão do runner e sem mexer"
pass "em grep de leitura."
pass "E a dívida NÃO se re-declara em silêncio: --update sem --reason não"
pass "grava nada, e uma decisão vencida/sem razão/ com data impossível não"
pass "passa em modo nenhum — o cron (--review) é quem a escala para violação."
pass "E o ESCOPO da varredura é medido: o passo de corpo vazio sai nomeado e a"
pass "soma fecha contra a própria fixture, a leitura da continuação inline é o que"
pass "faz a ocorrência aparecer, e tirar qualquer das duas do guard derruba a prova."
pass "E o CANAL do remédio (o patch que vai ao PR) é medido nas três metades: o"
pass "patch APLICA pelo git apply e fecha o gate, o preview NÃO grava (é o --fix"
pass "que grava), e cada fixer tem marcador PRÓPRIO — tirar qualquer uma das três"
pass "derruba o script."
exit 0
