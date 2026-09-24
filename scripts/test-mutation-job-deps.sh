#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-job-deps.sh — Mutation test do guard das DEPENDÊNCIAS dos
# jobs (scripts/check-job-deps.mjs)
#
# Usage:
#   ./scripts/test-mutation-job-deps.sh
#
# Exit codes:
#   0 — as DOZE mutações foram DETECTADAS (pelo gate e/ou pela suíte) e os
#       controles passaram ✅
#   1 — guard INDIFERENTE a alguma mutação (não cegou / não acusou) OU controle
#       falso ❌
#
# O QUE ISTO PROVA (e por que não basta o guard passar hoje)
#
# Um gate que roda e sai 0 prova que ele não ACUSOU — não prova que ele MEDIU. A
# promessa deste guard é "um job que roda comando dependente de node_modules
# INSTALA ou declara a isenção — e a isenção declarada é VERDADEIRA". Os
# mecanismos que ela usa são sete, e cada um tem aqui a sua mutação, nas duas
# direções (a que CEGA deixa passar o defeito; a que ACUSA O SÃO trava merge
# legítimo — as duas são regressão):
#
#   M1 — O IMPORT DE TOPO (importsEstaticos). É o que separa "estatico" (o
#        processo MORRE sem o pacote) de "tardio" (o caminho pode não ser
#        percorrido). Sem ele o GRAU mente — e a isenção "passa" deixa de ser
#        verificável (uma afirmação que o grafo desmente passaria).
#   M2 — O GRAFO DO ALVO (o arquivo JS do comando). Cegá-lo é a cegueira mais
#        direta: o job que roda um guard de YAML sem instalar volta a sair
#        VERDE, que é exatamente o defeito que este guard existe para pegar.
#   M3 — O INSTALL DO JOB (INSTALL_SUBCOMMANDS). Aqui a mutação vai na direção
#        contrária: um job que INSTALA passa a ser acusado (violação falsa) —
#        sem esta metade, "ficou cego" não significaria nada.
#   M4 — O ESCOPO VARBIDO. A isenção de um workflow que o escopo NÃO LEU não
#        sustenta veredito: sem esta guarda, rodar o guard num recorte (fixture)
#        acusa as isenções reais como "sem objeto" — violação sobre arquivo que
#        aquele escopo não contém.
#   M5 — O "SEM OBJETO". Uma isenção que sobrou sobre um job que passou a
#        INSTALAR mente sobre o presente: sem a regra, a declaração velha fica
#        para sempre.
#   M6 — O REGISTRO DA DATA (fail-closed). Sem addedAt a isenção não envelhece
#        — e "esqueci de registrar" viraria o jeito de nunca revisar. A mutação
#        desliga a violação e a isenção SEM data passa.# M7 — A JANELA DE REVISÃO (--review). O run normal avisa; o job semanal
#        ESCALA. Sem a escalada, a janela de 180 dias é decorativa e a dívida
#        vence em silêncio no único canal que a revisa.
#   M8 — A CLASSE DO ALVO (o flag não é o alvo). Um passo que roda
#        `bash -u scripts/corpo.sh` (o flag na frente do arquivo) tem de ser
#        julgado pelo CORPO do script — e o corpo é `node scripts/topo.mjs`, com
#        `pg` de topo. Enquanto a leitura era `tokens[0].startsWith("-")`, TODO
#        flag virava "payload inline": o arquivo estava na frente do guard e o
#        job saía do escopo sem ninguém decidir. A mutação devolve essa leitura e
#        o defeito PASSA — a classe (a mesma régua do `check-hook-commands`,
#        `alvoDoLancador` → `classeDoFlag`) é o que sustenta o vermelho.
#   M9 — A LEITURA DO CAMINHO (`runs-on`). O SEGUNDO contrato do guard: um gate
#        de LEITURA DE YAML não pode estar preso à infraestrutura da forja. Sem
#        a leitura do caminho, o mesmo leitor em `self-hosted` volta a passar —
#        e o veredito dele volta a depender de o runner da forja estar de pé.
#   M10 — A CLASSE DERIVADA (`le.length > 0`). A mutação vai na direção
#        OPOSTA: sem o fato de que o job LÊ YAML, todo job de leitura no
#        caminho da forja passa a ser ACUSADO (violação falsa) — o que trava
#        merge legítimo. O `le.length > 0` é o que sustenta o verde do job que
#        não lê YAML.
#   M11 — A EXCEÇÃO DECLARADA E SEM OBJETO. Uma exceção declarada faz o leitor
#        de YAML no caminho da forja passar (a decisão é declarada, não
#        presumida) — e a MESMA exceção sobre um job que já roda no caminho
#        hospedado é declaração que sobrou: sem a regra, ela fica para sempre.
#   M12 — A FILA DE MIGRAÇÃO publicada no veredito. Quem AINDA pede a forja sem
#        que nenhum fato exija a imagem dela sai NOMEADO no verde (texto e
#        --json), com a exceção declarada INCLUSA — a declaração tira o job do
#        vermelho, não da fila. Sem a publicação, migrar o que resta é
#        varredura manual: o operador teria de cruzar allowlist com workflow.
#
# AS DUAS TESTEMUNHAS. Onde a regra muda o veredito do CLI, a prova é o EXIT CODE
# sobre fixtures (comportamento, não leitura do código). Onde o veredito só
# aparece na API do módulo (a lista de isenções é injetável ali, e o CLI usa a do
# repositório), a testemunha é a suíte check-job-deps.test.ts — que é o que roda
# em todo PR. Onde o vitest não está instalado o motivo é DITO (nunca
# silencioso): o exit code de uma suíte que não rodou não é veredito.
#
# AS REGRAS DA ALLOWLIST (escopo, sem-objeto, data, janela) SÃO MEDIDAS POR
# EXECUÇÃO: os blocos M5–M7 inserem uma ISENÇÃO na lista do repositório (com o
# SETUP declarado no próprio bloco, restaurado junto) e a medem contra as
# fixtures — o CLI usa a lista do repositório, e uma lista injetável só existiria
# na API do módulo (a testemunha da suíte). O SETUP é cirúrgico e verificado pelo
# mesmo mecanismo das mutações.
#
# COMO (e por que assim): o guard REAL é executado contra mini-repos fixture em
# mktemp (e o repositório de verdade no CONTROLE A), com as mutações aplicadas
# NO LUGAR no arquivo do repositório — backup + restauração VERIFICADA por
# checksum (trap EXIT): um "exit" no meio não pode deixar a árvore mutada.
#
# Pipeline:
#   1. CONTROLE A — o guard REAL passa no repositório (sem violação, sem isenção
#      mentirosa)
#   2. CONTROLE B — o guard REAL reprova as fixtures de defeito e aprova as
#      limpas (sem esta metade, "ficou cego" não significaria nada)
#   3. M1..M7 — cada mecanismo mutado, com a cirurgia das fixtures vizinhas
#   4. CONTROLE FINAL — o guard restaurado volta a reprovar o defeito
#   5. Cleanup (trap EXIT — restaura o guard e remove o temp, mesmo com falha)
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'M1|O IMPORT DE TOPO (importsEstaticos)'
  'M2|O GRAFO DO ALVO (o arquivo JS do comando)'
  'M3|O INSTALL DO JOB (INSTALL_SUBCOMMANDS)'
  'M4|O ESCOPO VARRIDO: a isenção de um workflow que o escopo NÃO leu não vale'
  'M5|o SEM OBJETO: isenção que sobrou sobre um job que passou a instalar'
  'M6|O REGISTRO DA DATA (fail-closed)'
  'M7|A JANELA DE REVISÃO (--review)'
  'M8|A CLASSE DO ALVO: um flag na frente do arquivo não é o alvo'
  'M9|A LEITURA DO CAMINHO: o gate de leitura de YAML preso ao runner da forja'
  'M10|A CLASSE DERIVADA: um leitor que não lê YAML não é gate de leitura'
  'M11|A EXCEÇÃO DECLARADA do caminho, e a que não tem mais objeto'
  'M12|A FILA DE MIGRAÇÃO: quem ainda pede a forja sem precisar sai NO veredito'
)
GUARD="$SCRIPT_DIR/scripts/check-job-deps.mjs"
SUITE_ARQUIVO="src/lib/__tests__/check-job-deps.test.ts"

# ── AUTO-CHECAGEM: mensagem com CRASE entre aspas DUPLAS ──────────────────
# A crase é substituída pelo shell: o texto da mensagem some e o comando de
# dentro RODA. Medido nesta suíte: `pass "... o `pg` de topo ..."` imprimiu "o
#  de topo" e o shell tentou executar `pg`; no bloco da M8, o texto da própria
# MUTAÇÃO perdeu a mensagem do motivo e o sub-test passava medindo outro texto.
# Uma mensagem que mente sobre o que mediu é pior que um erro: a suíte recusa
# rodar.
if grep -nE '^[[:space:]]*(pass|fail|info|header)[[:space:]]+"[^"]*`' "$0" >/dev/null; then
  echo "❌ mensagem com crase entre aspas DUPLAS (o shell a executa, na linha):"
  grep -nE '^[[:space:]]*(pass|fail|info|header)[[:space:]]+"[^"]*`' "$0" | sed 's/^/     /'
  exit 2
fi

TMP_DIR="$(mktemp -d)"
FX_TOPO="$TMP_DIR/fx-topo"
FX_SEM_INSTALL="$TMP_DIR/fx-sem-install"
FX_LIMPO="$TMP_DIR/fx-limpo"
FX_FLAG="$TMP_DIR/fx-flag"
FX_FLAG_LIMPO="$TMP_DIR/fx-flag-limpo"
FX_CAMINHO_FORJA="$TMP_DIR/fx-caminho-forja"
FX_CAMINHO_HOSPEDADO="$TMP_DIR/fx-caminho-hospedado"
FX_CAMINHO_SEM_YAML="$TMP_DIR/fx-caminho-sem-yaml"

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

# ── Backup da FONTE + restauração VERIFICADA (trap EXIT) ──────────────────
# As mutações são aplicadas NO LUGAR, no arquivo do repositório (é ele que a
# suíte unitária importa e o CLI executa). Backup e restauração no MESMO trap,
# porque um "exit" no meio do caminho não pode deixar a árvore mutada.
guard_backup="$TMP_DIR/guard.original.mjs"
cp "$GUARD" "$guard_backup"
guard_sum="$(cksum "$GUARD" | cut -d' ' -f1)"

cleanup() {
  cp -f "$guard_backup" "$GUARD" 2>/dev/null || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

restaurar_original() {
  cp -f "$guard_backup" "$GUARD"
  if [ "$(cksum "$GUARD" | cut -d' ' -f1)" != "$guard_sum" ]; then
    fail "RESTAURAÇÃO FALHOU (checksum diverge) — restaure a partir de $guard_backup"
    exit 1
  fi
}

# ── mutar_guard: substituição CIRÚRGICA (exatamente 1 ocorrência) ─────────
# Uma mutação que casa 0 ou 2+ vezes não é cirúrgica: o script para em vez de
# medir outra coisa. O marcador "MUTACAO M" no texto novo é o que prova que a
# mutação APLICOU (o alvo pode existir e a escrita falhar).
mutar_guard() {
  GUARD="$GUARD" ALVO="$1" NOVO="$2" python3 - <<'PY'
import os
p = os.environ["GUARD"]
old, new = os.environ["ALVO"], os.environ["NOVO"]
s = open(p).read()
n = s.count(old)
if n != 1:
    raise SystemExit(f"mutacao nao-cirurgica no guard: {n} ocorrencia(s) do alvo (esperado 1)")
open(p, "w").write(s.replace(old, new))
PY
  if ! grep -qF 'MUTACAO M' "$GUARD"; then
    fail "a mutação não aplicou no guard (nada a medir)"
    exit 1
  fi
  if [ "$(cksum "$GUARD" | cut -d' ' -f1)" = "$guard_sum" ]; then
    fail "a mutação não alterou o guard (checksum idêntico) — o alvo casou mas a escrita não"
    exit 1
  fi
}

# ── mkfixture: um mini-repo com um workflow (job, script e install dados) ──
# O guard precisa de um workflow VÁLIDO (a leitura é fail-closed: YAML inválido
# não é "nada a julgar") e do package.json. O nome do job e a presença do
# install são PARÂMETROS porque é a combinação deles que produz cada caso: o
# defeito (job sem install), o controle (job que instala) e as duas fixtures que
# colidem com a isenção real do repositório.
mkfixture() {
  local raiz="$1" workflow="$2" job="$3" install="$4" script="$5" comando="${6:-}"
  # O COMANDO do passo e parametrizavel: o defeito da M8 nao esta no ALVO
  # (`node scripts/x.mjs`), esta em como o alvo e LIDO quando ha um flag na
  # frente (`bash -u scripts/corpo.sh`) — medir isso exige escrever o comando.
  if [ -z "$comando" ]; then comando="node scripts/$script"; fi
  mkdir -p "$raiz/.github/workflows" "$raiz/scripts"
  {
    echo "name: fixture"
    echo "on: pull_request"
    echo "jobs:"
    echo "  $job:"
    echo "    runs-on: ubuntu-latest"
    echo "    steps:"
    echo "      - uses: actions/checkout@v4"
    if [ "$install" = "1" ]; then
      echo "      - run: bun install --frozen-lockfile"
    fi
    echo "      - run: $comando"
  } > "$raiz/.github/workflows/$workflow"
  cat > "$raiz/package.json" <<'JSON'
{ "name": "fixture-da-prova", "private": true, "scripts": {}, "dependencies": {}, "devDependencies": {} }
JSON
  # O guard de YAML do repositório: o js-yaml só aparece em caminho TARDIO.
  cat > "$raiz/scripts/le-yaml.mjs" <<'JS'
export function valida(texto) {
  return require("js-yaml").load(texto)
}
JS
  # O import de TOPO: sem o pacote o processo morre no START (grau estatico).
  cat > "$raiz/scripts/topo.mjs" <<'JS'
import pg from "pg"
export const pool = pg
JS
  # O SCRIPT DE SHELL do alvo da M8: quem o executa depende do que o CORPO dele
  # alcanca — e o corpo chama o `topo.mjs` (o `pg` de topo).
  cat > "$raiz/scripts/corpo.sh" <<'SH'
set -eu
node scripts/topo.mjs
SH
}

# ── mkfixture_caminho: o MESMO job, num caminho dado, lendo (ou não) YAML ──
# O contrato do caminho julga dois FATOS derivados do próprio job: se ele LÊ
# YAML (o fecho de imports RELATIVOS alcança a leitura compartilhada) e em que
# `runs-on` ele roda. A fixture separa os dois: o mesmo job em `self-hosted` e
# em `ubuntu-latest`, e um leitor que NÃO alcança YAML (só cita o nome num
# texto) — o CONTROLE que desmente um vermelho vindo da fixture.
mkfixture_caminho() {
  local raiz="$1" caminho="$2" le="$3"
  mkdir -p "$raiz/.github/workflows" "$raiz/scripts"
  {
    echo "name: fixture"
    echo "on: pull_request"
    echo "jobs:"
    echo "  leitor:"
    echo "    runs-on: $caminho"
    echo "    steps:"
    echo "      - uses: actions/checkout@v4"
    echo "      - run: bun install --frozen-lockfile"
    if [ "$le" = "1" ]; then
      echo "      - run: node scripts/le-yaml.mjs"
    else
      echo "      - run: node scripts/le-doc.mjs"
    fi
  } > "$raiz/.github/workflows/pr.yml"
  cat > "$raiz/package.json" <<'JSON'
{ "name": "fixture-de-caminho", "private": true, "scripts": {}, "dependencies": {}, "devDependencies": {} }
JSON
  # O leitor de YAML: o import RELATIVO alcanca a leitura compartilhada.
  cat > "$raiz/scripts/le-yaml.mjs" <<'JS'
import { valida } from "./forge-workflows.mjs"
export function le(texto) {
  return valida(texto)
}
JS
  cat > "$raiz/scripts/forge-workflows.mjs" <<'JS'
export function valida(texto) {
  return require("js-yaml").load(texto)
}
JS
  # O CONTROLE da classe: um leitor que NÃO alcança YAML — a menção ao módulo
  # está num TEXTO, e é por SPECIFIER que a leitura é detectada.
  cat > "$raiz/scripts/le-doc.mjs" <<'JS'
export const NOTA = "a leitura compartilhada vive em scripts/forge-workflows.mjs"
export const ok = 1
JS
}

# ── rodar_guard / rodar_guard_real / rodar_guard_json ─────────────────────
rodar_guard() {
  set +e
  GUARD_OUT="$(cd "$SCRIPT_DIR" && node "$GUARD" --root "$1" 2>&1)"
  GUARD_EXIT=$?
  set -e
}

rodar_guard_real() {
  set +e
  GUARD_OUT="$(cd "$SCRIPT_DIR" && node "$GUARD" 2>&1)"
  GUARD_EXIT=$?
  set -e
}

JSON_OUT=""
rodar_guard_json() {
  set +e
  JSON_OUT="$(cd "$SCRIPT_DIR" && node "$GUARD" --root "$1" --json 2>&1)"
  set -e
}

# ── rodar_suite: a segunda testemunha (a suíte unitária do guard) ─────────
suite_disponivel() { [ -d "$SCRIPT_DIR/node_modules/vitest" ]; }

rodar_suite() {
  set +e
  SUITE_OUT="$(cd "$SCRIPT_DIR" && bun x vitest run --config vitest.config.unit.ts "$SUITE_ARQUIVO" 2>&1 | tail -8)"
  SUITE_EXIT=$?
  set -e
}

# ── Asserções do veredito (medem o CLI, não a intenção) ───────────────────
mostrar() { echo "$GUARD_OUT" | head -4 | sed 's/^/      /'; }

exigir_reprovado() {
  local cenario="$1" raiz="$2"
  rodar_guard "$raiz"
  if [ "$GUARD_EXIT" -ne 1 ]; then
    fail "$cenario: esperava exit 1 (violação) e veio $GUARD_EXIT — o guard NÃO julga este defeito"
    mostrar
    exit 1
  fi
}

exigir_aprovado() {
  local cenario="$1" raiz="$2"
  rodar_guard "$raiz"
  if [ "$GUARD_EXIT" -ne 0 ]; then
    fail "$cenario: esperava exit 0 (verde) e veio $GUARD_EXIT"
    mostrar
    exit 1
  fi
}

exigir_cego() {
  local cenario="$1" raiz="$2"
  rodar_guard "$raiz"
  if [ "$GUARD_EXIT" -ne 0 ]; then
    fail "$cenario: a mutação NÃO cegou o guard (exit $GUARD_EXIT, esperado 0) — o mecanismo mutado não sustenta nada"
    mostrar
    exit 1
  fi
}

# ── exigir_suite_vermelha: a suíte unitária tem de notar a mutação ────────
exigir_suite_vermelha() {
  local cenario="$1"
  if ! suite_disponivel; then
    info "$cenario (suíte): NÃO julgada — node_modules/vitest ausente neste job (declarado, nunca silencioso)"
    return 0
  fi
  rodar_suite
  if [ "$SUITE_EXIT" -eq 0 ]; then
    fail "$cenario: a suíte unitária ficou VERDE com o guard mutado — a regressão passaria no PR em silêncio"
    echo "$SUITE_OUT" | sed 's/^/      /'
    exit 1
  fi
  pass "$cenario: suíte unitária VERMELHA (exit $SUITE_EXIT) — a regressão não passa no PR"
}

# ── As fixtures ───────────────────────────────────────────────────────────
mkfixture "$FX_TOPO" "pr-topo.yml" "guard" 0 "topo.mjs"
mkfixture "$FX_SEM_INSTALL" "pr.yml" "guard" 0 "le-yaml.mjs"
mkfixture "$FX_LIMPO" "pr.yml" "guard" 1 "le-yaml.mjs"
# M8: o alvo ATRAS de um flag. O que executa o `pg` de topo é o CORPO do
# `corpo.sh` — e para ler o corpo é preciso primeiro PROVAR qual é o alvo.
mkfixture "$FX_FLAG" "pr-flag.yml" "guard" 0 "corpo.sh" "bash -u scripts/corpo.sh"
mkfixture "$FX_FLAG_LIMPO" "pr-flag.yml" "guard" 1 "corpo.sh" "bash -u scripts/corpo.sh"
# O contrato do CAMINHO: o leitor de YAML no caminho da forja (o defeito), o
# MESMO job no caminho hospedado (o controle que isola a causa) e um leitor que
# não alcança YAML (o controle da CLASSE).
mkfixture_caminho "$FX_CAMINHO_FORJA" "self-hosted" 1
mkfixture_caminho "$FX_CAMINHO_HOSPEDADO" "ubuntu-latest" 1
mkfixture_caminho "$FX_CAMINHO_SEM_YAML" "self-hosted" 0

echo -e "${CYAN}═══ Mutation test: dependências dos jobs (check-job-deps) ═══${NC}"
echo "  guard: $GUARD"
echo "  suíte: $SUITE_ARQUIVO"

# ── 1. CONTROLE A: o repositório REAL é verde ─────────────────────────────
header "CONTROLE A: o repositório REAL é verde"
rodar_guard_real
if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "CONTROLE A: o guard REPROVA o repositório (exit $GUARD_EXIT) — conserte a árvore antes de medir mutação"
  mostrar
  exit 1
fi
pass "CONTROLE A: o repositório passa (exit 0) — é este verde que a mutação tem de morder"

# ── 2. CONTROLE B: as duas direções ───────────────────────────────────────
header "CONTROLE B (SENSIBILIDADE): o guard REAL julga as duas direções"
exigir_reprovado "CONTROLE B1 (job sem install, guard de YAML)" "$FX_SEM_INSTALL"
pass "CONTROLE B1: job que roda guard dependente de node_modules SEM install é VIOLAÇÃO"
exigir_reprovado "CONTROLE B2 (job sem install, import de topo)" "$FX_TOPO"
pass "CONTROLE B2: o grau estatico (import de TOPO) é VIOLAÇÃO"
exigir_aprovado "CONTROLE B3 (job que instala)" "$FX_LIMPO"
pass "CONTROLE B3: o job que INSTALA passa — o controle na direção oposta"
# M8 nas DUAS direções: o comando com o flag na frente do arquivo é julgado pelo
# corpo do script (VIOLAÇÃO sem install) e o mesmo job que INSTALA passa.
exigir_reprovado 'CONTROLE B4 (flag antes do alvo: bash -u scripts/corpo.sh)' "$FX_FLAG"
pass 'CONTROLE B4: o pg de topo do CORPO do shell é achado ATRAS do flag — a classe lê o alvo'
exigir_aprovado "CONTROLE B5 (o mesmo comando no job que instala)" "$FX_FLAG_LIMPO"
pass "CONTROLE B5: o mesmo comando no job que INSTALA passa — o vermelho da B4 é do install, não do comando"
rodar_guard_json "$FX_TOPO"
if [ "$(echo "$JSON_OUT" | grep -c '"estatico"')" -lt 1 ]; then
  fail "CONTROLE B: o relatório --json não declara o grau estatico da fixture de import de topo"
  exit 1
fi
pass "CONTROLE B6: o GRAU sai no relatório (--json), não só no texto"

if suite_disponivel; then
  rodar_suite
  if [ "$SUITE_EXIT" -ne 0 ]; then
    fail "CONTROLE B (suíte): a suíte está VERMELHA na árvore íntegra — conserte antes de medir mutação"
    echo "$SUITE_OUT" | sed 's/^/      /'
    exit 1
  fi
  pass "CONTROLE B (suíte): a suíte unitária passa na árvore íntegra"
else
  info "CONTROLE B (suíte): NÃO julgada — node_modules/vitest ausente neste job (declarado, nunca silencioso)"
fi

# ── 3. MUTAÇÃO M1: o IMPORT DE TOPO (o grau mente) ────────────────────────
header "MUTAÇÃO M1: nunca encontrar import de TOPO (todo pacote vira tardio)"
mutar_guard \
  "    if (isBareSpecifier(m[1])) especs.add(m[1])" \
  "    if (false /* MUTACAO M1 */) especs.add(m[1])"
rodar_guard_json "$FX_TOPO"
if [ "$(echo "$JSON_OUT" | grep -c '"estatico"')" -ne 0 ]; then
  fail "M1: o grau estatico sobreviveu à mutação — o import de topo não é load-bearing"
  exit 1
fi
pass "M1: o grau estatico DESAPARECE com o guard mutado — a distinção topo/tardio sustenta o veredito"
exigir_reprovado "M1 cirúrgica (job sem install e sem isenção)" "$FX_SEM_INSTALL"
pass "M1 CIRÚRGICA: o job sem install segue reprovado — morreu só a régua do grau"
exigir_suite_vermelha "M1"
restaurar_original

# ── 4. MUTAÇÃO M2: o GRAFO do alvo (o guard fica cego) ────────────────────
header "MUTAÇÃO M2: ignorar o grafo do arquivo JS do comando"
mutar_guard \
  "  if (EXTENSOES_JS.some((e) => abs.endsWith(e))) {" \
  "  if (false /* MUTACAO M2 */) {"
exigir_cego "M2" "$FX_SEM_INSTALL"
pass "M2: o job que roda guard de YAML sem install PASSA com o guard mutado (CEGO) — o grafo é load-bearing"
exigir_cego "M2 (import de topo)" "$FX_TOPO"
pass "M2: a fixture de import de topo também passa (o guard ficou cego nas duas)"
exigir_suite_vermelha "M2"
restaurar_original

# ── 5. MUTAÇÃO M3: o INSTALL do job (violação FALSA) ──────────────────────
header "MUTAÇÃO M3: não reconhecer o INSTALL do job"
mutar_guard \
  'export const INSTALL_SUBCOMMANDS = new Set(["install", "i", "ci"])' \
  'export const INSTALL_SUBCOMMANDS = /* MUTACAO M3 */ new Set([])'
rodar_guard "$FX_LIMPO"
if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "M3: o job que INSTALA seguiu verde — o reconhecimento do install não sustenta o veredito"
  exit 1
fi
pass "M3: o job que INSTALA passa a ser ACUSADO (exit $GUARD_EXIT) — a regra do install sustenta o verde dele"
mostrar
exigir_reprovado "M3 cirúrgica (job sem install)" "$FX_SEM_INSTALL"
pass "M3 CIRÚRGICA: o job sem install segue reprovado — morreu só a regra do install"
exigir_suite_vermelha "M3"
restaurar_original

# ── 6. MUTAÇÃO M4: o ESCOPO VARBIDO (isenção julgada fora do escopo) ──────
header "MUTAÇÃO M4: julgar a isenção de um workflow fora do escopo varrido"
mutar_guard \
  '    if (!varrridos.has(String(entrada.job).split("::")[0])) continue' \
  '    if (false /* MUTACAO M4 */) continue'
rodar_guard "$FX_LIMPO"
if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "M4: o recorte seguiu verde — a guarda de escopo não sustentava nada"
  exit 1
fi
pass "M4: o recorte passa a ser ACUSADO (exit $GUARD_EXIT) pelas isenções de arquivos que ele não leu — o escopo é load-bearing"
mostrar
exigir_reprovado "M4 cirúrgica (o defeito do job sem install segue reprovado)" "$FX_SEM_INSTALL"
pass "M4 CIRÚRGICA: o defeito segue reprovado — morreu só a guarda de escopo"
restaurar_original

# ── 7. MUTAÇÃO M5: a isenção SEM OBJETO ───────────────────────────────────
header "MUTAÇÃO M5: isenção sobre um job que passou a INSTALAR (sem objeto)"
# O setup: uma isenção DECLARADA (com data) para um job que, na fixture,
# INSTALA — a declaração que sobrou. Sem a regra do sem-objeto ela fica para
# sempre.
mutar_guard \
  'export const JOB_DEPS_ALLOWLIST = [' \
  'export const JOB_DEPS_ALLOWLIST = /* MUTACAO M5-SETUP */ [
  {
    job: ".github/workflows/pr.yml::guard",
    addedAt: "2026-09-17",
    semDeps: "falha-fechado",
    reason: "fixture: isencao declarada para um job que INSTALA",
  },'
exigir_reprovado "M5 setup (isenção sobre job que instala)" "$FX_LIMPO"
pass "M5 SETUP: a isenção sobre um job que INSTALA é VIOLAÇÃO (sem objeto)"
mutar_guard \
  "    if (job.instala)" \
  "    if (false /* MUTACAO M5 */)"
exigir_cego "M5" "$FX_LIMPO"
pass "M5: a isenção desnecessária PASSA com o guard mutado (CEGO) — quem cobra a declaração velha é a regra do sem-objeto"
exigir_reprovado "M5 cirúrgica (o defeito de OUTRO workflow segue reprovado)" "$FX_TOPO"
pass "M5 CIRÚRGICA: o defeito de outro workflow segue reprovado — morreu só a regra do sem-objeto"
exigir_suite_vermelha "M5"
restaurar_original

# ── 8. MUTAÇÃO M6: o REGISTRO DA DATA (fail-closed) ──────────────────────
header "MUTAÇÃO M6: isenção SEM addedAt (o registro da decisão)"
# O setup: uma isenção declarada SEM data para a fixture. A lista é a do
# repositório (o CLI não recebe lista por parâmetro) — este é o caminho honesto
# de medir a regra por EXECUÇÃO, com o setup restaurado junto no fim do bloco.
mutar_guard \
  'export const JOB_DEPS_ALLOWLIST = [' \
  'export const JOB_DEPS_ALLOWLIST = /* MUTACAO M6-SETUP */ [
  {
    job: ".github/workflows/pr.yml::guard",
    semDeps: "falha-fechado",
    reason: "fixture: declarada SEM a data da decisao",
  },'
exigir_reprovado "M6 setup (isenção sem data)" "$FX_SEM_INSTALL"
pass "M6 SETUP: a isenção SEM addedAt é VIOLAÇÃO (fail-closed) — a data é load-bearing"
mutar_guard \
  '    ...auditoria.isencoes.invalid.map((i) => ({ tipo: "isencao-sem-data", job: i.id, why: i.why })),' \
  '    ...(false /* MUTACAO M6 */ ? auditoria.isencoes.invalid.map((i) => ({ tipo: "isencao-sem-data", job: i.id, why: i.why })) : []),'
exigir_cego "M6" "$FX_SEM_INSTALL"
pass "M6: a isenção SEM data PASSA com o guard mutado (CEGO) — o fail-closed impede o 'esqueci de registrar'"
exigir_suite_vermelha "M6"
restaurar_original

# ── 9. MUTAÇÃO M7: a JANELA DE REVISÃO (--review) ────────────────────────
header "MUTAÇÃO M7: a decisão VENCIDA não escala no --review (o canal semanal)"
# O setup: uma isenção VENCIDA para a fixture LEGÍTIMA (o job não instala) — a
# única coisa que muda o veredito do --review é a idade da decisão.
mutar_guard \
  'export const JOB_DEPS_ALLOWLIST = [' \
  'export const JOB_DEPS_ALLOWLIST = /* MUTACAO M7-SETUP */ [
  {
    job: ".github/workflows/pr.yml::guard",
    addedAt: "2020-01-01",
    semDeps: "falha-fechado",
    reason: "fixture: isencao declarada e VENCIDA",
  },'
set +e
REVIEW_OUT="$(cd "$SCRIPT_DIR" && node "$GUARD" --root "$FX_SEM_INSTALL" --review 2>&1)"
REVIEW_EXIT=$?
set -e
if [ "$REVIEW_EXIT" -eq 0 ]; then
  fail "M7 SETUP: o --review seguiu VERDE com a decisão vencida — a janela não escala"
  echo "$REVIEW_OUT" | head -4 | sed 's/^/      /'
  exit 1
fi
pass "M7 SETUP: a decisão VENCIDA escala a VIOLAÇÃO no --review (exit $REVIEW_EXIT)"
# O ALVO é o TOKEN `...(review`, não a expressão inteira: o prettier quebra a
# linha em SETE (o `map((a) => ({ ... }))` por dentro do ternário) e uma âncora
# de expressão inteira deixa de casar em SILÊNCIO — a mutação passa a medir 0
# ocorrências e o sub-test morre por INFRA, não porque o guard é cego. Medido:
# foi assim que o `prettier --write` do guard quebrou este sub-test uma vez.
mutar_guard \
  '    ...(review' \
  '    ...(false /* MUTACAO M7 */'
set +e
REVIEW_OUT="$(cd "$SCRIPT_DIR" && node "$GUARD" --root "$FX_SEM_INSTALL" --review 2>&1)"
REVIEW_EXIT=$?
set -e
if [ "$REVIEW_EXIT" -ne 0 ]; then
  fail "M7: o --review seguiu REPROVANDO com o guard mutado (exit $REVIEW_EXIT) — a escalada não era o que sustentava o vermelho"
  echo "$REVIEW_OUT" | head -4 | sed 's/^/      /'
  exit 1
fi
pass "M7: a decisão vencida PASSA no --review com o guard mutado (CEGO) — a janela seria decorativa sem a escalada"
exigir_suite_vermelha "M7"
restaurar_original

# ── 10. MUTAÇÃO M8: a CLASSE DO ALVO (o flag volta a ser o alvo) ──────────
# O NOVO vai entre ASPAS SIMPLES: o texto da mutação tem crase (a mensagem do
# motivo) e, entre aspas duplas, o shell a executaria como comando — medido: a
# linha saiu como "check-job-deps: comando não encontrado" e a mutação escreveu
# OUTRO texto (o sub-test passava sem medir o que diz medir).
header 'MUTAÇÃO M8: ler o flag como ALVO (a leitura antiga do check-job-deps)'
# A mutação devolve exatamente a leitura antiga (tokens[0].startsWith("-") →
# "payload inline"): com ela, o comando com o flag na frente do arquivo sai do
# escopo, o corpo do script nunca é lido e o job sem install — que roda `pg` de
# topo — volta a passar.
mutar_guard \
  '    const lancador = alvoDoLancador(comando)' \
  '    const lancador = /* MUTACAO M8 */ (comando.tokens?.[0] ?? "").startsWith("-")
      ? {
          ok: false,
          classe: CLASSE_DO_FLAG.SEM_ARQUIVO,
          motivo: "payload inline (mutado)",
        }
      : alvoDoLancador(comando)'
exigir_cego "M8" "$FX_FLAG"
pass 'M8: o passo com o flag na frente do arquivo PASSA com o guard mutado (CEGO) — a classe do alvo sustenta o vermelho'
exigir_reprovado "M8 cirúrgica (o defeito SEM flag segue reprovado)" "$FX_SEM_INSTALL"
pass "M8 CIRÚRGICA: o job sem install e sem flag segue reprovado — morreu só a leitura do alvo"
exigir_suite_vermelha "M8"
restaurar_original

# ── 11. CONTROLES do CAMINHO: a classe derivada, e o que ela NÃO acusa ───
header "CONTROLE C: o gate de LEITURA DE YAML não pode estar preso à forja"
exigir_reprovado "CONTROLE C1 (leitor de YAML em self-hosted)" "$FX_CAMINHO_FORJA"
pass "CONTROLE C1: o leitor de YAML no caminho da forja é VIOLAÇÃO — o veredito dele não pode depender do runner"
exigir_aprovado "CONTROLE C2 (o MESMO job no caminho hospedado)" "$FX_CAMINHO_HOSPEDADO"
pass "CONTROLE C2: o MESMO job no caminho hospedado passa — o vermelho da C1 é do CAMINHO, não do comando"
exigir_aprovado "CONTROLE C3 (o leitor que NÃO lê YAML)" "$FX_CAMINHO_SEM_YAML"
pass "CONTROLE C3: um leitor que não alcança YAML segue verde em self-hosted — a classe é DERIVADA (por specifier, não por prosa)"
rodar_guard_json "$FX_CAMINHO_FORJA"
if ! grep -q '"caminho-da-forja"' <<< "$JSON_OUT"; then
  fail "CONTROLE C4: a violação do caminho não sai nomeada no --json (o operador não a vê)"
  echo "$JSON_OUT" | head -6 | sed 's/^/      /'
  exit 1
fi
if ! grep -q '"classe": true' <<< "$JSON_OUT"; then
  fail "CONTROLE C4: o --json não publica o FATO da classe (quem lê não sabe por que o job foi julgado)"
  echo "$JSON_OUT" | head -6 | sed 's/^/      /'
  exit 1
fi
pass "CONTROLE C4: o --json publica a violação e o fato da classe (derivação visível, não implícita)"

# ── 12. MUTAÇÃO M9: a LEITURA DO CAMINHO (o gate volta a ficar preso) ────
header "MUTAÇÃO M9: o caminho do gate de leitura de YAML (runs-on)"
mutar_guard \
  '        prende: le.length > 0 && fatos.length === 0 && PEDE_A_FORJA.test(caminho),' \
  '        prende: /* MUTACAO M9 */ false,'
exigir_cego "M9" "$FX_CAMINHO_FORJA"
pass "M9: o leitor de YAML em self-hosted PASSA com o guard mutado (CEGO) — a leitura do caminho é load-bearing"
exigir_reprovado "M9 cirúrgica (o defeito de dependências segue reprovado)" "$FX_SEM_INSTALL"
pass "M9 CIRÚRGICA: o job sem install segue reprovado — morreu só a leitura do caminho"
exigir_suite_vermelha "M9"
restaurar_original

# ── 13. MUTAÇÃO M10: a CLASSE DERIVADA (acusar o são) ────────────────────
header "MUTAÇÃO M10: a classe derivada (quem LÊ YAML)"
mutar_guard \
  '        prende: le.length > 0 && fatos.length === 0 && PEDE_A_FORJA.test(caminho),' \
  '        prende: /* MUTACAO M10 */ fatos.length === 0 && PEDE_A_FORJA.test(caminho),'
exigir_reprovado "M10 (o job que NÃO lê YAML passou a ser acusado)" "$FX_CAMINHO_SEM_YAML"
pass "M10: sem o fato de que o job LÊ YAML, o job são passa a ser ACUSADO (violação falsa) — a derivação sustenta o verde da C3"
exigir_aprovado "M10 cirúrgica (o leitor no caminho hospedado segue verde)" "$FX_CAMINHO_HOSPEDADO"
exigir_suite_vermelha "M10"
restaurar_original

# ── 14. MUTAÇÃO M11: a EXCEÇÃO declarada, e a que não tem objeto ─────────
header "MUTAÇÃO M11: a exceção declarada do caminho"
# O SETUP: uma exceção declarada para o leitor do fixture. A lista é a do
# repositório (o CLI não recebe lista por parâmetro) — o caminho honesto de
# medir a regra por EXECUÇÃO, restaurado no fim do bloco.
mutar_guard \
  'export const RUNNER_PATH_ALLOWLIST = [' \
  'export const RUNNER_PATH_ALLOWLIST = /* MUTACAO M11-SETUP */ [
  {
    job: ".github/workflows/pr.yml::leitor",
    addedAt: "2026-09-24",
    reason: "fixture: excecao declarada para o leitor de YAML do fixture",
  },'
exigir_aprovado "M11 setup (a exceção declarada)" "$FX_CAMINHO_FORJA"
pass "M11 SETUP: a exceção declarada faz o leitor de YAML no caminho da forja PASSAR — a decisão é DECLARADA, não presumida"
exigir_reprovado "M11 (a MESMA exceção sobre o job no caminho hospedado)" "$FX_CAMINHO_HOSPEDADO"
pass "M11: a exceção sobre um job que JÁ roda no caminho hospedado é VIOLAÇÃO (sem objeto) — a declaração velha não fica para sempre"
# A mutação é a REGRA (o filtro), não a emissão: `...(false ? [] : lista)` ainda
# percorre a lista — medido: o guard seguia acusando e o sub-test morria por
# INFRA ("a mutação não cegou"), não porque o mecanismo fosse load-bearing.
mutar_guard \
  '          return job !== undefined && !job.prende' \
  '          return /* MUTACAO M11 */ false'
exigir_cego "M11" "$FX_CAMINHO_HOSPEDADO"
pass "M11: a exceção sem objeto PASSA com o guard mutado (CEGO) — quem cobra a declaração velha é a regra do sem-objeto"
# A CIRÚRGICA mede OUTRO defeito: o fixture do caminho está DECLARADO (a
# exceção do setup segue na lista), então ele passa por declaração — quem mostra
# que só a regra do sem-objeto morreu é o defeito de dependências, que a mutação
# e a exceção não tocam.
exigir_reprovado "M11 cirúrgica (o defeito de dependências segue reprovado)" "$FX_SEM_INSTALL"
pass "M11 CIRÚRGICA: o defeito de OUTRO contrato segue reprovado — morreu só a regra do sem-objeto"
exigir_suite_vermelha "M11"
restaurar_original

# ── 15. MUTAÇÃO M12: a FILA DE MIGRAÇÃO publicada no veredito ────────────
header "MUTAÇÃO M12: a fila de migração (quem ainda pede a forja sem precisar)"
# O SETUP: uma exceção declarada para o leitor do fixture. A fila INCLUI a
# exceção de propósito — a declaração tira o job do VERMELHO, não da fila: é
# exatamente o job verde-declarado que o próximo a migrar precisa ver (sem
# isto, "migrar o que resta" exigiria ler a allowlist e cruzar à mão).
mutar_guard \
  'export const RUNNER_PATH_ALLOWLIST = [' \
  'export const RUNNER_PATH_ALLOWLIST = /* MUTACAO M12-SETUP */ [
  {
    job: ".github/workflows/pr.yml::leitor",
    addedAt: "2026-09-24",
    reason: "fixture: excecao declarada para o leitor de YAML do fixture",
  },'
exigir_aprovado "M12 setup (a exceção declarada: o fixture volta ao verde)" "$FX_CAMINHO_FORJA"
pass "M12 SETUP: com a exceção declarada o fixture é VERDE — e é o verde que publica a fila"
rodar_guard_json "$FX_CAMINHO_FORJA"
# A fila é lida DO JSON (não por proximidade de grep: o id do job também vive
# em caminho.jobs[], e um teste por janela de linhas mediria o lugar errado).
FILA_OUT="$(printf '%s' "$JSON_OUT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(d["caminho"]["filaMigracao"]))')"
if ! grep -q '.github/workflows/pr.yml::leitor' <<< "$FILA_OUT"; then
  fail "M12: o --json VERDE não publica a fila com o job NOMEADO (a lista só existiria no vermelho, ou não nomeia)"
  echo "$FILA_OUT" | head -6 | sed 's/^/      /'
  exit 1
fi
pass "M12: o --json VERDE publica a fila com o job NOMEADO (a exceção declarada INCLUSA) — o próximo a migrar lê o veredito, não varre workflows"
# A MUTAÇÃO: a derivação da fila morre (filter vazio) — o verde deixa de
# publicar a lista, e o operador volta a depender do cruzamento manual.
mutar_guard \
  '    filaMigracao: leitura.jobs' \
  '    filaMigracao: /* MUTACAO M12 */ leitura.jobs.filter(() => false)'
rodar_guard_json "$FX_CAMINHO_FORJA"
FILA_OUT="$(printf '%s' "$JSON_OUT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(d["caminho"]["filaMigracao"]))')"
if grep -q 'pr.yml::leitor' <<< "$FILA_OUT"; then
  fail "M12: a fila sobreviveu à mutação — o job continua publicado no verde"
  echo "$FILA_OUT" | sed 's/^/      /'
  exit 1
fi
pass "M12: com a derivação da fila mutada, o verde deixa de publicá-la — a publicação é load-bearing, não prosa"
# A SUÍTE (que importa o módulo e lê a fila no retorno de auditaForjas) pega a
# MESMA mutação: sem a fila, a prova da publicação fica vermelha no PR.
exigir_suite_vermelha "M12"
# A CIRÚRGICA: OUTRO contrato segue medindo outro defeito — a fila some, o
# veredito das dependências (o primeiro contrato) continua de pé.
exigir_reprovado "M12 cirúrgica (o defeito de dependências segue reprovado)" "$FX_SEM_INSTALL"
pass "M12 CIRÚRGICA: o defeito de OUTRO contrato segue reprovado — morreu só a publicação da fila"
restaurar_original

# ── 16. CONTROLE FINAL: a árvore ficou como estava ────────────────────────
header "CONTROLE FINAL: restauração verificada por checksum"
exigir_reprovado "CONTROLE FINAL (job sem install)" "$FX_SEM_INSTALL"
pass "CONTROLE FINAL: o guard restaurado volta a reprovar o job sem install"
exigir_aprovado "CONTROLE FINAL (job que instala)" "$FX_LIMPO"
pass "CONTROLE FINAL: o job que instala segue verde"
exigir_reprovado "CONTROLE FINAL (flag antes do alvo)" "$FX_FLAG"
pass "CONTROLE FINAL: o alvo atras do flag volta a ser julgado depois da restauração"
exigir_reprovado "CONTROLE FINAL (leitor de YAML em self-hosted)" "$FX_CAMINHO_FORJA"
pass "CONTROLE FINAL: o leitor de YAML volta a ser reprovado no caminho da forja"
exigir_aprovado "CONTROLE FINAL (o mesmo leitor no caminho hospedado)" "$FX_CAMINHO_HOSPEDADO"
pass "CONTROLE FINAL: o leitor de YAML segue verde no caminho hospedado"

echo
echo -e "${GREEN}═══ MUTATION TEST PASSED — as 12 mutações foram detectadas (gate e/ou suíte) ═══${NC}"
